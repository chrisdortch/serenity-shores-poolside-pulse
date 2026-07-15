import AppKit
import ReceiverCore
import SwiftUI
import WebKit

private let receiverURL = URL(string: "https://poolside-pulse-x.vercel.app/#receiver")!
private let allowedHost = "poolside-pulse-x.vercel.app"

struct ReceiverWebView: NSViewRepresentable {
    @MainActor
    final class Coordinator: NSObject, WKNavigationDelegate, WKScriptMessageHandlerWithReply {
        private let bridge = ReceiverBridgeService()
        private var acceptedMainFrameLoad = false

        nonisolated func userContentController(
            _ userContentController: WKUserContentController,
            didReceive message: WKScriptMessage,
            replyHandler: @escaping (Any?, String?) -> Void
        ) {
            let origin = message.frameInfo.securityOrigin
            let frameURL = message.frameInfo.request.url
            let allowed = message.frameInfo.isMainFrame
                && origin.protocol.lowercased() == "https"
                && origin.host.lowercased() == allowedHost
                && (origin.port == 0 || origin.port == 443)
                && frameURL?.path == "/"
                && frameURL?.fragment == "receiver"
            let body = message.body
            Task { @MainActor [weak self] in
                guard allowed, let self else {
                    let response: [String: Any] = ["ok": false, "error": "Native music control is restricted to the Poolside Pulse X receiver page."]
                    replyHandler(response, nil)
                    return
                }
                replyHandler(self.bridge.handle(body), nil)
            }
        }

        nonisolated func webView(
            _ webView: WKWebView,
            decidePolicyFor navigationAction: WKNavigationAction,
            decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
        ) {
            guard navigationAction.targetFrame?.isMainFrame != false else {
                decisionHandler(.cancel)
                return
            }
            guard let url = navigationAction.request.url,
                  let scheme = url.scheme?.lowercased() else {
                decisionHandler(.cancel)
                return
            }
            let exactReceiverPage = scheme == "https"
                && url.host?.lowercased() == allowedHost
                && (url.port == nil || url.port == 443)
                && (url.path.isEmpty || url.path == "/")
                && url.fragment == "receiver"
            if scheme == "about" {
                decisionHandler(.allow)
                return
            }
            if exactReceiverPage {
                Task { @MainActor [weak self] in
                    guard let self else {
                        decisionHandler(.cancel)
                        return
                    }
                    if self.acceptedMainFrameLoad {
                        MusicAutomation.shared.failSafePause()
                    }
                    self.acceptedMainFrameLoad = true
                    decisionHandler(.allow)
                }
                return
            }
            if scheme == "https" && navigationAction.navigationType == .linkActivated {
                Task { @MainActor in NSWorkspace.shared.open(url) }
            }
            decisionHandler(.cancel)
        }

        nonisolated func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
            Task { @MainActor in MusicAutomation.shared.failSafePause() }
        }

        nonisolated func webView(
            _ webView: WKWebView,
            didFail navigation: WKNavigation!,
            withError error: Error
        ) {
            Task { @MainActor in MusicAutomation.shared.failSafePause() }
        }

        nonisolated func webView(
            _ webView: WKWebView,
            didFailProvisionalNavigation navigation: WKNavigation!,
            withError error: Error
        ) {
            Task { @MainActor in MusicAutomation.shared.failSafePause() }
        }
    }

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeNSView(context: Context) -> WKWebView {
        let content = WKUserContentController()
        let marker = """
        Object.defineProperty(window, '__POOL_SIDE_NATIVE_MUSIC__', {
          configurable: false,
          enumerable: false,
          writable: false,
          value: Object.freeze({
            version: 1,
            platform: 'macos-music-app',
            deviceName: 'Poolside Pulse X Music Receiver'
          })
        });
        """
        content.addUserScript(WKUserScript(
            source: marker,
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true
        ))
        content.addScriptMessageHandler(
            context.coordinator,
            contentWorld: .page,
            name: "poolsideMusic"
        )

        let configuration = WKWebViewConfiguration()
        configuration.userContentController = content
        configuration.websiteDataStore = .default()
        configuration.applicationNameForUserAgent = "PoolsidePulseNativeMusicReceiver/1.0"
        configuration.preferences.javaScriptCanOpenWindowsAutomatically = false
        configuration.mediaTypesRequiringUserActionForPlayback = []

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = context.coordinator
        webView.allowsMagnification = true
        webView.load(URLRequest(
            url: receiverURL,
            cachePolicy: .reloadIgnoringLocalAndRemoteCacheData,
            timeoutInterval: 30
        ))
        return webView
    }

    func updateNSView(_ webView: WKWebView, context: Context) {}

    static func dismantleNSView(_ webView: WKWebView, coordinator: Coordinator) {
        MusicAutomation.shared.failSafePause()
        webView.stopLoading()
        webView.configuration.userContentController.removeScriptMessageHandler(forName: "poolsideMusic")
        webView.navigationDelegate = nil
    }
}
