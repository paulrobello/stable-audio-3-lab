import AVFoundation
import MediaPlayer
import XCTest
@testable import Pardora

@MainActor
final class RadioPlayerTests: XCTestCase {
    func testPlaybackAudioSessionUsesValidBackgroundMusicOptions() {
        XCTAssertTrue(RadioAudioSessionConfiguration.categoryOptions.isEmpty)
    }

    func testAppRegistersForBackgroundAudio() throws {
        let testFileURL = URL(filePath: #filePath)
        let plistURL = testFileURL
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .appending(path: "Pardora/Resources/Info.plist")
        let plistData = try Data(contentsOf: plistURL)
        let plist = try XCTUnwrap(PropertyListSerialization.propertyList(from: plistData, format: nil) as? [String: Any])

        XCTAssertTrue((plist["UIBackgroundModes"] as? [String])?.contains("audio") == true)
    }

    func testTogglePlaybackConfiguresBackgroundAudioSessionAndNowPlayingInfo() throws {
        let audioSession = FakeRadioAudioSession()
        let nowPlayingCenter = FakeRadioNowPlayingCenter()
        let liveActivityController = FakeRadioLiveActivityController()
        let player = RadioPlayer(
            audioSession: audioSession,
            nowPlayingCenter: nowPlayingCenter,
            remoteCommandCenter: FakeRadioRemoteCommandCenter(),
            liveActivityController: liveActivityController)
        let metadata = RadioPlaybackMetadata(
            trackID: "track-lan",
            title: "LAN Track",
            artist: "Pardora",
            albumTitle: "Synthwave",
            queueText: "22/3 ahead",
            durationSeconds: 90)

        player.load(url: URL(string: "http://192.168.1.207:3007/api/radio?stream=1"), metadata: metadata)
        player.togglePlayback()

        XCTAssertEqual(audioSession.activationCount, 1)
        XCTAssertEqual(nowPlayingCenter.nowPlayingInfo?[MPMediaItemPropertyTitle] as? String, "LAN Track")
        XCTAssertEqual(nowPlayingCenter.nowPlayingInfo?[MPMediaItemPropertyArtist] as? String, "Pardora")
        XCTAssertEqual(nowPlayingCenter.nowPlayingInfo?[MPMediaItemPropertyAlbumTitle] as? String, "Synthwave")
        XCTAssertEqual(nowPlayingCenter.nowPlayingInfo?[MPNowPlayingInfoPropertyPlaybackRate] as? Double, 1)
        XCTAssertEqual(nowPlayingCenter.nowPlayingInfo?[MPMediaItemPropertyPlaybackDuration] as? TimeInterval, 90)
        XCTAssertEqual(nowPlayingCenter.nowPlayingInfo?[MPNowPlayingInfoPropertyElapsedPlaybackTime] as? TimeInterval, 0)
        XCTAssertEqual(liveActivityController.lastMetadata?.title, "LAN Track")
        XCTAssertEqual(liveActivityController.lastMetadata?.queueText, "22/3 ahead")
        XCTAssertEqual(liveActivityController.lastIsPlaying, true)
    }

    func testPlayWithoutStreamShowsVisibleStatus() {
        let player = RadioPlayer(
            audioSession: FakeRadioAudioSession(),
            nowPlayingCenter: FakeRadioNowPlayingCenter(),
            remoteCommandCenter: FakeRadioRemoteCommandCenter(),
            liveActivityController: FakeRadioLiveActivityController())

        player.togglePlayback()

        XCTAssertFalse(player.isPlaying)
        XCTAssertEqual(player.statusMessage, RadioPlayer.noStreamMessage)
    }

    func testProgressUsesPerTrackPlaybackClock() {
        var currentDate = Date(timeIntervalSince1970: 0)
        let player = RadioPlayer(
            audioSession: FakeRadioAudioSession(),
            nowPlayingCenter: FakeRadioNowPlayingCenter(),
            remoteCommandCenter: FakeRadioRemoteCommandCenter(),
            liveActivityController: FakeRadioLiveActivityController(),
            now: { currentDate }
        )

        player.load(
            url: URL(string: "https://radio.pardev.net/api/radio?stream=1"),
            metadata: .init(trackID: "track-1", title: "Public Track", durationSeconds: 90)
        )
        player.play()

        currentDate = Date(timeIntervalSince1970: 5)
        player.refreshProgress()

        XCTAssertEqual(player.progress.elapsedSeconds, 5)
        XCTAssertEqual(player.progress.durationSeconds, 90)
        XCTAssertEqual(player.progress.fraction, 5.0 / 90.0)

        currentDate = Date(timeIntervalSince1970: 200)
        player.refreshProgress()

        XCTAssertEqual(player.progress.elapsedSeconds, 90)
        XCTAssertEqual(player.progress.fraction, 1)
    }

    func testAudioSessionFailureShowsVisibleStatus() {
        let player = RadioPlayer(
            audioSession: FakeRadioAudioSession(error: TestAudioError.denied),
            nowPlayingCenter: FakeRadioNowPlayingCenter(),
            remoteCommandCenter: FakeRadioRemoteCommandCenter(),
            liveActivityController: FakeRadioLiveActivityController()
        )

        player.load(url: URL(string: "https://radio.pardev.net/api/radio?stream=1"), metadata: .init(title: "Public Track"))
        player.togglePlayback()

        XCTAssertFalse(player.isPlaying)
        XCTAssertEqual(player.statusMessage, "Audio playback could not start: denied")
    }

    func testPausingUpdatesNowPlayingRate() {
        let nowPlayingCenter = FakeRadioNowPlayingCenter()
        let liveActivityController = FakeRadioLiveActivityController()
        let player = RadioPlayer(
            audioSession: FakeRadioAudioSession(),
            nowPlayingCenter: nowPlayingCenter,
            remoteCommandCenter: FakeRadioRemoteCommandCenter(),
            liveActivityController: liveActivityController)

        player.load(url: URL(string: "https://radio.pardev.net/api/radio?stream=1"), metadata: .init(title: "Public Track"))
        player.togglePlayback()
        player.togglePlayback()

        XCTAssertEqual(nowPlayingCenter.nowPlayingInfo?[MPNowPlayingInfoPropertyPlaybackRate] as? Double, 0)
        XCTAssertEqual(liveActivityController.lastMetadata?.title, "Public Track")
        XCTAssertEqual(liveActivityController.lastIsPlaying, false)
    }

    func testPauseCommandUpdatesStateEvenWhenPlaybackFlagIsStale() {
        let remoteCommandCenter = FakeRadioRemoteCommandCenter()
        let nowPlayingCenter = FakeRadioNowPlayingCenter()
        let liveActivityController = FakeRadioLiveActivityController()
        let player = RadioPlayer(
            audioSession: FakeRadioAudioSession(),
            nowPlayingCenter: nowPlayingCenter,
            remoteCommandCenter: remoteCommandCenter,
            liveActivityController: liveActivityController)

        player.load(url: URL(string: "https://radio.pardev.net/api/radio?stream=1"), metadata: .init(title: "Public Track"))
        remoteCommandCenter.triggerPause()

        XCTAssertFalse(player.isPlaying)
        XCTAssertEqual(player.statusMessage, "Paused")
        XCTAssertEqual(nowPlayingCenter.nowPlayingInfo?[MPNowPlayingInfoPropertyPlaybackRate] as? Double, 0)
        XCTAssertEqual(liveActivityController.lastIsPlaying, false)
    }

    func testLoadWithoutStreamEndsLiveActivity() {
        let liveActivityController = FakeRadioLiveActivityController()
        let player = RadioPlayer(
            audioSession: FakeRadioAudioSession(),
            nowPlayingCenter: FakeRadioNowPlayingCenter(),
            remoteCommandCenter: FakeRadioRemoteCommandCenter(),
            liveActivityController: liveActivityController)

        player.load(url: URL(string: "https://radio.pardev.net/api/radio?stream=1"), metadata: .init(title: "Public Track"))
        player.togglePlayback()
        player.load(url: nil)

        XCTAssertEqual(liveActivityController.endCount, 1)
    }

    func testRemoteCommandsControlPlaybackAndSkip() {
        let remoteCommandCenter = FakeRadioRemoteCommandCenter()
        let player = RadioPlayer(
            audioSession: FakeRadioAudioSession(),
            nowPlayingCenter: FakeRadioNowPlayingCenter(),
            remoteCommandCenter: remoteCommandCenter,
            liveActivityController: FakeRadioLiveActivityController())
        var skipCount = 0

        player.setNextTrackHandler {
            skipCount += 1
        }
        player.load(url: URL(string: "https://radio.pardev.net/api/radio?stream=1"), metadata: .init(title: "Public Track"))
        remoteCommandCenter.triggerPlay()

        XCTAssertTrue(player.isPlaying)
        XCTAssertEqual(remoteCommandCenter.lastIsPlaying, true)
        XCTAssertEqual(remoteCommandCenter.lastCanSkip, true)

        remoteCommandCenter.triggerPause()

        XCTAssertFalse(player.isPlaying)

        remoteCommandCenter.triggerToggle()

        XCTAssertTrue(player.isPlaying)

        remoteCommandCenter.triggerNextTrack()

        XCTAssertEqual(skipCount, 1)
    }
}

private final class FakeRadioAudioSession: RadioAudioSession {
    var activationCount = 0
    var error: Error?

