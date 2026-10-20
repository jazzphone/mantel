import AuthenticationServices
import Foundation
import MantelKit
import SwiftUI
#if os(iOS)
import UIKit
#else
import AppKit
#endif

/// The app's state for its house: setup, sign-in, the door it is on, the summary (shared by the iPhone/iPad app
/// and the Mac menu bar app). The house decides everything; this only asks (docs/phase10/APPLE-APPS.md §2-§4).
@MainActor
final class SessionModel: NSObject, ObservableObject {
    enum Phase: Equatable { case setup, signIn, ready }

    @Published private(set) var phase: Phase = .setup
    @Published private(set) var house: House?
    @Published private(set) var user: AppUser?
    @Published private(set) var door: Door?
    @Published private(set) var summary: Summary?
    @Published var problem: String?
    @Published var busy = false
    /// A house found by a typed address or Bonjour, waiting for the person to compare its six digits.
    @Published var pending: House?
    @Published var pendingCode: String?

    private(set) var client: MantelClient?
    private let store = SharedStore.shared
    private let network = NetworkWatcher()
    private var authSession: ASWebAuthenticationSession?

    override init() {
        super.init()
        if let h = store.currentHouse {
            use(h)
            Task { await self.resume() }
        }
        network.start { [weak self] _ in Task { @MainActor in await self?.reconnect() } }
    }

    private func use(_ h: House) {
        house = h
        client = MantelClient(house: h)
    }

    func resume() async {
        guard let client else { return }
        if await client.isSignedIn {
            user = await client.credential?.user
            phase = .ready
            await reconnect()
            await PushRegistrar.shared.register(client: client)   // Apple's token may change; the house's mode too
        } else {
            phase = .signIn
        }
    }

    /// The network changed (or the app came back): probe the local address first, then the remote one.
    func reconnect() async {
        guard let client, phase == .ready else { return }
        do {
            door = try await client.connect()
            await saveHouse()
            await refresh()
        } catch {
            door = nil
            problem = error.localizedDescription
        }
    }

    private func saveHouse() async {
        guard let client else { return }
        let h = await client.house
        house = h
        store.save(h)
    }

    func refresh() async {
        guard let client, let h = house else { return }
        do {
            let s = try await client.summary()
            summary = s
            store.setSummary(s, for: h)
            reloadWidgets()
            await MusicActivityController.shared.follow(s.now_playing, house: h)
        } catch let e as APIError where e.status == 401 {
            phase = .signIn
        } catch {
            problem = error.localizedDescription
            NSLog("Mantel: summary failed: %@", error.localizedDescription)
        }
    }

    // MARK: - setup

    /// A scanned or tapped `mantel://pair` link: the house, pinned, and a code that signs this device in.
    func pair(_ link: PairingLink) async {
        busy = true
        defer { busy = false }
        use(link.house)
        do {
            guard let client else { return }
            try await client.connect()
            let cred = try await client.redeem(pairingCode: link.code, device: DeviceInfo.current)
            user = cred.user
            await saveHouse()
            phase = .ready
            problem = nil
            await reconnect()
            await PushRegistrar.shared.register(client: client)
        } catch {
            problem = error.localizedDescription
            phase = .signIn
            await saveHouse()
        }
    }

    /// A typed address or a discovered house: ask it who it is; the person compares the six digits before signing in.
    func lookUp(_ address: String) async {
        let text = address.contains("://") ? address : "https://" + address
        guard let url = PairingLink.httpsURL(text) else {
            problem = "Use the address you open Mantel at, starting with https://."
            return
        }
        busy = true
        defer { busy = false }
        do {
            var req = URLRequest(url: url.appending(path: "api/app/hello"))
            req.timeoutInterval = 8
            let (data, _) = try await URLSession.shared.data(for: req)
            let hello = try JSONDecoder().decode(Hello.self, from: data)
            guard hello.service == "mantel" else { throw APIError(error: "not_mantel", message: "That is not a Mantel.") }
            let local = hello.addresses.local.flatMap(PairingLink.httpsURL)
            let remote = hello.addresses.remote.flatMap(PairingLink.httpsURL)
            pending = House(name: hello.name, local: local ?? (hello.door == "lan" ? url : nil),
                            remote: remote ?? (hello.door == "lan" ? nil : url), fingerprint: hello.fingerprint)
            pendingCode = House.shortCode(hello.fingerprint)
            problem = nil
        } catch {
            problem = (error as? APIError)?.localizedDescription ?? "Can’t reach Mantel at that address."
        }
    }

