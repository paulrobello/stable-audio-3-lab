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
}
