import Foundation

protocol RadioTransport: Sendable {
    func data(for request: URLRequest) async throws -> (Data, URLResponse)
}

extension URLSession: RadioTransport {}

typealias RadioActionPayload = [String: RadioPayloadValue]

enum RadioPayloadValue: Equatable, Sendable {
    case string(String)
    case bool(Bool)

    var jsonValue: Any {
        switch self {
        case .string(let value):
            value
        case .bool(let value):
            value
        }
    }
}

extension Dictionary where Key == String, Value == RadioPayloadValue {
    var jsonObject: [String: Any] {
        mapValues(\.jsonValue)
    }
}

protocol RadioActionClient: Sendable {
    func postAction(_ payload: RadioActionPayload) async throws -> RadioActionResponse
}

struct RadioAPIClient: RadioActionClient {
    let baseURL: URL
    let transport: RadioTransport

    init(baseURL: URL, transport: RadioTransport = URLSession.shared) {
        self.baseURL = baseURL
        self.transport = transport
    }

    func fetchState() async throws -> RadioStreamState {
        let response: RadioEnvelope = try await send(path: "/api/radio", method: "GET", body: nil)
        guard response.ok, let state = response.state else {
            throw RadioAPIError.server(response.error ?? "Radio state unavailable.")
        }

        return state
    }

    func postAction(_ payload: RadioActionPayload) async throws -> RadioActionResponse {
        let body = try JSONSerialization.data(withJSONObject: payload.jsonObject)
        return try await send(path: "/api/radio", method: "POST", body: body)
    }

    private func send<T: Decodable>(path: String, method: String, body: Data?) async throws -> T {
        let url = baseURL.appending(path: path)
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.cachePolicy = .reloadIgnoringLocalCacheData

        if let body {
            request.httpBody = body
            request.setValue("application/json", forHTTPHeaderField: "content-type")
        }

        let (data, response) = try await transport.data(for: request)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw RadioAPIError.transport
        }

        return try JSONDecoder().decode(T.self, from: data)
    }
}

struct RadioEnvelope: Decodable {
    var ok: Bool
    var state: RadioStreamState?
    var error: String?
}

struct RadioActionResponse: Decodable {
    var ok: Bool
    var state: RadioStreamState?
    var error: String?
    var deletedTrack: RadioTrackRecord?
    var rejectedTrack: RadioTrackRecord?
    var skippedTrack: RadioTrackRecord?
}

enum RadioAPIError: Error, Equatable, LocalizedError {
    case server(String)
    case transport

    var errorDescription: String? {
        switch self {
        case .server(let message):
            message
        case .transport:
            "Radio server request failed."
        }
    }
}
