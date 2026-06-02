import XCTest
@testable import Pardora

@MainActor
final class RadioAppModelTests: XCTestCase {
    func testLikePostsRatingUp() async {
        let client = FakeRadioActionClient()
        let model = RadioAppModel(serverOrigin: "https://radio.pardev.net", actionClient: client)

        await model.likeCurrentTrack()

        let payload = await client.lastPayload
        XCTAssertEqual(payload?["action"], .string("rating"))
        XCTAssertEqual(payload?["rating"], .string("up"))
    }

    func testDeleteMemoryFeedbackPostsDeleteFeedbackAction() async {
        let client = FakeRadioActionClient()
        let model = RadioAppModel(serverOrigin: "https://radio.pardev.net", actionClient: client)

        await model.deleteMemoryFeedback(styleID: .synthwave, phrase: "warm analog bass", rating: .up)

        let payload = await client.lastPayload
        XCTAssertEqual(payload?["action"], .string("deleteFeedback"))
        XCTAssertEqual(payload?["styleId"], .string("synthwave"))
        XCTAssertEqual(payload?["phrase"], .string("warm analog bass"))
        XCTAssertEqual(payload?["rating"], .string("up"))
    }

    func testRateTrackPostsQueueTrackPromptAndStyle() async {
        let client = FakeRadioActionClient()
        let model = RadioAppModel(serverOrigin: "https://radio.pardev.net", actionClient: client)
        let track = RadioTrackRecord(
            id: "queue-track",
            filename: "queue-track.mp3",
            title: "Queue Track",
            prompt: "queue prompt",
            styleId: .ambient,
            announce: true,
            createdAt: "2026-05-27T16:00:00.000Z"
        )

        await model.rateTrack(track, rating: .down)

        let payload = await client.lastPayload
        XCTAssertEqual(payload?["action"], .string("rating"))
        XCTAssertEqual(payload?["rating"], .string("down"))
        XCTAssertEqual(payload?["styleId"], .string("ambient"))
        XCTAssertEqual(payload?["phrase"], .string("queue prompt"))
    }

    func testSkipPostsSkipTrack() async {
        let client = FakeRadioActionClient()
        let model = RadioAppModel(serverOrigin: "https://radio.pardev.net", actionClient: client)

        await model.skipCurrentTrack()

        let payload = await client.lastPayload
        XCTAssertEqual(payload?["action"], .string("skipTrack"))
    }

    func testDeleteTracksPostsDeleteForEachSelectedTrack() async {
        let client = FakeRadioActionClient()
        let model = RadioAppModel(serverOrigin: "https://radio.pardev.net", actionClient: client)
        let first = RadioTrackRecord(
            id: "track-1",
            filename: "first.mp3",
            title: "First",
            prompt: "first prompt",
            styleId: .synthwave,
            announce: true,
            createdAt: "2026-05-27T16:00:00.000Z"
        )
        let second = RadioTrackRecord(
            id: "track-2",
            filename: "second.mp3",
            title: "Second",
            prompt: "second prompt",
            styleId: .synthwave,
            announce: true,
            createdAt: "2026-05-27T16:00:00.000Z"
        )

        await model.deleteTracks([first, second])

        let payloads = await client.payloads
        XCTAssertEqual(payloads.count, 2)
        XCTAssertEqual(payloads[0]["action"], .string("deleteTrack"))
        XCTAssertEqual(payloads[0]["filename"], .string("first.mp3"))
        XCTAssertEqual(payloads[1]["action"], .string("deleteTrack"))
        XCTAssertEqual(payloads[1]["filename"], .string("second.mp3"))
    }

    func testSelectMusicStylePostsConfigureAction() async {
        let client = FakeRadioActionClient()
        let model = RadioAppModel(serverOrigin: "https://radio.pardev.net", actionClient: client)

        await model.selectMusicStyle(.ambient)

        let payload = await client.lastPayload
        XCTAssertEqual(payload?["action"], .string("configure"))
        XCTAssertEqual(payload?["styleId"], .string("ambient"))
    }

    func testSelectMusicStyleAppliesReturnedState() async {
        var nextState = Self.stateWithLANURL
        nextState.selectedStyleId = .ambient
        let client = FakeRadioActionClient(response: RadioActionResponse(
            ok: true,
            state: nextState,
            error: nil,
            deletedTrack: nil,
            rejectedTrack: nil,
            skippedTrack: nil
        ))
        let model = RadioAppModel(serverOrigin: "https://radio.pardev.net", actionClient: client)

        await model.selectMusicStyle(.ambient)

        XCTAssertEqual(model.state?.selectedStyleId, .ambient)
    }

