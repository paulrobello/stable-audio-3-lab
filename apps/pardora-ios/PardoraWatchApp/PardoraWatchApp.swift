import SwiftUI
import WatchConnectivity

@main
struct PardoraWatchApp: App {
    @StateObject private var controller = WatchRadioController()

    var body: some Scene {
        WindowGroup {
            WatchControlView(controller: controller)
                .task {
                    controller.start()
                    await controller.refresh()
                }
        }
    }
}

struct WatchControlView: View {
    @ObservedObject var controller: WatchRadioController

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(controller.title)
                        .font(.headline)
                        .lineLimit(2)
                    Text(controller.detail)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                    Text(controller.status)
                        .font(.caption2)
                        .foregroundStyle(controller.isReachable ? Color.secondary : Color.orange)
                        .lineLimit(2)
                }

                Button {
                    Task { await controller.togglePlayback() }
                } label: {
                    Label(controller.isPlaying ? "Pause" : "Play", systemImage: controller.isPlaying ? "pause.fill" : "play.fill")
                }

                Button {
                    Task { await controller.skipTrack() }
                } label: {
                    Label("Skip", systemImage: "forward.fill")
                }

                HStack {
                    Button {
                        Task { await controller.thumbsUp() }
                    } label: {
                        Image(systemName: "hand.thumbsup.fill")
                    }
                    .accessibilityLabel("Thumbs Up")

                    Button {
                        Task { await controller.thumbsDown() }
                    } label: {
                        Image(systemName: "hand.thumbsdown.fill")
                    }
                    .accessibilityLabel("Thumbs Down")
                }

                Button {
                    Task { await controller.refresh() }
                } label: {
                    Label("Refresh", systemImage: "arrow.clockwise")
                }
            }
            .buttonStyle(.bordered)
            .padding(.vertical, 4)
        }
    }
}

@MainActor
final class WatchRadioController: NSObject, ObservableObject, WCSessionDelegate {
    @Published var title = "Pardora Radio"
    @Published var detail = "Controls ready."
    @Published var nextTitle = "Queue empty"
    @Published var status = "Connecting..."
    @Published var isPlaying = false
    @Published var isReachable = false

    func start() {
        guard WCSession.isSupported() else {
            status = "WatchConnectivity unavailable"
            return
        }

        let session = WCSession.default
        session.delegate = self
        session.activate()
        isReachable = session.isReachable
    }

    func refresh() async {
        await send(command: "refresh")
    }

    func togglePlayback() async {
        await send(command: "togglePlayback")
    }

    func skipTrack() async {
        await send(command: "skipTrack")
    }

    func thumbsUp() async {
        await send(command: "thumbsUp")
    }

    func thumbsDown() async {
        await send(command: "thumbsDown")
    }

    nonisolated func session(
        _ session: WCSession,
        activationDidCompleteWith activationState: WCSessionActivationState,
        error: Error?
    ) {
        let isReachable = session.isReachable
        let message = error?.localizedDescription ?? (isReachable ? "Connected" : "Ready")
        Task { @MainActor [weak self] in
            self?.isReachable = isReachable
            self?.status = message
            if activationState == .activated {
                await self?.refresh()
            }
        }
    }

    nonisolated func sessionReachabilityDidChange(_ session: WCSession) {
        let isReachable = session.isReachable
        Task { @MainActor [weak self] in
            self?.isReachable = isReachable
            self?.status = isReachable ? "Connected" : "Ready"
        }
    }

    nonisolated func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any]) {
        let state = WatchRadioSnapshot(applicationContext)
        Task { @MainActor [weak self] in
            self?.apply(snapshot: state)
        }
    }

    private func send(command: String) async {
        guard WCSession.default.activationState == .activated else {
            status = "Connecting..."
            return
        }

        status = "Sending..."
        let message = ["command": command]
        if WCSession.default.isReachable {
            WCSession.default.sendMessage(message, replyHandler: nil) { [weak self] error in
                Task { @MainActor in
                    self?.queue(command: command, error: error)
                }
            }
            status = "Sent"
        } else {
            queue(command: command)
        }
    }

    private func queue(command: String, error: Error? = nil) {
        WCSession.default.transferUserInfo(["command": command])
        status = error == nil ? "Queued for iPhone" : "Queued: \(error?.localizedDescription ?? "iPhone unavailable")"
        isReachable = WCSession.default.isReachable
    }

    private func apply(snapshot: WatchRadioSnapshot) {
        title = snapshot.title ?? title
        detail = snapshot.detail ?? detail
        nextTitle = snapshot.nextTitle ?? nextTitle
        isPlaying = snapshot.isPlaying ?? isPlaying
        let replyStatus = snapshot.status ?? ""
        status = replyStatus.isEmpty ? "Connected" : replyStatus
        isReachable = WCSession.default.isReachable
    }
}

private struct WatchRadioSnapshot: Sendable {
    var title: String?
    var detail: String?
    var nextTitle: String?
    var isPlaying: Bool?
    var status: String?

    init(_ dictionary: [String: Any]) {
        title = dictionary["title"] as? String
        detail = dictionary["detail"] as? String
        nextTitle = dictionary["nextTitle"] as? String
        isPlaying = dictionary["isPlaying"] as? Bool
        status = dictionary["status"] as? String
    }
}
