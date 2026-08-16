import AppKit
import SwiftUI
import WebKit

private let receiverURL = URL(string: "https://serenity-shores-poolside.chrisdortch.chatgpt.site/receiver")!
private let allowedHost = "serenity-shores-poolside.chrisdortch.chatgpt.site"
private let allowedMainPaths: Set<String> = ["/receiver", "/control"]

struct ReceiverWebView: NSViewRepresentable {
    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate, NSWindowDelegate {
        private weak var mainWebView: WKWebView?
        private weak var authWebView: WKWebView?
        private var authWindowController: NSWindowController?

        func attach(mainWebView: WKWebView) {
            self.mainWebView = mainWebView
        }

        func webView(
            _ webView: WKWebView,
            decidePolicyFor navigationAction: WKNavigationAction,
            decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
        ) {
            guard let url = navigationAction.request.url else {
                decisionHandler(.cancel)
                return
            }

            if webView === authWebView {
                decideAuthNavigation(url, action: navigationAction, decisionHandler: decisionHandler)
            } else if webView === mainWebView {
                decideMainNavigation(webView, url: url, action: navigationAction, decisionHandler: decisionHandler)
            } else {
                decisionHandler(.cancel)
            }
        }

        func webView(
            _ webView: WKWebView,
            createWebViewWith configuration: WKWebViewConfiguration,
            for navigationAction: WKNavigationAction,
            windowFeatures: WKWindowFeatures
        ) -> WKWebView? {
            guard webView === mainWebView,
                  navigationAction.targetFrame == nil,
                  isTrustedMainFrame(navigationAction.sourceFrame),
                  let url = navigationAction.request.url
            else { return nil }

            guard isBlankURL(url) || isAppleAuthenticationURL(url) else {
                if navigationAction.navigationType == .linkActivated, isOrdinaryExternalURL(url) {
                    NSWorkspace.shared.open(url)
                }
                return nil
            }

            closeAuthWindow()

            configuration.preferences.javaScriptCanOpenWindowsAutomatically = true
            let popup = WKWebView(frame: .zero, configuration: configuration)
            popup.navigationDelegate = self
            popup.uiDelegate = self
            popup.allowsMagnification = true

            let window = NSWindow(
                contentRect: NSRect(x: 0, y: 0, width: 720, height: 760),
                styleMask: [.titled, .closable, .miniaturizable, .resizable],
                backing: .buffered,
                defer: false
            )
            window.title = "Sign in to Apple Music"
            window.contentView = popup
            window.delegate = self
            window.isReleasedWhenClosed = false
            window.center()

            let controller = NSWindowController(window: window)
            authWebView = popup
            authWindowController = controller
            controller.showWindow(nil)
            NSApp.activate(ignoringOtherApps: true)
            return popup
        }

        func webViewDidClose(_ webView: WKWebView) {
            guard webView === authWebView else { return }
            closeAuthWindow()
        }

        func windowWillClose(_ notification: Notification) {
            guard let window = notification.object as? NSWindow,
                  window === authWindowController?.window
            else { return }
            releaseAuthWindow()
        }

        func tearDown() {
            closeAuthWindow()
            mainWebView = nil
        }

        private func decideMainNavigation(
            _ webView: WKWebView,
            url: URL,
            action: WKNavigationAction,
            decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
        ) {
            if action.targetFrame?.isMainFrame == false {
                let embeddedPageAllowed = isBlankURL(url)
                    || isAllowedOriginURL(url)
                    || isAppleAuthenticationURL(url)
                decisionHandler(embeddedPageAllowed ? .allow : .cancel)
                return
            }

            if action.targetFrame == nil {
                if isAllowedMainURL(url) {
                    webView.load(action.request)
                    decisionHandler(.cancel)
                    return
                }
                if isBlankURL(url) || isAppleAuthenticationURL(url) {
                    decisionHandler(.allow)
                    return
                }
                if action.navigationType == .linkActivated, isOrdinaryExternalURL(url) {
                    NSWorkspace.shared.open(url)
                }
                decisionHandler(.cancel)
                return
            }

            guard action.targetFrame?.isMainFrame == true else {
                decisionHandler(.cancel)
                return
            }

            if isAllowedMainURL(url) || isBlankURL(url) {
                decisionHandler(.allow)
                return
            }

            if action.navigationType == .linkActivated, isOrdinaryExternalURL(url) {
                NSWorkspace.shared.open(url)
            }
            decisionHandler(.cancel)
        }

        private func decideAuthNavigation(
            _ url: URL,
            action: WKNavigationAction,
            decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
        ) {
            if isBlankURL(url) || isAppleAuthenticationURL(url) || isAllowedMainURL(url) {
                decisionHandler(.allow)
                return
            }
            if action.navigationType == .linkActivated, isOrdinaryExternalURL(url) {
                NSWorkspace.shared.open(url)
            }
            decisionHandler(.cancel)
        }

        private func isTrustedMainFrame(_ frame: WKFrameInfo) -> Bool {
            frame.isMainFrame && frame.request.url.map(isAllowedMainURL) == true
        }

        private func isAllowedMainURL(_ url: URL) -> Bool {
            isAllowedOriginURL(url) && allowedMainPaths.contains(url.path)
        }

        private func isAllowedOriginURL(_ url: URL) -> Bool {
            url.scheme?.lowercased() == "https"
                && url.host?.lowercased() == allowedHost
                && (url.port == nil || url.port == 443)
        }

        private func isAppleAuthenticationURL(_ url: URL) -> Bool {
            guard url.scheme?.lowercased() == "https",
                  let host = url.host?.lowercased()
            else { return false }
            return host == "apple.com" || host.hasSuffix(".apple.com")
        }

        private func isBlankURL(_ url: URL) -> Bool {
            url.scheme?.lowercased() == "about" && url.absoluteString.lowercased() == "about:blank"
        }

        private func isOrdinaryExternalURL(_ url: URL) -> Bool {
            guard let scheme = url.scheme?.lowercased() else { return false }
            return scheme == "https" || scheme == "http" || scheme == "mailto"
        }

        private func closeAuthWindow() {
            guard let controller = authWindowController else { return }
            controller.window?.delegate = nil
            releaseAuthWindow()
            controller.close()
        }

        private func releaseAuthWindow() {
            authWebView?.stopLoading()
            authWebView?.navigationDelegate = nil
            authWebView?.uiDelegate = nil
            authWebView = nil
            authWindowController = nil
        }
    }

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeNSView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        configuration.applicationNameForUserAgent = "PoolsidePulseReceiver/2.0"
        configuration.preferences.javaScriptCanOpenWindowsAutomatically = true
        configuration.mediaTypesRequiringUserActionForPlayback = []

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = context.coordinator
        webView.uiDelegate = context.coordinator
        webView.allowsMagnification = true
        context.coordinator.attach(mainWebView: webView)
        webView.load(URLRequest(
            url: receiverURL,
            cachePolicy: .reloadIgnoringLocalAndRemoteCacheData,
            timeoutInterval: 30
        ))
        return webView
    }

    func updateNSView(_ webView: WKWebView, context: Context) {}

    static func dismantleNSView(_ webView: WKWebView, coordinator: Coordinator) {
        coordinator.tearDown()
        webView.stopLoading()
        webView.navigationDelegate = nil
        webView.uiDelegate = nil
    }
}
