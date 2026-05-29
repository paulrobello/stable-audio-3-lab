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
    var currentTrackStartedAt: String?
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
    var styles: [RadioStyle]?

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

    var availableStyles: [RadioStyle] {
        let baseStyles = styles?.isEmpty == false ? styles ?? [] : RadioStyle.builtIns
        guard !baseStyles.contains(where: { $0.id == selectedStyleId }) else {
            return baseStyles
        }

        return [RadioStyle(id: selectedStyleId, label: selectedStyleId.displayName, seedPrompt: selectedStyleId.seedPrompt, negativePrompt: nil)] + baseStyles
    }

    var selectedStyle: RadioStyle? {
        availableStyles.first { $0.id == selectedStyleId }
    }

    var queueStatusText: String {
        "\(queueAheadCount)/\(queueTarget) ahead"
    }

    var nextUpTrack: RadioTrackRecord? {
        let queue = selectedQueue
        guard let currentFilename = currentTrack?.filename else {
            return queue.first
        }

        if let currentIndex = queue.firstIndex(where: { $0.filename == currentFilename }) {
            return queue.dropFirst(queue.index(after: currentIndex)).first
        }

        return queue.first { $0.filename != currentFilename }
    }

    var nextUpTitleText: String {
        if let nextUpTrack {
            return nextUpTrack.title
        }

        if queueAheadCount > 0 {
            return "Preparing next song"
        }

        if needsQueueFill {
            return "Generating new music"
        }

        return "Queue empty"
    }

    func preference(for style: RadioStyleID) -> RadioPreference? {
        preferences[style.rawValue]
    }

    func feedbackSummary(for style: RadioStyleID) -> RadioFeedbackSummary {
        let preference = preference(for: style)
        let ratedTracks = history.filter { $0.styleId == style }

        return RadioFeedbackSummary(
            likeItems: memoryItems(phrases: preference?.likes ?? [], ratedTracks: ratedTracks, rating: .up),
            dislikeItems: memoryItems(phrases: preference?.dislikes ?? [], ratedTracks: ratedTracks, rating: .down),
            tasteProfile: preference?.tasteProfile
        )
    }

    private func memoryItems(phrases: [String], ratedTracks: [RadioTrackRecord], rating: RadioRating) -> [RadioMemoryItem] {
        let ratedPhrases = ratedTracks.filter { $0.rating == rating }.map(\.prompt)
        return phrases.mergingUnique(ratedPhrases).map { phrase in
            let exactAssessment = ratedTracks.first { $0.prompt == phrase && $0.rating == rating && $0.latestAssessment != nil }?.latestAssessment
            let promptAssessment = ratedTracks.first { $0.prompt == phrase && $0.latestAssessment != nil }?.latestAssessment
            return RadioMemoryItem(phrase: phrase, rating: rating, assessment: exactAssessment ?? promptAssessment)
        }
    }

    func isTrackLiked(_ track: RadioTrackRecord?) -> Bool {
        guard let track else {
            return false
        }

        if track.rating == .up {
            return true
        }

        return preference(for: track.styleId)?.likes.contains(track.prompt) == true
    }

    func isTrackDisliked(_ track: RadioTrackRecord?) -> Bool {
        guard let track else {
            return false
        }

        if track.rating == .down {
            return true
        }

        return preference(for: track.styleId)?.dislikes.contains(track.prompt) == true
    }

    func thumbStatus(for track: RadioTrackRecord?) -> RadioThumbStatus? {
        if isTrackLiked(track) {
            return .up
        }

        if isTrackDisliked(track) {
            return .down
        }

        return nil
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
    var fileSizeBytes: Int?
    var rating: RadioRating?
    var ratedAt: String?
    var latestAssessment: RadioAudioAssessment?

    var isLiked: Bool {
        rating == .up
    }

    var createdDate: Date? {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = formatter.date(from: createdAt) {
            return date
        }

        formatter.formatOptions = [.withInternetDateTime]
        return formatter.date(from: createdAt)
    }

    var createdTimestampText: String {
        guard let createdDate else {
            return createdAt
        }

        return createdDate.formatted(.dateTime.month(.abbreviated).day().hour().minute())
    }

    var fileSizeText: String? {
        guard let fileSizeBytes, fileSizeBytes > 0 else {
            return nil
        }

        let units = ["B", "KB", "MB", "GB"]
        var value = Double(fileSizeBytes)
        var unitIndex = 0
        while value >= 1000, unitIndex < units.count - 1 {
            value /= 1000
            unitIndex += 1
        }

        if unitIndex == 0 {
            return "\(Int(value.rounded())) \(units[unitIndex])"
        }

        let precision = value >= 10 ? 0 : 1
        return String(format: "%.\(precision)f %@", value, units[unitIndex])
    }

    func createdAgeText(now: Date = .now) -> String {
        guard let createdDate else {
            return "age unknown"
        }

        let seconds = max(0, Int(now.timeIntervalSince(createdDate)))
        if seconds < 60 {
            return "just now"
        }

        let minutes = seconds / 60
        if minutes < 60 {
            return "\(minutes)m old"
        }

        let hours = minutes / 60
        if hours < 24 {
            return "\(hours)h old"
        }

        return "\(hours / 24)d old"
    }

    func createdDetailText(now: Date = .now) -> String {
        ["Created \(createdTimestampText)", createdAgeText(now: now), fileSizeText]
            .compactMap(\.self)
            .joined(separator: " • ")
    }

    var queueCreatedDetailText: String {
        "Created \(createdTimestampText)"
    }
}

