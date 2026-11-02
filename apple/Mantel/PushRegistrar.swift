import MantelKit
import UIKit
import UserNotifications

/// Notifications from the house (§5, slice 10.5): the APNs device token and this phone's notification key go to the
/// house (`/api/app/push/register`); the house seals each notification to that key, and the Notification Service
/// Extension opens it. Real pushes need the developer account's APNs key on the house (M10-6); in the Simulator
/// `xcrun simctl push` delivers sealed test notifications (apple/README.md).
@MainActor
final class PushRegistrar {
    static let shared = PushRegistrar()
    private var client: MantelClient?
    private(set) var lastError: String?
    /// The person chose Turn On Notifications: register even if they stopped this app in Mantel Settings.
    private var resume = false
    /// Whether this phone's notifications are on and registered with the house: the screens then leave the house's
    /// notifications to the phone (HouseWebView's bridge `notifications`; hk-notify.js draws no banner of its own).
    nonisolated static let onKey = "MantelPushOn"
    nonisolated static var isOn: Bool { UserDefaults.standard.bool(forKey: onKey) }
    private func setOn(_ on: Bool) { UserDefaults.standard.set(on, forKey: Self.onKey) }

    func register(client: MantelClient) async {
        self.client = client
        await requestAndRegister()
    }

    func requestAndRegister(resume: Bool = false) async {
        if resume { self.resume = true }
        #if DEBUG
        // -MantelNoPush YES: never ask (a script driving Simulators has no finger for the system's prompt)
        if !resume, UserDefaults.standard.bool(forKey: "MantelNoPush") { return }
        #endif
        let ok = (try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge])) ?? false
        print("Mantel push: notifications allowed: \(ok)")
        guard ok else { setOn(false); return }
        UIApplication.shared.registerForRemoteNotifications()
    }

    func didRegister(token: Data) async {
        guard let client = client ?? SharedStore.shared.client() else { return }
        #if DEBUG
        let sandbox = true
        #else
        let sandbox = false
        #endif
        do {
            let done = try await client.registerPush(token: token, key: NotificationKey.publicKey(), sandbox: sandbox,
                                                     resume: resume)
            resume = false
            lastError = nil
            setOn(done)
            print(done ? "Mantel push: registered with the house" : "Mantel push: stopped in Mantel Settings; not registering")
        } catch {
            lastError = error.localizedDescription
            print("Mantel push: registration failed: \(error)")
        }
    }

    func didFail(_ error: Error) async {
        lastError = error.localizedDescription
        setOn(false)
        print("Mantel push: APNs registration failed: \(error)")
    }
}
