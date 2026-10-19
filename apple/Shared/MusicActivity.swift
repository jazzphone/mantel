import ActivityKit
import Foundation
import ImageIO
import MantelKit
import SwiftUI
import UniformTypeIdentifiers

/// "Playing in the Living Room" on the Lock Screen and in the Dynamic Island, drawn like Apple Music's own player
/// (docs/phase10/APPLE-APPS.md §6). Music plays on the house's speakers, not the phone, so this is a Live Activity,
/// not the system's Now Playing (faking that with silent audio gets an app rejected).
struct MusicActivityAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable {
        var title: String
        var artist: String
        var album: String = ""
        var playing: Bool
        var volume: Double
        /// The cover, cached in the App Group (ArtCache), and a colour taken from it for the background.
        var artFile: String?
        var tint: String?
        /// The track's position at `positionAt`, and its length (for the progress bar and the times).
        var position: Double?
        var duration: Double?
        var positionAt: Date?

        /// The track's start and end as dates, when the house says where it is (a running progress bar).
        var span: ClosedRange<Date>? {
            guard let d = duration, d > 0, let p = position else { return nil }
            let start = (positionAt ?? .now).addingTimeInterval(-p)
            return start...start.addingTimeInterval(d)
        }
    }

    /// The speaker, by entity id (the buttons' target) and name.
    var speaker: String
    var room: String
}

extension MusicActivityAttributes.ContentState {
    init(_ p: EntityState, artFile: String?, tint: String?) {
        let a = p.attributes
        self.init(title: a?.media_title ?? "Music", artist: a?.media_artist ?? "", album: a?.media_album_name ?? "",
                  playing: p.state == "playing", volume: a?.volume_level ?? 0, artFile: artFile, tint: tint,
                  position: a?.media_position, duration: a?.media_duration, positionAt: a?.positionAt)
    }
}

/// Covers in the App Group, small enough for a Live Activity (which may only draw images it can read from disk),
/// with an average colour for the background, as Apple Music tints its player from the artwork.
enum ArtCache {
    static var folder: URL? {
        FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: MantelConfig.appGroup)?
            .appendingPathComponent("Art", isDirectory: true)
    }

    static func name(for ref: String) -> String {
        let h = ref.utf8.reduce(UInt64(1469598103934665603)) { ($0 ^ UInt64($1)) &* 1099511628211 }
        return String(h, radix: 16) + ".jpg"
    }

    static func url(_ name: String) -> URL? { folder?.appendingPathComponent(name) }

    /// Fetch (once per cover), shrink to 300 px and remember; returns the file's name and a tint.
    static func store(_ ref: String, using client: MantelClient) async -> (String, String)? {
        guard let dir = folder else { return nil }
        let name = name(for: ref)
        let file = dir.appendingPathComponent(name)
        let tintFile = dir.appendingPathComponent(name + ".tint")
        if let tint = try? String(contentsOf: tintFile, encoding: .utf8), FileManager.default.fileExists(atPath: file.path) {
            return (name, tint)
        }
        guard let data = try? await client.artwork(ref), let src = CGImageSourceCreateWithData(data as CFData, nil),
              let thumb = CGImageSourceCreateThumbnailAtIndex(src, 0, [kCGImageSourceCreateThumbnailFromImageAlways: true,
                                                                      kCGImageSourceThumbnailMaxPixelSize: 300,
                                                                      kCGImageSourceCreateThumbnailWithTransform: true] as CFDictionary)
        else { return nil }
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        guard let dest = CGImageDestinationCreateWithURL(file as CFURL, UTType.jpeg.identifier as CFString, 1, nil) else { return nil }
        CGImageDestinationAddImage(dest, thumb, [kCGImageDestinationLossyCompressionQuality: 0.85] as CFDictionary)
        guard CGImageDestinationFinalize(dest) else { return nil }
        let tint = averageHex(thumb)
        try? tint.write(to: tintFile, atomically: true, encoding: .utf8)
        return (name, tint)
    }

    static func averageHex(_ image: CGImage) -> String {
        var px = [UInt8](repeating: 0, count: 4)
        let ctx = CGContext(data: &px, width: 1, height: 1, bitsPerComponent: 8, bytesPerRow: 4,
                            space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
        ctx?.interpolationQuality = .medium
        ctx?.draw(image, in: CGRect(x: 0, y: 0, width: 1, height: 1))
        return String(format: "%02x%02x%02x", px[0], px[1], px[2])
    }
}

extension Color {
    /// A colour from "rrggbb", darkened so white text stays readable on it (Apple Music's tinted player).
    init(playerTint hex: String?) {
        guard let hex, hex.count == 6, let v = UInt32(hex, radix: 16) else {
            self = Color(white: 0.12)
            return
        }
        let k = 0.55
        self = Color(red: Double((v >> 16) & 0xff) / 255 * k, green: Double((v >> 8) & 0xff) / 255 * k,
                     blue: Double(v & 0xff) / 255 * k)
    }
}
