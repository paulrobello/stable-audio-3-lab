import Foundation
import XCTest
@testable import Pardora

final class RadioAPIClientTests: XCTestCase {
    func testFetchStateCallsRadioEndpoint() async throws {
        let transport = MockRadioTransport { request in
            XCTAssertEqual(request.url?.absoluteString, "https://radio.pardev.net/api/radio")
            return (Self.okEnvelope, HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!)
        }
        let client = RadioAPIClient(baseURL: URL(string: "https://radio.pardev.net")!, transport: transport)

        let state = try await client.fetchState()

        XCTAssertEqual(state.currentTrack?.title, "Neon Causeway")
    }

    func testFetchEnvelopeDecodesPromptModels() async throws {
        let transport = MockRadioTransport { request in
            (Self.okEnvelope, HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!)
        }
        let client = RadioAPIClient(baseURL: URL(string: "https://radio.pardev.net")!, transport: transport)

        let envelope = try await client.fetchEnvelope()

        XCTAssertEqual(envelope.promptModels, ["qwen3:14b", "gemma3:12b"])
    }

    func testPostActionSendsBooleanJSONBody() async throws {
        let transport = MockRadioTransport { request in
            XCTAssertEqual(request.httpMethod, "POST")
            let body = try XCTUnwrap(request.httpBody)
            let payload = try XCTUnwrap(JSONSerialization.jsonObject(with: body) as? [String: Any])
            XCTAssertEqual(payload["action"] as? String, "configure")
            XCTAssertEqual(payload["announceEnabled"] as? Bool, true)
            return (Self.okEnvelope, HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!)
        }
        let client = RadioAPIClient(baseURL: URL(string: "https://radio.pardev.net")!, transport: transport)

        let response = try await client.postAction(["action": .string("configure"), "announceEnabled": .bool(true)])

        XCTAssertTrue(response.ok)
    }

    private static let okEnvelope = """
    {
      "ok": true,
      "promptModels": ["qwen3:14b", "gemma3:12b"],
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
          "id": "track-1",
          "filename": "neon_causeway.mp3",
          "title": "Neon Causeway",
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
        "needsQueueFill": true,
        "streamUrl": "https://radio.pardev.net/api/radio?stream=1"
      }
    }
    """.data(using: .utf8)!
}

private struct MockRadioTransport: RadioTransport {
    var handler: @Sendable (URLRequest) throws -> (Data, URLResponse)

    func data(for request: URLRequest) async throws -> (Data, URLResponse) {
        try handler(request)
    }
}
