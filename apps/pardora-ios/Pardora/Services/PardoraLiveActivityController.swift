@preconcurrency import ActivityKit
import Foundation

@MainActor
protocol RadioLiveActivityControlling: AnyObject {
    func update(metadata: RadioPlaybackMetadata?, isPlaying: Bool)
    func end()
}

@MainActor
final class PardoraLiveActivityController: RadioLiveActivityControlling {
    static let shared = PardoraLiveActivityController()

    private var currentActivity: Activity<PardoraActivityAttributes>?
    private var lastState: PardoraActivityAttributes.ContentState?

    private init() {
        currentActivity = Activity<PardoraActivityAttributes>.activities.first
        lastState = currentActivity?.content.state
    }

    func update(metadata: RadioPlaybackMetadata?, isPlaying: Bool) {
        guard let metadata else {
            end()
            return
        }

        let state = PardoraActivityAttributes.ContentState(
            trackTitle: metadata.title,
            styleName: metadata.albumTitle ?? "Pardora",
            queueText: metadata.queueText ?? "",
            isPlaying: isPlaying,
            updatedAt: .now)
        lastState = state

        if let currentActivity {
            Task {
                await currentActivity.update(ActivityContent(state: state, staleDate: nil))
            }
            return
        }

        guard ActivityAuthorizationInfo().areActivitiesEnabled else {
            return
        }

        do {
            currentActivity = try Activity.request(
                attributes: PardoraActivityAttributes(stationName: "Pardora"),
                content: ActivityContent(state: state, staleDate: nil),
                pushType: nil)
        } catch {
            currentActivity = nil
        }
    }

    func end() {
        guard let currentActivity, let lastState else {
            currentActivity = nil
            return
        }

        self.currentActivity = nil
        Task {
            await currentActivity.end(
                ActivityContent(state: lastState, staleDate: nil),
                dismissalPolicy: .immediate)
        }
    }
}