    func testSelectMusicStyleKeepsLatestSelectionWhenOlderResponseFinishesLast() async {
        let client = DelayedStyleSelectionActionClient(delayedStyleID: .ambient, baseState: Self.stateWithLANURL)
        let model = RadioAppModel(serverOrigin: "https://radio.pardev.net", actionClient: client)
        model.state = Self.stateWithLANURL

        let olderSelection = Task {
            await model.selectMusicStyle(.ambient)
        }
        await client.waitForPayloadCount(1)

        let newerSelection = Task {
            await model.selectMusicStyle(.cinematic)
        }
        await client.waitForPayloadCount(2)
        await newerSelection.value

        XCTAssertEqual(model.state?.selectedStyleId, .cinematic)

        await client.completeDelayedStyle()
        await olderSelection.value

        XCTAssertEqual(model.state?.selectedStyleId, .cinematic)
    }

    func testSelectMusicStylePreservesPendingSelectionAcrossRefresh() async {
        let client = DelayedStyleSelectionActionClient(delayedStyleID: .ambient, baseState: Self.stateWithLANURL)
        let model = RadioAppModel(
            serverOrigin: "https://radio.pardev.net",
            endpointMode: .custom,
            transport: TTSRefreshRadioTransport(state: Self.stateWithLANURL),
            actionClient: client
        )
        model.state = Self.stateWithLANURL

        let selection = Task {
            await model.selectMusicStyle(.ambient)
        }
        await client.waitForPayloadCount(1)

        await model.refresh(showStatus: false)

        XCTAssertEqual(model.state?.selectedStyleId, .ambient)

        await client.completeDelayedStyle()
        await selection.value

        XCTAssertEqual(model.state?.selectedStyleId, .ambient)
    }

    func testDraftMusicStylePostsRequestAndReturnsDraft() async {
        let draft = RadioStyleDraft(
            label: "Dungeon Synth",
            seedPrompt: "moody dungeon synth instrumental, tape hiss",
            negativePrompt: "modern EDM drops",
            model: "codex"
        )
        let client = FakeRadioActionClient(response: RadioActionResponse(ok: true, styleDraft: draft))
        let model = RadioAppModel(serverOrigin: "https://radio.pardev.net", actionClient: client)

        let result = await model.draftMusicStyle(request: "dark fantasy cassette synth")

        let payload = await client.lastPayload
        XCTAssertEqual(payload?["action"], .string("draftStyle"))
        XCTAssertEqual(payload?["request"], .string("dark fantasy cassette synth"))
        XCTAssertEqual(result, draft)
    }

    func testDraftMusicStyleReportsMissingDraftResponse() async {
        let client = FakeRadioActionClient(response: RadioActionResponse(ok: true))
        let model = RadioAppModel(serverOrigin: "https://radio.pardev.net", actionClient: client)

        let result = await model.draftMusicStyle(request: "dark fantasy cassette synth")

        XCTAssertNil(result)
        XCTAssertEqual(model.statusMessage, "Codex did not return a style draft.")
    }

    func testSaveMusicStyleCreatesStyleAndAppliesReturnedState() async {
        let style = RadioStyle(
            id: "dungeon-synth",
            label: "Dungeon Synth",
            seedPrompt: "moody dungeon synth instrumental, tape hiss",
            negativePrompt: "modern EDM drops"
        )
        var nextState = Self.stateWithLANURL
        nextState.selectedStyleId = style.id
        nextState.styles = [style]
        let client = FakeRadioActionClient(response: RadioActionResponse(ok: true, state: nextState, style: style))
        let model = RadioAppModel(serverOrigin: "https://radio.pardev.net", actionClient: client)

        let result = await model.saveMusicStyle(
            styleID: nil,
            label: " Dungeon Synth ",
            seedPrompt: " moody dungeon synth instrumental, tape hiss ",
            negativePrompt: " modern EDM drops "
        )

        let payload = await client.lastPayload
        XCTAssertEqual(payload?["action"], .string("createStyle"))
        XCTAssertNil(payload?["styleId"])
        XCTAssertEqual(payload?["label"], .string("Dungeon Synth"))
        XCTAssertEqual(payload?["seedPrompt"], .string("moody dungeon synth instrumental, tape hiss"))
        XCTAssertEqual(payload?["negativePrompt"], .string("modern EDM drops"))
        XCTAssertEqual(result, style)
        XCTAssertEqual(model.state?.selectedStyleId, "dungeon-synth")
        XCTAssertEqual(model.availableMusicStyles, [style])
    }

