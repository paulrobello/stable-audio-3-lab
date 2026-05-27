import XCTest
@testable import Pardora

final class RadioModelsTests: XCTestCase {
    func testDecodesRadioStreamStateFixture() throws {
        let state = try JSONDecoder().decode(RadioStreamState.self, from: Data(Self.fixture.utf8))

        XCTAssertEqual(state.selectedStyleId, .synthwave)
        XCTAssertEqual(state.currentTrack?.title, "Neon Causeway")
        XCTAssertEqual(state.queueAheadCount, 2)
        XCTAssertEqual(state.preference(for: .synthwave)?.likes, ["warm analog bass"])
        XCTAssertEqual(state.streamURL?.absoluteString, "https://radio.pardev.net/api/radio?stream=1")
    }

    func testUnknownStyleDecodesWithoutFailing() throws {
        let json = Self.fixture.replacingOccurrences(of: "\"selectedStyleId\": \"synthwave\"", with: "\"selectedStyleId\": \"future-style\"")
        let state = try JSONDecoder().decode(RadioStreamState.self, from: Data(json.utf8))

        XCTAssertEqual(state.selectedStyleId.rawValue, "future-style")
        XCTAssertEqual(state.selectedStyleId.displayName, "Future Style")
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
      "preferences": {
        "synthwave": {
          "likes": ["warm analog bass"],
          "dislikes": ["harsh cymbals"],
          "tasteProfile": {
            "likedTraits": ["warm bass"],
            "dislikedTraits": ["brittle highs"],
            "promptDirectives": ["lean into night drive momentum"],
            "negativePromptDirectives": ["avoid harsh cymbals"],
            "explorationNotes": ["prefers clean punch"],
            "updatedAt": "2026-05-27T16:00:00.000Z",
            "sourceEventCount": 2,
            "provider": "codex-cli",
            "model": "gpt-5"
          }
        }
      },
      "currentTrackByStyle": { "synthwave": "neon_causeway.mp3" },
      "currentTrack": {
        "id": "track-1",
        "filename": "neon_causeway.mp3",
        "title": "Neon Causeway",
        "prompt": "instrumental synthwave, warm analog bass",
        "styleId": "synthwave",
        "announce": true,
        "createdAt": "2026-05-27T16:00:00.000Z",
        "promptProvider": "ollama",
        "promptModel": "llama3.1:8b",
        "durationSeconds": 60,
        "rating": "up"
      },
      "history": [],
      "updatedAt": "2026-05-27T16:00:00.000Z",
      "streamReady": true,
      "queueAheadCount": 2,
      "queueTarget": 3,
      "needsQueueFill": true,
      "streamUrl": "https://radio.pardev.net/api/radio?stream=1",
      "lanStreamUrl": "http://192.168.1.50:3007/api/radio?stream=1"
    }
    """
}
