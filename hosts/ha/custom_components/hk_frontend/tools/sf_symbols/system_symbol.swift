// A system symbol the SF Symbols app doesn't list yet, as the app's own SVG export would give it (one path in the
// Regular-S group): Apple names a product's glyph with a code (HomeView's is B60489D1A39349AFA3504AE69B1C9133) in
// macOS's own set until the app publishes it. sfsvg.py runs this when the app's `export` doesn't know a name.
//   swift system_symbol.swift NAME OUT.svg
// Reads macOS's private symbol set (AppKit's _imageWithSystemSymbolName:), the monochrome outline at Regular, Small.
import AppKit

let args = CommandLine.arguments
guard args.count == 3 else { FileHandle.standardError.write("usage: system_symbol.swift NAME OUT.svg\n".data(using: .utf8)!); exit(2) }
let name = args[1], out = args[2]
let load = NSSelectorFromString("_imageWithSystemSymbolName:")
var image = NSImage(systemSymbolName: name, accessibilityDescription: nil)
if image == nil, NSImage.responds(to: load) {
  image = NSImage.perform(load, with: name)?.takeUnretainedValue() as? NSImage
}
let cfg = NSImage.SymbolConfiguration(pointSize: 100, weight: .regular, scale: .small)
guard let symbol = image?.withSymbolConfiguration(cfg), let rep = symbol.representations.first,
      let glyph = rep.value(forKey: "vectorGlyph") as? NSObject,
      let path = glyph.perform(NSSelectorFromString("CGPath"))?.takeUnretainedValue() else {
  FileHandle.standardError.write("no system symbol \(name)\n".data(using: .utf8)!); exit(1)
}
func n(_ v: CGFloat) -> String { String(format: "%.4f", Double(v)) }
var d = ""
(path as! CGPath).applyWithBlock { e in
  let p = e.pointee.points
  switch e.pointee.type {
  case .moveToPoint: d += "M\(n(p[0].x)) \(n(p[0].y))"
  case .addLineToPoint: d += "L\(n(p[0].x)) \(n(p[0].y))"
  case .addQuadCurveToPoint: d += "Q\(n(p[0].x)) \(n(p[0].y)) \(n(p[1].x)) \(n(p[1].y))"
  case .addCurveToPoint: d += "C\(n(p[0].x)) \(n(p[0].y)) \(n(p[1].x)) \(n(p[1].y)) \(n(p[2].x)) \(n(p[2].y))"
  case .closeSubpath: d += "Z"
  @unknown default: break
  }
}
// the glyph's own coordinates are y-down already, as the app's export is
let svg = "<svg xmlns=\"http://www.w3.org/2000/svg\"><g id=\"Regular-S\"><path class=\"monochrome-0\" d=\"\(d)\"/></g></svg>\n"
try! svg.write(toFile: out, atomically: true, encoding: .utf8)