    func testSaveMusicStyleUpdatesExistingStyle() async {
        let style = RadioStyle(
            id: .synthwave,
            label: "Edited Synthwave",
            seedPrompt: "brighter analog synthwave instrumental",
            negativePrompt: "vocals"
        )
        let client = FakeRadioActionClient(response: RadioActionResponse(ok: true, style: style))
        let model = RadioAppModel(serverOrigin: "https://radio.pardev.net", actionClient: client)

        let result = await model.saveMusicStyle(
            styleID: .synthwave,
            label: "Edited Synthwave",
            seedPrompt: "brighter analog synthwave instrumental",
            negativePrompt: "vocals"
        )

        let payload = await client.lastPayload
        XCTAssertEqual(payload?["action"], .string("updateStyle"))
        XCTAssertEqual(payload?["styleId"], .string("synthwave"))
        XCTAssertEqual(result, style)
    }

    func testDeleteMusicStylePostsDeleteAndAppliesReturnedState() async {
        let style = RadioStyle(
            id: "dungeon-synth",
            label: "Dungeon Synth",
            seedPrompt: "moody dungeon synth instrumental, tape hiss",
            negativePrompt: "modern EDM drops"
        )
        var nextState = Self.stateWithLANURL
        nextState.selectedStyleId = .synthwave
        nextState.styles = RadioStyle.builtIns
        let client = FakeRadioActionClient(response: RadioActionResponse(ok: true, state: nextState, deletedStyle: style))
        let model = RadioAppModel(serverOrigin: "https://radio.pardev.net", actionClient: client)

        let deleted = await model.deleteMusicStyle(style)

        let payload = await client.lastPayload
        XCTAssertTrue(deleted)
        XCTAssertEqual(payload?["action"], .string("deleteStyle"))
        XCTAssertEqual(payload?["styleId"], .string("dungeon-synth"))
        XCTAssertEqual(model.state?.selectedStyleId, .synthwave)
    }

    func testSaveConfigurationPostsEditedStationSettings() async {
        let client = FakeRadioActionClient()
        let model = RadioAppModel(serverOrigin: "https://radio.pardev.net", actionClient: client)
        model.state = Self.stateWithLANURL

        model.updatePromptModel("qwen2.5:14b")
        model.updateAnnouncementsEnabled(false)
        model.updateTTSProvider(.deepgram)
        model.updateTTSVoice("aura-2-apollo-en")

        await model.saveConfiguration()

        let payload = await client.lastPayload
        XCTAssertEqual(payload?["action"], .string("configure"))
        XCTAssertEqual(payload?["styleId"], .string("synthwave"))
        XCTAssertEqual(payload?["promptModel"], .string("qwen2.5:14b"))
        XCTAssertEqual(payload?["announceEnabled"], .bool(false))
        XCTAssertEqual(payload?["ttsProvider"], .string("deepgram"))
        XCTAssertEqual(payload?["ttsVoice"], .string("aura-2-apollo-en"))
    }

    func testChangeAnnouncementsPersistsSelection() async {
        let client = FakeRadioActionClient()
        let model = RadioAppModel(serverOrigin: "https://radio.pardev.net", actionClient: client)
        model.state = Self.stateWithLANURL

        await model.changeAnnouncementsEnabled(false)

        let payload = await client.lastPayload
        XCTAssertEqual(payload?["action"], .string("configure"))
        XCTAssertEqual(payload?["announceEnabled"], .bool(false))
        XCTAssertEqual(model.state?.announceEnabled, false)
    }

    func testLoadTTSVoiceOptionsPostsProviderAndAppliesReturnedVoices() async {
        var state = Self.stateWithLANURL
        state.ttsProvider = .elevenlabs
        state.ttsVoice = "Juniper"
        let voices = [
            RadioTTSVoiceOption(id: "Juniper", label: "Juniper", description: nil),
            RadioTTSVoiceOption(id: "voice-alpha", label: "Alpha", description: "Account voice"),
            RadioTTSVoiceOption(id: "voice-beta", label: "Beta", description: nil),
        ]
        let client = FakeRadioActionClient(response: RadioActionResponse(ok: true, voices: voices))
        let model = RadioAppModel(serverOrigin: "https://radio.pardev.net", actionClient: client)
        model.state = state

        await model.loadTTSVoiceOptions()

        let payload = await client.lastPayload
        XCTAssertEqual(payload?["action"], .string("ttsVoices"))
        XCTAssertEqual(payload?["ttsProvider"], .string("elevenlabs"))
        XCTAssertEqual(payload?["ttsVoice"], .string("Juniper"))
        XCTAssertEqual(model.ttsVoiceOptions, voices)
    }

