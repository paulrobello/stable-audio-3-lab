import Foundation
import WatchConnectivity

@MainActor
final class PardoraWatchConnectivityController: NSObject, WCSessionDelegate {
    static let shared = PardoraWatchConnectivityController()

    private let model: RadioAppModel
    private let player: RadioPlayer

    override init() {
        model = RadioAppModel()
        player = RadioPlayer.shared
        super.init()
    }

    func start() {
        guard WCSession.isSupported() else {
            return
        }

        let session = WCSession.default
        session.delegate = self
        session.activate()
        publishState()
    }

    nonisolated func session(
        _ session: WCSession,
        activationDidCompleteWith activationState: WCSessionActivationState,
        error: Error?
    ) {
        Task { @MainActor [weak self] in
            self?.publishState()
        }
    }

    nonisolated func sessionDidBecomeInactive(_ session: WCSession) {}

    nonisolated func sessionDidDeactivate(_ session: WCSession) {
        session.activate()
    }

    nonisolated func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
        let command = message["command"] as? String
        Task { @MainActor [weak self] in
            _ = await self?.handle(command: command)
        }
    }

    nonisolated func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any]) {
        let command = userInfo["command"] as? String
        Task { @MainActor [weak self] in
            _ = await self?.handle(command: command)
        }
    }

    private func handle(command: String?) async -> RadioWatchPayload {
        switch command {
        case "togglePlayback":
            await refreshModel()
            configurePlayer()
            player.togglePlayback()
        case "skipTrack":
            await model.skipCurrentTrack()
            await refreshModel()
            configurePlayer()
            player.play()
        case "thumbsUp":
            await model.likeCurrentTrack()
            configurePlayer()
        case "thumbsDown":
            await model.dislikeCurrentTrack()
            configurePlayer()
        default:
            await refreshModel()
            configurePlayer()
        }

        publishState()
        return statePayload()
    }

    private func refreshModel() async {
        await model.refresh(showStatus: false)
    }

    private func configurePlayer() {
        player.load(url: model.streamURL, metadata: RadioPlaybackMetadata(state: model.state))
    }

    private func statePayload() -> RadioWatchPayload {
        Self.statePayload(
            title: model.state?.currentTrack?.title,
            detail: model.state.map { "\($0.selectedStyleId.displayName) • \($0.queueStatusText)" },
            nextTitle: model.state?.nextUpTitleText,
            isPlaying: player.isPlaying,
            status: model.statusMessage ?? player.statusMessage
        )
    }

    private func publishState() {
        guard WCSession.isSupported(), WCSession.default.activationState == .activated else {
            return
        }

        try? WCSession.default.updateApplicationContext(statePayload().dictionary)
    }

    private static func statePayload(
        title: String? = nil,
        detail: String? = nil,
        nextTitle: String? = nil,
        isPlaying: Bool = false,
        status: String? = nil,
        error: String? = nil
    ) -> RadioWatchPayload {
        RadioWatchPayload(
            title: title ?? "Pardora Radio",
            detail: detail ?? "Controls ready.",
            nextTitle: nextTitle ?? "Queue empty",
            isPlaying: isPlaying,
            status: error ?? status ?? ""
        )
    }
}

private struct RadioWatchPayload: Sendable {
    var title = "Pardora Radio"
    var detail = "Controls ready."
    var nextTitle = "Queue empty"
    var isPlaying = false
    var status = ""

    init(
        title: String = "Pardora Radio",
        detail: String = "Controls ready.",
        nextTitle: String = "Queue empty",
        isPlaying: Bool = false,
        status: String = "",
        error: String? = nil
    ) {
        self.title = title
        self.detail = detail
        self.nextTitle = nextTitle
        self.isPlaying = isPlaying
        self.status = error ?? status
    }

    var dictionary: [String: Any] {
        [
            "title": title,
            "detail": detail,
            "nextTitle": nextTitle,
            "isPlaying": isPlaying,
            "status": status,
        ]
    }
}
