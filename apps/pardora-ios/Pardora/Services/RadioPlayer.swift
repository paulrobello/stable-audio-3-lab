import AVFoundation
import Foundation
import MediaPlayer
import Observation

protocol RadioAudioSession: AnyObject {
    func activatePlaybackSession() throws
}

protocol RadioNowPlayingCenter: AnyObject {
    var nowPlayingInfo: [String: Any]? { get set }
}

protocol RadioRemoteCommandCenter: AnyObject {
    func configure(
        play: @escaping @MainActor () -> Void,
        pause: @escaping @MainActor () -> Void,
        toggle: @escaping @MainActor () -> Void,
        nextTrack: @escaping @MainActor () -> Void
    )
    func update(isPlaying: Bool, canSkip: Bool)
}

enum RadioAudioSessionConfiguration {
    static let categoryOptions: AVAudioSession.CategoryOptions = []
}

struct RadioPlaybackMetadata {
    var trackID: String?
    var title: String
    var artist: String
    var albumTitle: String?
    var queueText: String?
    var durationSeconds: Int?

    init(
        trackID: String? = nil,
        title: String,
        artist: String = "Pardora",
        albumTitle: String? = nil,
        queueText: String? = nil,
        durationSeconds: Int? = nil
    ) {
        self.trackID = trackID
        self.title = title
        self.artist = artist
        self.albumTitle = albumTitle
        self.queueText = queueText
        self.durationSeconds = durationSeconds
    }

    init?(state: RadioStreamState?) {
        guard let state else {
            return nil
        }

        trackID = state.currentTrack?.id
        title = state.currentTrack?.title ?? "Pardora Radio"
        artist = "Pardora"
        albumTitle = state.selectedStyleId.displayName
        queueText = "\(state.queueAheadCount)/\(state.queueTarget) ahead"
        durationSeconds = state.currentTrack?.durationSeconds
    }
}

struct RadioPlaybackProgress: Equatable {
    var elapsedSeconds: Int = 0
    var durationSeconds: Int?

    var fraction: Double {
        guard let durationSeconds, durationSeconds > 0 else {
            return 0
        }

        return min(max(Double(elapsedSeconds) / Double(durationSeconds), 0), 1)
    }
}

extension AVAudioSession: RadioAudioSession {
    func activatePlaybackSession() throws {
        try setCategory(.playback, mode: .default, options: RadioAudioSessionConfiguration.categoryOptions)
        try setActive(true)
    }
}

extension MPNowPlayingInfoCenter: RadioNowPlayingCenter {}

extension MPRemoteCommandCenter: RadioRemoteCommandCenter {
    func configure(
        play: @escaping @MainActor () -> Void,
        pause: @escaping @MainActor () -> Void,
        toggle: @escaping @MainActor () -> Void,
        nextTrack: @escaping @MainActor () -> Void
    ) {
        playCommand.removeTarget(nil)
        pauseCommand.removeTarget(nil)
        togglePlayPauseCommand.removeTarget(nil)
        nextTrackCommand.removeTarget(nil)

        playCommand.addTarget { _ in
            Task { @MainActor in play() }
            return .success
        }
        pauseCommand.addTarget { _ in
            Task { @MainActor in pause() }
            return .success
        }
        togglePlayPauseCommand.addTarget { _ in
            Task { @MainActor in toggle() }
            return .success
        }
        nextTrackCommand.addTarget { _ in
            Task { @MainActor in nextTrack() }
            return .success
        }
    }

    func update(isPlaying: Bool, canSkip: Bool) {
        playCommand.isEnabled = !isPlaying
        pauseCommand.isEnabled = isPlaying
        togglePlayPauseCommand.isEnabled = true
        nextTrackCommand.isEnabled = canSkip
    }
}

@MainActor
@Observable
final class RadioPlayer {
    static let shared = RadioPlayer()
    static let noStreamMessage = "Connect to the radio stream before pressing Play."

    private let player = AVPlayer()
    private let audioSession: RadioAudioSession
    private let nowPlayingCenter: RadioNowPlayingCenter
    private let remoteCommandCenter: RadioRemoteCommandCenter
    private let liveActivityController: RadioLiveActivityControlling
    private let now: () -> Date
    private var metadata: RadioPlaybackMetadata?
    private var activeTrackID: String?
    private var progressAnchorDate: Date?
    private var progressAnchorElapsedSeconds = 0
    private var nextTrackHandler: (() -> Void)?
    private(set) var isPlaying = false
    private(set) var currentURL: URL?
    private(set) var statusMessage: String?
    private(set) var progress = RadioPlaybackProgress()

    init(
        audioSession: RadioAudioSession = AVAudioSession.sharedInstance(),
        nowPlayingCenter: RadioNowPlayingCenter = MPNowPlayingInfoCenter.default(),
        remoteCommandCenter: RadioRemoteCommandCenter = MPRemoteCommandCenter.shared(),
        liveActivityController: RadioLiveActivityControlling = PardoraLiveActivityController.shared,
        now: @escaping () -> Date = Date.init
    ) {
        self.audioSession = audioSession
        self.nowPlayingCenter = nowPlayingCenter
        self.remoteCommandCenter = remoteCommandCenter
        self.liveActivityController = liveActivityController
        self.now = now
        configureRemoteCommands()
    }

