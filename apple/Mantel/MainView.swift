import MantelKit
import SwiftUI

/// The house's own screens and Mantel Settings, in a web view (§1), as a native app (docs/phase10/NATIVE-FEEL.md):
///
/// * one menu: the page's own (HK's menu, the tab bar's More), with "Mantel App" opening the app's settings;
/// * the music's Now Playing is the app's own player (`NowPlayingSheet`), from the page's mini player, the playing
///   bar, the Live Activity (`mantel://player`) and the widgets;
/// * nothing white on open: the last page's still, then the page once it has drawn;
/// * the status bar's ink follows the page's ground.
struct MainView: View {
    @EnvironmentObject private var model: SessionModel
    @EnvironmentObject private var music: MusicModel
    @ObservedObject private var router = NotificationRouter.shared
    @Environment(\.scenePhase) private var scenePhase
    @State private var start: URL?
    @State private var showMenu = false
    @State private var showPlayer = false
    @State private var loadedDoor: Door?
    @State private var ready = false
    @State private var lightPage = false
    /// The page has the app's hooks (web/shim/mantel-native.js says its tone as it starts): its menu holds "Mantel App".
    /// A Mantel from before them gets the app's own ⋯ button instead.
    @State private var pageHooks = false
    @State private var still: UIImage? = HouseWebView.stillFile.flatMap { UIImage(contentsOfFile: $0.path) }

    var body: some View {
        ZStack {
            Color(red: 0.02, green: 0.03, blue: 0.055).ignoresSafeArea()      // the page's own ground (#05070e)
            if !ready {
                // the still only where it fits: one taken on the Duo's other display, or an iPad turned or in another
                // window size since, would show the wrong page's layout
                GeometryReader { g in
                    if let still, Self.fits(still, g.size) {
                        Image(uiImage: still).resizable().scaledToFill().frame(width: g.size.width, height: g.size.height).clipped()
                    } else {
                        ProgressView().tint(.white).controlSize(.large).frame(maxWidth: .infinity, maxHeight: .infinity)
                    }
                }
                .ignoresSafeArea()
            }
            if let start {
                HouseWebView(start: start, house: model.house!, onSessionEnded: { next in
                    Task { await load(next) }       // the web session ended: hand the web view a new one
                }, onEvent: handle)
                .ignoresSafeArea()
                .id(start)
                .opacity(ready ? 1 : 0)
            }
        }
        .overlay(alignment: .topTrailing) {
            if ready, !pageHooks {
                Button { showMenu = true } label: {
                    Image(systemName: "ellipsis.circle.fill").font(.title2).symbolRenderingMode(.hierarchical)
                }
                .accessibilityLabel("Mantel App Settings")
                .hoverEffect(.highlight)
                .padding(.trailing, 12).padding(.top, 4)
            }
        }
        .preferredColorScheme(lightPage ? .light : .dark)
        // a form sheet in a regular-width window (iPad, the open Duo turned), a full-height sheet on a phone's width
        .sheet(isPresented: $showMenu) { AppMenu().presentationSizing(.form) }
        .sheet(isPresented: $showPlayer) { NowPlayingSheet().presentationSizing(.form) }
        .task {
            if router.player { router.player = false; openPlayer() }       // opened by the Live Activity, cold
            #if DEBUG
            if UserDefaults.standard.bool(forKey: "MantelOpenPlayer") { openPlayer() }     // -MantelOpenPlayer YES
            #endif
            await load(Self.firstPage)
        }
        .onChange(of: model.door) { _, door in
            if door != nil, door != loadedDoor { Task { await load("/home") } }     // reload only when the door changes
        }
        .onChange(of: router.open) { _, url in
            if let url { router.open = nil; Task { await load(url) } }
        }
        .onChange(of: router.player) { _, on in
            if on { router.player = false; openPlayer() }
        }
        .onChange(of: router.menu) { _, on in
            if on { router.menu = false; if ready, !showPlayer { showMenu = true } }      // ⌘, (MantelApp's commands)
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .background, ready { HouseWebView.saveStill() }
        }
        .overlay(alignment: .bottom) {
            if let p = model.problem, start == nil {
                Text(p).padding().background(.thinMaterial, in: RoundedRectangle(cornerRadius: 12)).padding()
            }
        }
    }

