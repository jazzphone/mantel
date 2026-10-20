import SwiftUI
#if canImport(AppKit)
import AppKit
#else
import UIKit
#endif

/// One of the house's icons (`hk:<name>` from its own set, or `mdi:<name>`), drawn as the house draws it: the SF Symbol
/// the house's glyph is made from (HKGlyphs, generated from the house's manifest), its own drawing for the few that
/// are not a symbol, else the nearest symbol the name spells, else `fallback`. A symbol this system lacks is never
/// drawn blank.
struct HouseGlyph: View {
    let icon: String?
    var fallback = "music.note.list"

    var body: some View {
        switch Self.resolve(icon, fallback: fallback) {
        case .symbol(let s): Image(systemName: s)
        case .path(let d): GlyphShape(data: d).aspectRatio(1, contentMode: .fit).frame(width: 15, height: 15)
        }
    }

    enum Drawing: Equatable { case symbol(String), path(String) }

    static func resolve(_ icon: String?, fallback: String) -> Drawing {
        let raw = icon ?? ""
        let name = raw.split(separator: ":", maxSplits: 1).last.map(String.init) ?? ""
        if raw.hasPrefix("hk:") {
            if let s = HKGlyphs.symbols[name], exists(s) { return .symbol(s) }
            if let p = HKGlyphs.paths[name] { return .path(p) }
        }
        // a name the set doesn't know (or a Material one): the symbol it spells, its filled one, then shorter
        var parts = name.split(separator: "-").map(String.init)
        while !parts.isEmpty {
            let s = parts.joined(separator: ".")
            for c in [s + ".fill", s] where exists(c) { return .symbol(c) }
            parts.removeLast()
        }
        return .symbol(fallback)
    }

    static func exists(_ symbol: String) -> Bool {
        #if canImport(AppKit)
        NSImage(systemSymbolName: symbol, accessibilityDescription: nil) != nil
        #else
        UIImage(systemName: symbol) != nil
        #endif
    }
}

/// SVG path data in a 24-unit box (absolute M L H V Q C Z, what the house's own drawings use), scaled to the frame.
struct GlyphShape: Shape {
    let data: String

    func path(in rect: CGRect) -> Path {
        let k = min(rect.width, rect.height) / 24
        func pt(_ x: CGFloat, _ y: CGFloat) -> CGPoint { CGPoint(x: rect.minX + x * k, y: rect.minY + y * k) }
        // the data as commands, each with its numbers
        var runs: [(Character, [CGFloat])] = []
        var token = ""
        func endNumber() {
            if let v = Double(token), !runs.isEmpty { runs[runs.count - 1].1.append(CGFloat(v)) }
            token = ""
        }
        for ch in data {
            if ch.isLetter && ch != "e" { endNumber(); runs.append((ch, [])) }
            else if ch == "," || ch == " " { endNumber() }
            else if ch == "-" && !token.isEmpty && token.last != "e" { endNumber(); token = "-" }
            else { token.append(ch) }
        }
        endNumber()

        var p = Path(), x: CGFloat = 0, y: CGFloat = 0
        for (cmd, n) in runs {
            var i = 0
            switch cmd {
            case "Z": p.closeSubpath()
            case "M", "L":
                while i + 2 <= n.count {
                    x = n[i]; y = n[i + 1]
                    if cmd == "M" && i == 0 { p.move(to: pt(x, y)) } else { p.addLine(to: pt(x, y)) }
                    i += 2
                }
            case "H": for v in n { x = v; p.addLine(to: pt(x, y)) }
            case "V": for v in n { y = v; p.addLine(to: pt(x, y)) }
            case "Q":
                while i + 4 <= n.count {
                    p.addQuadCurve(to: pt(n[i + 2], n[i + 3]), control: pt(n[i], n[i + 1]))
                    x = n[i + 2]; y = n[i + 3]; i += 4
                }
            case "C":
                while i + 6 <= n.count {
                    p.addCurve(to: pt(n[i + 4], n[i + 5]), control1: pt(n[i], n[i + 1]), control2: pt(n[i + 2], n[i + 3]))
                    x = n[i + 4]; y = n[i + 5]; i += 6
                }
            default: break          // what the house's own drawings don't use (make_glyphs.py leaves those out)
            }
        }
        return p
    }
}
