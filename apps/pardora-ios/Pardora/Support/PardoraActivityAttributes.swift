import ActivityKit
import Foundation

struct PardoraActivityAttributes: ActivityAttributes {
    var stationName: String

    struct ContentState: Codable, Hashable {
        var trackTitle: String
        var styleName: String
        var queueText: String
        var isPlaying: Bool
        var updatedAt: Date
    }
}
