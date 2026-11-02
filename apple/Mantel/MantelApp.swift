import AppIntents
import MantelKit
import SwiftUI
import UserNotifications

/// Mantel for iPhone and iPad (docs/phase10/APPLE-APPS.md): a native shell around Mantel's own web pages. Native
/// code only where the system needs it: sign-in, the Keychain and Secure Enclave, push, the Lock Screen's music,
/// widgets, Control Center and Siri. The house decides everything.
@main
struct MantelApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var delegate
    @StateObject private var model = SessionModel()
    @StateObject private var music = MusicModel()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(model)
                .environmentObject(music)
                .onOpenURL { url in
                    if let link = PairingLink(url: url) { Task { await model.pair(link) } }
                    else if url.scheme == "mantel", url.host == "player" { NotificationRouter.shared.player = true }
                    else if url.scheme == "mantel", url.host == "settings" { NotificationRouter.shared.menu = true }
                }
                #if DEBUG
                // -MantelPair '<mantel://pair link>': pair a Debug build without `simctl openurl`'s "Open in Mantel?"
                // (a script driving several Simulators); only while it is not paired yet
                .task {
                    if model.house == nil, let s = UserDefaults.standard.string(forKey: "MantelPair"),
                       let url = URL(string: s), let link = PairingLink(url: url) { await model.pair(link) }
                }
                #endif
        }
        // a hardware keyboard (iPad, a keyboard on the Duo): hold ⌘ to see them
        .commands {
            CommandGroup(replacing: .appSettings) {
                Button("Mantel App Settings…") { NotificationRouter.shared.menu = true }.keyboardShortcut(",")
            }
            CommandGroup(after: .toolbar) {
                Button("Reload Page") { HouseWebView.reloadLive() }.keyboardShortcut("r")
            }
        }
    }
}

final class AppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    func application(_ application: UIApplication,
                     didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        let center = UNUserNotificationCenter.current()
        center.delegate = self
        // the notification's actions (§5): open the accessory. (Mute 1 Hour is not built: its button was shown and did
        // nothing, the third audit pass, 2026-11-01; docs/guide/iPhone-and-Mac-Apps.md "Not built yet")
        let open = UNNotificationAction(identifier: "OPEN", title: "Open", options: [.foreground])
        center.setNotificationCategories([UNNotificationCategory(identifier: "MANTEL_ACCESSORY", actions: [open],
                                                                 intentIdentifiers: [], options: [])])
        return true
    }

    /// The Home Screen's quick action (Config/Mantel-Info.plist UIApplicationShortcutItems): App Settings, even when
    /// the page cannot load. Cold, it comes with the scene; warm, to the scene's delegate.
    static let settingsShortcut = "app.mantel.settings"

    func application(_ application: UIApplication, configurationForConnecting session: UISceneSession,
                     options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        if options.shortcutItem?.type == Self.settingsShortcut {
            Task { @MainActor in NotificationRouter.shared.menu = true }
        }
        let config = UISceneConfiguration(name: nil, sessionRole: session.role)
        config.delegateClass = SceneDelegate.self
        return config
    }

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        Task { await PushRegistrar.shared.didRegister(token: deviceToken) }
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        // the Simulator, or no push entitlement yet (no developer account, M10-6): simulated pushes still work
        Task { await PushRegistrar.shared.didFail(error) }
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification) async
        -> UNNotificationPresentationOptions {
        // A sealed notification the extension did not open (the Simulator's `simctl push` never starts the
        // Notification Service Extension): open it here, in the app, and show the real words instead.
        let info = notification.request.content.userInfo
        if info["mantel_opened"] == nil, let sealed = SealedNotification(userInfo: info),
           let opened = try? sealed.open(with: NotificationKey.load()) {
            let c = UNMutableNotificationContent()
            c.title = opened.title
            c.body = opened.body ?? ""
            c.sound = .default
            c.interruptionLevel = opened.important == true ? .timeSensitive : .active
            c.categoryIdentifier = notification.request.content.categoryIdentifier
            c.userInfo = ["mantel_opened": true, "mantel_url": opened.url ?? "/home", "mantel_entity": opened.entity ?? ""]
            if let tag = opened.tag { c.threadIdentifier = tag }
            try? await center.add(UNNotificationRequest(identifier: notification.request.identifier + ".opened", content: c, trigger: nil))
            return []
        }
        return [.banner, .list, .sound]
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async {
        let info = response.notification.request.content.userInfo
        if let url = info["mantel_url"] as? String {
            await MainActor.run { NotificationRouter.shared.open = url }
        }
    }
}

/// Only for the quick action with the app already running (SwiftUI keeps the window; the rest is SwiftUI's).
final class SceneDelegate: NSObject, UIWindowSceneDelegate {
    func windowScene(_ windowScene: UIWindowScene, performActionFor shortcutItem: UIApplicationShortcutItem,
                     completionHandler: @escaping (Bool) -> Void) {
        let ours = shortcutItem.type == AppDelegate.settingsShortcut
        if ours { Task { @MainActor in NotificationRouter.shared.menu = true } }
        completionHandler(ours)
    }
}

/// Where a tapped notification asks the web view to go.
@MainActor
final class NotificationRouter: ObservableObject {
    static let shared = NotificationRouter()
    @Published var open: String?
    /// The app's own music player, asked for from outside the page (the Live Activity, a widget).
    @Published var player = false
    /// The app's own settings (⌘,).
    @Published var menu = false
}

struct MantelShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(intent: MusicControlIntent(.playPause, speaker: nil),
                    phrases: ["Pause the music in \(.applicationName)", "Play the music in \(.applicationName)"],
                    shortTitle: "Play or Pause", systemImageName: "playpause.fill")
        AppShortcut(intent: MusicControlIntent(.next, speaker: nil),
                    phrases: ["Next song in \(.applicationName)"], shortTitle: "Next Track", systemImageName: "forward.fill")
        AppShortcut(intent: SetAccessoryIntent(),
                    phrases: ["Turn on \(\.$accessory) in \(.applicationName)", "Switch \(\.$accessory) with \(.applicationName)"],
                    shortTitle: "Turn On or Off", systemImageName: "lightswitch.on")
    }
}