    func confirmPending() {
        guard let h = pending else { return }
        use(h)
        store.save(h)
        pending = nil
        pendingCode = nil
        phase = .signIn
    }

    // MARK: - signing in (Mantel's own /login in ASWebAuthenticationSession: passkeys use the house's own domain)

    func signIn() async {
        guard let client else { return }
        busy = true
        defer { busy = false }
        do {
            try await client.connect()
            let pkce = PKCE()
            let state = Base64URL.encode(Data.random(count: 16))
            let url = try await client.authorizeURL(pkce: pkce, state: state, deviceName: DeviceInfo.current.name)
            let callback = try await webAuth(url)
            let items = URLComponents(url: callback, resolvingAgainstBaseURL: false)?.queryItems ?? []
            guard items.first(where: { $0.name == "state" })?.value == state else { throw APIError(error: "bad_state") }
            if items.contains(where: { $0.name == "error" }) { return }        // the person pressed Cancel
            guard let code = items.first(where: { $0.name == "code" })?.value else { throw APIError(error: "no_code") }
            let cred = try await client.exchange(code: code, pkce: pkce, device: DeviceInfo.current)
            user = cred.user
            await saveHouse()
            phase = .ready
            problem = nil
            await reconnect()
            await PushRegistrar.shared.register(client: client)
        } catch let e as ASWebAuthenticationSessionError where e.code == .canceledLogin {
            return
        } catch {
            problem = error.localizedDescription
        }
    }

    private func webAuth(_ url: URL) async throws -> URL {
        try await withCheckedThrowingContinuation { cont in
            let s = ASWebAuthenticationSession(url: url, callback: .customScheme(MantelConfig.urlScheme)) { url, err in
                if let url { cont.resume(returning: url) } else { cont.resume(throwing: err ?? APIError(error: "cancelled")) }
            }
            s.presentationContextProvider = self
            s.prefersEphemeralWebBrowserSession = false     // the person's passkeys and Safari sign-in are welcome
            authSession = s
            s.start()
        }
    }

    func signOut() async {
        await MusicActivityController.shared.end()
        if let client { await client.signOut() }
        user = nil
        summary = nil
        phase = .signIn
        reloadWidgets()
    }

    func forgetHouse() async {
        await signOut()
        if let h = house { store.remove(h) }
        house = nil
        client = nil
        phase = .setup
    }

    // MARK: - acting

    func toggle(_ e: EntityState) async { await run(Command.toggle(e)) }

    func run(_ c: Command) async {
        guard let client else { return }
        do {
            try await client.run(c)
            try? await Task.sleep(for: .milliseconds(400))
            await refresh()
        } catch {
            problem = error.localizedDescription
        }
    }

    func webSessionURL(next: String = "/home") async -> URL? {
        guard let client else { return nil }
        do { return try await client.webSessionURL(next: next) } catch {
            if !Task.isCancelled && (error as? URLError)?.code != .cancelled { problem = error.localizedDescription }
            return nil
        }
    }

    private func reloadWidgets() {
        #if canImport(WidgetKit)
        WidgetCenterBridge.reload()
        #endif
    }
}

extension SessionModel: ASWebAuthenticationPresentationContextProviding {
    nonisolated func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        MainActor.assumeIsolated {
            #if os(iOS)
            let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
            return scenes.flatMap { $0.windows }.first { $0.isKeyWindow } ?? ASPresentationAnchor()
            #else
            return NSApp.keyWindow ?? NSApp.windows.first ?? ASPresentationAnchor()
            #endif
        }
    }
}

extension DeviceInfo {
    static var current: DeviceInfo {
        var sys = utsname()
        uname(&sys)
        let model = withUnsafeBytes(of: &sys.machine) { raw in
            String(decoding: raw.prefix { $0 != 0 }, as: UTF8.self)
        }
        #if os(iOS)
        let simModel = ProcessInfo.processInfo.environment["SIMULATOR_MODEL_IDENTIFIER"]
        return DeviceInfo(name: UIDevice.current.name, model: simModel ?? model,
                          platform: "\(UIDevice.current.systemName) \(UIDevice.current.systemVersion)")
        #else
        return DeviceInfo(name: Host.current().localizedName ?? "Mac", model: model,
                          platform: "macOS \(ProcessInfo.processInfo.operatingSystemVersionString)")
        #endif
    }
}

#if canImport(WidgetKit)
import WidgetKit
enum WidgetCenterBridge {
    static func reload() {
        WidgetCenter.shared.reloadAllTimelines()
        #if os(iOS)
        ControlCenter.shared.reloadAllControls()
        #endif
    }
}
#endif