    private func handle(_ e: HouseWebView.WebEvent) {
        switch e {
        case .ready: withAnimation(.easeOut(duration: 0.2)) { ready = true }
        case .menu: showMenu = true
        case .player: openPlayer()
        case .tone(let light): lightPage = light; pageHooks = true
        }
    }

    private func openPlayer() {
        music.attach(model)
        showPlayer = true
    }

    /// The still was taken in a window of about this shape (within 10%).
    private static func fits(_ image: UIImage, _ size: CGSize) -> Bool {
        guard image.size.height > 0, size.height > 0 else { return false }
        let a = image.size.width / image.size.height, b = size.width / size.height
        return abs(a - b) / b < 0.1
    }

    /// Debug builds may start on another page: `simctl launch booted com.jazzphone.mantel.ios -MantelStartPage /x`.
    private static var firstPage: String {
        #if DEBUG
        if let p = UserDefaults.standard.string(forKey: "MantelStartPage"), p.hasPrefix("/") { return p }
        #endif
        return "/home"
    }

    private func load(_ next: String) async {
        if let url = await model.webSessionURL(next: next) {
            loadedDoor = model.door
            if url != start { ready = false }
            start = url
        }
    }
}

/// The app's own settings: Mantel Settings, favorites for the widgets and Control Center, Face ID, notifications,
/// clearing the cache, signing out.
struct AppMenu: View {
    @EnvironmentObject private var model: SessionModel
    @Environment(\.dismiss) private var dismiss
    @State private var faceID = SharedStore.shared.requireFaceID
    @State private var cleared = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    LabeledContent("Mantel", value: model.house?.name ?? "")
                    LabeledContent("Signed In As", value: model.user?.displayName ?? "")
                    LabeledContent("Connected", value: model.door == .lan ? "Home Network" : model.door == .tunnel ? "Away" : "Not Connected")
                }
                Section {
                    Button { dismiss(); NotificationRouter.shared.open = "/settings" } label: {
                        Label("Mantel Settings", systemImage: "gearshape")
                    }
                } footer: { Text("Users, screens, wall tablets and everything else about this Mantel.") }
                Section {
                    NavigationLink("Favorites") { FavoritesEditor() }
                } footer: { Text("Your favorites show in the widgets, Control Center, Siri and on the Mac.") }
                Section {
                    Toggle("Face ID to Open", isOn: $faceID).onChange(of: faceID) { _, v in SharedStore.shared.requireFaceID = v }
                    Button("Turn On Notifications") { Task { await PushRegistrar.shared.requestAndRegister(resume: true) } }
                }
                Section {
                    Button(cleared ? "Cache Cleared" : "Clear Cache") { clearCache() }.disabled(cleared)
                } footer: { Text("Reloads the pages and album art from the house. You stay signed in.") }
                Section {
                    Button("Sign Out", role: .destructive) { HouseWebView.forgetStill(); dismiss(); Task { await model.signOut() } }
                    Button("Forget This Mantel", role: .destructive) { HouseWebView.forgetStill(); dismiss(); Task { await model.forgetHouse() } }
                }
            }
            .navigationTitle("Mantel App")
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
    }

    /// The web view's data (its next page gets a new web session), saved covers, URL caches; then fresh widgets.
    /// Never the house, its pin, the device key or the sign-in: those are the Keychain's, not a cache.
    private func clearCache() {
        if let house = model.house { HouseWebView.forgetData(for: house) }
        ArtCache.clear()
        URLCache.shared.removeAllCachedResponses()
        cleared = true
        NotificationRouter.shared.open = "/home"
        Task { await model.refresh() }
    }
}