    func testRefreshPreservesLoadedTTSVoiceOptionsForCurrentProvider() async {
        var state = Self.stateWithLANURL
        state.ttsProvider = .elevenlabs
        state.ttsVoice = "Juniper"
        let voices = [
            RadioTTSVoiceOption(id: "voice-alpha", label: "Alpha", description: "Account voice"),
            RadioTTSVoiceOption(id: "voice-beta", label: "Beta", description: nil),
        ]
        let client = FakeRadioActionClient(response: RadioActionResponse(ok: true, voices: voices))
        let model = RadioAppModel(
            serverOrigin: "https://radio.pardev.net",
            endpointMode: .custom,
            transport: TTSRefreshRadioTransport(state: state),
            actionClient: client
        )
        model.state = state

        await model.loadTTSVoiceOptions()
        await model.refresh()

        XCTAssertEqual(model.ttsVoiceOptions, RadioTTSVoiceOption.merged(voices, currentVoice: "Juniper"))
    }

    func testChangeTTSProviderPersistsSelectionBeforeLoadingVoices() async {
        let voices = [
            RadioTTSVoiceOption(id: "aura-2-apollo-en", label: "Apollo", description: nil),
        ]
        let client = FakeRadioActionClient(response: RadioActionResponse(ok: true, voices: voices))
        let model = RadioAppModel(serverOrigin: "https://radio.pardev.net", actionClient: client)
        model.state = Self.stateWithLANURL

        await model.changeTTSProvider(.deepgram)

        let payloads = await client.payloads
        XCTAssertEqual(payloads.count, 2)
        XCTAssertEqual(payloads[0]["action"], .string("configure"))
        XCTAssertEqual(payloads[0]["ttsProvider"], .string("deepgram"))
        XCTAssertEqual(payloads[0]["ttsVoice"], .string("aura-2-thalia-en"))
        XCTAssertEqual(payloads[1]["action"], .string("ttsVoices"))
        XCTAssertEqual(payloads[1]["ttsProvider"], .string("deepgram"))
        XCTAssertEqual(model.state?.ttsProvider, .deepgram)
    }

    func testChangeTTSVoicePersistsSelection() async {
        var state = Self.stateWithLANURL
        state.ttsProvider = .deepgram
        state.ttsVoice = "aura-2-thalia-en"
        let client = FakeRadioActionClient()
        let model = RadioAppModel(serverOrigin: "https://radio.pardev.net", actionClient: client)
        model.state = state

        await model.changeTTSVoice("aura-2-apollo-en")

        let payload = await client.lastPayload
        XCTAssertEqual(payload?["action"], .string("configure"))
        XCTAssertEqual(payload?["ttsProvider"], .string("deepgram"))
        XCTAssertEqual(payload?["ttsVoice"], .string("aura-2-apollo-en"))
        XCTAssertEqual(model.state?.ttsVoice, "aura-2-apollo-en")
    }

    func testModelExposesServerProvidedMusicStyles() async {
        let transport = DynamicStylesRadioTransport()
        let model = RadioAppModel(
            serverOrigin: "http://localhost:3007",
            endpointMode: .custom,
            transport: transport
        )

        await model.refresh()

        XCTAssertEqual(model.availableMusicStyles.map(\.label), ["Synthwave Night Drive", "Dungeon Synth"])
        XCTAssertEqual(model.state?.selectedStyle?.label, "Dungeon Synth")
    }

    func testEndpointModeDefaultsToAuto() {
        let model = RadioAppModel()

        XCTAssertEqual(model.endpointMode, .auto)
    }

    func testAutoEndpointUsesLANWhenDeviceIsOnSamePrivateNetwork() {
        let model = RadioAppModel(localIPv4Addresses: { ["192.168.1.80"] })
        model.state = Self.stateWithLANURL
        model.endpointMode = .auto

        model.applyEndpointMode()

        XCTAssertEqual(model.serverOrigin, "http://192.168.1.50:3007")
        XCTAssertEqual(model.streamURL?.absoluteString, "http://192.168.1.50:3007/api/radio?stream=1")
        XCTAssertTrue(model.usesLocalEndpoint)
    }

    func testAutoEndpointUsesPublicWhenLANIsDifferentPrivateNetwork() {
        let model = RadioAppModel(localIPv4Addresses: { ["192.168.2.80"] })
        model.state = Self.stateWithLANURL
        model.endpointMode = .auto

        model.applyEndpointMode()

        XCTAssertEqual(model.serverOrigin, "https://radio.pardev.net")
        XCTAssertEqual(model.streamURL?.absoluteString, "https://radio.pardev.net/api/radio?stream=1")
        XCTAssertFalse(model.usesLocalEndpoint)
    }