    init(error: Error? = nil) {
        self.error = error
    }

    func activatePlaybackSession() throws {
        if let error {
            throw error
        }

        activationCount += 1
    }
}

private final class FakeRadioNowPlayingCenter: RadioNowPlayingCenter {
    var nowPlayingInfo: [String: Any]?
}

private final class FakeRadioRemoteCommandCenter: RadioRemoteCommandCenter {
    var playHandler: (@MainActor () -> Void)?
    var pauseHandler: (@MainActor () -> Void)?
    var toggleHandler: (@MainActor () -> Void)?
    var nextTrackHandler: (@MainActor () -> Void)?
    var lastIsPlaying: Bool?
    var lastCanSkip: Bool?

    func configure(
        play: @escaping @MainActor () -> Void,
        pause: @escaping @MainActor () -> Void,
        toggle: @escaping @MainActor () -> Void,
        nextTrack: @escaping @MainActor () -> Void
    ) {
        playHandler = play
        pauseHandler = pause
        toggleHandler = toggle
        nextTrackHandler = nextTrack
    }

    func update(isPlaying: Bool, canSkip: Bool) {
        lastIsPlaying = isPlaying
        lastCanSkip = canSkip
    }

    @MainActor
    func triggerPlay() {
        playHandler?()
    }

    @MainActor
    func triggerPause() {
        pauseHandler?()
    }

    @MainActor
    func triggerToggle() {
        toggleHandler?()
    }

    @MainActor
    func triggerNextTrack() {
        nextTrackHandler?()
    }
}

private final class FakeRadioLiveActivityController: RadioLiveActivityControlling {
    var endCount = 0
    var lastMetadata: RadioPlaybackMetadata?
    var lastIsPlaying: Bool?

    func update(metadata: RadioPlaybackMetadata?, isPlaying: Bool) {
        lastMetadata = metadata
        lastIsPlaying = isPlaying
    }

    func end() {
        endCount += 1
    }
}

private enum TestAudioError: LocalizedError {
    case denied

    var errorDescription: String? {
        "denied"
    }
}