struct RadioPreference: Codable, Equatable {
    var likes: [String]
    var dislikes: [String]
    var tasteProfile: RadioTasteProfile?
}

struct RadioFeedbackSummary: Equatable {
    var likeItems: [RadioMemoryItem]
    var dislikeItems: [RadioMemoryItem]
    var tasteProfile: RadioTasteProfile?

    var likes: [String] {
        likeItems.map(\.phrase)
    }

    var dislikes: [String] {
        dislikeItems.map(\.phrase)
    }

    var isEmpty: Bool {
        likes.isEmpty && dislikes.isEmpty && tasteProfile == nil
    }
}

struct RadioMemoryItem: Equatable, Identifiable {
    var phrase: String
    var rating: RadioRating
    var assessment: RadioAudioAssessment?

    var id: String {
        "\(rating.rawValue):\(phrase)"
    }
}

struct RadioAudioAssessment: Codable, Equatable {
    var assessedAt: String?
    var provider: String?
    var model: String?
    var summary: String?
    var attributes: RadioAudioAssessmentAttributes

    init(
        assessedAt: String? = nil,
        provider: String? = nil,
        model: String? = nil,
        summary: String? = nil,
        attributes: RadioAudioAssessmentAttributes = RadioAudioAssessmentAttributes()
    ) {
        self.assessedAt = assessedAt
        self.provider = provider
        self.model = model
        self.summary = summary
        self.attributes = attributes
    }

    enum CodingKeys: String, CodingKey {
        case assessedAt
        case provider
        case model
        case summary
        case attributes
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        assessedAt = try container.decodeIfPresent(String.self, forKey: .assessedAt)
        provider = try container.decodeIfPresent(String.self, forKey: .provider)
        model = try container.decodeIfPresent(String.self, forKey: .model)
        summary = try container.decodeIfPresent(String.self, forKey: .summary)
        attributes = try container.decodeIfPresent(RadioAudioAssessmentAttributes.self, forKey: .attributes) ?? RadioAudioAssessmentAttributes()
    }
}

struct RadioAudioAssessmentAttributes: Codable, Equatable {
    var genre: [String]
    var instruments: [String]
    var mood: [String]
    var production: [String]
    var positives: [String]
    var negatives: [String]
    var rhythm: String?
    var tempoBpm: Int?
    var key: String?