    func testLocalEndpointUsesDetectedLANOrigin() {
        let model = RadioAppModel(localIPv4Addresses: { ["192.168.2.80"] })
        model.state = Self.stateWithLANURL
        model.endpointMode = .local

        model.applyEndpointMode()

        XCTAssertEqual(model.serverOrigin, "http://192.168.1.50:3007")
        XCTAssertEqual(model.streamURL?.absoluteString, "http://192.168.1.50:3007/api/radio?stream=1")
        XCTAssertTrue(model.usesLocalEndpoint)
    }

    func testCustomEndpointKeepsEnteredOrigin() {
        let model = RadioAppModel(serverOrigin: "http://10.0.0.12:3007/radio", endpointMode: .custom)

        model.applyEndpointMode()

        XCTAssertEqual(model.serverOrigin, "http://10.0.0.12:3007")
    }

    func testAutoRefreshFallsBackToLocalWhenPublicReturnsNonJSON() async {
        let transport = FallbackRadioTransport()
        let model = RadioAppModel(
            serverOrigin: "https://radio.pardev.net",
            endpointMode: .auto,
            transport: transport,
            localIPv4Addresses: { [] }
        )

        await model.refresh()

        let requestedURLs = await transport.requestedURLs
        XCTAssertEqual(requestedURLs, [
            "https://radio.pardev.net/api/radio",
            "http://localhost:3007/api/radio",
        ])
        XCTAssertEqual(model.state?.currentTrack?.title, "Local Track")
        XCTAssertEqual(model.serverOrigin, "http://localhost:3007")
        XCTAssertNil(model.statusMessage)
    }

    func testAutoRefreshPreservesCloudflareAccessMessageWhenFallbacksFail() async {
        let transport = CloudflareOnlyRadioTransport()
        let model = RadioAppModel(
            serverOrigin: "https://radio.pardev.net",
            endpointMode: .auto,
            transport: transport,
            localIPv4Addresses: { [] }
        )

        await model.refresh()

        let requestedURLs = await transport.requestedURLs
        XCTAssertEqual(requestedURLs, [
            "https://radio.pardev.net/api/radio",
            "http://localhost:3007/api/radio",
        ])
        XCTAssertNil(model.state)
        XCTAssertEqual(model.statusMessage, RadioAppModel.cloudflareVPNMessage)
    }

    func testAutoRefreshDiscoversLANOriginBeforeStateExists() async {
        let transport = LANDiscoveryRadioTransport()
        let model = RadioAppModel(
            serverOrigin: "https://radio.pardev.net",
            endpointMode: .auto,
            transport: transport,
            localIPv4Addresses: { ["192.168.1.40"] }
        )

        await model.refresh()

        XCTAssertEqual(model.state?.currentTrack?.title, "LAN Track")
        XCTAssertEqual(model.serverOrigin, "http://192.168.1.207:3007")
        XCTAssertEqual(model.streamURL?.absoluteString, "http://192.168.1.207:3007/api/radio?stream=1")
        XCTAssertNil(model.statusMessage)
    }

    func testLocalRefreshDiscoversLANOriginBeforeStateExists() async {
        let transport = LANDiscoveryRadioTransport()
        let model = RadioAppModel(
            endpointMode: .local,
            transport: transport,
            localIPv4Addresses: { ["192.168.1.40"] }
        )

        await model.refresh()

        XCTAssertEqual(model.state?.currentTrack?.title, "LAN Track")
        XCTAssertEqual(model.serverOrigin, "http://192.168.1.207:3007")
        XCTAssertEqual(model.endpointSummary, "Local")
        XCTAssertNil(model.statusMessage)
    }

    func testLANCandidateOriginsComeFromPrivateSubnet() {
        let origins = RadioEndpointResolver.lanCandidateOrigins(localIPv4Addresses: ["127.0.0.1", "192.168.1.40"])

        XCTAssertTrue(origins.contains("http://192.168.1.207:3007"))
        XCTAssertFalse(origins.contains("http://192.168.1.40:3007"))
        XCTAssertFalse(origins.contains("http://127.0.0.1:3007"))
    }

    func testPublicEndpointHTMLSuggestsCloudflareVPN() async {
        let transport = FallbackRadioTransport()
        let model = RadioAppModel(
            serverOrigin: "https://radio.pardev.net",
            endpointMode: .publicInternet,
            transport: transport
        )

        await model.refresh()

        XCTAssertNil(model.state)
        XCTAssertEqual(model.statusMessage, RadioAppModel.cloudflareVPNMessage)
    }

