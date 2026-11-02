import MantelKit
import UserNotifications

/// Opens the house's sealed notifications on the Mac (docs/phase14/SYSTEM-ALERTS.md slice 14.10; the iPhone's is
/// MantelNotificationService). Apple carried only "Mantel / New notification" and ciphertext (`m`, apns.py); the
/// words, the thread, how it interrupts and the snapshot's id are opened here with this Mac's own notification key,
/// which the app made and keeps in the shared Keychain group (the team-signed build; a Mac signed to run locally has
/// no such group, so the key here is not the app's and the notification stays as Apple carried it).
final class NotificationService: UNNotificationServiceExtension {
    private var content: UNMutableNotificationContent?
    private var deliver: ((UNNotificationContent) -> Void)?

    override func didReceive(_ request: UNNotificationRequest, withContentHandler handler: @escaping (UNNotificationContent) -> Void) {
        deliver = handler
        guard let best = request.content.mutableCopy() as? UNMutableNotificationContent else { return handler(request.content) }
        content = best
        guard let sealed = SealedNotification(userInfo: request.content.userInfo),
              let opened = try? sealed.open(with: NotificationKey.load()) else {
            return handler(best)           // not ours, or not for this Mac: shown as Apple carried it
        }
        best.title = opened.title
        best.body = opened.body ?? ""
        if let thread = opened.thread { best.threadIdentifier = thread }
        switch opened.interruption {    // a system alert by its level (docs/phase14/SYSTEM-ALERTS.md)
        case .passive: best.interruptionLevel = .passive
        case .active: best.interruptionLevel = .active
        case .timeSensitive: best.interruptionLevel = .timeSensitive
        }
        best.userInfo["mantel_opened"] = true
        if let url = opened.url { best.userInfo["mantel_url"] = url }
        if let entity = opened.entity { best.userInfo["mantel_entity"] = entity }
        guard let snap = opened.snap, let client = SharedStore.shared.client() else { return handler(best) }
        Task {
            if let data = try? await client.snapshot(snap) {
                let file = FileManager.default.temporaryDirectory.appendingPathComponent(snap + ".jpg")
                if (try? data.write(to: file)) != nil,
                   let a = try? UNNotificationAttachment(identifier: "snapshot", url: file, options: nil) {
                    best.attachments = [a]
                }
            }
            handler(best)
        }
    }

    override func serviceExtensionTimeWillExpire() {
        if let content, let deliver { deliver(content) }
    }
}
