import AppKit
import ReceiverCore
import SwiftUI

@MainActor
final class ReceiverAppDelegate: NSObject, NSApplicationDelegate {
    private var keepAwakeActivity: NSObjectProtocol?

    func applicationDidFinishLaunching(_ notification: Notification) {
        keepAwakeActivity = ProcessInfo.processInfo.beginActivity(
            options: [.userInitiated, .idleSystemSleepDisabled, .automaticTerminationDisabled],
            reason: "Poolside Pulse X receiver must remain awake for scheduled playback and safety announcements."
        )
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        true
    }

    func applicationWillTerminate(_ notification: Notification) {
        MusicAutomation.shared.failSafePause()
        if let keepAwakeActivity {
            ProcessInfo.processInfo.endActivity(keepAwakeActivity)
            self.keepAwakeActivity = nil
        }
    }
}

@main
struct PoolsidePulseXMusicReceiverApp: App {
    @NSApplicationDelegateAdaptor(ReceiverAppDelegate.self) private var appDelegate

    var body: some Scene {
        WindowGroup("Poolside Pulse X Music Receiver") {
            VStack(spacing: 0) {
                HStack(spacing: 10) {
                    Image(systemName: "music.note.house.fill")
                        .foregroundStyle(.blue)
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Apple Music exact-volume receiver")
                            .font(.headline)
                        Text("Choose the pool speaker in macOS Control Center. Keep Music.app and this window on the same output.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    Spacer()
                    Text("Music.app 0–100")
                        .font(.caption.bold())
                        .padding(.horizontal, 10)
                        .padding(.vertical, 5)
                        .background(.blue.opacity(0.12), in: Capsule())
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 9)
                .background(.regularMaterial)

                Divider()
                ReceiverWebView()
            }
            .frame(minWidth: 980, minHeight: 720)
        }
        .windowStyle(.titleBar)
        .defaultSize(width: 1180, height: 820)
    }
}
