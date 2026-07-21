import Foundation
import CoreFoundation

public enum ReceiverBridgeError: LocalizedError, Equatable {
    case invalidRequest
    case unsupportedVersion
    case unsupportedMethod(String)
    case invalidVolume
    case invalidAppleMusicURL
    case automation(String)

    public var errorDescription: String? {
        switch self {
        case .invalidRequest:
            return "Invalid Poolside Pulse receiver request."
        case .unsupportedVersion:
            return "Unsupported Poolside Pulse receiver bridge version."
        case .unsupportedMethod(let method):
            return "Unsupported Music.app receiver method: \(method)."
        case .invalidVolume:
            return "Volume must be a whole number from 0 through 100."
        case .invalidAppleMusicURL:
            return "Use a full https://music.apple.com Apple Music URL."
        case .automation(let message):
            return message
        }
    }
}

public struct BridgeRequest {
    public static let version = 1
    public static let methods: Set<String> = [
        "capabilities", "activate", "play", "pause", "pauseImmediate",
        "resume", "previous", "next", "stop", "state", "setVolume",
        "pauseForAnnouncement", "resumeAfterAnnouncement", "failSafePause"
    ]

    public let method: String
    public let params: [String: Any]

    public init(body: Any) throws {
        guard let value = body as? [String: Any],
              let suppliedVersion = value["v"] as? NSNumber,
              let method = value["method"] as? String,
              let params = value["params"] as? [String: Any]
        else { throw ReceiverBridgeError.invalidRequest }
        guard CFGetTypeID(suppliedVersion) != CFBooleanGetTypeID(),
              suppliedVersion.doubleValue == Double(Self.version) else {
            throw ReceiverBridgeError.unsupportedVersion
        }
        guard Self.methods.contains(method) else {
            throw ReceiverBridgeError.unsupportedMethod(method)
        }
        self.method = method
        self.params = params
    }

    public func volume(_ key: String, default fallback: Int? = nil) throws -> Int {
        guard let raw = params[key] else {
            if let fallback { return fallback }
            throw ReceiverBridgeError.invalidVolume
        }
        guard let number = raw as? NSNumber,
              CFGetTypeID(number) != CFBooleanGetTypeID() else { throw ReceiverBridgeError.invalidVolume }
        let value = number.doubleValue
        guard value.rounded() == value, value >= 0, value <= 100 else {
            throw ReceiverBridgeError.invalidVolume
        }
        return Int(value)
    }

    public func appleMusicURL(_ key: String = "url") throws -> URL {
        guard let raw = params[key] as? String,
              raw.count <= 2_000,
              let components = URLComponents(string: raw),
              components.scheme?.lowercased() == "https",
              let host = components.host?.lowercased(),
              host == "music.apple.com" || host.hasSuffix(".music.apple.com"),
              let url = components.url
        else { throw ReceiverBridgeError.invalidAppleMusicURL }
        return url
    }

    public func bool(_ key: String, default fallback: Bool = false) -> Bool {
        (params[key] as? NSNumber)?.boolValue ?? fallback
    }
}
