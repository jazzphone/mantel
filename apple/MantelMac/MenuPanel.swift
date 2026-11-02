import AppKit
import MantelKit
import SwiftUI

/// The menu bar panel, native throughout (the brief: "the Swift UI version ... like an Apple designer is
/// making it"): the music player over its cover's colors -- Speakers, Up Next and Browse slide in over it -- or the
/// person's favorites, under one slim bar (the house, Away, Music | Favorites, the window, the app's menu). Before the
/// house is set up or signed in, the way to do that.
struct MenuPanel: View {
    @EnvironmentObject private var model: SessionModel
    @EnvironmentObject private var app: MacApp
    @EnvironmentObject private var music: MusicModel
    @ObservedObject private var push = PushRegistrar.shared
    @Environment(\.openWindow) private var openWindow
    @AppStorage("panelTab") private var tab = Tab.music
    @State private var pane: PlayerPane?

    enum Tab: String { case music, favorites }
    static let size = CGSize(width: 360, height: 520)

    var body: some View {
        Group {
            if model.phase == .ready {
                ZStack {
                    PlayerBackdrop(ref: tab == .music ? music.leader?.art : nil)
                    VStack(spacing: 0) {
                        bar.padding(.horizontal, 14).padding(.top, 10).padding(.bottom, 6)
                        content.padding(.horizontal, 18).padding(.bottom, 16)
                    }
                }
                .frame(width: Self.size.width, height: Self.size.height)
                .environment(\.colorScheme, .dark)
            } else {
                notSignedIn.frame(width: Self.size.width)
            }
        }
        .task { await model.refresh() }
        .onAppear { music.attach(model) }
    }

    @ViewBuilder private var content: some View {
        if tab == .favorites {
            FavoritesGrid { open("favorites") }.transition(.opacity)
        } else if music.state?.configured == false {
            NotConfigured()
        } else if let p = pane {
            VStack(alignment: .leading, spacing: 12) {
                PaneHeader(title: p.title) { withAnimation(.spring(response: 0.35, dampingFraction: 0.9)) { pane = nil } }
                switch p {
                case .speakers: SpeakersPane()
                case .upNext: UpNextPane()
                case .browse: BrowsePane(columns: 3)
                }
            }
            .transition(.move(edge: .bottom).combined(with: .opacity))
        } else {
            NowPlayingView(open: { p in withAnimation(.spring(response: 0.35, dampingFraction: 0.9)) { pane = p } })
                .transition(.opacity)
        }
    }

    private var bar: some View {
        HStack(spacing: 10) {
            Text(model.house?.name ?? "Mantel").font(.system(size: 13, weight: .semibold)).lineLimit(1)
                .foregroundStyle(.white.opacity(0.85))
            if model.door == .tunnel {
                Image(systemName: "globe").font(.system(size: 11, weight: .semibold)).foregroundStyle(.white.opacity(0.6))
                    .help("Away from home: through the house's remote address")
            }
            Spacer(minLength: 4)
            Picker("", selection: Binding(get: { tab }, set: { t in withAnimation(.easeInOut(duration: 0.2)) { tab = t; pane = nil } })) {
                Image(systemName: "music.note").help("Music").tag(Tab.music)
                Image(systemName: "star.fill").help("Favorites").tag(Tab.favorites)
            }
            .pickerStyle(.segmented).labelsHidden().frame(width: 76)
            Button { open("music") } label: { Image(systemName: "macwindow") }
                .buttonStyle(.plain).foregroundStyle(.white.opacity(0.8)).help("Open the Player in a Window")
            menu
        }
    }

    private var menu: some View {
        Menu {
            if let h = model.house { Text(h.name) }
            Button("Open Player Window") { open("music") }
            Button("Edit Favorites…") { open("favorites") }
            Button("Open Mantel in the Browser") {
                Task { if let u = await model.webSessionURL() { NSWorkspace.shared.open(u) } }
            }
            Toggle("Play/Pause Key Controls the House (Try It)", isOn: Binding(get: { app.mediaKeys }, set: { v in
                app.mediaKeys = v
                app.keys.follow(model.summary?.now_playing)
            }))
            notifications
            if model.houses.count > 1 {
                Menu("Switch Mantel") {
                    ForEach(model.houses, id: \.id) { h in
                        Button(h.name + (h.id == model.house?.id ? " ✓" : "")) { Task { await model.switchTo(h) } }
                    }
                }
            }
            Divider()
            Button("Sign Out") { Task { await model.signOut() } }
            Button("Forget This Mantel…") { Task { await model.forgetHouse() } }
            Divider()
            Button("Quit Mantel") { NSApp.terminate(nil) }
        } label: { Image(systemName: "ellipsis.circle") }
            .menuStyle(.borderlessButton).menuIndicator(.hidden).fixedSize()
            .foregroundStyle(.white.opacity(0.8))
    }

