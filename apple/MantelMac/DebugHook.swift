#if DEBUG
import AppKit
import WebKit

/// Debug builds only: `mantel://debug/snapshot?to=http://127.0.0.1:<port>/` sends what the menu's and the window's
/// Music pages show (menu.png, window.png) and the app's state (state.txt) to a receiver on this Mac's loopback, and
/// `mantel://debug/js?page=menu|favorites|window&code=…&to=…`, and `mantel://debug/load` loads every page, runs a line of JavaScript in that page and sends the answer
/// (js.txt). For checking the pages from a script where nothing can see the menu bar panel and the app's container is
/// closed to other apps (the tests against the fictional Mantel, apple/README.md).
@MainActor
enum DebugHook {
    static func handle(_ url: URL, app: MacApp, model: SessionModel) {
        guard url.host == "debug" else { return }
        let q = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
        let to = q.first(where: { $0.name == "to" })?.value.flatMap(URL.init(string:))
        func send(_ name: String, _ data: Data) {
            guard let to, ["127.0.0.1", "localhost"].contains(to.host ?? "") else { return }    // this Mac only
            var req = URLRequest(url: to.appending(path: name))
            req.httpMethod = "PUT"
            Task { _ = try? await URLSession.shared.upload(for: req, from: data) }
        }
        switch url.path {
        case "/snapshot":
            let windows = NSApp.windows.map { "\($0.title.isEmpty ? String(describing: type(of: $0)) : $0.title) visible=\($0.isVisible) \(Int($0.frame.width))x\(Int($0.frame.height))" }
            let state = "phase=\(model.phase) door=\(String(describing: model.door)) house=\(model.house?.name ?? "-") " +
                "problem=\(model.problem ?? "-") playing=\(model.summary?.now_playing?.state ?? "-")\n" + windows.joined(separator: "\n")
            send("state.txt", Data(state.utf8))
            for (name, page) in [("menu", app.menuPage), ("favorites", app.favoritesPage), ("window", app.windowPage)] {
                guard let web = page.webView else {
                    send("\(name).txt", Data("no page".utf8))
                    continue
                }
                web.takeSnapshot(with: nil) { image, _ in
                    guard let tiff = image?.tiffRepresentation, let rep = NSBitmapImageRep(data: tiff),
                          let png = rep.representation(using: .png, properties: [:]) else { return }
                    send("\(name).png", png)
                    send("\(name).txt", Data("\(web.url?.absoluteString ?? "") \(Int(web.frame.width))x\(Int(web.frame.height))".utf8))
                }
            }
        case "/js":
            let which = q.first { $0.name == "page" }?.value
            let page = which == "menu" ? app.menuPage : which == "favorites" ? app.favoritesPage : app.windowPage
            guard let code = q.first(where: { $0.name == "code" })?.value, let web = page.webView else { return }
            web.evaluateJavaScript(code) { result, error in
                let text = error.map { "error: \($0)" } ?? String(describing: result ?? "nil")
                send("js.txt", Data(text.utf8))
            }
        case "/load":           // every page loaded, shown or not (the menu panel cannot be opened from a script)
            Task {
                await app.favoritesPage.setQuery(MenuPanel.favoritesQuery((model.summary?.favorites ?? []).map(\.entity_id)))
                for page in app.pages { await page.show(model) }
            }
        default: break
        }
    }
}
#endif