    init(
        genre: [String] = [],
        instruments: [String] = [],
        mood: [String] = [],
        production: [String] = [],
        positives: [String] = [],
        negatives: [String] = [],
        rhythm: String? = nil,
        tempoBpm: Int? = nil,
        key: String? = nil
    ) {
        self.genre = genre
        self.instruments = instruments
        self.mood = mood
        self.production = production
        self.positives = positives
        self.negatives = negatives
        self.rhythm = rhythm
        self.tempoBpm = tempoBpm
        self.key = key
    }

    enum CodingKeys: String, CodingKey {
        case genre
        case instruments
        case mood
        case production
        case positives
        case negatives
        case rhythm
        case tempoBpm
        case key
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        genre = try container.decodeIfPresent([String].self, forKey: .genre) ?? []
        instruments = try container.decodeIfPresent([String].self, forKey: .instruments) ?? []
        mood = try container.decodeIfPresent([String].self, forKey: .mood) ?? []
        production = try container.decodeIfPresent([String].self, forKey: .production) ?? []
        positives = try container.decodeIfPresent([String].self, forKey: .positives) ?? []
        negatives = try container.decodeIfPresent([String].self, forKey: .negatives) ?? []
        rhythm = try container.decodeIfPresent(String.self, forKey: .rhythm)
        tempoBpm = try container.decodeIfPresent(Int.self, forKey: .tempoBpm)
        key = try container.decodeIfPresent(String.self, forKey: .key)
    }
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

struct RadioStyle: Codable, Equatable, Identifiable {
    var id: RadioStyleID
    var label: String
    var seedPrompt: String
    var negativePrompt: String?

    static let builtIns: [RadioStyle] = [
        RadioStyle(id: .synthwave, label: "Synthwave Night Drive", seedPrompt: "Warm analog bass, neon pads, clean punchy drums, no vocals.", negativePrompt: "Muddy low end, harsh cymbals, vocals."),
        RadioStyle(id: .ambient, label: "Ambient Signal Drift", seedPrompt: "Slow evolving pads, gentle arpeggios, spacious reverb.", negativePrompt: "Busy drums, abrupt transitions, vocals."),
        RadioStyle(id: .cinematic, label: "Cinematic Trailer Pulse", seedPrompt: "Pulsing low strings, restrained brass, deep percussion.", negativePrompt: "Cartoon sounds, thin drums, vocals."),
        RadioStyle(id: .lofi, label: "Lofi Study Loop", seedPrompt: "Dusty drums, mellow Rhodes chords, warm tape saturation.", negativePrompt: "Bright hats, harsh clipping, vocals."),
        RadioStyle(id: .experimental, label: "Experimental Machine Folk", seedPrompt: "Organic plucks, glitchy tape loops, subtle modular pulses.", negativePrompt: "Random noise wall, abrasive clipping, vocals.")
    ]
}

struct RadioStyleID: RawRepresentable, Codable, Hashable, Identifiable, CaseIterable, ExpressibleByStringLiteral {
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

    static let allCases: [RadioStyleID] = [.synthwave, .ambient, .cinematic, .lofi, .experimental]

    var id: String {
        rawValue
    }

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

    var seedPrompt: String {
        switch rawValue {
        case "synthwave":
            "Warm analog bass, neon pads, clean punchy drums, no vocals."
        case "ambient":
            "Slow evolving pads, gentle arpeggios, spacious reverb."
        case "cinematic":
            "Pulsing low strings, restrained brass, deep percussion."
        case "lofi":
            "Dusty drums, mellow Rhodes chords, warm tape saturation."
        case "experimental":
            "Organic plucks, glitchy tape loops, subtle modular pulses."
        default:
            "Custom station style from the radio server."
        }
    }
}

enum RadioRating: String, Codable {
    case up
    case down
}

enum RadioThumbStatus: Equatable {
    case up
    case down

