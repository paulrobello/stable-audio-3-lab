import Foundation
import Darwin

enum RadioEndpointMode: String, CaseIterable, Identifiable {
    case auto
    case publicInternet = "public"
    case local
    case custom

    var id: String {
        rawValue
    }

    var displayName: String {
        switch self {
        case .auto:
            "Auto"
        case .publicInternet:
            "Public"
        case .local:
            "Local"
        case .custom:
            "Custom"
        }
    }
}

enum RadioEndpointResolver {
    static let defaultPublicOrigin = "https://radio.pardev.net"
    static let defaultLocalOrigin = "http://localhost:3007"

    static func origin(from url: URL?) -> String? {
        guard let url, let scheme = url.scheme, let host = url.host else {
            return nil
        }

        var components = URLComponents()
        components.scheme = scheme
        components.host = host
        components.port = url.port
        return components.string
    }

    static func normalizedOrigin(_ rawValue: String) -> String? {
        let trimmed = rawValue.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let url = URL(string: trimmed), ["http", "https"].contains(url.scheme?.lowercased()), url.host != nil else {
            return nil
        }

        return origin(from: url)
    }

    static func streamURL(from value: String?, relativeTo origin: String) -> URL? {
        guard let value else {
            return nil
        }

        if let absoluteURL = URL(string: value), absoluteURL.scheme != nil {
            return absoluteURL
        }

        guard let baseURL = URL(string: origin) else {
            return nil
        }

        return URL(string: value, relativeTo: baseURL)?.absoluteURL
    }

    static func isSameLAN(url: URL?, localIPv4Addresses: [String]) -> Bool {
        guard let host = url?.host, let remote = IPv4Address(host), remote.isPrivate else {
            return false
        }

        return localIPv4Addresses
            .compactMap(IPv4Address.init)
            .filter(\.isPrivate)
            .contains { $0.isSameSubnet(as: remote) }
    }

    static func localIPv4Addresses() -> [String] {
        var results: [String] = []
        var interfaces: UnsafeMutablePointer<ifaddrs>?
        guard getifaddrs(&interfaces) == 0, let firstInterface = interfaces else {
            return results
        }
        defer { freeifaddrs(interfaces) }

        for pointer in sequence(first: firstInterface, next: { $0.pointee.ifa_next }) {
            let interface = pointer.pointee
            guard let socketAddress = interface.ifa_addr, socketAddress.pointee.sa_family == UInt8(AF_INET) else {
                continue
            }

            var address = socketAddress.pointee
            var hostname = [CChar](repeating: 0, count: Int(NI_MAXHOST))
            let result = getnameinfo(
                &address,
                socklen_t(socketAddress.pointee.sa_len),
                &hostname,
                socklen_t(hostname.count),
                nil,
                0,
                NI_NUMERICHOST
            )

            if result == 0 {
                results.append(String(cString: hostname))
            }
        }

        return results
    }
}

private struct IPv4Address {
    let octets: [Int]

    init?(_ rawValue: String) {
        let parts = rawValue.split(separator: ".")
        guard parts.count == 4 else {
            return nil
        }

        let octets = parts.compactMap { Int($0) }
        guard octets.count == 4, octets.allSatisfy({ (0...255).contains($0) }) else {
            return nil
        }

        self.octets = octets
    }

    var isPrivate: Bool {
        octets[0] == 10 ||
            (octets[0] == 172 && (16...31).contains(octets[1])) ||
            (octets[0] == 192 && octets[1] == 168)
    }

    func isSameSubnet(as other: IPv4Address) -> Bool {
        octets.prefix(3).elementsEqual(other.octets.prefix(3))
    }
}
