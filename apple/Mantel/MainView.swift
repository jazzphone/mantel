import MantelKit
import SwiftUI

/// The house's own screens and Mantel Settings, in a web view (§1), as a native app (docs/phase10/NATIVE-FEEL.md):
///
/// * one menu: the page's own (HK's menu, the tab bar's More), with "Mantel App" opening the app's settings;
/// * the music's Now Playing is the app's own player (`NowPlayingSheet`), from the page's mini player, the playing
///   bar, the Live Activity (`mantel://player`) and the widgets;
/// * nothing white on open: the last page's still, then the page once it has drawn;
/// * the status bar's ink follows the page's ground;
/// * the app's own settings are never out of reach, even when the page does not come: the ⋯ button 3 s into a load
///   that has not drawn, and "Can’t Reach Mantel" (`TroubleView`) when it fails or takes 15 s. A failed load is
///   tried again once, quietly, before saying anything; then again in the background (2, 4, 8, 16, 30 s…) until
///   the page draws, which takes the place of the message by itself.
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
    // GETTING THROUGH
    /// The page asked for last (tried again as it was).
    @State private var asked = "/home"
    /// 3 s into a load with no page yet: the ⋯ button.
    @State private var waited = false
    /// Why the page has not come, on screen.
    @State private var trouble: String?
    /// Failed loads in a row since the page last drew.
    @State private var failures = 0
    /// The person pressed Try Again: its button waits for the answer.
    @State private var trying = false
    @State private var watch: Task<Void, Never>?
    @State private var retry: Task<Void, Never>?

    var body: some View {
        ZStack {
            // the page's own ground (#05070e; a light page's, light): also the bands beside a page kept clear of a
            // camera at the side
            (lightPage ? Color(uiColor: .systemBackground) : Color(red: 0.02, green: 0.03, blue: 0.055)).ignoresSafeArea()
            if !ready {
                // the still only where it fits: one taken on the Duo's other display, or an iPad turned or in another
                // window size since, would show the wrong page's layout
                GeometryReader { g in
                    if let still, Self.fits(still, g.size) {
                        Image(uiImage: still).resizable().scaledToFill().frame(width: g.size.width, height: g.size.height).clipped()
                    } else if trouble == nil {
                        ProgressView().tint(.white).controlSize(.large).frame(maxWidth: .infinity, maxHeight: .infinity)
                    }
                }
                .ignoresSafeArea(edges: .vertical)
            }
            if let start {
                HouseWebView(start: start, house: model.house!, onSessionEnded: { next in
                    Task { await load(next) }       // the web session ended: hand the web view a new one
                }, onEvent: handle)
                // under the status bar and the home indicator (the page pads itself by env(safe-area-inset-top and
                // -bottom)), but not under a camera at the side: the Duo's outer display has it at its right edge,
                // a phone turned has its Dynamic Island there, and HK's pages do not pad their sides
                .ignoresSafeArea(edges: .vertical)
                .id(start)
                .opacity(ready ? 1 : 0)
            }
            if let trouble, !ready {
                Color.black.opacity(0.45).ignoresSafeArea()
                TroubleView(address: address, reason: trouble, trying: trying,
                            tryAgain: tryAgain, settings: { showMenu = true })
                .transition(.opacity.combined(with: .scale(scale: 0.97)))
            }
        }
        .overlay(alignment: .topTrailing) {
            // the page's menu holds the app's settings once it has drawn; until then, and on a page without the
            // app's hooks, this button does
            if (ready && !pageHooks) || (!ready && waited && trouble == nil) {
                Button { showMenu = true } label: {
                    // plain to see over a still, a spinner or a page of any colour
                    Image(systemName: "ellipsis").font(.body.weight(.semibold)).foregroundStyle(.primary)
                        .frame(width: 36, height: 36)
                        .background(.regularMaterial, in: Circle())
                        .contentShape(Circle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Mantel App Settings")
                .hoverEffect(.highlight)
                .padding(.trailing, 12).padding(.top, 4)
                .transition(.opacity)
            }
        }
        .preferredColorScheme(lightPage ? .light : .dark)
        // a form sheet in a regular-width window (iPad, the open Duo turned), a full-height sheet on a phone's width
        .sheet(isPresented: $showMenu) { AppMenu().presentationSizing(.form) }
        .sheet(isPresented: $showPlayer) { NowPlayingSheet().presentationSizing(.form) }
        .task {
            if router.player { router.player = false; openPlayer() }       // opened by the Live Activity, cold
            if router.menu { router.menu = false; showMenu = true }         // the Home Screen's App Settings, cold
            #if DEBUG
            switch UserDefaults.standard.string(forKey: "MantelOpen") {     // -MantelOpen player|settings
            case "player": openPlayer()
            case "settings": showMenu = true
            default: break
            }
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
            // ⌘, and the Home Screen's App Settings: whatever the page is doing
            if on { router.menu = false; if !showPlayer { showMenu = true } }
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .background, ready { HouseWebView.saveStill() }
            if phase == .active, trouble != nil { again(now: true) }       // back to the app: try at once
        }
    }

    private func handle(_ e: HouseWebView.WebEvent) {
        switch e {
        case .ready:
            watch?.cancel(); retry?.cancel()
            failures = 0
            trying = false
            waited = false
            withAnimation(.easeOut(duration: 0.2)) { ready = true; trouble = nil }
        case .menu: showMenu = true
        case .player: openPlayer()
        case .tone(let light): lightPage = light; pageHooks = true
        case .failed(let why): failed(why)
        case .lost:
            ready = false
            startWatch()
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

    /// Where the house is, as the person typed or scanned it: the home network's address, and the one from away.
    private var address: String {
        let h = model.house
        let parts = [h?.local, h?.remote].compactMap { $0 }.map { u in u.host.map { $0 + (u.port.map { ":\($0)" } ?? "") } ?? "" }
        return parts.isEmpty ? (h?.name ?? "") : parts.joined(separator: " · ")
    }

    private func load(_ next: String) async {
        asked = next
        startWatch()
        guard let client = model.client else { return }
        do {
            let url = try await client.webSessionURL(next: next)
            loadedDoor = model.door
            if url != start { ready = false }
            start = url
        } catch {
            if Task.isCancelled || (error as? URLError)?.code == .cancelled { return }
            failed(HouseWebView.reason(error))
        }
    }

    /// 3 s without a page: the ⋯ button. 15 s: say so (the page may still come; it takes the message's place).
    private func startWatch() {
        watch?.cancel()
        watch = Task { @MainActor in
            try? await Task.sleep(for: .seconds(3))
            guard !Task.isCancelled, !ready else { return }
            withAnimation { waited = true }
            try? await Task.sleep(for: .seconds(12))
            guard !Task.isCancelled, !ready, trouble == nil else { return }
            withAnimation { trouble = "It’s taking too long to answer." }
        }
    }

    /// A load that failed: once, tried again in a second without a word (a brief hiccup never shows); after that the
    /// reason is on screen and the app keeps trying, further apart.
    private func failed(_ why: String) {
        guard !ready else { return }
        failures += 1
        trying = false
        if failures >= 2 { withAnimation { trouble = why } }
        again(after: failures == 1 ? 1 : min(30, pow(2, Double(failures - 1))))
    }

    private func again(now: Bool = false, after delay: Double = 0) {
        retry?.cancel()
        retry = Task { @MainActor in
            if !now { try? await Task.sleep(for: .seconds(delay)) }
            guard !Task.isCancelled, !ready else { return }
            await load(asked)
        }
    }

    private func tryAgain() {
        trying = true
        failures = max(failures, 1)          // the person asked: the next failure says so at once
        again(now: true)
    }
}

/// The page did not come: calm and native, with the way out. Over the last page's still, in the middle of the window
/// (inside the safe area: the Duo's cutouts, an iPad's Stage Manager window).
struct TroubleView: View {
    let address: String
    let reason: String
    let trying: Bool
    let tryAgain: () -> Void
    let settings: () -> Void

    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: "wifi.exclamationmark").font(.system(size: 40, weight: .medium)).foregroundStyle(.secondary)
                .padding(.bottom, 2)
            Text("Can’t Reach Mantel").font(.title2.bold())
            if !address.isEmpty {
                Text(address).font(.callout.monospaced()).foregroundStyle(.secondary).lineLimit(2)
                    .multilineTextAlignment(.center)
            }
            Text(reason).multilineTextAlignment(.center).foregroundStyle(.secondary)
            VStack(spacing: 10) {
                Button(action: tryAgain) {
                    ZStack {
                        Text("Try Again").opacity(trying ? 0 : 1)
                        if trying { ProgressView() }
                    }
                    .frame(maxWidth: .infinity).padding(.vertical, 4)
                }
                .buttonStyle(.borderedProminent)
                .disabled(trying)
                Button(action: settings) {
                    Text("App Settings").frame(maxWidth: .infinity).padding(.vertical, 4)
                }
                .buttonStyle(.bordered)
            }
            .padding(.top, 8)
            Text("Mantel keeps trying, and opens as soon as it answers.")
                .font(.footnote).foregroundStyle(.secondary).multilineTextAlignment(.center)
                .padding(.top, 2)
        }
        .padding(28)
        .frame(maxWidth: 380)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 28, style: .continuous))
        .padding(20)
        .environment(\.colorScheme, .dark)
        .accessibilityElement(children: .contain)
    }
}

