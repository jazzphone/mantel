import Foundation

/// Who may use the microphone in the app's web view (docs/phase17/INTERCOM.md, "The apps"): the paired house's own
/// https page, and nothing else. The Intercom sheet and the door's talk button listen through `getUserMedia`; the
/// web view asks the app, and the app answers from this one rule, so it can be tested without a web view.
public enum MediaPermission {
    /// True when a frame at `scheme://host:port` may record: the scheme is https, and it is the very origin (scheme, host
    /// and port) of one of the house's addresses. A page on plain http never gets the microphone, even on the house's
    /// own address, and neither does another host or another port. `port` is what WebKit reports: 0 (or nil) for the
    /// scheme's default.
    public static func allowsMicrophone(scheme: String, host: String, port: Int?, house addresses: [URL?]) -> Bool {
        guard scheme.lowercased() == "https", !host.isEmpty else { return false }
        let asked = (host.lowercased(), normalized(port))
        return addresses.compactMap { $0 }.contains { url in
            url.scheme?.lowercased() == "https" && url.host?.lowercased() == asked.0 && normalized(url.port) == asked.1
        }
    }

    private static func normalized(_ port: Int?) -> Int {
        guard let port, port != 0 else { return 443 }
        return port
    }
}
