import Foundation
import Network
import Observation

@MainActor
@Observable
final class RadioAppModel {
    var endpointMode: RadioEndpointMode
    var serverOrigin: String
    var state: RadioStreamState?
    var isRefreshing = false
    var statusMessage: String?
    var connectionTestMessage: String?
    var promptModels = RadioPromptModelOptions.defaults
    var ttsVoiceOptions = RadioTTSVoiceOption.options(for: .openai, currentVoice: "nova")

    static let cloudflareVPNMessage = "Cloudflare Access blocked this request. Check that Cloudflare One/WARP is routing Pardora from an allowed IP, then try again."
    static let testingConnectionMessage = "Testing radio connection..."
    static let scanningLANMessage = "Scanning local Wi-Fi for Pardora..."

    private var client: RadioAPIClient
    private var actionClient: RadioActionClient?
    private let transport: RadioTransport
    private let localIPv4Addresses: @Sendable () -> [String]
    private var networkMonitor: NWPathMonitor?
    private let networkQueue = DispatchQueue(label: "net.pardev.pardora.network-monitor")
    private var lastNetworkSignature: String?

    init(
        serverOrigin: String = RadioEndpointResolver.defaultPublicOrigin,
        endpointMode: RadioEndpointMode = .auto,
        transport: RadioTransport = URLSession.shared,
        actionClient: RadioActionClient? = nil,
        localIPv4Addresses: @escaping @Sendable () -> [String] = RadioEndpointResolver.localIPv4Addresses
    ) {
        self.serverOrigin = serverOrigin
        self.endpointMode = endpointMode
        self.transport = transport
        client = RadioAPIClient(baseURL: URL(string: serverOrigin)!, transport: transport)
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

    func startNetworkMonitoring() {
        guard networkMonitor == nil else {
            return
        }

        let monitor = NWPathMonitor()
        monitor.pathUpdateHandler = { [weak self] path in
            Task { @MainActor [weak self] in
                await self?.networkPathDidChange(path)
            }
        }
        networkMonitor = monitor
        monitor.start(queue: networkQueue)
    }

    func stopNetworkMonitoring() {
        networkMonitor?.cancel()
        networkMonitor = nil
        lastNetworkSignature = nil
    }

    func networkPathDidChange(_ path: NWPath? = nil) async {
        if let path {
            let signature = networkSignature(for: path)
            guard signature != lastNetworkSignature else {
                return
            }
            lastNetworkSignature = signature
        }

        guard endpointMode == .auto else {
            return
        }

        applyEndpointMode()
        await refresh()
    }

    func refresh(showStatus: Bool = true) async {
        isRefreshing = true
        if showStatus {
            statusMessage = Self.testingConnectionMessage
        }
        defer { isRefreshing = false }

        var lastError: Error?
        var cloudflareAccessError: Error?
        for origin in refreshCandidateOrigins {
            guard let baseURL = URL(string: origin) else {
                lastError = RadioAPIError.server("Enter a valid radio server URL.")
                continue
            }

            client = RadioAPIClient(baseURL: baseURL, transport: transport)

            do {
                let response = try await client.fetchEnvelope()
                guard response.ok, let state = response.state else {
                    throw RadioAPIError.server(response.error ?? "Radio state unavailable.")
                }
                setState(state, origin: origin, promptModels: response.promptModels)
                return
            } catch {
                if error as? RadioAPIError == .webLoginPage {
                    cloudflareAccessError = error
                }
                lastError = error
            }
        }

        if shouldDiscoverLAN {
            if showStatus {
                statusMessage = Self.scanningLANMessage
            }
            if let discovered = await fetchFirstReachableState(origins: lanDiscoveryOrigins) {
                setState(discovered.state, origin: discovered.origin)
                return
            }
        }

        if showStatus {
            statusMessage = statusMessage(for: cloudflareAccessError ?? lastError)
        }
    }

    func testConnection() async {
        connectionTestMessage = Self.testingConnectionMessage
        await refresh()

        if let statusMessage {
            connectionTestMessage = statusMessage
        } else {
            connectionTestMessage = "Connected to \(serverOrigin)"
        }
    }

    func post(_ payload: RadioActionPayload) async {
        do {
            let response = try await (actionClient ?? client).postAction(payload)
            if response.ok {
                if let state = response.state {
                    applyStateOptions(state)
                    self.state = state
                    applyEndpointMode()
                }
                applyPromptModels(response.promptModels)
                applyVoiceOptions(response.voices)
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

    func deleteTracks(_ tracks: [RadioTrackRecord]) async {
        for track in tracks {
            await deleteTrack(track)
        }
    }

    func selectMusicStyle(_ style: RadioStyleID) async {
        await post(["action": .string("configure"), "styleId": .string(style.rawValue)])
    }

    func updatePromptModel(_ promptModel: String) {
        state?.promptModel = promptModel
    }

    func updateAnnouncementsEnabled(_ enabled: Bool) {
        state?.announceEnabled = enabled
    }

    func updateTTSProvider(_ provider: RadioTTSProvider) {
        guard state != nil else {
            return
        }

        state?.ttsProvider = provider
        state?.ttsVoice = RadioTTSVoiceOption.defaultVoice(for: provider)
        ttsVoiceOptions = RadioTTSVoiceOption.options(for: provider, currentVoice: state?.ttsVoice)
    }

    func updateTTSVoice(_ voice: String) {
        state?.ttsVoice = voice
    }

    func loadTTSVoiceOptions() async {
        guard let state else {
            return
        }

        await post([
            "action": .string("ttsVoices"),
            "ttsProvider": .string(state.ttsProvider.rawValue),
            "ttsVoice": .string(state.ttsVoice),
        ])
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

    private var refreshCandidateOrigins: [String] {
        let origins: [String]
        switch endpointMode {
        case .auto:
            origins = [serverOrigin, RadioEndpointResolver.defaultLocalOrigin]
        case .publicInternet:
            origins = [publicServerOrigin]
        case .local:
            origins = [localServerOrigin, RadioEndpointResolver.defaultLocalOrigin].compactMap(\.self)
        case .custom:
            origins = [serverOrigin]
        }

        return origins.reduce(into: []) { uniqueOrigins, origin in
            if !uniqueOrigins.contains(origin) {
                uniqueOrigins.append(origin)
            }
        }
    }

    private var shouldDiscoverLAN: Bool {
        switch endpointMode {
        case .auto, .local:
            true
        case .publicInternet, .custom:
            false
        }
    }

    private var lanDiscoveryOrigins: [String] {
        RadioEndpointResolver.lanCandidateOrigins(localIPv4Addresses: localIPv4Addresses())
    }

    private func updateClient() {
        guard let baseURL = URL(string: serverOrigin) else {
            return
        }

        client = RadioAPIClient(baseURL: baseURL, transport: transport)
    }

    private func setState(_ state: RadioStreamState, origin: String, promptModels: [String]? = nil) {
        applyStateOptions(state)
        self.state = state
        serverOrigin = origin
        applyPromptModels(promptModels)
        applyEndpointMode()
        statusMessage = nil
    }

    private func applyStateOptions(_ state: RadioStreamState) {
        ttsVoiceOptions = RadioTTSVoiceOption.options(for: state.ttsProvider, currentVoice: state.ttsVoice)
    }

    private func applyPromptModels(_ models: [String]?) {
        promptModels = RadioPromptModelOptions.merged(models ?? promptModels, currentModel: state?.promptModel)
    }

    private func applyVoiceOptions(_ voices: [RadioTTSVoiceOption]?) {
        guard let voices, !voices.isEmpty else {
            return
        }

        ttsVoiceOptions = voices
    }

    private func fetchFirstReachableState(origins: [String]) async -> (origin: String, state: RadioStreamState)? {
        let batchSize = 32
        var startIndex = origins.startIndex

        while startIndex < origins.endIndex {
            let endIndex = origins.index(startIndex, offsetBy: batchSize, limitedBy: origins.endIndex) ?? origins.endIndex
            let batch = Array(origins[startIndex..<endIndex])
            if let result = await fetchFirstReachableStateBatch(origins: batch) {
                return result
            }
            startIndex = endIndex
        }

        return nil
    }

    private func fetchFirstReachableStateBatch(origins: [String]) async -> (origin: String, state: RadioStreamState)? {
        await withTaskGroup(of: (String, RadioStreamState)?.self) { group in
            for origin in origins {
                group.addTask { [transport] in
                    guard let baseURL = URL(string: origin) else {
                        return nil
                    }

                    let client = RadioAPIClient(baseURL: baseURL, transport: transport, timeoutInterval: 0.75)
                    do {
                        return (origin, try await client.fetchState())
                    } catch {
                        return nil
                    }
                }
            }

            while let result = await group.next() {
                if let result {
                    group.cancelAll()
                    return result
                }
            }

            return nil
        }
    }

    private func networkSignature(for path: NWPath) -> String {
        [
            String(describing: path.status),
            path.usesInterfaceType(.wifi) ? "wifi" : "no-wifi",
            path.usesInterfaceType(.wiredEthernet) ? "wired" : "no-wired",
            path.usesInterfaceType(.cellular) ? "cellular" : "no-cellular",
            path.isExpensive ? "expensive" : "not-expensive",
            path.isConstrained ? "constrained" : "not-constrained",
        ].joined(separator: "|")
    }

    private func statusMessage(for error: Error?) -> String {
        if error as? RadioAPIError == .webLoginPage {
            return Self.cloudflareVPNMessage
        }

        return error?.localizedDescription ?? "Radio state unavailable."
    }
}
