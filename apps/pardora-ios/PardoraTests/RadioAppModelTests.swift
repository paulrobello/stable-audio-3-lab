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