    func testConnectionTestLeavesVisibleSuccessMessage() async {
        let transport = FallbackRadioTransport()
        let model = RadioAppModel(
            serverOrigin: "http://localhost:3007",
            endpointMode: .custom,
            transport: transport
        )

        await model.testConnection()

        XCTAssertEqual(model.connectionTestMessage, "Connected to http://localhost:3007")
        XCTAssertNil(model.statusMessage)
    }

    func testCloudflareOneShortcutUsesDocumentedURLScheme() {
        XCTAssertEqual(CloudflareOneApp.url.scheme, "cf1app")
        XCTAssertEqual(CloudflareOneApp.url.host, "oneapp.cloudflare.com")
        XCTAssertEqual(CloudflareOneApp.appStoreURL.host, "apps.apple.com")
    }

    func testNetworkChangeRefreshesAutoEndpointDetection() async {
        let transport = FallbackRadioTransport()
        let model = RadioAppModel(
            serverOrigin: "https://radio.pardev.net",
            endpointMode: .auto,
            transport: transport,
            localIPv4Addresses: { [] }
        )

        await model.networkPathDidChange()

        let requestedURLs = await transport.requestedURLs
        XCTAssertEqual(requestedURLs, [
            "https://radio.pardev.net/api/radio",
            "http://localhost:3007/api/radio",
        ])
        XCTAssertEqual(model.state?.currentTrack?.title, "Local Track")
    }

    func testSilentRefreshUpdatesQueueWithoutVisibleTestingStatus() async {
        let transport = QueueRefreshRadioTransport()
        let model = RadioAppModel(
            serverOrigin: "http://localhost:3007",
            endpointMode: .custom,
            transport: transport
        )

        await model.refresh()
        await model.refresh(showStatus: false)

        XCTAssertEqual(model.state?.queueAheadCount, 3)
        XCTAssertEqual(model.state?.history.count, 4)
        XCTAssertNil(model.statusMessage)
    }

    private static var stateWithLANURL: RadioStreamState {
        try! JSONDecoder().decode(RadioStreamState.self, from: Data(Self.fixture.utf8))
    }

    private static let fixture = """
    {
      "selectedStyleId": "synthwave",
      "announceEnabled": true,
      "promptModel": "llama3.1:8b",
      "ttsProvider": "openai",
      "ttsVoice": "nova",
      "announcementPrefix": "Now playing: ",
      "announcementSuffix": "",
      "preferences": {},
      "currentTrackByStyle": {},
      "currentTrack": null,
      "history": [],
      "updatedAt": "2026-05-27T16:00:00.000Z",
      "streamReady": true,
      "queueAheadCount": 0,
      "queueTarget": 3,
      "needsQueueFill": false,
      "streamUrl": "https://radio.pardev.net/api/radio?stream=1",
      "lanStreamUrl": "http://192.168.1.50:3007/api/radio?stream=1"
    }
    """
}

private actor QueueRefreshRadioTransport: RadioTransport {
    private var responseCount = 0

    func data(for request: URLRequest) async throws -> (Data, URLResponse) {
        let url = try XCTUnwrap(request.url)
        responseCount += 1
        let queueAheadCount = responseCount == 1 ? 0 : 3
        let history = (0...queueAheadCount).map { index in
            """
            {
              "id": "track-\(index)",
              "filename": "track-\(index).mp3",
              "title": "Track \(index)",
              "prompt": "instrumental synthwave",
              "styleId": "synthwave",
              "announce": true,
              "createdAt": "2026-05-27T16:00:00.000Z"
            }
            """
        }.joined(separator: ",")
        let envelope = """
        {
          "ok": true,
          "state": {
            "selectedStyleId": "synthwave",
            "announceEnabled": true,
            "promptModel": "llama3.1:8b",
            "ttsProvider": "openai",
            "ttsVoice": "nova",
            "announcementPrefix": "Now playing: ",
            "announcementSuffix": "",
            "preferences": {},
            "currentTrackByStyle": { "synthwave": "track-0.mp3" },
            "currentTrack": {
              "id": "track-0",
              "filename": "track-0.mp3",
              "title": "Track 0",
              "prompt": "instrumental synthwave",
              "styleId": "synthwave",
              "announce": true,
              "createdAt": "2026-05-27T16:00:00.000Z"
            },
            "history": [\(history)],
            "updatedAt": "2026-05-27T16:00:0\(responseCount).000Z",
            "streamReady": true,
            "queueAheadCount": \(queueAheadCount),
            "queueTarget": 3,
            "needsQueueFill": \(queueAheadCount < 3),
            "streamUrl": "http://localhost:3007/api/radio?stream=1"
          }
        }
        """
        let response = try XCTUnwrap(HTTPURLResponse(url: url, statusCode: 200, httpVersion: nil, headerFields: nil))
        return (Data(envelope.utf8), response)
    }
}

