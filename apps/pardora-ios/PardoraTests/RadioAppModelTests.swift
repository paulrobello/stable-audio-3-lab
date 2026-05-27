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
