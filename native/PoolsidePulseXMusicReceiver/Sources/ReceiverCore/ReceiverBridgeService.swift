import Foundation

@MainActor
public final class ReceiverBridgeService {
    private let music: MusicAutomation

    public init(music: MusicAutomation = .shared) {
        self.music = music
    }

    public func handle(_ body: Any) -> [String: Any] {
        do {
            let request = try BridgeRequest(body: body)
            return ["ok": true, "result": try perform(request)]
        } catch {
            return ["ok": false, "error": error.localizedDescription]
        }
    }

    private func perform(_ request: BridgeRequest) throws -> [String: Any] {
        switch request.method {
        case "capabilities", "activate":
            return try music.capabilities()
        case "state":
            return try music.state().dictionary
        case "setVolume":
            return try music.setVolume(request.volume("percent")).dictionary
        case "play":
            return try music.play(
                url: request.appleMusicURL(),
                volume: request.volume("volumePercent", default: 30)
            ).dictionary
        case "pause":
            return try music.pause().dictionary
        case "pauseImmediate":
            return try music.silenceAndPause().dictionary
        case "resume":
            return try music.resume(volume: request.volume("volumePercent", default: 30)).dictionary
        case "previous":
            return try music.previous(volume: request.volume("volumePercent", default: 30)).dictionary
        case "next":
            return try music.next(volume: request.volume("volumePercent", default: 30)).dictionary
        case "stop":
            return try music.stop().dictionary
        case "failSafePause":
            return try music.silenceAndPause().dictionary
        case "pauseForAnnouncement":
            return try music.pauseForAnnouncement()
        case "resumeAfterAnnouncement":
            let snapshot = request.params["snapshot"] as? [String: Any]
            let wasPlaying = (snapshot?["wasPlaying"] as? NSNumber)?.boolValue ?? false
            return try music.resumeAfterAnnouncement(
                wasPlaying: wasPlaying,
                volume: request.volume("volumePercent", default: 30),
                persistentId: String(snapshot?["persistentId"] as? String ?? "")
            ).dictionary
        default:
            throw ReceiverBridgeError.unsupportedMethod(request.method)
        }
    }
}