private actor DynamicStylesRadioTransport: RadioTransport {
    func data(for request: URLRequest) async throws -> (Data, URLResponse) {
        let url = try XCTUnwrap(request.url)
        let envelope = """
        {
          "ok": true,
          "state": {
            "selectedStyleId": "dungeon-synth",
            "announceEnabled": true,
            "promptModel": "llama3.1:8b",
            "ttsProvider": "openai",
            "ttsVoice": "nova",
            "announcementPrefix": "Now playing: ",
            "announcementSuffix": "",
            "preferences": {},
            "currentTrackByStyle": {},
            "currentTrack": null,
            "history": [],
            "updatedAt": "2026-05-27T16:00:00.000Z",
            "streamReady": true,
            "queueAheadCount": 0,
            "queueTarget": 3,
            "needsQueueFill": false,
            "streamUrl": "http://localhost:3007/api/radio?stream=1",
            "styles": [
              {
                "id": "synthwave",
                "label": "Synthwave Night Drive",
                "seedPrompt": "instrumental synthwave, warm analog bass",
                "negativePrompt": "vocals"
              },
              {
                "id": "dungeon-synth",
                "label": "Dungeon Synth",
                "seedPrompt": "moody dungeon synth instrumental, tape hiss",
                "negativePrompt": "modern EDM drops"
              }
            ]
          }
        }
        """
        let response = try XCTUnwrap(HTTPURLResponse(url: url, statusCode: 200, httpVersion: nil, headerFields: nil))
        return (Data(envelope.utf8), response)
    }
}

private actor TTSRefreshRadioTransport: RadioTransport {
    let state: RadioStreamState

    init(state: RadioStreamState) {
        self.state = state
    }

    func data(for request: URLRequest) async throws -> (Data, URLResponse) {
        let url = try XCTUnwrap(request.url)
        let stateData = try JSONEncoder().encode(state)
        let stateJSON = try XCTUnwrap(String(data: stateData, encoding: .utf8))
        let envelope = """
        {
          "ok": true,
          "state": \(stateJSON)
        }
        """
        let response = try XCTUnwrap(HTTPURLResponse(url: url, statusCode: 200, httpVersion: nil, headerFields: nil))
        return (Data(envelope.utf8), response)
    }
}

private actor FakeRadioActionClient: RadioActionClient {
    var payloads: [RadioActionPayload] = []
    let response: RadioActionResponse

    init(response: RadioActionResponse = RadioActionResponse(
        ok: true,
        state: nil,
        error: nil,
        deletedTrack: nil,
        rejectedTrack: nil,
        skippedTrack: nil
    )) {
        self.response = response
    }

    var lastPayload: RadioActionPayload? {
        payloads.last
    }

    func postAction(_ payload: RadioActionPayload) async throws -> RadioActionResponse {
        payloads.append(payload)
        return response
    }
}

private actor DelayedStyleSelectionActionClient: RadioActionClient {
    var payloads: [RadioActionPayload] = []

    private let delayedStyleID: RadioStyleID
    private let baseState: RadioStreamState
    private var delayedContinuation: CheckedContinuation<RadioActionResponse, Error>?
    private var payloadCountContinuations: [(Int, CheckedContinuation<Void, Never>)] = []

    init(delayedStyleID: RadioStyleID, baseState: RadioStreamState) {
        self.delayedStyleID = delayedStyleID
        self.baseState = baseState
    }

    func postAction(_ payload: RadioActionPayload) async throws -> RadioActionResponse {
        payloads.append(payload)
        resumePayloadCountContinuations()

        guard case .string(let styleIDValue)? = payload["styleId"] else {
            return RadioActionResponse(ok: true)
        }

        let styleID = RadioStyleID(rawValue: styleIDValue)
        if styleID == delayedStyleID {
            return try await withCheckedThrowingContinuation { continuation in
                delayedContinuation = continuation
            }
        }

        return response(styleID: styleID)
    }

    func waitForPayloadCount(_ count: Int) async {
        guard payloads.count < count else {
            return
        }

        await withCheckedContinuation { continuation in
            payloadCountContinuations.append((count, continuation))
        }
    }

    func completeDelayedStyle() {
        delayedContinuation?.resume(returning: response(styleID: delayedStyleID))
        delayedContinuation = nil
    }

    private func response(styleID: RadioStyleID) -> RadioActionResponse {
        var state = baseState
        state.selectedStyleId = styleID
        return RadioActionResponse(ok: true, state: state)
    }

    private func resumePayloadCountContinuations() {
        let readyContinuations = payloadCountContinuations.filter { payloads.count >= $0.0 }
        payloadCountContinuations.removeAll { payloads.count >= $0.0 }
        for continuation in readyContinuations {
            continuation.1.resume()
        }
    }
}

