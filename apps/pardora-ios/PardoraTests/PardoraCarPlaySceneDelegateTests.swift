import XCTest
@testable import Pardora

final class PardoraCarPlaySceneDelegateTests: XCTestCase {
    func testRootRenderStateSkipsRefreshWhenOnlyUpdatedAtChanges() {
        var renderState = PardoraCarPlayRootRenderState()
        let first = PardoraCarPlayRootSnapshot(
            carPlayModeEnabled: true,
            state: Self.state(updatedAt: "2026-05-27T16:00:00.000Z"),
            statusMessage: nil,
            isPlaying: false,
            hasStreamURL: true
        )
        let refreshed = PardoraCarPlayRootSnapshot(
            carPlayModeEnabled: true,
            state: Self.state(updatedAt: "2026-05-27T16:00:05.000Z"),
            statusMessage: nil,
            isPlaying: false,
            hasStreamURL: true
        )

        XCTAssertTrue(renderState.shouldRenderRootTemplate(for: first))
        XCTAssertFalse(renderState.shouldRenderRootTemplate(for: refreshed))
    }

    func testRootRenderStateRefreshesWhenVisibleControlsChange() {
        var renderState = PardoraCarPlayRootRenderState()
        let stopped = PardoraCarPlayRootSnapshot(
            carPlayModeEnabled: true,
            state: Self.state(updatedAt: "2026-05-27T16:00:00.000Z"),
            statusMessage: nil,
            isPlaying: false,
            hasStreamURL: true
        )
        let playing = PardoraCarPlayRootSnapshot(
            carPlayModeEnabled: true,
            state: Self.state(updatedAt: "2026-05-27T16:00:05.000Z"),
            statusMessage: nil,
            isPlaying: true,
            hasStreamURL: true
        )

        XCTAssertTrue(renderState.shouldRenderRootTemplate(for: stopped))
        XCTAssertTrue(renderState.shouldRenderRootTemplate(for: playing))
    }

    private static func state(updatedAt: String) -> RadioStreamState {
        let fixture = """
        {
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
            "createdAt": "2026-05-27T15:55:00.000Z"
          },
          "history": [
            {
              "id": "track-0",
              "filename": "track-0.mp3",
              "title": "Track 0",
              "prompt": "instrumental synthwave",
              "styleId": "synthwave",
              "announce": true,
              "createdAt": "2026-05-27T15:55:00.000Z"
            },
            {
              "id": "track-1",
              "filename": "track-1.mp3",
              "title": "Track 1",
              "prompt": "instrumental synthwave",
              "styleId": "synthwave",
              "announce": true,
              "createdAt": "2026-05-27T16:00:00.000Z"
            }
          ],
          "updatedAt": "\(updatedAt)",
          "streamReady": true,
          "queueAheadCount": 1,
          "queueTarget": 3,
          "needsQueueFill": true,
          "streamUrl": "https://radio.pardev.net/api/radio?stream=1"
        }
        """

        return try! JSONDecoder().decode(RadioStreamState.self, from: Data(fixture.utf8))
    }
}
