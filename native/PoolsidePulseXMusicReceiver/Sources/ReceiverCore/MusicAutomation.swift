import AppKit
import Foundation

public struct MusicState: Equatable {
    public var volume: Int
    public var playerState: String
    public var position: Double
    public var name: String
    public var artists: String
    public var persistentId: String
    public var sourceURL: String

    public var isPlaying: Bool { playerState.lowercased() == "playing" }

    public var dictionary: [String: Any] {
        [
            "deviceId": "music-app@receiver-mac",
            "deviceName": "macOS Music.app",
            "volume": volume,
            "supportsVolume": true,
            "volumeVerified": true,
            "verifiedPercent": volume,
            "playerState": playerState,
            "isPlaying": isPlaying,
            "position": position,
            "name": name,
            "artists": artists,
            "persistentId": persistentId,
            "sourceUrl": sourceURL,
            "uri": sourceURL
        ]
    }
}

@MainActor
public final class MusicAutomation {
    public static let shared = MusicAutomation()

    private var currentSourceURL = ""

    public init() {}

    public func capabilities() throws -> [String: Any] {
        var result = try state().dictionary
        result["authorized"] = true
        result["platform"] = "macos-music-app"
        return result
    }

    public func state() throws -> MusicState {
        let descriptor = try execute(Self.stateScript)
        return try decodeState(descriptor, sourceURL: currentSourceURL)
    }

    public func setVolume(_ percent: Int) throws -> MusicState {
        guard (0...100).contains(percent) else { throw ReceiverBridgeError.invalidVolume }
        let descriptor = try execute("""
        tell application "Music" to set sound volume to \(percent)
        delay 0.08
        \(Self.stateScript)
        """)
        let value = try decodeState(descriptor, sourceURL: currentSourceURL)
        guard value.volume == percent else {
            throw ReceiverBridgeError.automation("Music.app did not verify the requested \(percent)% volume.")
        }
        return value
    }

    public func play(url: URL, volume: Int) throws -> MusicState {
        guard (0...100).contains(volume) else { throw ReceiverBridgeError.invalidVolume }
        let literal = Self.appleScriptLiteral(url.absoluteString)
        let descriptor = try execute("""
        tell application "Music"
            set sound volume to \(volume)
            open location \(literal)
            delay 0.75
            play
        end tell
        delay 0.25
        \(Self.stateScript)
        """)
        let value = try decodeState(descriptor, sourceURL: url.absoluteString)
        currentSourceURL = url.absoluteString
        return value
    }

    public func pause() throws -> MusicState {
        let descriptor = try execute("""
        tell application "Music" to pause
        delay 0.12
        \(Self.stateScript)
        """)
        let value = try decodeState(descriptor, sourceURL: currentSourceURL)
        guard !value.isPlaying else {
            throw ReceiverBridgeError.automation("Music.app could not be confirmed paused.")
        }
        return value
    }

    public func resume(volume: Int) throws -> MusicState {
        guard (0...100).contains(volume) else { throw ReceiverBridgeError.invalidVolume }
        let descriptor = try execute("""
        tell application "Music"
            set sound volume to \(volume)
            play
        end tell
        delay 0.25
        \(Self.stateScript)
        """)
        return try decodeState(descriptor, sourceURL: currentSourceURL)
    }

    public func next(volume: Int) throws -> MusicState {
        guard (0...100).contains(volume) else { throw ReceiverBridgeError.invalidVolume }
        let descriptor = try execute("""
        tell application "Music"
            set sound volume to \(volume)
            next track
            play
        end tell
        delay 0.35
        \(Self.stateScript)
        """)
        return try decodeState(descriptor, sourceURL: currentSourceURL)
    }

    public func stop() throws -> MusicState {
        let descriptor = try execute("""
        tell application "Music" to stop
        delay 0.12
        \(Self.stateScript)
        """)
        return try decodeState(descriptor, sourceURL: currentSourceURL)
    }

