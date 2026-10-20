import Foundation
import Security

/// Mantel's secrets in the Keychain: this device only, readable after the first unlock (so widgets and the
/// notification extension can use them), shared with the extensions through one access group. Never iCloud,
/// never UserDefaults, never a log (docs/phase10/APPLE-APPS.md §3 "Storage").
public struct Keychain: Sendable {
    public let service: String
    public let accessGroup: String?

    public init(service: String = "app.mantel.credentials", accessGroup: String? = MantelConfig.keychainGroup) {
        self.service = service
        self.accessGroup = accessGroup
    }

    private func query(_ account: String) -> [String: Any] {
        var q: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
                                kSecAttrService as String: service,
                                kSecAttrAccount as String: account,
                                kSecAttrSynchronizable as String: false]
        if let group = accessGroup {
            q[kSecAttrAccessGroup as String] = group
            #if os(macOS)
            // the Mac: the iOS-style keychain (access groups, no per-build "allow access" prompts); a build without the
            // group (signed to run locally) falls back to the login keychain below
            q[kSecUseDataProtectionKeychain as String] = true
            #endif
        }
        return q
    }

    @discardableResult
    public func set(_ data: Data?, for account: String) -> Bool {
        let q = query(account)
        SecItemDelete(q as CFDictionary)
        guard let data else { return true }
        var add = q
        add[kSecValueData as String] = data
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        var status = SecItemAdd(add as CFDictionary, nil)
        if status == errSecMissingEntitlement, accessGroup != nil {
            // a build without the shared access group (a plain Simulator run): this app's own Keychain
            return Keychain(service: service, accessGroup: nil).set(data, for: account)
        }
        if status == errSecDuplicateItem {
            status = SecItemUpdate(q as CFDictionary, [kSecValueData as String: data] as CFDictionary)
        }
        return status == errSecSuccess
    }

    public func data(for account: String) -> Data? {
        var q = query(account)
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: CFTypeRef?
        let status = SecItemCopyMatching(q as CFDictionary, &out)
        if status == errSecMissingEntitlement, accessGroup != nil {
            return Keychain(service: service, accessGroup: nil).data(for: account)
        }
        return status == errSecSuccess ? out as? Data : nil
    }

    public func codable<T: Decodable>(_ type: T.Type, for account: String) -> T? {
        data(for: account).flatMap { try? JSONDecoder().decode(T.self, from: $0) }
    }

    @discardableResult
    public func setCodable<T: Encodable>(_ value: T?, for account: String) -> Bool {
        set(value.flatMap { try? JSONEncoder().encode($0) }, for: account)
    }
}

/// Names shared by the app and its extensions (the App Group and the Keychain group).
public enum MantelConfig {
    /// The iPhone app and its extensions: `group.com.jazzphone.mantel`. The Mac (no extensions): the app's Info.plist
    /// "MantelAppGroup", its team-prefixed group, which macOS allows without a profile; a Mac build signed to run
    /// locally has none and keeps its own defaults.
    public static var appGroup: String {
        #if os(macOS)
        let g = Bundle.main.object(forInfoDictionaryKey: "MantelAppGroup") as? String
        return g.flatMap { $0.hasPrefix("com.") ? nil : $0 } ?? ""
        #else
        return "group.com.jazzphone.mantel"
        #endif
    }
    /// Set from the app's Info.plist ("MantelKeychainGroup": $(AppIdentifierPrefix)com.jazzphone.mantel.shared); nil uses the
    /// app's default group.
    public static var keychainGroup: String? {
        Bundle.main.object(forInfoDictionaryKey: "MantelKeychainGroup") as? String
    }
    public static let urlScheme = "mantel"
    public static let redirectURI = "mantel://auth"
    #if os(macOS)
    public static let clientID = "mantel-mac"
    #else
    public static let clientID = "mantel-ios"
    #endif
}