private actor FallbackRadioTransport: RadioTransport {
    var requestedURLs: [String] = []

    func data(for request: URLRequest) async throws -> (Data, URLResponse) {
        let url = try XCTUnwrap(request.url)
        requestedURLs.append(url.absoluteString)

        let response = try XCTUnwrap(HTTPURLResponse(url: url, statusCode: 200, httpVersion: nil, headerFields: nil))
        if url.host == "localhost" {
            return (Data(Self.localEnvelope.utf8), response)
        }

        return (Data("<html>Cloudflare Access</html>".utf8), response)
    }

    private static let localEnvelope = """
    {
      "ok": true,
      "state": {
        "selectedStyleId": "synthwave",
        "announceEnabled": true,
        "promptModel": "llama3.1:8b",
        "ttsProvider": "openai",
        "ttsVoice": "nova",
        "announcementPrefix": "Now playing: ",
        "announcementSuffix": "",
        "preferences": {},
        "currentTrackByStyle": {},
        "currentTrack": {
          "id": "track-local",
          "filename": "local.mp3",
          "title": "Local Track",
          "prompt": "instrumental synthwave",
          "styleId": "synthwave",
          "announce": true,
          "createdAt": "2026-05-27T16:00:00.000Z"
        },
        "history": [],
        "updatedAt": "2026-05-27T16:00:00.000Z",
        "streamReady": true,
        "queueAheadCount": 0,
        "queueTarget": 3,
        "needsQueueFill": false,
        "streamUrl": "http://localhost:3007/api/radio?stream=1",
        "lanStreamUrl": "http://192.168.1.50:3007/api/radio?stream=1"
      }
    }
    """
}

private actor CloudflareOnlyRadioTransport: RadioTransport {
    var requestedURLs: [String] = []

    func data(for request: URLRequest) async throws -> (Data, URLResponse) {
        let url = try XCTUnwrap(request.url)
        requestedURLs.append(url.absoluteString)

        guard url.host == "radio.pardev.net" else {
            throw URLError(.cannotConnectToHost)
        }

        let response = try XCTUnwrap(HTTPURLResponse(url: url, statusCode: 200, httpVersion: nil, headerFields: nil))
        return (Data("<html>Cloudflare Access</html>".utf8), response)
    }
}

private actor LANDiscoveryRadioTransport: RadioTransport {
    var requestedURLs: [String] = []

    func data(for request: URLRequest) async throws -> (Data, URLResponse) {
        let url = try XCTUnwrap(request.url)
        requestedURLs.append(url.absoluteString)

        if url.host == "192.168.1.207" {
            let response = try XCTUnwrap(HTTPURLResponse(url: url, statusCode: 200, httpVersion: nil, headerFields: nil))
            return (Data(Self.lanEnvelope.utf8), response)
        }

        throw URLError(.cannotConnectToHost)
    }

    private static let lanEnvelope = """
    {
      "ok": true,
      "state": {
        "selectedStyleId": "synthwave",
        "announceEnabled": true,
        "promptModel": "llama3.1:8b",
        "ttsProvider": "openai",
        "ttsVoice": "nova",
        "announcementPrefix": "Now playing: ",
        "announcementSuffix": "",
        "preferences": {},
        "currentTrackByStyle": {},
        "currentTrack": {
          "id": "track-lan",
          "filename": "lan.mp3",
          "title": "LAN Track",
          "prompt": "instrumental synthwave",
          "styleId": "synthwave",
          "announce": true,
          "createdAt": "2026-05-27T16:00:00.000Z"
        },
        "history": [],
        "updatedAt": "2026-05-27T16:00:00.000Z",
        "streamReady": true,
        "queueAheadCount": 0,
        "queueTarget": 3,
        "needsQueueFill": false,
        "streamUrl": "https://radio.pardev.net/api/radio?stream=1",
        "lanStreamUrl": "http://192.168.1.207:3007/api/radio?stream=1"
      }
    }
    """
}