    /// This Mac's notifications from the house (PushRegistrar): on, or the one thing that turns them on.
    @ViewBuilder private var notifications: some View {
        switch push.status {
        case .on:
            Button("Notifications On") {}.disabled(true)
        case .needsSignedBuild:
            Button("Notifications Need the Signed Build") {}.disabled(true)
        case .registering:
            Button("Turning On Notifications…") {}.disabled(true)
        case .denied:
            Button("Notifications Are Off in System Settings…") { PushRegistrar.openSystemSettings() }
        case .unknown, .stopped, .failed:
            Button("Turn On Notifications") { Task { await push.requestAndRegister(resume: true) } }
            if case .failed(let why) = push.status { Text(why) }
        }
    }

    @ViewBuilder private var notSignedIn: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text(model.house?.name ?? "Mantel").font(.headline)
                Spacer()
                Button("Quit") { NSApp.terminate(nil) }.buttonStyle(.borderless)
            }
            if model.phase == .setup {
                Text("Pair this Mac with your home’s Mantel to play music on the house’s speakers from the menu bar.")
                    .font(.callout).foregroundStyle(.secondary)
                Button("Set Up Mantel…") { open("setup") }.keyboardShortcut(.defaultAction)
            } else {
                Text("Sign in to \(model.house?.name ?? "Mantel") to see its music and your favorites.")
                    .font(.callout).foregroundStyle(.secondary)
                Button("Sign In…") { open("setup") }.keyboardShortcut(.defaultAction)
            }
            if let p = model.problem { Text(p).font(.caption).foregroundStyle(.red) }
        }
        .padding(14)
    }

    private func open(_ id: String) {
        openWindow(id: id)
        MacApp.front(id)
    }
}

/// A Mantel whose music is not Mantel's own yet (Home Assistant's engine, or a Mantel from before the apps' music):
/// the speaker the person listens to, with plain buttons.
struct NotConfigured: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            NowPlayingControls()
            Text("Update your Mantel, with its music set up in Mantel, for the full player here.")
                .font(.caption).foregroundStyle(.white.opacity(0.6))
            Spacer()
        }
        .foregroundStyle(.white)
    }
}

/// The speaker the person listens to (the summary), with the app's own buttons through the gateway.
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
                }
                .buttonStyle(.plain)
            }
        } else {
            Text("No speaker yet.").font(.callout).foregroundStyle(.secondary)
        }
    }

    private func control(_ symbol: String, _ service: String, _ p: EntityState) -> some View {
        Button { Task { await model.run(Command(domain: "media_player", service: service, entity_id: p.entity_id)) } } label: {
            Image(systemName: symbol).font(.title3)
        }
    }
}

/// The player in a window of its own, wide (Apple Music's own layout): the player on the left over its cover's
/// colors, Browse, Up Next and Speakers beside it. No title bar: the window's buttons float over the colors.
struct MusicWindow: View {
    @EnvironmentObject private var model: SessionModel
    @EnvironmentObject private var music: MusicModel
    @AppStorage("windowPane") private var pane = PlayerPane.browse

    var body: some View {
        ZStack {
            PlayerBackdrop(ref: music.leader?.art)
            if model.phase != .ready {
                Text("Set up Mantel from the menu bar first.").foregroundStyle(.white.opacity(0.7))
            } else if music.state?.configured == false {
                NotConfigured().padding(40)
            } else {
                HStack(spacing: 0) {
                    NowPlayingView(wide: true, open: { pane = $0 }, current: pane)
                        .padding(.horizontal, 36).padding(.top, 44).padding(.bottom, 32)
                        .frame(minWidth: 320, idealWidth: 420, maxWidth: 520)
                    Rectangle().fill(.white.opacity(0.1)).frame(width: 1).padding(.vertical, 24)
                    VStack(alignment: .leading, spacing: 18) {
                        PaneTabs(selection: $pane).frame(maxWidth: .infinity)          // centered over its column
                        switch pane {
                        case .speakers: SpeakersPane()
                        case .upNext: UpNextPane()
                        case .browse: BrowsePane(columns: 4, sizable: true)
                        }
                    }
                    .padding(.horizontal, 28).padding(.top, 40).padding(.bottom, 24)
                    .frame(minWidth: 360, maxWidth: .infinity)
                }
            }
        }
        .environment(\.colorScheme, .dark)
        .frame(minWidth: 760, minHeight: 540)
        .ignoresSafeArea()
        .navigationTitle(model.house.map { "Music · \($0.name)" } ?? "Music")
        .onAppear { music.attach(model) }
    }
}
