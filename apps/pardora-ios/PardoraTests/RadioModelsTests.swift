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

    func testDecodesServerProvidedMusicStyles() throws {
        let json = Self.fixture
            .replacingOccurrences(of: "\"selectedStyleId\": \"synthwave\"", with: "\"selectedStyleId\": \"dungeon-synth\"")
            .replacingOccurrences(of: "\"preferences\": {", with: """
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
            ],
            "preferences": {
            """)
        let state = try JSONDecoder().decode(RadioStreamState.self, from: Data(json.utf8))

        XCTAssertEqual(state.availableStyles.map(\.label), ["Synthwave Night Drive", "Dungeon Synth"])
        XCTAssertEqual(state.selectedStyle?.label, "Dungeon Synth")
    }

    func testTrackFeedbackFallsBackToStylePreferences() throws {
        var state = try JSONDecoder().decode(RadioStreamState.self, from: Data(Self.fixture.utf8))
        state.currentTrack?.rating = nil
        state.currentTrack?.prompt = "warm analog bass"

        XCTAssertTrue(state.isTrackLiked(state.currentTrack))
        XCTAssertFalse(state.isTrackDisliked(state.currentTrack))

        state.currentTrack?.prompt = "harsh cymbals"

        XCTAssertFalse(state.isTrackLiked(state.currentTrack))
        XCTAssertTrue(state.isTrackDisliked(state.currentTrack))
    }

    func testNextUpTrackUsesSelectedQueueAfterCurrentTrack() throws {
        var state = try JSONDecoder().decode(RadioStreamState.self, from: Data(Self.fixture.utf8))
        let current = try XCTUnwrap(state.currentTrack)
        let next = RadioTrackRecord(
            id: "track-2",
            filename: "neon_ascent.mp3",
            title: "Neon Ascent",
            prompt: "instrumental synthwave, bright lead",
            styleId: .synthwave,
            announce: true,
            createdAt: "2026-05-27T16:01:00.000Z",
            promptProvider: nil,
            promptModel: nil,
            source: nil,
            fallbackReason: nil,
            announcementFilename: nil,
            durationSeconds: 90,
            rating: nil,
            ratedAt: nil
        )
        let otherStyle = RadioTrackRecord(
            id: "track-3",
            filename: "quiet_room.mp3",
            title: "Quiet Room",
            prompt: "ambient pads",
            styleId: .ambient,
            announce: true,
            createdAt: "2026-05-27T16:02:00.000Z",
            promptProvider: nil,
            promptModel: nil,
            source: nil,
            fallbackReason: nil,
            announcementFilename: nil,
            durationSeconds: 120,
            rating: nil,
            ratedAt: nil
        )
        state.history = [current, otherStyle, next]

        XCTAssertEqual(state.nextUpTrack?.title, "Neon Ascent")
    }

    func testQueueStatusAndNextUpFallbackStayVisible() throws {
        var state = try JSONDecoder().decode(RadioStreamState.self, from: Data(Self.fixture.utf8))
        state.history = [try XCTUnwrap(state.currentTrack)]
        state.queueAheadCount = 2
        state.queueTarget = 3

        XCTAssertEqual(state.queueStatusText, "2/3 ahead")
        XCTAssertEqual(state.nextUpTrack, nil)
        XCTAssertEqual(state.nextUpTitleText, "Preparing next song")

        state.queueAheadCount = 0
        state.needsQueueFill = true

        XCTAssertEqual(state.nextUpTitleText, "Generating new music")

        state.needsQueueFill = false

        XCTAssertEqual(state.nextUpTitleText, "Queue empty")
    }

    func testTrackCreatedAgeAndFileSizeText() throws {
        let track = try XCTUnwrap(try JSONDecoder().decode(RadioStreamState.self, from: Data(Self.fixture.utf8)).currentTrack)
        let now = try Date("2026-05-27T18:05:00.000Z", strategy: .iso8601)

        XCTAssertEqual(track.createdAgeText(now: now), "2h old")
        XCTAssertEqual(track.fileSizeText, "1.2 MB")
        XCTAssertTrue(track.createdDetailText(now: now).contains("2h old"))
        XCTAssertTrue(track.createdDetailText(now: now).contains("1.2 MB"))
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
        "fileSizeBytes": 1234567,
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
