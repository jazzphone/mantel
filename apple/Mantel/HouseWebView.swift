import MantelKit
import SafariServices
import SwiftUI
import UIKit
import WebKit

/// HK's own pages in a web view: the screens and Mantel Settings, exactly as on the wall tablets (§1).
///
/// * Its own, non-persistent website data per house: the page's Mantel session (handed over by a one-time code,
///   `/app/web-session`) lives only as long as the app; the page never sees the app's tokens.
/// * The `ios` host: `window.mantelNative` (platform, haptics, share, the app's menu, its own music player, the status
///   bar's ink) over a `WKScriptMessageHandler`; web/shim/mantel-native.js is the page's side.
/// * Native, not a website (docs/phase10/NATIVE-FEEL.md): no long-press callouts, text selection, link previews or
///   zoom on the screens (fields still select); the edge swipe goes back a page; nothing is shown until the page has
///   drawn (`onEvent(.ready)`), and a still of the last page is kept for the next open.
/// * Only the house's own addresses load inside; any other link opens in Safari.
/// * A page that falls back to `/login` (its session ended) is caught: the app hands it a new session.
struct HouseWebView: UIViewRepresentable {
    let start: URL
    let house: House
    let onSessionEnded: (String) -> Void
    var onEvent: (WebEvent) -> Void = { _ in }

    /// What the page tells the app.
    enum WebEvent: Equatable {
        case ready                 // the first page has drawn
        case menu(String)          // a row of the app's in the page's menu ("app": its settings)
        case player                // the music's Now Playing: the app's own player
        case tone(light: Bool)     // the page's ground: dark status-bar ink on a light page
    }

    /// The web view on screen, for its still (`saveStill`).
    @MainActor private static weak var live: WKWebView?

    private static var stores: [String: WKWebsiteDataStore] = [:]

    /// Clear Cache: the next web view for this house starts with empty website data (and a new web session).
    static func forgetData(for house: House) {
        stores[house.id]?.removeData(ofTypes: WKWebsiteDataStore.allWebsiteDataTypes(), modifiedSince: .distantPast) {}
        stores[house.id] = nil
        forgetStill()
    }

    // THE LAST PAGE'S STILL: drawn under the web view until it is ready, so an open never starts on a blank screen.
    // In the app's own caches (it can show the house), never the App Group; gone with Clear Cache and Sign Out.
    static var stillFile: URL? {
        FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first?.appendingPathComponent("last-page.jpg")
    }
    @MainActor static func saveStill() {
        guard let view = live, view.bounds.width > 0, let file = stillFile else { return }
        view.takeSnapshot(with: nil) { image, _ in
            guard let data = image?.jpegData(compressionQuality: 0.7) else { return }
            try? data.write(to: file, options: [.atomic, .completeFileProtection])
        }
    }
    static func forgetStill() { if let f = stillFile { try? FileManager.default.removeItem(at: f) } }

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        let phone = UIDevice.current.userInterfaceIdiom == .phone      // the iPad keeps the Music page's own player
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
          menu: (id) => window.webkit.messageHandlers.mantel.postMessage({ type: 'menu', id: String(id || '') }),
          tone: (light) => window.webkit.messageHandlers.mantel.postMessage({ type: 'tone', light: !!light }),
        \(phone ? "  player: () => window.webkit.messageHandlers.mantel.postMessage({ type: 'player' })," : "")
        });
        """
        // NOT A WEBSITE: no callout or selection on the screens (fields keep theirs), no double-tap or pinch zoom
        let native = """
        (function () {
          var st = document.createElement('style');
          st.textContent = 'html{-webkit-touch-callout:none;-webkit-user-select:none;user-select:none;touch-action:manipulation;-webkit-text-size-adjust:100%}' +
            'input,textarea,select,[contenteditable],[contenteditable] *{-webkit-touch-callout:default;-webkit-user-select:text;user-select:text}';
          document.documentElement.appendChild(st);
          function vp() {
            var m = document.querySelector('meta[name=viewport]');
            if (m && !/maximum-scale/.test(m.content)) m.content += ', maximum-scale=1';
          }
          if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', vp); else vp();
        })();
        """
        config.userContentController.addUserScript(WKUserScript(source: native, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        config.userContentController.addUserScript(WKUserScript(source: bridge, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        #if DEBUG
        // -MantelDebugJS '<script>': run on every page of a Debug build; it may report with mantelDebug(...) to the
        // device log ("[web]" lines: xcrun simctl launch --console-pty ...)
        if let js = UserDefaults.standard.string(forKey: "MantelDebugJS") {
            let debug = "window.mantelDebug = (...a) => window.webkit.messageHandlers.mantel.postMessage({ type: 'log', text: a.map(String).join(' ') });\n" + js
            config.userContentController.addUserScript(WKUserScript(source: debug, injectionTime: .atDocumentEnd, forMainFrameOnly: true))
        }
        #endif
        config.userContentController.add(context.coordinator, name: "mantel")
        let view = WKWebView(frame: .zero, configuration: config)
        view.navigationDelegate = context.coordinator
        view.uiDelegate = context.coordinator
        // the edge swipe: back a page (HK's pages are one document; WebKit swipes its same-document history too)
        view.allowsBackForwardNavigationGestures = true
        view.allowsLinkPreview = false
        view.scrollView.contentInsetAdjustmentBehavior = .never     // the page pads itself by env(safe-area-inset-*)
        view.isOpaque = false
        view.backgroundColor = .black
        view.customUserAgent = nil
        #if DEBUG
        view.isInspectable = true
        #endif
        view.load(URLRequest(url: start))
        HouseWebView.live = view
        return view
    }

    func updateUIView(_ view: WKWebView, context: Context) {}

    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
        let parent: HouseWebView
        private var drawn = false
        init(_ parent: HouseWebView) { self.parent = parent }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            webView.scrollView.pinchGestureRecognizer?.isEnabled = false
            guard !drawn else { return }
            drawn = true
            // (a frame for the page's first paint after its load)
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { self.parent.onEvent(.ready) }
        }

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
            // never back to the one-time handover (its code is spent): the first page is as far back as it goes
            if action.navigationType == .backForward, url.path.hasPrefix("/app/") { return .cancel }
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
                case "selection": UISelectionFeedbackGenerator().selectionChanged()
                default: UIImpactFeedbackGenerator(style: .light).impactOccurred()
                }
            case "menu": parent.onEvent(.menu(body["id"] as? String ?? ""))
            case "player":
                UIImpactFeedbackGenerator(style: .light).impactOccurred()
                parent.onEvent(.player)
            case "tone": parent.onEvent(.tone(light: body["light"] as? Bool ?? false))
            case "share":
                guard let s = body["url"] as? String, let url = URL(string: s) else { return }
                let vc = UIActivityViewController(activityItems: [url], applicationActivities: nil)
                message.webView?.window?.rootViewController?.present(vc, animated: true)
            #if DEBUG
            case "log": print("[web]", body["text"] as? String ?? "")
            #endif
            default: break
            }
        }
    }
}