    var symbolName: String {
        switch self {
        case .up:
            "hand.thumbsup.fill"
        case .down:
            "hand.thumbsdown.fill"
        }
    }

    var accessibilityLabel: String {
        switch self {
        case .up:
            "Thumbs up"
        case .down:
            "Thumbs down"
        }
    }

    var isNegative: Bool {
        self == .down
    }
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

struct RadioTTSVoiceOption: Codable, Equatable, Identifiable {
    var id: String
    var label: String
    var description: String?

    static func merged(_ options: [RadioTTSVoiceOption], currentVoice: String?) -> [RadioTTSVoiceOption] {
        guard let currentVoice, !currentVoice.isEmpty, !options.contains(where: { $0.id == currentVoice }) else {
            return options
        }

        return [RadioTTSVoiceOption(id: currentVoice, label: fallbackLabel(for: currentVoice), description: nil)] + options
    }

    static func fallbackLabel(for voiceID: String) -> String {
        let trimmedVoiceID = voiceID.trimmingCharacters(in: .whitespacesAndNewlines)
        let knownPrefixes = ["aura-2-", "aura-", "af_", "am_", "bf_", "bm_"]
        let name = knownPrefixes.reduce(trimmedVoiceID) { value, prefix in
            value.hasPrefix(prefix) ? String(value.dropFirst(prefix.count)) : value
        }
        let words = name
            .replacingOccurrences(of: "-en", with: "")
            .split { $0 == "-" || $0 == "_" }

        guard !words.isEmpty else {
            return trimmedVoiceID
        }

        return words
            .map { $0.prefix(1).uppercased() + $0.dropFirst() }
            .joined(separator: " ")
    }

