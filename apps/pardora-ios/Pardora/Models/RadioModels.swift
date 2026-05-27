import Foundation

struct RadioStreamState: Codable, Equatable {
    var selectedStyleId: RadioStyleID
    var announceEnabled: Bool
    var promptModel: String
    var ttsProvider: RadioTTSProvider
    var ttsVoice: String
    var announcementPrefix: String
    var announcementSuffix: String
    var preferences: [String: RadioPreference]
    var currentTrackByStyle: [String: String]
    var currentTrack: RadioTrackRecord?
    var history: [RadioTrackRecord]
    var updatedAt: String
    var streamReady: Bool
    var queueAheadCount: Int
    var queueTarget: Int
    var needsQueueFill: Bool
    var streamUrl: String?
    var lanStreamUrl: String?
    var publicPlaylistUrls: RadioPlaylistUrls?
    var lanPlaylistUrls: RadioPlaylistUrls?

    var streamURL: URL? {
        if let streamUrl, let url = URL(string: streamUrl) {
            return url
        }

        if let lanStreamUrl, let url = URL(string: lanStreamUrl) {
            return url
        }

        return nil
    }

    var selectedQueue: [RadioTrackRecord] {
        history.filter { $0.styleId == selectedStyleId }
    }

    func preference(for style: RadioStyleID) -> RadioPreference? {
        preferences[style.rawValue]
    }
}

struct RadioTrackRecord: Codable, Equatable, Identifiable {
    var id: String
    var filename: String
    var title: String
    var prompt: String
    var styleId: RadioStyleID
    var announce: Bool
    var createdAt: String
    var promptProvider: String?
    var promptModel: String?
    var source: String?
    var fallbackReason: String?
    var announcementFilename: String?
    var durationSeconds: Int?
    var rating: RadioRating?
    var ratedAt: String?

    var isLiked: Bool {
        rating == .up
    }
}

struct RadioPreference: Codable, Equatable {
    var likes: [String]
    var dislikes: [String]
    var tasteProfile: RadioTasteProfile?
}

struct RadioTasteProfile: Codable, Equatable {
    var likedTraits: [String]
    var dislikedTraits: [String]
    var promptDirectives: [String]
    var negativePromptDirectives: [String]
    var explorationNotes: [String]
    var updatedAt: String
    var sourceEventCount: Int
    var provider: String
    var model: String
}

struct RadioPlaylistUrls: Codable, Equatable {
    var m3u: String?
    var pls: String?
}

struct RadioStyleID: RawRepresentable, Codable, Hashable, ExpressibleByStringLiteral {
    typealias RawValue = String

    var rawValue: String

    init(rawValue: String) {
        self.rawValue = rawValue
    }

    init(stringLiteral value: StringLiteralType) {
        rawValue = value
    }

    static let synthwave = RadioStyleID(rawValue: "synthwave")
    static let ambient = RadioStyleID(rawValue: "ambient")
    static let cinematic = RadioStyleID(rawValue: "cinematic")
    static let lofi = RadioStyleID(rawValue: "lofi")
    static let experimental = RadioStyleID(rawValue: "experimental")

    var displayName: String {
        switch rawValue {
        case "synthwave":
            "Synthwave Night Drive"
        case "ambient":
            "Ambient Signal Drift"
        case "cinematic":
            "Cinematic Trailer Pulse"
        case "lofi":
            "Lofi Study Loop"
        case "experimental":
            "Experimental Machine Folk"
        default:
            rawValue
                .split(separator: "-")
                .map { $0.prefix(1).uppercased() + $0.dropFirst() }
                .joined(separator: " ")
        }
    }
}

enum RadioRating: String, Codable {
    case up
    case down
}

enum RadioTTSProvider: String, Codable, CaseIterable, Identifiable {
    case openai
    case elevenlabs
    case deepgram
    case gemini
    case kokoroOnnx = "kokoro-onnx"

    var id: String {
        rawValue
    }

    var displayName: String {
        switch self {
        case .openai:
            "OpenAI"
        case .elevenlabs:
            "ElevenLabs"
        case .deepgram:
            "Deepgram"
        case .gemini:
            "Gemini"
        case .kokoroOnnx:
            "Kokoro ONNX"
        }
    }
}
