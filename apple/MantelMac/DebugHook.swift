#if DEBUG
import AppKit
import MantelKit
import SwiftUI

/// Debug builds only: `mantel://debug/house?fp=<pin's start>` switches house (houses.txt: each one's pin start, `*` in
/// use); `mantel://debug/render?view=player|speakers|upnext|browse|favorites|window&to=http://127.0.0.1:<port>/`
/// draws that view with the app's live data (SwiftUI's ImageRenderer: controls AppKit draws itself -- the segmented
/// controls, the search field -- come out as placeholders) and sends it, with the app's state (state.txt), to a
/// receiver on this Mac's loopback. For checking the player from a script, where nothing can see the menu bar panel.
@MainActor
enum DebugHook {
    static func handle(_ url: URL, model: SessionModel, music: MusicModel) {
        guard url.host == "debug" else { return }
        let q = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
        let to = q.first(where: { $0.name == "to" })?.value.flatMap(URL.init(string:))
        func send(_ name: String, _ data: Data) {
            guard let to, ["127.0.0.1", "localhost"].contains(to.host ?? "") else { return }    // this Mac only
            var req = URLRequest(url: to.appending(path: name))
            req.httpMethod = "PUT"
            Task { _ = try? await URLSession.shared.upload(for: req, from: data) }
        }
        if url.path == "/house", let fp = q.first(where: { $0.name == "fp" })?.value {     // switch, by its pin's start
            if let h = model.houses.first(where: { $0.fingerprint.hasPrefix(fp) }) { Task { await model.switchTo(h) } }
            send("houses.txt", Data(model.houses.map { "\($0.fingerprint.prefix(8)) \($0.id == model.house?.id ? "*" : " ")" }
                .joined(separator: "\n").utf8))
            return
        }
        if url.path == "/act", let what = q.first(where: { $0.name == "do" })?.value {   // the buttons' own calls
            let arg = q.first(where: { $0.name == "arg" })?.value ?? ""
            Task {
            await music.refresh()
            send("act.txt", Data("\(what) \(arg) context=\(music.context?.key ?? "-") client=\(music.client != nil)".utf8))
            switch what {
            case "transport": music.transport(arg)                                  // play_pause | next | previous
            case "volume": music.setVolume(Double(arg) ?? 0.3)
            case "rooms": music.playOn(arg.split(separator: ",").map(String.init))  // Speakers' Update
            case "queue": music.playQueueItem(arg)
            case "playlist": music.play(playlist: arg)
            case "item": music.play(MusicItem(media_type: "playlist", uri: arg, name: arg))
            case "stop": music.stop()
            default: break
            }
            }
            return
        }
        guard url.path == "/render" else { return }
        let which = q.first { $0.name == "view" }?.value ?? "player"
        let state = "phase=\(model.phase) music=\(music.state.map { "configured=\($0.configured) speakers=\($0.speakers.count) contexts=\($0.contexts.count) focus=\($0.focus ?? "-")" } ?? "none") " +
            "context=\(music.context?.key ?? "-") playing=\(music.isPlaying) problem=\(music.problem ?? "-") last=\(music.lastFailure ?? "-")"
        send("state.txt", Data(state.utf8))
        Task {
            await music.refresh()
            _ = await music.image(music.leader?.art)            // the pictures: the renderer runs no view's task
            if which == "upnext" {
                await music.loadQueue()
                for i in music.queue?.items ?? [] { _ = await music.image(i.image) }
            }
            if which == "browse" || which == "window" {
                let kind = UserDefaults.standard.string(forKey: "browseKind") ?? "playlist"
                await music.loadLibrary(kind, search: "")
                for i in music.library[MusicModel.libraryKey(kind, "")] ?? [] { _ = await music.image(i.image) }
            }
            let size = which == "window" ? CGSize(width: 1080, height: 680) : MenuPanel.size
            let view = ZStack {
                PlayerBackdrop(ref: which == "favorites" ? nil : music.leader?.art)
                content(which, music)
            }
            .frame(width: size.width, height: size.height)
            .environment(\.colorScheme, .dark)
            .environment(\.drawingStill, true)
            .environmentObject(model).environmentObject(music)
            let r = ImageRenderer(content: view)
            r.scale = 2
            if let tiff = r.nsImage?.tiffRepresentation, let rep = NSBitmapImageRep(data: tiff),
               let png = rep.representation(using: .png, properties: [:]) {
                send("\(which).png", png)
            }
        }
    }

    @ViewBuilder static func content(_ which: String, _ music: MusicModel) -> some View {
        switch which {
        case "window":
            HStack(spacing: 0) {
                NowPlayingView(wide: true, open: { _ in }, current: .browse)
                    .padding(.horizontal, 36).padding(.top, 44).padding(.bottom, 32).frame(width: 440)
                    .frame(maxHeight: .infinity)
                Rectangle().fill(.white.opacity(0.1)).frame(width: 1).padding(.vertical, 24)
                VStack(alignment: .leading, spacing: 18) {
                    PaneTabs(selection: .constant(.browse)).frame(maxWidth: .infinity)
                    BrowsePane(columns: 4)
                }
                .padding(.horizontal, 28).padding(.top, 40).padding(.bottom, 24)
            }
        case "speakers", "upnext", "browse":
            VStack(alignment: .leading, spacing: 12) {
                PaneHeader(title: which == "speakers" ? "Speakers" : which == "upnext" ? "Up Next" : "Browse") {}
                if which == "speakers" { SpeakersPane() } else if which == "upnext" { UpNextPane() } else { BrowsePane(columns: 3) }
            }
            .padding(.horizontal, 18).padding(.top, 46).padding(.bottom, 16)
        case "playlists":           // the house's playlists alone (Browse runs past the panel's height)
            LazyVGrid(columns: [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)], spacing: 10) {
                ForEach(music.state?.playlists ?? []) { HousePlaylistTile(playlist: $0) }
            }
            .padding(.horizontal, 18).padding(.top, 46).frame(maxHeight: .infinity, alignment: .top)
        case "favorites":
            FavoritesGrid {}.padding(.horizontal, 18).padding(.top, 46).padding(.bottom, 16)
        default:
            NowPlayingView(open: { _ in }).padding(.horizontal, 18).padding(.top, 46).padding(.bottom, 16)
        }
    }
}
#endif
