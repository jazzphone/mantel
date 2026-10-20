import AppKit
import MantelKit
import SwiftUI

/// The menu bar panel: the house's Music page at about a phone's size, edge to edge, with the panel's few controls
/// floating over its top right corner (Away, Music | Favorites, the Music window, the app's menu: Avery, 2026-10-19, no
/// bar above the page); or the person's favorites under a compact header with the house's name. Before the house is set
/// up or signed in, and whenever the page cannot be opened, the menu's own controls.
struct MenuPanel: View {
    @EnvironmentObject private var model: SessionModel
    @EnvironmentObject private var app: MacApp
    @Environment(\.openWindow) private var openWindow
    @AppStorage("panelTab") private var tab = Tab.music

    enum Tab: String { case music, favorites }

    var body: some View {
        Group {
            if model.phase == .ready, tab == .music {
                ZStack(alignment: .topTrailing) {
                    MusicPageView(page: app.menuPage).frame(height: 680)
                    controls
                        .padding(.horizontal, 10).padding(.vertical, 5)
                        .background(.ultraThinMaterial, in: Capsule())
                        .environment(\.colorScheme, .dark)          // the page is dark: so are its floating controls
                        .padding(.top, 14).padding(.trailing, 12)
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
                    if model.phase == .ready { FavoritesList().padding(14) } else { notSignedIn }
                    if let p = model.problem {
                        Text(p).font(.caption).foregroundStyle(.red).padding(.horizontal, 12).padding(.bottom, 8)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
            }
        }
        .frame(width: 390)
        .task { await model.refresh() }
    }

    private var controls: some View {
        HStack(spacing: 8) {
            if model.door == .tunnel {
                Label("Away", systemImage: "globe").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                    .help("Away from home: through the house's remote address")
            }
            if model.phase == .ready {
                Picker("", selection: $tab) {
                    Image(systemName: "music.note").help("Music").tag(Tab.music)
                    Image(systemName: "star").help("Favorites").tag(Tab.favorites)
                }
                .pickerStyle(.segmented).labelsHidden().frame(width: 84)
                Button { open("music") } label: { Image(systemName: "macwindow") }
                    .buttonStyle(.borderless).help("Open Music in a window")
            }
            Menu {
                if let h = model.house { Text(h.name) }
                if model.phase == .ready {
                    Button("Open Music") { open("music") }
                    Button("Edit Favorites…") { open("favorites") }
                    Button("Open Mantel") {
                        Task { if let u = await model.webSessionURL() { NSWorkspace.shared.open(u) } }
                    }
                    Toggle("Play/Pause Key Controls the House (Try It)", isOn: Binding(get: { app.mediaKeys }, set: { v in
                        app.mediaKeys = v
                        app.keys.follow(model.summary?.now_playing)
                    }))
                    Divider()
                    Button("Sign Out") { app.menuPage.close(); app.windowPage.close(); Task { await model.signOut() } }
                }
                if model.house != nil {
                    Button("Forget This Mantel…") {
                        app.menuPage.close(); app.windowPage.close()
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
        NSApp.activate()
    }
}

/// The Music page (the menu's or the window's), or the menu's own controls while it cannot be opened.
struct MusicPageView: View {
    @EnvironmentObject private var model: SessionModel
    @ObservedObject var page: HousePage

    var body: some View {
        Group {
            if let web = page.webView, !page.failed {
                HousePageView(web: web)
            } else if page.failed {
                VStack(alignment: .leading, spacing: 12) {
                    NowPlayingControls()
                    Button("Try the Music Page Again") { Task { await page.reload() } }
                }
                .padding(14).frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
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
            Text("No speaker yet: choose one on the Music page.").font(.callout).foregroundStyle(.secondary)
        }
    }

    private func control(_ symbol: String, _ service: String, _ p: EntityState) -> some View {
        Button { Task { await model.run(Command(domain: "media_player", service: service, entity_id: p.entity_id)) } } label: {
            Image(systemName: symbol).font(.title3)
        }
    }
}

/// The person's favorites as toggles, and the way to choose them.
struct FavoritesList: View {
    @EnvironmentObject private var model: SessionModel
    @Environment(\.openWindow) private var openWindow

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            let favs = model.summary?.favorites ?? []
            if favs.isEmpty {
                Text("No favorites yet. Add the accessories you use most: they show here, in the widgets, Control Center and Siri.")
                    .font(.callout).foregroundStyle(.secondary)
            }
            ScrollView {
                VStack(spacing: 8) {
                    ForEach(favs) { e in
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
            .frame(maxHeight: 520)
            HStack {
                Button { openWindow(id: "favorites"); NSApp.activate() } label: {
                    Label(favs.isEmpty ? "Add Favorites…" : "Edit Favorites…", systemImage: "star")
                }
                Spacer()
                Button { Task { await model.refresh() } } label: { Image(systemName: "arrow.clockwise") }
                    .buttonStyle(.borderless).help("Refresh")
            }
        }
    }
}

/// The Music page in a resizable window: its wider layout (what plays and where beside Browse) when there is room.
struct MusicWindow: View {
    @EnvironmentObject private var model: SessionModel
    @EnvironmentObject private var app: MacApp

    var body: some View {
        Group {
            if model.phase == .ready {
                MusicPageView(page: app.windowPage)
            } else {
                ContentUnavailableView("Not Signed In", systemImage: "house",
                                       description: Text("Set up Mantel from the menu bar first."))
            }
        }
        .frame(minWidth: 380, minHeight: 520)
        .ignoresSafeArea()          // no title bar: the page to the window's edges, the window's buttons over it
        .navigationTitle(model.house.map { "Music · \($0.name)" } ?? "Music")
    }
}
