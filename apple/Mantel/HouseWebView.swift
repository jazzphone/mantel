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
/// * One web view for any window: an iPhone, an iPad in any Split View or Stage Manager size, the iPhone Duo folded
///   or open. It is never rebuilt for a new size (the page lays itself out by its width; its scroll and state stay),
///   and nothing here asks which device it is on: the app's own player is decided by the page's width (`playerScript`).
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
        case failed(String)        // the page did not come (no answer, an HTTP error): the reason, in one plain line
        case lost                  // the page's process ended (memory): it is loading again, not drawn
    }

    /// One plain line for why a page or a request did not come.
    static func reason(_ error: Error) -> String {
        guard let e = error as? URLError else { return error.localizedDescription }
        switch e.code {
        case .notConnectedToInternet, .dataNotAllowed, .internationalRoamingOff: return "This device is offline."
        case .cannotFindHost, .dnsLookupFailed: return "Its address can’t be found from this network."
        case .cannotConnectToHost: return "Nothing answered at its address."
        case .timedOut: return "It took too long to answer."
        case .networkConnectionLost: return "The connection dropped."
        case .secureConnectionFailed, .serverCertificateUntrusted, .serverCertificateHasBadDate,
             .serverCertificateNotYetValid, .serverCertificateHasUnknownRoot, .clientCertificateRejected:
            return "Its secure connection couldn’t be checked."
        default: return e.localizedDescription
        }
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
          player: () => window.webkit.messageHandlers.mantel.postMessage({ type: 'player' }),
          notifications: \(PushRegistrar.isOn ? "true" : "false"),
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
        config.userContentController.addUserScript(WKUserScript(source: Self.playerScript, injectionTime: .atDocumentStart, forMainFrameOnly: true))
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
        // the app's ground shows through wherever the page has not drawn yet (a fold, a turn, a resized window)
        view.backgroundColor = .clear
        view.scrollView.backgroundColor = .clear
        view.customUserAgent = nil
        #if DEBUG
        view.isInspectable = true
        #endif
        view.load(URLRequest(url: start))
        HouseWebView.live = view
        return view
    }

    func updateUIView(_ view: WKWebView, context: Context) {}

    /// THE APP'S PLAYER OR THE PAGE'S, BY THE PAGE'S WIDTH, AT THE TAP. The page asks for a host's player through
    /// `window.hkHostPlayer` (web/shim/mantel-native.js sets it once; hk-music.js and hk-media.js read it on a tap).
    /// It is only there while the page is narrower than the Music page's two columns (hk-music.js COLS2): an iPhone,
    /// the Duo folded or open in portrait, an iPad in a narrow Split View or Stage Manager window. Wider, the player
    /// is the page's own column (NATIVE-FEEL.md item 7: the iPad keeps the two-column Music page) and the playing bar
    /// opens the Music page. Read at the tap, so a fold, a turn or a resized window needs nothing from the app.
    static let playerScript = """
    (function () {
      var own;
      Object.defineProperty(window, 'hkHostPlayer', { configurable: true,
        get: function () { return window.innerWidth < \(twoPlayerColumns) ? own : undefined; },
        set: function (f) { own = f; } });
    })();
    """
    /// The Music page's two-column width, in points (hk-music.js COLS2).
    static let twoPlayerColumns = 760

    /// The app's menu: the Intercom sheet, on the page that is open (`#intercom` on its address; web/hk/cards/hk-intercom.js
    /// opens the sheet when the address changes to it, and clears it again when the sheet closes).
    @MainActor static func openIntercom() {
        live?.evaluateJavaScript("if (location.hash !== '#intercom') location.hash = '#intercom';")
    }

    /// ⌘R: the page again, where it is (its web session stays; a spent handover gets a new one through `/login`).
    @MainActor static func reloadLive() { live?.reload() }

    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
        let parent: HouseWebView
        private var drawn = false
        /// The main frame answered with an error page: it finishes loading, but it is not the house's page.
        private var errorPage = false
        init(_ parent: HouseWebView) { self.parent = parent }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            webView.scrollView.pinchGestureRecognizer?.isEnabled = false
            if errorPage { errorPage = false; return }
            guard !drawn else { return }
            drawn = true
            // (a frame for the page's first paint after its load)
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { self.parent.onEvent(.ready) }
        }

        // A PAGE THAT DOES NOT COME (MainView shows why, with the way to the app's settings). Only before the first
        // page has drawn: once it has, the page is up and handles its own requests. Cancelled loads (a newer one, the
        // app's own `.cancel`s: /login, outside links) are not failures.
        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            report(error)
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            report(error)
        }

        private func report(_ error: Error) {
            let e = error as NSError
            if drawn || (e.domain == NSURLErrorDomain && e.code == NSURLErrorCancelled)
                || (e.domain == "WebKitErrorDomain" && e.code == 102) { return }     // 102: frame load interrupted
            parent.onEvent(.failed(HouseWebView.reason(error)))
        }

        func webView(_ webView: WKWebView, decidePolicyFor response: WKNavigationResponse) async -> WKNavigationResponsePolicy {
            guard response.isForMainFrame, let http = response.response as? HTTPURLResponse,
                  http.statusCode == 404 || http.statusCode >= 500 else { return .allow }
            let code = http.statusCode
            await MainActor.run {
                guard !drawn else { return }
                errorPage = true
                parent.onEvent(.failed(code >= 500 ? "Mantel answered, but couldn’t open its page (error \(code))."
                                                   : "Mantel doesn’t have that page."))
            }
            return .allow
        }

        /// The page's process ended (iOS took its memory back): load it again, and say it is not drawn until then.
        func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
            drawn = false
            parent.onEvent(.lost)
            webView.reload()
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

        // THE MICROPHONE: the paired house's own https page may record (the Intercom, the door's talk button); every
        // other page, frame or origin, and the camera, are refused without asking (MediaPermission has the rule).
        func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin,
                     initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType,
                     decisionHandler: @escaping (WKPermissionDecision) -> Void) {
            let mine = type == .microphone && MediaPermission.allowsMicrophone(
                scheme: origin.protocol, host: origin.host, port: origin.port,
                house: [parent.house.local, parent.house.remote])
            decisionHandler(mine ? .grant : .deny)
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
                guard let s = body["url"] as? String, let url = URL(string: s), let web = message.webView,
                      var top = web.window?.rootViewController else { return }
                while let next = top.presentedViewController { top = next }
                let vc = UIActivityViewController(activityItems: [url], applicationActivities: nil)
                // a regular-width window shows it as a popover, which needs a place to point at: the page's top
                if let pop = vc.popoverPresentationController {
                    pop.sourceView = web
                    pop.sourceRect = CGRect(x: web.bounds.midX, y: web.safeAreaInsets.top + 8, width: 1, height: 1)
                    pop.permittedArrowDirections = [.up]
                }
                top.present(vc, animated: true)
            #if DEBUG
            case "log": print("[web]", body["text"] as? String ?? "")
            #endif
            default: break
            }
        }
    }
}
