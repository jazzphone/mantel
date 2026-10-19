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

    func register(client: MantelClient) async {
        self.client = client
        await requestAndRegister()
    }

    func requestAndRegister() async {
        let ok = (try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge])) ?? false
        print("Mantel push: notifications allowed: \(ok)")
        guard ok else { return }
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
            try await client.registerPush(token: token, key: NotificationKey.publicKey(), sandbox: sandbox)
            lastError = nil
            print("Mantel push: registered with the house")
        } catch {
            lastError = error.localizedDescription
            print("Mantel push: registration failed: \(error)")
        }
    }

    func didFail(_ error: Error) async {
        lastError = error.localizedDescription
        print("Mantel push: APNs registration failed: \(error)")
    }
}
