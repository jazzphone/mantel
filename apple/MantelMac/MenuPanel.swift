import AppKit
import MantelKit
import SwiftUI

/// The menu bar panel: the house's own pages at about a phone's size, edge to edge, with the panel's few controls
/// floating in a band over their top (Away, Music | Favorites, the window, the app's menu: Avery, 2026-10-19, no bar
/// above the page): the music player (web/cards/mantel-player.js) or the person's favorites as Home's pills. Before
/// the house is set up or signed in, and whenever a page cannot be opened, the menu's own controls.
struct MenuPanel: View {
    @EnvironmentObject private var model: SessionModel
    @EnvironmentObject private var app: MacApp
    @Environment(\.openWindow) private var openWindow
    @AppStorage("panelTab") private var tab = Tab.music

    enum Tab: String { case music, favorites }
    /// The band over the page that its floating controls sit in (the page laid out below it, its background under it).
    static let band: CGFloat = 40
    /// The page under it (Avery, 2026-10-19: a quarter shorter than a phone's).
    static let height: CGFloat = 470

    var body: some View {
        Group {
            if model.phase == .ready {
                ZStack(alignment: .topTrailing) {
                    Group {
                        if tab == .music {
                            PageView(page: app.menuPage) { NowPlayingControls() }
                        } else if favoriteIDs.isEmpty {
                            noFavorites.padding(.top, Self.band)
                        } else {
                            PageView(page: app.favoritesPage) { FavoritesList() }
                        }
                    }
                    .frame(height: Self.height + Self.band)
                    .background(Color(red: 0.02, green: 0.027, blue: 0.055))     // the pages' own #05070e
                    controls
                        .padding(.horizontal, 10).padding(.vertical, 4)
                        .background(.ultraThinMaterial, in: Capsule())
                        .environment(\.colorScheme, .dark)          // the pages are dark: so are their floating controls
                        .padding(.top, 8).padding(.trailing, 12)
                }
            } else {
                VStack(spacing: 0) {
                    HStack(spacing: 8) {
                        Text(model.house?.name ?? "Mantel").font(.headline).lineLimit(1)
                        Spacer(minLength: 4)
                        controls
                    }
                    .padding(.horizontal, 12).padding(.vertical, 8)
                    Divider()
                    notSignedIn
                    if let p = model.problem {
                        Text(p).font(.caption).foregroundStyle(.red).padding(.horizontal, 12).padding(.bottom, 8)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
            }
        }
        .frame(width: 390)
        .task { await model.refresh() }
        .task(id: favoriteIDs) { await app.favoritesPage.setQuery(Self.favoritesQuery(favoriteIDs)) }
    }

    /// The person's favorites, in their order (the house's summary: only those that still exist).
    private var favoriteIDs: [String] { (model.summary?.favorites ?? []).map(\.entity_id) }

    static func favoritesQuery(_ ids: [String]) -> String {
        "pane=favorites&ids=" + ids.map { $0.addingPercentEncoding(withAllowedCharacters: .alphanumerics.union(["_", "."])) ?? $0 }
            .joined(separator: ",")
    }

    private var noFavorites: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("No favorites yet. Add the accessories you use most: they show here as the dashboard's buttons, and in the widgets, Control Center and Siri.")
                .font(.callout).foregroundStyle(.secondary)
            Button("Add Favorites…") { open("favorites") }
        }
        .environment(\.colorScheme, .dark)
        .padding(16).frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    private var controls: some View {
        HStack(spacing: 8) {
            if model.door == .tunnel {
                Label("Away", systemImage: "globe").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                    .help("Away from home: through the house's remote address")
            }
            if model.phase == .ready {
                if tab == .favorites {
                    Button { open("favorites") } label: { Image(systemName: "square.and.pencil") }
                        .buttonStyle(.borderless).help("Edit Favorites")
                }
                Picker("", selection: $tab) {
                    Image(systemName: "music.note").help("Music").tag(Tab.music)
                    Image(systemName: "star").help("Favorites").tag(Tab.favorites)
                }
                .pickerStyle(.segmented).labelsHidden().frame(width: 84)
                Button { open("music") } label: { Image(systemName: "macwindow") }
                    .buttonStyle(.borderless).help("Open Play Music in a window")
            }
            Menu {
                if let h = model.house { Text(h.name) }
                if model.phase == .ready {
                    Button("Open Play Music") { open("music") }
                    Button("Edit Favorites…") { open("favorites") }
                    Button("Open Mantel") {
                        Task { if let u = await model.webSessionURL() { NSWorkspace.shared.open(u) } }
                    }
                    Toggle("Play/Pause Key Controls the House (Try It)", isOn: Binding(get: { app.mediaKeys }, set: { v in
                        app.mediaKeys = v
                        app.keys.follow(model.summary?.now_playing)
                    }))
                    Divider()
                    Button("Sign Out") { app.pages.forEach { $0.close() }; Task { await model.signOut() } }
                }
                if model.house != nil {
                    Button("Forget This Mantel…") {
                        app.pages.forEach { $0.close() }
                        Task { await model.forgetHouse() }
                    }
                }
                Divider()
                Button("Quit Mantel") { NSApp.terminate(nil) }
            } label: { Image(systemName: "ellipsis.circle") }
                .menuStyle(.borderlessButton).menuIndicator(.hidden).fixedSize()
        }
    }

    @ViewBuilder private var notSignedIn: some View {
        VStack(alignment: .leading, spacing: 10) {
            if model.phase == .setup {
                Text("Pair this Mac with your home’s Mantel to play music on the house’s speakers from the menu bar.")
                    .font(.callout).foregroundStyle(.secondary)
                Button("Set Up Mantel…") { open("setup") }.keyboardShortcut(.defaultAction)
            } else {
                Text("Sign in to \(model.house?.name ?? "Mantel") to see its music and your favorites.")
                    .font(.callout).foregroundStyle(.secondary)
                Button("Sign In…") { open("setup") }.keyboardShortcut(.defaultAction)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14)
    }

    private func open(_ id: String) {
        openWindow(id: id)
        MacApp.front(id)
    }
}

/// One of the house's pages, or the menu's own controls (`fallback`) while it cannot be opened.
struct PageView<Fallback: View>: View {
    @EnvironmentObject private var model: SessionModel
    @ObservedObject var page: HousePage
    @ViewBuilder var fallback: () -> Fallback

    var body: some View {
        Group {
            if let web = page.webView, !page.failed {
                HousePageView(web: web)
            } else if page.failed {
                VStack(alignment: .leading, spacing: 12) {
                    fallback()
                    if page.unsupported {
                        Text("Update your Mantel to see the full player here.").font(.caption).foregroundStyle(.secondary)
                    } else {
                        Button("Try Again") { Task { await page.reload() } }
                    }
                }
                .padding(14).padding(.top, page.topInset)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                .environment(\.colorScheme, .dark)
            } else {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .task { await page.show(model) }
        .onChange(of: model.door) { _, door in
            if door != nil { Task { await page.show(model) } }       // a new door: the page again
        }
    }
}

/// The speaker the person listens to, with the menu's own buttons (the app's API, through the gateway).
struct NowPlayingControls: View {
    @EnvironmentObject private var model: SessionModel

    var body: some View {
        if let p = model.summary?.now_playing {
            VStack(alignment: .leading, spacing: 4) {
                Label(p.name, systemImage: "hifispeaker.fill").font(.caption).foregroundStyle(.secondary)
                Text(p.attributes?.media_title ?? "Nothing playing").font(.body.weight(.semibold)).lineLimit(1)
                Text(p.attributes?.media_artist ?? "").font(.caption).foregroundStyle(.secondary)
                HStack(spacing: 16) {
                    control("backward.fill", "media_previous_track", p)
                    control(p.state == "playing" ? "pause.fill" : "play.fill", "media_play_pause", p)
                    control("forward.fill", "media_next_track", p)
                    Slider(value: Binding(get: { p.attributes?.volume_level ?? 0 }, set: { v in
                        Task { await model.run(Command(domain: "media_player", service: "volume_set", entity_id: p.entity_id,
                                                       data: ["volume_level": .number(v)])) }
                    }), in: 0...1)
                }
                .buttonStyle(.plain)
            }
        } else {
            Text("No speaker yet: choose one with Speakers.").font(.callout).foregroundStyle(.secondary)
        }
    }

    private func control(_ symbol: String, _ service: String, _ p: EntityState) -> some View {
        Button { Task { await model.run(Command(domain: "media_player", service: service, entity_id: p.entity_id)) } } label: {
            Image(systemName: symbol).font(.title3)
        }
    }
}

/// The person's favorites as the menu's own toggles: while their page cannot be opened.
struct FavoritesList: View {
    @EnvironmentObject private var model: SessionModel

    var body: some View {
        ScrollView {
            VStack(spacing: 8) {
                ForEach(model.summary?.favorites ?? []) { e in
                    HStack {
                        VStack(alignment: .leading) {
                            Text(e.name)
                            Text(e.detail).font(.caption).foregroundStyle(.secondary)
                        }
                        Spacer()
                        if e.isToggleable {
                            Toggle("", isOn: Binding(get: { e.isOn }, set: { _ in Task { await model.toggle(e) } }))
                                .toggleStyle(.switch).labelsHidden()
                        } else if e.isAction {
                            Button("Run") { Task { await model.toggle(e) } }
                        }
                    }
                }
            }
        }
    }
}

/// Play Music in a resizable window, without its title bar: what plays and where beside Browse when there is room.
struct MusicWindow: View {
    @EnvironmentObject private var model: SessionModel
    @EnvironmentObject private var app: MacApp

    var body: some View {
        Group {
            if model.phase == .ready {
                PageView(page: app.windowPage) { NowPlayingControls() }
            } else {
                ContentUnavailableView("Not Signed In", systemImage: "house",
                                       description: Text("Set up Mantel from the menu bar first."))
            }
        }
        .frame(minWidth: 340, minHeight: 560)
        .ignoresSafeArea()          // no title bar: the page to the window's edges, the window's buttons over it
        .navigationTitle(model.house.map { "Play Music · \($0.name)" } ?? "Play Music")
    }
}
