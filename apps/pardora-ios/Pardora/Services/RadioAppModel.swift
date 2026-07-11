import Foundation
import Network
import Observation

@MainActor
@Observable
final class RadioAppModel {
    var endpointMode: RadioEndpointMode
    var serverOrigin: String
    /// When false (the default), the noisy /24 cleartext-HTTP LAN subnet scan
    /// (SEC-009) is skipped entirely. Discovery then prefers the explicitly
    /// configured `serverOrigin` and `refreshCandidateOrigins`; the full subnet
    /// probe only runs when an operator opts in by setting this to true. Future
    /// work can add Bonjour/mDNS discovery as a quieter middle step.
    var enableLanSubnetScan: Bool
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
    private var remoteTTSVoiceOptions: (provider: RadioTTSProvider, voices: [RadioTTSVoiceOption])?
    private var pendingMusicStyleSelection: RadioStyleID?
    private var musicStyleSelectionRequestID = 0

    init(
        serverOrigin: String = RadioEndpointResolver.defaultPublicOrigin,
        endpointMode: RadioEndpointMode = .auto,
        transport: RadioTransport = URLSession.shared,
        actionClient: RadioActionClient? = nil,
        localIPv4Addresses: @escaping @Sendable () -> [String] = RadioEndpointResolver.localIPv4Addresses,
        enableLanSubnetScan: Bool = false
    ) {
        self.serverOrigin = serverOrigin
        self.endpointMode = endpointMode
        self.transport = transport
        self.enableLanSubnetScan = enableLanSubnetScan
        // Guard against an empty/corrupt persisted serverOrigin (QA-017): fall
        // back to the default public origin instead of crashing at init. The
        // force unwrap on the default is safe — it is a compile-time constant
        // ("https://radio.pardev.net") that always parses.
        client = RadioAPIClient(baseURL: URL(string: serverOrigin) ?? URL(string: RadioEndpointResolver.defaultPublicOrigin)!, transport: transport)
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

    var availableMusicStyles: [RadioStyle] {
        state?.availableStyles ?? RadioStyle.builtIns
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
                applySuccessfulActionResponse(response)
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

    func rateTrack(_ track: RadioTrackRecord, rating: RadioRating) async {
        await post([
            "action": .string("rating"),
            "rating": .string(rating.rawValue),
            "filename": .string(track.filename),
            "styleId": .string(track.styleId.rawValue),
            "phrase": .string(track.prompt),
        ])
    }

    func deleteMemoryFeedback(styleID: RadioStyleID, phrase: String, rating: RadioRating) async {
        await post([
            "action": .string("deleteFeedback"),
            "styleId": .string(styleID.rawValue),
            "phrase": .string(phrase),
            "rating": .string(rating.rawValue),
        ])
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
        musicStyleSelectionRequestID += 1
        let requestID = musicStyleSelectionRequestID
        let previousStyle = state?.selectedStyleId
        pendingMusicStyleSelection = style
        state?.selectedStyleId = style

        do {
            let response = try await (actionClient ?? client).postAction([
                "action": .string("configure"),
                "styleId": .string(style.rawValue),
            ])
            guard requestID == musicStyleSelectionRequestID else {
                return
            }
            guard response.ok else {
                pendingMusicStyleSelection = nil
                if let previousStyle {
                    state?.selectedStyleId = previousStyle
                }
                statusMessage = response.error ?? "Radio action failed."
                return
            }
            pendingMusicStyleSelection = nil
            applySuccessfulActionResponse(response)
        } catch {
            guard requestID == musicStyleSelectionRequestID else {
                return
            }
            pendingMusicStyleSelection = nil
            if let previousStyle {
                state?.selectedStyleId = previousStyle
            }
            statusMessage = error.localizedDescription
        }
    }

    func draftMusicStyle(request: String) async -> RadioStyleDraft? {
        do {
            let response = try await (actionClient ?? client).postAction([
                "action": .string("draftStyle"),
                "request": .string(request),
            ])
            guard response.ok else {
                statusMessage = response.error ?? "Could not draft music style prompts."
                return nil
            }
            applyPromptModels(response.promptModels)
            guard let styleDraft = response.styleDraft else {
                statusMessage = "Codex did not return a style draft."
                return nil
            }
            statusMessage = nil
            return styleDraft
        } catch {
            statusMessage = error.localizedDescription
            return nil
        }
    }

    func saveMusicStyle(
        styleID: RadioStyleID?,
        label: String,
        seedPrompt: String,
        negativePrompt: String
    ) async -> RadioStyle? {
        let trimmedLabel = label.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedSeedPrompt = seedPrompt.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedNegativePrompt = negativePrompt.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmedLabel.count >= 2, trimmedSeedPrompt.count >= 8 else {
            statusMessage = "Enter a style name and prompt before saving."
            return nil
        }

        var payload: RadioActionPayload = [
            "action": .string(styleID == nil ? "createStyle" : "updateStyle"),
            "label": .string(trimmedLabel),
            "seedPrompt": .string(trimmedSeedPrompt),
            "negativePrompt": .string(trimmedNegativePrompt),
        ]
        if let styleID {
            payload["styleId"] = .string(styleID.rawValue)
        }

        do {
            let response = try await (actionClient ?? client).postAction(payload)
            guard response.ok else {
                statusMessage = response.error ?? "Could not save music style."
                return nil
            }
            applySuccessfulActionResponse(response)
            return response.style
        } catch {
            statusMessage = error.localizedDescription
            return nil
        }
    }

    func deleteMusicStyle(_ style: RadioStyle) async -> Bool {
        do {
            let response = try await (actionClient ?? client).postAction([
                "action": .string("deleteStyle"),
                "styleId": .string(style.id.rawValue),
            ])
            guard response.ok else {
                statusMessage = response.error ?? "Could not delete music style."
                return false
            }
            applySuccessfulActionResponse(response)
            return true
        } catch {
            statusMessage = error.localizedDescription
            return false
        }
    }

    func updatePromptModel(_ promptModel: String) {
        state?.promptModel = promptModel
    }

    func updateAnnouncementsEnabled(_ enabled: Bool) {
        state?.announceEnabled = enabled
    }

    func changeAnnouncementsEnabled(_ enabled: Bool) async {
        updateAnnouncementsEnabled(enabled)
        await saveConfiguration()
    }

    func updateTTSProvider(_ provider: RadioTTSProvider) {
        guard state != nil else {
            return
        }

        state?.ttsProvider = provider
        state?.ttsVoice = RadioTTSVoiceOption.defaultVoice(for: provider)
        applyTTSVoiceOptions(for: provider, currentVoice: state?.ttsVoice)
    }

    func updateTTSVoice(_ voice: String) {
        state?.ttsVoice = voice
        applyTTSVoiceOptions(for: state?.ttsProvider ?? .openai, currentVoice: voice)
    }

    func changeTTSProvider(_ provider: RadioTTSProvider) async {
        updateTTSProvider(provider)
        await saveConfiguration()
        await loadTTSVoiceOptions()
    }

    func changeTTSVoice(_ voice: String) async {
        updateTTSVoice(voice)
        await saveConfiguration()
    }

    func loadTTSVoiceOptions() async {
        guard let state else {
            return
        }

        let provider = state.ttsProvider
        let voice = state.ttsVoice
        let payload: RadioActionPayload = [
            "action": .string("ttsVoices"),
            "ttsProvider": .string(provider.rawValue),
            "ttsVoice": .string(voice),
        ]

        do {
            let response = try await (actionClient ?? client).postAction(payload)
            if response.ok {
                applyVoiceOptions(response.voices, provider: provider, currentVoice: voice)
                statusMessage = nil
            } else {
                statusMessage = response.error ?? "Radio action failed."
            }
        } catch {
            statusMessage = error.localizedDescription
        }
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
        // SEC-009: the /24 cleartext-HTTP subnet scan is opt-in. The explicitly
        // configured `serverOrigin` (and `refreshCandidateOrigins`) is always
        // tried first; the subnet probe only runs when the operator enables it.
        guard enableLanSubnetScan else {
            return false
        }
        switch endpointMode {
        case .auto, .local:
            return true
        case .publicInternet, .custom:
            return false
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
        let state = statePreservingPendingMusicStyle(state)
        applyStateOptions(state)
        self.state = state
        serverOrigin = origin
        applyPromptModels(promptModels)
        applyEndpointMode()
        statusMessage = nil
    }

    private func applySuccessfulActionResponse(_ response: RadioActionResponse) {
        if let state = response.state {
            let state = statePreservingPendingMusicStyle(state)
            applyStateOptions(state)
            self.state = state
            applyEndpointMode()
        }
        applyPromptModels(response.promptModels)
        applyVoiceOptions(response.voices)
        statusMessage = nil
    }

    private func statePreservingPendingMusicStyle(_ state: RadioStreamState) -> RadioStreamState {
        guard let pendingMusicStyleSelection else {
            return state
        }

        var state = state
        state.selectedStyleId = pendingMusicStyleSelection
        return state
    }

    private func applyStateOptions(_ state: RadioStreamState) {
        applyTTSVoiceOptions(for: state.ttsProvider, currentVoice: state.ttsVoice)
    }

    private func applyPromptModels(_ models: [String]?) {
        promptModels = RadioPromptModelOptions.merged(models ?? promptModels, currentModel: state?.promptModel)
    }

    private func applyVoiceOptions(_ voices: [RadioTTSVoiceOption]?) {
        applyVoiceOptions(voices, provider: state?.ttsProvider, currentVoice: state?.ttsVoice)
    }

    private func applyVoiceOptions(_ voices: [RadioTTSVoiceOption]?, provider: RadioTTSProvider?, currentVoice: String?) {
        guard let provider else {
            return
        }
        guard let voices, !voices.isEmpty else {
            return
        }

        let mergedVoices = RadioTTSVoiceOption.merged(voices, currentVoice: currentVoice)
        remoteTTSVoiceOptions = (provider, mergedVoices)
        if state?.ttsProvider == provider {
            ttsVoiceOptions = mergedVoices
        }
    }

    private func applyTTSVoiceOptions(for provider: RadioTTSProvider, currentVoice: String?) {
        if let remoteTTSVoiceOptions, remoteTTSVoiceOptions.provider == provider {
            ttsVoiceOptions = RadioTTSVoiceOption.merged(remoteTTSVoiceOptions.voices, currentVoice: currentVoice)
            return
        }

        ttsVoiceOptions = RadioTTSVoiceOption.options(for: provider, currentVoice: currentVoice)
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
