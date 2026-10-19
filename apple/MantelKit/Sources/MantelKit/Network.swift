import Foundation
import Network

/// Calls `onChange` when the device's network changes (Wi-Fi to cellular, a new Wi-Fi), so the app can probe its
/// house's local address again and switch doors (docs/phase10/APPLE-APPS.md §4).
public final class NetworkWatcher: @unchecked Sendable {
    private let monitor = NWPathMonitor()
    private let queue = DispatchQueue(label: "app.mantel.network")
    private var last: String?

    public init() {}

    public func start(_ onChange: @escaping @Sendable (_ onWiFi: Bool) -> Void) {
        monitor.pathUpdateHandler = { [weak self] path in
            guard let self else { return }
            let key = "\(path.status)-\(path.availableInterfaces.map { $0.name }.joined(separator: ","))"
            guard key != self.last else { return }
            self.last = key
            onChange(path.usesInterfaceType(.wifi) || path.usesInterfaceType(.wiredEthernet))
        }
        monitor.start(queue: queue)
    }

    public func stop() { monitor.cancel() }
}

/// Mantel houses announced on this network (`_mantel._tcp`, Mantel Link's announcement, phase 9). Discovery only
/// suggests: the sign-in (or comparing the six digits) confirms which house it is.
public final class HouseBrowser: @unchecked Sendable {
    public struct Found: Hashable, Identifiable, Sendable {
        public var id: String { url.absoluteString }
        public let name: String
        public let url: URL
    }

    private var browser: NWBrowser?
    private let queue = DispatchQueue(label: "app.mantel.bonjour")

    public init() {}

    public func start(_ onResults: @escaping @Sendable ([Found]) -> Void) {
        let b = NWBrowser(for: .bonjourWithTXTRecord(type: "_mantel._tcp", domain: nil), using: .tcp)
        b.browseResultsChangedHandler = { results, _ in
            var out: [Found] = []
            for r in results {
                guard case .service(let name, _, _, _) = r.endpoint,
                      case .bonjour(let txt) = r.metadata,
                      let s = txt["url"], let url = PairingLink.httpsURL(s) else { continue }
                out.append(Found(name: name, url: url))
            }
            onResults(out)
        }
        b.start(queue: queue)
        browser = b
    }

    public func stop() {
        browser?.cancel()
        browser = nil
    }
}