    static func options(for provider: RadioTTSProvider, currentVoice: String? = nil) -> [RadioTTSVoiceOption] {
        let options: [RadioTTSVoiceOption] = switch provider {
        case .openai:
            [
                RadioTTSVoiceOption(id: "nova", label: "Nova", description: "Warm and friendly"),
                RadioTTSVoiceOption(id: "alloy", label: "Alloy", description: "Neutral and balanced"),
                RadioTTSVoiceOption(id: "ash", label: "Ash", description: "Enthusiastic and energetic"),
                RadioTTSVoiceOption(id: "ballad", label: "Ballad", description: "Warm and soulful"),
                RadioTTSVoiceOption(id: "coral", label: "Coral", description: "Friendly and approachable"),
                RadioTTSVoiceOption(id: "echo", label: "Echo", description: "Smooth and articulate"),
                RadioTTSVoiceOption(id: "fable", label: "Fable", description: "Expressive and animated"),
                RadioTTSVoiceOption(id: "onyx", label: "Onyx", description: "Deep and authoritative"),
                RadioTTSVoiceOption(id: "sage", label: "Sage", description: "Calm and wise"),
                RadioTTSVoiceOption(id: "shimmer", label: "Shimmer", description: "Soft and gentle"),
                RadioTTSVoiceOption(id: "verse", label: "Verse", description: "Clear and melodic"),
                RadioTTSVoiceOption(id: "marin", label: "Marin", description: "Gentle and soothing"),
                RadioTTSVoiceOption(id: "cedar", label: "Cedar", description: "Rich and resonant"),
            ]
        case .elevenlabs:
            [
                RadioTTSVoiceOption(id: "Juniper", label: "Juniper", description: nil),
            ]
        case .deepgram:
            [
                RadioTTSVoiceOption(id: "aura-2-thalia-en", label: "Thalia", description: "American, feminine, clear and energetic"),
                RadioTTSVoiceOption(id: "aura-2-andromeda-en", label: "Andromeda", description: "American, feminine, casual and expressive"),
                RadioTTSVoiceOption(id: "aura-2-helena-en", label: "Helena", description: "American, feminine, caring and natural"),
                RadioTTSVoiceOption(id: "aura-2-apollo-en", label: "Apollo", description: "American, masculine, confident and casual"),
                RadioTTSVoiceOption(id: "aura-2-arcas-en", label: "Arcas", description: "American, masculine, natural and smooth"),
                RadioTTSVoiceOption(id: "aura-2-aries-en", label: "Aries", description: "American, masculine, warm and energetic"),
                RadioTTSVoiceOption(id: "aura-asteria-en", label: "Asteria (Aura-1)", description: "American, feminine, knowledgeable"),
                RadioTTSVoiceOption(id: "aura-luna-en", label: "Luna (Aura-1)", description: "American, feminine, friendly"),
            ]
        case .gemini:
            [
                RadioTTSVoiceOption(id: "Kore", label: "Kore", description: "Firm"),
                RadioTTSVoiceOption(id: "Zephyr", label: "Zephyr", description: "Bright"),
                RadioTTSVoiceOption(id: "Puck", label: "Puck", description: "Upbeat"),
                RadioTTSVoiceOption(id: "Charon", label: "Charon", description: "Informative"),
                RadioTTSVoiceOption(id: "Fenrir", label: "Fenrir", description: "Excitable"),
                RadioTTSVoiceOption(id: "Leda", label: "Leda", description: "Youthful"),
                RadioTTSVoiceOption(id: "Orus", label: "Orus", description: "Firm"),
                RadioTTSVoiceOption(id: "Aoede", label: "Aoede", description: "Breezy"),
                RadioTTSVoiceOption(id: "Callirrhoe", label: "Callirrhoe", description: "Easy-going"),
                RadioTTSVoiceOption(id: "Autonoe", label: "Autonoe", description: "Bright"),
                RadioTTSVoiceOption(id: "Enceladus", label: "Enceladus", description: "Breathy"),
                RadioTTSVoiceOption(id: "Iapetus", label: "Iapetus", description: "Clear"),
                RadioTTSVoiceOption(id: "Umbriel", label: "Umbriel", description: "Easy-going"),
                RadioTTSVoiceOption(id: "Algieba", label: "Algieba", description: "Smooth"),
                RadioTTSVoiceOption(id: "Despina", label: "Despina", description: "Smooth"),
                RadioTTSVoiceOption(id: "Erinome", label: "Erinome", description: "Clear"),
            ]
        case .kokoroOnnx:
            [
                RadioTTSVoiceOption(id: "af_sarah", label: "Sarah", description: nil),
                RadioTTSVoiceOption(id: "af_alloy", label: "Alloy", description: nil),
                RadioTTSVoiceOption(id: "af_aoede", label: "Aoede", description: nil),
                RadioTTSVoiceOption(id: "af_bella", label: "Bella", description: nil),
                RadioTTSVoiceOption(id: "af_heart", label: "Heart", description: nil),
            ]
        }

        return merged(options, currentVoice: currentVoice)
    }

    static func defaultVoice(for provider: RadioTTSProvider) -> String {
        options(for: provider).first?.id ?? "nova"
    }
}

enum RadioPromptModelOptions {
    static let defaults = [
        "llama3.1:8b",
        "gemma3:12b",
        "phi4:14b",
        "qwen2.5:14b",
        "mistral-small:24b",
        "gemma3:27b",
    ]

    static func merged(_ models: [String], currentModel: String?) -> [String] {
        var seen = Set<String>()
        return (models.isEmpty ? defaults : models)
            .appending(currentModel)
            .compactMap { $0?.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty && seen.insert($0).inserted }
    }
}

private extension Array where Element == String {
    func appending(_ value: String?) -> [String?] {
        map(Optional.some) + [value]
    }

    func mergingUnique(_ values: [String]) -> [String] {
        var seen = Set<String>()
        return (self + values)
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty && seen.insert($0).inserted }
    }
}
