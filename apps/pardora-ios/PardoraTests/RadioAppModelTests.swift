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

    func testSkipPostsSkipTrack() async {
        let client = FakeRadioActionClient()
        let model = RadioAppModel(serverOrigin: "https://radio.pardev.net", actionClient: client)

        await model.skipCurrentTrack()

        let payload = await client.lastPayload
        XCTAssertEqual(payload?["action"], .string("skipTrack"))
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

private actor FakeRadioActionClient: RadioActionClient {
    var payloads: [RadioActionPayload] = []

    var lastPayload: RadioActionPayload? {
        payloads.last
    }

    func postAction(_ payload: RadioActionPayload) async throws -> RadioActionResponse {
        payloads.append(payload)
        return RadioActionResponse(
            ok: true,
            state: nil,
            error: nil,
            deletedTrack: nil,
            rejectedTrack: nil,
            skippedTrack: nil
        )
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
