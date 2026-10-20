import AppKit
import MantelKit
import SwiftUI

/// Mantel in the Mac's menu bar (docs/phase10/APPLE-APPS.md §9 and §12): a music player of its own (the house's music,
/// with Speakers / Volume / Up Next / Browse) in the menu, Play Music in a window, the person's favorites as toggles (chosen here
/// too), and the keyboard's play/pause key for the house's speaker. It shares MantelKit (sign-in, the device key, the
/// API) and SessionModel with the iPhone app.
@main
struct MantelMacApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var delegate

    var body: some Scene {
        MenuBarExtra {
            MenuPanel().environmentObject(delegate.model).environmentObject(delegate.app)
        } label: {
            MenuLabel(model: delegate.model, app: delegate.app)
        }
        .menuBarExtraStyle(.window)

        Window("Music", id: "music") {
            MusicWindow().environmentObject(delegate.model).environmentObject(delegate.app)
        }
        .defaultSize(width: 1100, height: 760)       // Play Music's wide layout: what plays beside Browse
        .windowStyle(.hiddenTitleBar)                 // no gray bar: the window's buttons float on the page
        .windowBackgroundDragBehavior(.enabled)

        Window("Favorites", id: "favorites") {
            NavigationStack { FavoritesEditor() }.environmentObject(delegate.model).frame(minWidth: 380, minHeight: 480)
        }
        .defaultSize(width: 420, height: 620)

        Window("Set Up Mantel", id: "setup") {
            SetupWindow().environmentObject(delegate.model)
        }
        .windowResizability(.contentSize)
    }
}

/// What lives as long as the app: the house's pages (the menu's two and the window's), the media keys.
@MainActor
final class MacApp: ObservableObject {
    /// The menu's: the player, the favorites (both under the panel's floating controls); the window's: Play Music.
    let menuPage = HousePage(query: "pane=player", topInset: MenuPanel.band)
    let favoritesPage = HousePage(query: "pane=favorites", topInset: MenuPanel.band, zoom: 0.75)
    let windowPage = HousePage(view: "playmusic", query: "bare=1", topInset: 28)
    var pages: [HousePage] { [menuPage, favoritesPage, windowPage] }
    let keys = NowPlayingKeys()
    /// A window to open, asked for by a `mantel://music` (or `favorites`, `setup`) link; the menu bar icon opens it.
    @Published var openRequest: String?
    @Published var mediaKeys: Bool {
        didSet { UserDefaults.standard.set(mediaKeys, forKey: NowPlayingKeys.enabledKey) }
    }

    init() { mediaKeys = UserDefaults.standard.bool(forKey: NowPlayingKeys.enabledKey) }

    /// A window opened from the menu bar comes to the front: the app has no Dock icon, so macOS may leave it behind.
    static func front(_ id: String) {
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) {
            NSApp.activate(ignoringOtherApps: true)
            for w in NSApp.windows where w.identifier?.rawValue.contains(id) == true && w.isVisible {
                w.makeKeyAndOrderFront(nil)
                w.orderFrontRegardless()
            }
        }
    }
}

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    let model = SessionModel()
    let app = MacApp()
    private var timer: Timer?

    func applicationDidFinishLaunching(_ notification: Notification) {
        app.keys.attach(model)
        MusicActivityController.shared.keys = app.keys
        // the speaker's song and state for the media keys and the menu's icon: the summary, every 20 seconds
        timer = Timer.scheduledTimer(withTimeInterval: 20, repeats: true) { [weak self] _ in
            Task { @MainActor in
                guard let self, self.model.phase == .ready else { return }
                await self.model.refresh()
            }
        }
    }

    /// A `mantel://pair` link clicked in Mantel Settings (or anywhere): pair with that house. `mantel://music`,
    /// `mantel://favorites` and `mantel://setup` open those windows.
    func application(_ application: NSApplication, open urls: [URL]) {
        for url in urls {
            if let link = PairingLink(url: url) {
                Task { await model.pair(link) }
            } else if url.scheme == MantelConfig.urlScheme, let host = url.host, ["music", "favorites", "setup"].contains(host) {
                app.openRequest = host
            } else {
                #if DEBUG
                DebugHook.handle(url, app: app, model: model)
                #endif
            }
        }
    }
}

struct MenuLabel: View {
    @ObservedObject var model: SessionModel
    @ObservedObject var app: MacApp
    @Environment(\.openWindow) private var openWindow

    var body: some View {
        Image(systemName: model.summary?.now_playing?.state == "playing" ? "music.note.house.fill" : "house.fill")
            .onChange(of: app.openRequest) { _, id in
                guard let id else { return }
                app.openRequest = nil
                openWindow(id: id)
                MacApp.front(id)
            }
    }
}

/// The Mac has no Live Activity: the speaker's song goes to the media keys (NowPlayingKeys) instead.
@MainActor final class MusicActivityController {
    static let shared = MusicActivityController()
    var keys: NowPlayingKeys?
    func follow(_ playing: EntityState?, house: House) async { keys?.follow(playing) }
    func end() async { keys?.follow(nil) }
}

/// Notifications on the Mac are optional (§9) and not wired yet.
@MainActor final class PushRegistrar {
    static let shared = PushRegistrar()
    func register(client: MantelClient) async {}
}
