import AppKit
import MantelKit
import SwiftUI
import WebKit

/// One of the house's pages in a web view on the Mac, kept alive between openings of the menu so it stays live: the
/// Mac's music player (`?pane=player`, web/cards/mantel-player.js), the person's favorites as Home's pills
/// (`?pane=favorites&ids=…`, at three-quarter size), and Play Music without its title bar (`/playmusic?bare=1`). As
/// the iPhone's HouseWebView (§1):
///
/// * Its own, non-persistent website data per house, shared by the menu's page and the Music window: the page's
///   Mantel session (handed over by a one-time code, `/app/web-session`) lives only as long as the app; the page
///   never sees the app's tokens.
/// * Only the house's own addresses load inside; any other link opens in the browser.
/// * A page that falls back to `/login` (its session ended) is caught: the page gets a new session.
///
/// The screens' pages live at `/<screen>/<view>`; the app does not know the person's screen, so it asks for `/home`
/// (the house sends the person to their own screen, and its redirect keeps no query) and turns the first landing on
/// `/<screen>/home` into `/<screen>/<view>?<query>`.
@MainActor
final class HousePage: NSObject, ObservableObject {
    let view: String
    private(set) var query: String
    /// Room at the top for what floats over the page (the Music window's buttons, which have no title bar under them).
    let topInset: CGFloat
    /// The page's scale (WebKit's page zoom): the favorites' pills a quarter smaller in the menu.
    let zoom: CGFloat
    @Published private(set) var webView: WKWebView?
    /// The page could not be opened (no web session, the house unreachable): the menu shows its own controls.
    @Published private(set) var failed = false
    private var house: House?
    private var loadedDoor: Door?
    private var wantsQuery = false
    private weak var model: SessionModel?

    private static var stores: [String: WKWebsiteDataStore] = [:]

    init(view: String = "home", query: String, topInset: CGFloat = 0, zoom: CGFloat = 1) {
        self.zoom = zoom
        self.view = view
        self.query = query
        self.topInset = topInset
    }

    /// Open (or keep) the page for the model's house; a new door or a new house loads it again.
    func show(_ model: SessionModel, force: Bool = false) async {
        guard model.phase == .ready, let h = model.house else { return }
        self.model = model
        if !force, webView != nil, house?.id == h.id, loadedDoor == model.door, !failed { return }
        await load("/home", model: model, house: h)
    }

    func reload() async {
        guard let model, let h = model.house else { return }
        await load("/home", model: model, house: h)
    }

    /// A new query (the favorites changed): the page again, if it is up.
    func setQuery(_ q: String) async {
        guard q != query else { return }
        query = q
        if webView != nil { await reload() }
    }

    /// The person signed out or forgot the house: the page and its session go.
    func close() {
        webView?.stopLoading()
        webView = nil
        house = nil
        failed = false
    }

    private func load(_ next: String, model: SessionModel, house h: House) async {
        guard let url = await model.webSessionURL(next: next) else {
            if !Task.isCancelled { failed = true }      // a view's task ended meanwhile: not a failure
            return
        }
        failed = false
        loadedDoor = model.door
        wantsQuery = next == "/home"
        let web = (house?.id == h.id ? webView : nil) ?? make(for: h)
        house = h
        webView = web
        web.load(URLRequest(url: url))
    }

    private func make(for h: House) -> WKWebView {
        let config = WKWebViewConfiguration()
        let store = HousePage.stores[h.id] ?? WKWebsiteDataStore.nonPersistent()
        HousePage.stores[h.id] = store
        config.websiteDataStore = store
        config.mediaTypesRequiringUserActionForPlayback = []
        let bridge = "window.mantelNative = Object.freeze({ platform: 'mac' });"
        config.userContentController.addUserScript(WKUserScript(source: bridge, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        let web = WKWebView(frame: .zero, configuration: config)
        web.navigationDelegate = self
        web.uiDelegate = self
        web.allowsBackForwardNavigationGestures = false
        web.underPageBackgroundColor = .black
        web.pageZoom = zoom
        if #available(macOS 26.0, *), topInset > 0 {
            web.obscuredContentInsets = NSEdgeInsets(top: topInset, left: 0, bottom: 0, right: 0)
        }
        #if DEBUG
        web.isInspectable = true
        #endif
        return web
    }

    private func isHouse(_ url: URL) -> Bool {
        guard let h = house else { return false }
        return [h.local, h.remote].compactMap { $0 }.contains {
            $0.host == url.host && $0.scheme == url.scheme && $0.port == url.port
        }
    }
}

extension HousePage: WKNavigationDelegate, WKUIDelegate {
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction) async -> WKNavigationActionPolicy {
        guard let url = action.request.url else { return .cancel }
        if url.scheme == "about" || url.scheme == "blob" || url.scheme == "data" { return .allow }
        let main = action.targetFrame?.isMainFrame == true
        if !isHouse(url) {
            if action.navigationType == .linkActivated || main {
                NSWorkspace.shared.open(url)
                return .cancel
            }
            return .allow          // a frame's media stays the page's business
        }
        guard main else { return .allow }
        if url.path == "/login" {
            await reload()         // the page's session ended: a new one
            return .cancel
        }
        let parts = url.path.split(separator: "/")
        if wantsQuery, parts.count == 2, parts[1] == "home", parts[0].contains("-") {
            wantsQuery = false     // the person's own screen: this view of it, with the query
            var c = URLComponents(url: url, resolvingAgainstBaseURL: false)
            c?.path = "/\(parts[0])/\(view)"
            c?.percentEncodedQuery = query.isEmpty ? nil : query
            if let to = c?.url { webView.load(URLRequest(url: to)) }
            return .cancel
        }
        return .allow
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { noteFailure(error) }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        noteFailure(error)
    }

    private func noteFailure(_ error: Error) {
        let e = error as NSError
        if e.domain == NSURLErrorDomain && e.code == NSURLErrorCancelled { return }     // the redirects above
        if e.domain == "WebKitErrorDomain" && e.code == 102 { return }                  // "frame load interrupted"
        failed = true
        model?.problem = error.localizedDescription
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = action.request.url { NSWorkspace.shared.open(url) }
        return nil
    }
}

/// The page's web view in SwiftUI.
struct HousePageView: NSViewRepresentable {
    let web: WKWebView

    func makeNSView(context: Context) -> NSView {
        let host = NSView()
        attach(web, to: host)
        return host
    }

    func updateNSView(_ host: NSView, context: Context) {
        if web.superview !== host { attach(web, to: host) }
    }

    private func attach(_ web: WKWebView, to host: NSView) {
        host.subviews.forEach { $0.removeFromSuperview() }
        web.removeFromSuperview()
        web.translatesAutoresizingMaskIntoConstraints = false
        host.addSubview(web)
        NSLayoutConstraint.activate([web.leadingAnchor.constraint(equalTo: host.leadingAnchor),
                                     web.trailingAnchor.constraint(equalTo: host.trailingAnchor),
                                     web.topAnchor.constraint(equalTo: host.topAnchor),
                                     web.bottomAnchor.constraint(equalTo: host.bottomAnchor)])
    }
}
