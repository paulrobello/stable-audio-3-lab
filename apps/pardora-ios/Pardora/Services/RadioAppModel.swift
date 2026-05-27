import Foundation
import Observation

@MainActor
@Observable
final class RadioAppModel {
    var endpointMode: RadioEndpointMode
    var serverOrigin: String
    var state: RadioStreamState?
    var isRefreshing = false
    var statusMessage: String?

    private var client: RadioAPIClient
    private var actionClient: RadioActionClient?
    private let localIPv4Addresses: @Sendable () -> [String]

    init(
        serverOrigin: String = RadioEndpointResolver.defaultPublicOrigin,
        endpointMode: RadioEndpointMode = .auto,
        actionClient: RadioActionClient? = nil,
        localIPv4Addresses: @escaping @Sendable () -> [String] = RadioEndpointResolver.localIPv4Addresses
    ) {
        self.serverOrigin = serverOrigin
        self.endpointMode = endpointMode
        client = RadioAPIClient(baseURL: URL(string: serverOrigin)!)
        self.actionClient = actionClient
        self.localIPv4Addresses = localIPv4Addresses
    }

    var localServerOrigin: String? {
        RadioEndpointResolver.origin(from: localStreamURL)
    }

    var publicServerOrigin: String {
        RadioEndpointResolver.origin(from: publicStreamURL) ?? RadioEndpointResolver.defaultPublicOrigin
    }

    var usesLocalEndpoint: Bool {
        switch endpointMode {
        case .local:
            localServerOrigin != nil
        case .auto:
            RadioEndpointResolver.isSameLAN(url: localStreamURL, localIPv4Addresses: localIPv4Addresses())
        case .publicInternet, .custom:
            false
        }
    }

    var streamURL: URL? {
        if usesLocalEndpoint, let localStreamURL {
            return localStreamURL
        }

        return publicStreamURL ?? localStreamURL
    }

    var endpointSummary: String {
        switch endpointMode {
        case .auto where usesLocalEndpoint:
            "Auto selected local LAN"
        case .auto:
            "Auto selected public"
        case .publicInternet:
            "Public"
        case .local:
            localServerOrigin == nil ? "Local URL not detected yet" : "Local"
        case .custom:
            "Custom"
        }
    }

    func applyEndpointMode() {
        switch endpointMode {
        case .auto:
            serverOrigin = usesLocalEndpoint ? localServerOrigin ?? serverOrigin : publicServerOrigin
        case .publicInternet:
            serverOrigin = publicServerOrigin
        case .local:
            serverOrigin = localServerOrigin ?? RadioEndpointResolver.defaultLocalOrigin
        case .custom:
            serverOrigin = RadioEndpointResolver.normalizedOrigin(serverOrigin) ?? serverOrigin
        }

        updateClient()
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
            applyEndpointMode()
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
                    applyEndpointMode()
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

    private var publicStreamURL: URL? {
        RadioEndpointResolver.streamURL(from: state?.streamUrl, relativeTo: serverOrigin)
    }

    private var localStreamURL: URL? {
        RadioEndpointResolver.streamURL(from: state?.lanStreamUrl, relativeTo: serverOrigin)
    }

    private func updateClient() {
        guard let baseURL = URL(string: serverOrigin) else {
            return
        }

        client = RadioAPIClient(baseURL: baseURL)
    }
}