    func load(url: URL?, metadata: RadioPlaybackMetadata? = nil) {
        self.metadata = metadata
        if currentURL != url {
            currentURL = url
            if let url {
                player.replaceCurrentItem(with: AVPlayerItem(url: url))
                statusMessage = nil
            } else {
                player.replaceCurrentItem(with: nil)
                isPlaying = false
                liveActivityController.end()
            }
        }

        updateProgressBaseline(for: metadata)
        updateNowPlayingInfo()
        updateRemoteCommands()
        if isPlaying {
            updateLiveActivity()
        }
    }

    func setNextTrackHandler(_ handler: (() -> Void)?) {
        nextTrackHandler = handler
        updateRemoteCommands()
    }

    func togglePlayback() {
        if isPlaying {
            pause()
        } else {
            play()
        }
    }

    func play() {
        guard currentURL != nil else {
            statusMessage = Self.noStreamMessage
            return
        }

        do {
            try audioSession.activatePlaybackSession()
        } catch {
            statusMessage = "Audio playback could not start: \(error.localizedDescription)"
            return
        }

        player.play()
        isPlaying = true
        statusMessage = "Playing"
        progressAnchorDate = now()
        refreshProgress()
        updateNowPlayingInfo()
        updateRemoteCommands()
        updateLiveActivity()
    }

    func pause() {
        refreshProgress()
        player.pause()
        isPlaying = false
        statusMessage = "Paused"
        progressAnchorElapsedSeconds = progress.elapsedSeconds
        progressAnchorDate = nil
        updateNowPlayingInfo()
        updateRemoteCommands()
        updateLiveActivity()
    }

    func refreshProgress() {
        guard metadata?.durationSeconds != nil else {
            progress = RadioPlaybackProgress()
            return
        }

        let elapsed: TimeInterval
        if isPlaying, let progressAnchorDate {
            elapsed = TimeInterval(progressAnchorElapsedSeconds) + now().timeIntervalSince(progressAnchorDate)
        } else {
            elapsed = TimeInterval(progressAnchorElapsedSeconds)
        }

        let clampedElapsed: Int
        if let duration = metadata?.durationSeconds, duration > 0 {
            clampedElapsed = min(Int(elapsed.rounded(.down)), duration)
        } else {
            clampedElapsed = Int(elapsed.rounded(.down))
        }

        progress = RadioPlaybackProgress(elapsedSeconds: clampedElapsed, durationSeconds: metadata?.durationSeconds)
        updateNowPlayingInfo()
    }

    private func updateNowPlayingInfo() {
        guard let metadata else {
            nowPlayingCenter.nowPlayingInfo = nil
            return
        }

        var info: [String: Any] = [
            MPMediaItemPropertyTitle: metadata.title,
            MPMediaItemPropertyArtist: metadata.artist,
            MPNowPlayingInfoPropertyPlaybackRate: isPlaying ? 1.0 : 0.0,
        ]

        if let albumTitle = metadata.albumTitle {
            info[MPMediaItemPropertyAlbumTitle] = albumTitle
        }

        if let durationSeconds = metadata.durationSeconds {
            info[MPMediaItemPropertyPlaybackDuration] = TimeInterval(durationSeconds)
            info[MPNowPlayingInfoPropertyElapsedPlaybackTime] = TimeInterval(progress.elapsedSeconds)
        }

        nowPlayingCenter.nowPlayingInfo = info
    }

    private func configureRemoteCommands() {
        remoteCommandCenter.configure(
            play: { [weak self] in
                self?.play()
            },
            pause: { [weak self] in
                self?.pause()
            },
            toggle: { [weak self] in
                self?.togglePlayback()
            },
            nextTrack: { [weak self] in
                self?.nextTrackHandler?()
            }
        )
        updateRemoteCommands()
    }

    private func updateRemoteCommands() {
        remoteCommandCenter.update(isPlaying: isPlaying, canSkip: nextTrackHandler != nil && currentURL != nil)
    }

    private func updateProgressBaseline(for metadata: RadioPlaybackMetadata?) {
        guard let metadata else {
            activeTrackID = nil
            progressAnchorDate = nil
            progressAnchorElapsedSeconds = 0
            progress = RadioPlaybackProgress()
            return
        }

        let nextTrackID = metadata.trackID ?? metadata.title
        guard activeTrackID != nextTrackID else {
            progress.durationSeconds = metadata.durationSeconds
            return
        }

        activeTrackID = nextTrackID
        progressAnchorDate = isPlaying ? now() : nil
        progressAnchorElapsedSeconds = 0
        progress = RadioPlaybackProgress(durationSeconds: metadata.durationSeconds)
    }

    private func updateLiveActivity() {
        liveActivityController.update(metadata: metadata, isPlaying: isPlaying)
    }
}
