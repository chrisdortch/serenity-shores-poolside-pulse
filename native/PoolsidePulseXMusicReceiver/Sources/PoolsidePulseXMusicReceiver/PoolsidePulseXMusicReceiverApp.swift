import AppKit
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
            ReceiverWebView()
            .frame(minWidth: 980, minHeight: 720)
        }
        .windowStyle(.titleBar)
        .defaultSize(width: 1180, height: 820)
    }
}
