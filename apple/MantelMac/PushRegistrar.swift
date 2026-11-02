import AppKit
import MantelKit
import Security
import UserNotifications

/// Notifications from the house on the Mac (docs/phase14/SYSTEM-ALERTS.md slice 14.10; the iPhone's is
/// Mantel/PushRegistrar.swift): the APNs device token and this Mac's notification key go to the house
/// (`/api/app/push/register`); the house seals each notification to that key and MantelMacNotificationService opens it.
///
/// Remote notifications need the push entitlement (`com.apple.developer.aps-environment`), which only the team-signed
/// build carries (Config/MacTeam.entitlements; a Mac signed to run locally cannot). Without it nothing is asked and
/// nothing is registered, and the menu says so; the rest of the app works as before.
@MainActor
final class PushRegistrar: ObservableObject {
    static let shared = PushRegistrar()

    enum Status: Equatable {
        case unknown                  // not tried yet (not signed in)
        case needsSignedBuild         // this build has no push entitlement
        case denied                   // notifications are off for Mantel in System Settings
        case registering
        case on                       // registered with the house
        case stopped                  // stopped in Mantel Settings: only Turn On Notifications registers again
        case failed(String)
    }
    @Published private(set) var status: Status

    private var client: MantelClient?
    /// The person chose Turn On Notifications: register even if they stopped this app in Mantel Settings.
    private var resume = false

    init() { status = Self.apsEnvironment == nil ? .needsSignedBuild : .unknown }

    /// "development" or "production": what this build was signed with, nil without the push entitlement.
    nonisolated static var apsEnvironment: String? {
        guard let task = SecTaskCreateFromSelf(nil),
              let value = SecTaskCopyValueForEntitlement(task, "com.apple.developer.aps-environment" as CFString, nil)
        else { return nil }
        return value as? String
    }

    func register(client: MantelClient) async {
        self.client = client
        await requestAndRegister()
    }

    func requestAndRegister(resume: Bool = false) async {
        if resume { self.resume = true }
        guard Self.apsEnvironment != nil else { status = .needsSignedBuild; return }
        #if DEBUG
        // -MantelNoPush YES: never ask (a script driving the app has no finger for the system's prompt)
        if !resume, UserDefaults.standard.bool(forKey: "MantelNoPush") { return }
        #endif
        let ok = (try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge])) ?? false
        NSLog("Mantel push: notifications allowed: %@", ok ? "yes" : "no")
        guard ok else { status = .denied; return }
        status = .registering
        NSApplication.shared.registerForRemoteNotifications()
    }

    func didRegister(token: Data) async {
        guard let client = client ?? SharedStore.shared.client() else { status = .unknown; return }
        // the entitlement says which Apple service gave this token: the sandbox's for a development-signed build
        let sandbox = Self.apsEnvironment == "development"
        do {
            let done = try await client.registerPush(token: token, key: NotificationKey.publicKey(), sandbox: sandbox,
                                                     resume: resume, platform: "mac")
            resume = false
            status = done ? .on : .stopped
            NSLog("Mantel push: %@", done ? "registered with the house" : "stopped in Mantel Settings; not registering")
        } catch {
            status = .failed(error.localizedDescription)
            NSLog("Mantel push: registration failed: %@", error.localizedDescription)
        }
    }

    func didFail(_ error: Error) async {
        status = .failed(error.localizedDescription)
        NSLog("Mantel push: APNs registration failed: %@", error.localizedDescription)
    }

    /// System Settings → Notifications, for a Mac whose person said no (the system asks only once).
    static func openSystemSettings() {
        if let url = URL(string: "x-apple.systempreferences:com.apple.Notifications-Settings.extension") {
            NSWorkspace.shared.open(url)
        }
    }
}

/// What the notification center asks of the app: show a notification while the app is in front (opening a sealed one
/// here if the extension did not), and open the place a tapped one is for, in the browser as "Open Mantel in the
/// Browser" does (a web session on the house, then the path).
final class NotificationHandler: NSObject, UNUserNotificationCenterDelegate {
    static let shared = NotificationHandler()
    /// Opens a path on the house in the browser (the AppDelegate sets it).
    @MainActor var open: ((String) async -> Void)?

    func install() {
        let center = UNUserNotificationCenter.current()
        center.delegate = self
        // the accessory notification's action (§5): open it
        let open = UNNotificationAction(identifier: "OPEN", title: "Open", options: [.foreground])
        center.setNotificationCategories([UNNotificationCategory(identifier: "MANTEL_ACCESSORY", actions: [open],
                                                                 intentIdentifiers: [], options: [])])
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification) async
        -> UNNotificationPresentationOptions {
        // A sealed notification the extension did not open (an extension that never ran, or a Mac signed to run
        // locally): open it here and show the real words instead.
        let info = notification.request.content.userInfo
        if info["mantel_opened"] == nil, let sealed = SealedNotification(userInfo: info),
           let opened = try? sealed.open(with: NotificationKey.load()) {
            let c = UNMutableNotificationContent()
            c.title = opened.title
            c.body = opened.body ?? ""
            c.sound = .default
            switch opened.interruption {
            case .passive: c.interruptionLevel = .passive
            case .active: c.interruptionLevel = .active
            case .timeSensitive: c.interruptionLevel = .timeSensitive
            }
            c.categoryIdentifier = notification.request.content.categoryIdentifier
            c.userInfo = ["mantel_opened": true, "mantel_url": opened.url ?? "/home", "mantel_entity": opened.entity ?? ""]
            if let thread = opened.thread { c.threadIdentifier = thread }
            try? await center.add(UNNotificationRequest(identifier: notification.request.identifier + ".opened", content: c, trigger: nil))
            return []
        }
        return [.banner, .list, .sound]
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async {
        let info = response.notification.request.content.userInfo
        var path = info["mantel_url"] as? String
        if path == nil, let sealed = SealedNotification(userInfo: info),
           let opened = try? sealed.open(with: NotificationKey.load()) { path = opened.url }
        // only a path on the house (the web session refuses anything else too)
        let target = path.flatMap { $0.hasPrefix("/") && !$0.hasPrefix("//") ? $0 : nil } ?? "/home"
        let open = await MainActor.run { NotificationHandler.shared.open }
        await open?(target)
    }
}
