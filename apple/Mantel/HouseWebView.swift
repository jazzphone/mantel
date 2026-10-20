import MantelKit
import SafariServices
import SwiftUI
import UIKit
import WebKit

/// HK's own pages in a web view: the screens and Mantel Settings, exactly as on the wall tablets (§1).
///
/// * Its own, non-persistent website data per house: the page's Mantel session (handed over by a one-time code,
///   `/app/web-session`) lives only as long as the app; the page never sees the app's tokens.
/// * The `ios` host: `window.mantelNative` (platform, haptics, share) over a `WKScriptMessageHandler`.
/// * Only the house's own addresses load inside; any other link opens in Safari.
/// * A page that falls back to `/login` (its session ended) is caught: the app hands it a new session.
struct HouseWebView: UIViewRepresentable {
    let start: URL
    let house: House
    let onSessionEnded: (String) -> Void

    private static var stores: [String: WKWebsiteDataStore] = [:]

    /// Clear Cache: the next web view for this house starts with empty website data (and a new web session).
    static func forgetData(for house: House) {
        stores[house.id]?.removeData(ofTypes: WKWebsiteDataStore.allWebsiteDataTypes(), modifiedSince: .distantPast) {}
        stores[house.id] = nil
    }

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        let store = HouseWebView.stores[house.id] ?? WKWebsiteDataStore.nonPersistent()
        HouseWebView.stores[house.id] = store
        config.websiteDataStore = store
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        let bridge = """
        window.mantelNative = Object.freeze({
          platform: 'ios',
          haptic: (kind) => window.webkit.messageHandlers.mantel.postMessage({ type: 'haptic', kind: String(kind || 'light') }),
          share: (url, title) => window.webkit.messageHandlers.mantel.postMessage({ type: 'share', url: String(url), title: String(title || '') }),
        });
        """
        config.userContentController.addUserScript(WKUserScript(source: bridge, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        config.userContentController.add(context.coordinator, name: "mantel")
        let view = WKWebView(frame: .zero, configuration: config)
        view.navigationDelegate = context.coordinator
        view.uiDelegate = context.coordinator
        view.allowsBackForwardNavigationGestures = false
        view.scrollView.contentInsetAdjustmentBehavior = .never     // the page pads itself by env(safe-area-inset-*)
        view.isOpaque = false
        view.backgroundColor = .black
        view.customUserAgent = nil
        #if DEBUG
        view.isInspectable = true
        #endif
        view.load(URLRequest(url: start))
        return view
    }

    func updateUIView(_ view: WKWebView, context: Context) {}

    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
        let parent: HouseWebView
        init(_ parent: HouseWebView) { self.parent = parent }

        private func isHouse(_ url: URL) -> Bool {
            [parent.house.local, parent.house.remote, parent.start].compactMap { $0 }.contains {
                $0.host == url.host && $0.scheme == url.scheme && $0.port == url.port
            }
        }

        func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction) async -> WKNavigationActionPolicy {
            guard let url = action.request.url else { return .cancel }
            if url.scheme == "about" || url.scheme == "blob" || url.scheme == "data" { return .allow }
            if !isHouse(url) {
                if action.navigationType == .linkActivated || action.targetFrame?.isMainFrame == true {
                    await MainActor.run { UIApplication.shared.open(url) }
                    return .cancel
                }
                return .allow          // a frame's media (the Music Assistant page, maps) stays the page's business
            }
            if action.targetFrame?.isMainFrame == true, url.path == "/login" {
                let next = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first { $0.name == "next" }?.value
                await MainActor.run { parent.onSessionEnded(next ?? "/home") }
                return .cancel
            }
            return .allow
        }

        func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                     for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
            if let url = action.request.url { UIApplication.shared.open(url) }
            return nil
        }

        func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
            guard let body = message.body as? [String: Any], let type = body["type"] as? String else { return }
            switch type {
            case "haptic":
                switch body["kind"] as? String {
                case "success": UINotificationFeedbackGenerator().notificationOccurred(.success)
                case "warning": UINotificationFeedbackGenerator().notificationOccurred(.warning)
                case "heavy": UIImpactFeedbackGenerator(style: .heavy).impactOccurred()
                default: UIImpactFeedbackGenerator(style: .light).impactOccurred()
                }
            case "share":
                guard let s = body["url"] as? String, let url = URL(string: s) else { return }
                let vc = UIActivityViewController(activityItems: [url], applicationActivities: nil)
                message.webView?.window?.rootViewController?.present(vc, animated: true)
            default: break
            }
        }
    }
}
