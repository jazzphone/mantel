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
                }
        }
    }
}

final class AppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    func application(_ application: UIApplication,
                     didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        let center = UNUserNotificationCenter.current()
        center.delegate = self
        // the notification's actions (§5): open the accessory, mute it for an hour (the Notifier's mutes)
        let open = UNNotificationAction(identifier: "OPEN", title: "Open", options: [.foreground])
        let mute = UNNotificationAction(identifier: "MUTE_HOUR", title: "Mute 1 Hour", options: [])
        center.setNotificationCategories([UNNotificationCategory(identifier: "MANTEL_ACCESSORY", actions: [open, mute],
                                                                 intentIdentifiers: [], options: [])])
        return true
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

/// Where a tapped notification asks the web view to go.
@MainActor
final class NotificationRouter: ObservableObject {
    static let shared = NotificationRouter()
    @Published var open: String?
    /// The app's own music player, asked for from outside the page (the Live Activity, a widget).
    @Published var player = false
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