    public func pauseForAnnouncement() throws -> [String: Any] {
        let before = try state()
        if !before.isPlaying {
            var result = before.dictionary
            result["state"] = before.dictionary
            result["wasPlaying"] = false
            result["position"] = before.position
            result["persistentId"] = before.persistentId
            result["sourceUrl"] = before.sourceURL
            result["uri"] = before.sourceURL
            result["volumeLowered"] = false
            result["previousVolume"] = before.volume
            return result
        }
        _ = try setVolume(0)
        let after = try pause()
        var result = after.dictionary
        result["state"] = after.dictionary
        result["wasPlaying"] = before.isPlaying
        result["position"] = before.position
        result["persistentId"] = before.persistentId
        result["sourceUrl"] = before.sourceURL
        result["uri"] = before.sourceURL
        result["volumeLowered"] = true
        result["previousVolume"] = before.volume
        return result
    }

    public func resumeAfterAnnouncement(wasPlaying: Bool, volume: Int, persistentId: String) throws -> MusicState {
        if !wasPlaying { return try setVolume(volume) }
        let current = try state()
        if !persistentId.isEmpty && current.persistentId != persistentId {
            failSafePause()
            throw ReceiverBridgeError.automation("Music.app changed tracks during the announcement, so Poolside Pulse kept it silent instead of resuming the wrong track.")
        }
        return try resume(volume: volume)
    }

    public func failSafePause() {
        _ = try? silenceAndPause()
    }

    public func silenceAndPause() throws -> MusicState {
        let descriptor = try execute("""
        tell application "Music"
            set sound volume to 0
            pause
        end tell
        delay 0.12
        \(Self.stateScript)
        """)
        let value = try decodeState(descriptor, sourceURL: currentSourceURL)
        guard !value.isPlaying && value.volume == 0 else {
            throw ReceiverBridgeError.automation("Music.app could not be confirmed silent and paused.")
        }
        return value
    }

    private func execute(_ source: String) throws -> NSAppleEventDescriptor {
        guard let script = NSAppleScript(source: source) else {
            throw ReceiverBridgeError.automation("The Music.app automation script could not be created.")
        }
        var details: NSDictionary?
        let result = script.executeAndReturnError(&details)
        if let details {
            let message = (details[NSAppleScript.errorMessage] as? String)
                ?? (details["NSAppleScriptErrorMessage"] as? String)
                ?? "macOS denied or failed Music.app automation."
            throw ReceiverBridgeError.automation(message)
        }
        return result
    }

    private func decodeState(_ descriptor: NSAppleEventDescriptor, sourceURL: String) throws -> MusicState {
        guard descriptor.numberOfItems >= 6 else {
            throw ReceiverBridgeError.automation("Music.app returned an incomplete playback status.")
        }
        return MusicState(
            volume: Int(descriptor.atIndex(1)?.int32Value ?? 0),
            playerState: descriptor.atIndex(2)?.stringValue ?? "stopped",
            position: descriptor.atIndex(3)?.doubleValue ?? 0,
            name: descriptor.atIndex(4)?.stringValue ?? "",
            artists: descriptor.atIndex(5)?.stringValue ?? "",
            persistentId: descriptor.atIndex(6)?.stringValue ?? "",
            sourceURL: sourceURL
        )
    }

    private static func appleScriptLiteral(_ value: String) -> String {
        let safe = value
            .replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "\"", with: "\\\"")
            .replacingOccurrences(of: "\r", with: "")
            .replacingOccurrences(of: "\n", with: "")
        return "\"\(safe)\""
    }

    private static let stateScript = """
    tell application "Music"
        set ppVolume to sound volume
        set ppState to (player state as text)
        set ppPosition to 0.0
        set ppName to ""
        set ppArtist to ""
        set ppPersistentID to ""
        try
            set ppPosition to player position
        end try
        try
            set ppTrack to current track
            set ppName to name of ppTrack
            set ppArtist to artist of ppTrack
            set ppPersistentID to persistent ID of ppTrack
        end try
        return {ppVolume, ppState, ppPosition, ppName, ppArtist, ppPersistentID}
    end tell
    """
}
