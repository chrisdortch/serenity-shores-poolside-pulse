import Foundation
import ReceiverCore

@main
struct BridgeRequestSelfTests {
    private static var checks = 0

    private static func expect(_ condition: @autoclosure () -> Bool, _ message: String) {
        checks += 1
        guard condition() else {
            FileHandle.standardError.write(Data("FAIL: \(message)\n".utf8))
            exit(1)
        }
    }

    private static func request(
        version: Any = 1,
        method: String = "setVolume",
        params: [String: Any] = ["percent": 30]
    ) throws -> BridgeRequest {
        try BridgeRequest(body: ["v": version, "method": method, "params": params])
    }

    static func main() throws {
        for percent in [0, 30, 100] {
            let parsed = try request(params: ["percent": percent])
            let actual = try parsed.volume("percent")
            expect(actual == percent, "accept \(percent)%")
        }

        do {
            _ = try request(params: ["percent": 30.5]).volume("percent")
            expect(false, "reject fractional volume")
        } catch { expect(error as? ReceiverBridgeError == .invalidVolume, "fractional volume error") }

        for invalid in [-1, 101, true] as [Any] {
            do {
                _ = try request(params: ["percent": invalid]).volume("percent")
                expect(false, "reject invalid volume \(invalid)")
            } catch { expect(error as? ReceiverBridgeError == .invalidVolume, "invalid volume error") }
        }

        for invalidVersion in [true, 1.5, 2] as [Any] {
            do {
                _ = try request(version: invalidVersion)
                expect(false, "reject bridge version \(invalidVersion)")
            } catch { expect(error as? ReceiverBridgeError == .unsupportedVersion, "invalid version error") }
        }

        let appleURL = try request(method: "play", params: ["url": "https://music.apple.com/us/album/example/123?i=456"]).appleMusicURL()
        expect(appleURL.host == "music.apple.com", "accept exact Apple Music host")

        let previous = try request(method: "previous", params: ["volumePercent": 30])
        expect(try previous.volume("volumePercent") == 30, "accept previous-track request")

        do {
            _ = try request(method: "play", params: ["url": "https://evil.example/?next=https://music.apple.com/us/album/1"]).appleMusicURL()
            expect(false, "reject lookalike host")
        } catch { expect(error as? ReceiverBridgeError == .invalidAppleMusicURL, "lookalike host error") }

        do {
            _ = try request(method: "deleteEverything")
            expect(false, "reject unknown method")
        } catch {
            if let bridgeError = error as? ReceiverBridgeError,
               case .unsupportedMethod = bridgeError {
                expect(true, "unknown method error")
            } else {
                expect(false, "unknown method error type")
            }
        }

        print("ReceiverCore self-tests passed: \(checks) checks")
    }
}