/// The app's own settings: Mantel Settings, favorites for the widgets and Control Center, Face ID, notifications,
/// clearing the cache, signing out.
struct AppMenu: View {
    @EnvironmentObject private var model: SessionModel
    @Environment(\.dismiss) private var dismiss
    @State private var faceID = SharedStore.shared.requireFaceID
    @State private var cleared = false

    /// Mantel does not answer now (no way in from here): the rows that need it say so.
    private var offline: Bool { model.door == nil }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    LabeledContent("Mantel", value: model.house?.name ?? "")
                    LabeledContent("Signed In As", value: model.user?.displayName ?? "")
                    LabeledContent("Connected", value: model.door == .lan ? "Home Network" : model.door == .tunnel ? "Away" : "Not Connected")
                    if let a = model.house?.local { LabeledContent("At Home", value: a.host ?? "") }
                    if let a = model.house?.remote { LabeledContent("Away", value: a.host ?? "") }
                }
                Section {
                    Button { dismiss(); NotificationRouter.shared.open = "/settings" } label: {
                        Label("Mantel Settings", systemImage: "gearshape")
                    }
                } footer: {
                    // everything here is the app's own and works without the house; these two rows need it to answer
                    Text("Users, screens, wall tablets and everything else about this Mantel."
                         + (offline ? " They open once Mantel answers again." : ""))
                }
                Section {
                    NavigationLink("Favorites") { FavoritesEditor() }
                } footer: {
                    Text("Your favorites show in the widgets, Control Center, Siri and on the Mac."
                         + (offline ? " Mantel keeps the list: changing it needs Mantel to answer." : ""))
                }
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
