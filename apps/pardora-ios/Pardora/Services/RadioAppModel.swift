import Foundation
import Observation

@MainActor
@Observable
final class RadioAppModel {
    var serverOrigin: String
    var state: RadioStreamState?
    var isRefreshing = false
    var statusMessage: String?

    private var client: RadioAPIClient
    private var actionClient: RadioActionClient?

    init(serverOrigin: String = "https://radio.pardev.net", actionClient: RadioActionClient? = nil) {
        self.serverOrigin = serverOrigin
        client = RadioAPIClient(baseURL: URL(string: serverOrigin)!)
        self.actionClient = actionClient
    }

    func refresh() async {
        guard let baseURL = URL(string: serverOrigin) else {
            statusMessage = "Enter a valid radio server URL."
            return
        }

        client = RadioAPIClient(baseURL: baseURL)
        isRefreshing = true
        defer { isRefreshing = false }

        do {
            state = try await client.fetchState()
            statusMessage = nil
        } catch {
            statusMessage = error.localizedDescription
        }
    }

    func post(_ payload: RadioActionPayload) async {
        do {
            let response = try await (actionClient ?? client).postAction(payload)
            if response.ok {
                if let state = response.state {
                    self.state = state
                }
                statusMessage = nil
            } else {
                statusMessage = response.error ?? "Radio action failed."
            }
        } catch {
            statusMessage = error.localizedDescription
        }
    }

    func likeCurrentTrack() async {
        await post(["action": .string("rating"), "rating": .string("up")])
    }

    func dislikeCurrentTrack() async {
        await post(["action": .string("rating"), "rating": .string("down")])
    }

    func skipCurrentTrack() async {
        await post(["action": .string("skipTrack")])
    }

    func selectTrack(_ track: RadioTrackRecord) async {
        await post(["action": .string("selectTrack"), "filename": .string(track.filename)])
    }

    func deleteTrack(_ track: RadioTrackRecord) async {
        await post(["action": .string("deleteTrack"), "filename": .string(track.filename)])
    }

    func saveConfiguration() async {
        guard let state else {
            statusMessage = "Load station settings before saving."
            return
        }

        await post([
            "action": .string("configure"),
            "styleId": .string(state.selectedStyleId.rawValue),
            "promptModel": .string(state.promptModel),
            "announceEnabled": .bool(state.announceEnabled),
            "ttsProvider": .string(state.ttsProvider.rawValue),
            "ttsVoice": .string(state.ttsVoice),
            "announcementPrefix": .string(state.announcementPrefix),
            "announcementSuffix": .string(state.announcementSuffix),
        ])
    }
}
