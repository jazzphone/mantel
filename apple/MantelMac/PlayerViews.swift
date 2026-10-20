import MantelKit
import SwiftUI

/// A scroll view, or (drawing a still: DebugHook, whose renderer draws no scroll view) a plain stack.
struct PaneScroll<Content: View>: View {
    var axis: Axis.Set = .vertical
    @ViewBuilder var content: () -> Content
    @Environment(\.drawingStill) private var still
    var body: some View {
        if still { content() } else { ScrollView(axis, showsIndicators: axis == .vertical) { content() } }
    }
}

private struct DrawingStillKey: EnvironmentKey { static let defaultValue = false }
extension EnvironmentValues {
    var drawingStill: Bool {
        get { self[DrawingStillKey.self] }
        set { self[DrawingStillKey.self] = newValue }
    }
}

/// What the player's row of buttons opens: where it plays, what comes next, something else to play.
enum PlayerPane: String, CaseIterable, Identifiable {
    case speakers, upNext, browse
    var id: String { rawValue }
    var title: String { switch self { case .speakers: "Speakers"; case .upNext: "Up Next"; case .browse: "Browse" } }
    var symbol: String {
        switch self { case .speakers: "hifispeaker.2.fill"; case .upNext: "list.bullet"; case .browse: "square.grid.2x2.fill" }
    }
}

// MARK: - the cover

/// A picture from the house (a cover, a playlist's), loaded once and kept.
struct ArtImage: View {
    @EnvironmentObject private var music: MusicModel
    let ref: String?
    var placeholder = "music.note"
    @State private var image: NSImage?
    @State private var loaded: String?

    var body: some View {
        ZStack {
            if let image = image ?? music.cached(ref) {
                Image(nsImage: image).resizable().aspectRatio(contentMode: .fill)
                    .transition(.opacity)
            } else {
                LinearGradient(colors: [Color.white.opacity(0.16), Color.white.opacity(0.05)],
                               startPoint: .topLeading, endPoint: .bottomTrailing)
                Image(systemName: placeholder).font(.system(size: 28, weight: .regular))
                    .foregroundStyle(.white.opacity(0.45))
            }
        }
        .task(id: ref) {
            guard ref != loaded else { return }
            loaded = ref
            let got = await music.image(ref)
            withAnimation(.easeInOut(duration: 0.35)) { image = got }
        }
    }
}

/// The cover over everything, blurred and saturated, darkened toward the bottom: the player's backdrop.
struct PlayerBackdrop: View {
    let ref: String?

    var body: some View {
        // (an overlay on a clear view: the picture fills what the panel is and never sizes it)
        Color.clear.overlay {
            ZStack {
                LinearGradient(colors: [Color(red: 0.24, green: 0.16, blue: 0.40), Color(red: 0.07, green: 0.06, blue: 0.12)],
                               startPoint: .topLeading, endPoint: .bottom)
                if ref != nil {
                    GeometryReader { g in
                        ArtImage(ref: ref).frame(width: g.size.width, height: g.size.height)
                            .scaleEffect(1.6).blur(radius: 60).saturation(1.8).opacity(0.85)
                    }
                }
                LinearGradient(colors: [.black.opacity(0.05), .black.opacity(0.25), .black.opacity(0.6)],
                               startPoint: .top, endPoint: .bottom)
            }
        }
        .clipped()
        .ignoresSafeArea()
    }
}

// MARK: - now playing

/// The player: the cover, the song, how far in, the buttons, the volume, and the row below. `wide` is the window's.
struct NowPlayingView: View {
    @EnvironmentObject private var music: MusicModel
    var wide = false
    var open: (PlayerPane) -> Void
    var current: PlayerPane? = nil

    var body: some View {
        VStack(spacing: 0) {
            GeometryReader { g in
                let side = min(g.size.width, g.size.height)
                ArtImage(ref: music.leader?.art)
                    .frame(width: side, height: side)
                    .clipShape(RoundedRectangle(cornerRadius: wide ? 14 : 10, style: .continuous))
                    .shadow(color: .black.opacity(music.isPlaying ? 0.45 : 0.3), radius: music.isPlaying ? 24 : 12, y: music.isPlaying ? 14 : 6)
                    .scaleEffect(music.isPlaying || music.context == nil ? 1 : 0.86)
                    .animation(.spring(response: 0.5, dampingFraction: 0.7), value: music.isPlaying)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
            .frame(maxHeight: wide ? 400 : .infinity)
            .padding(.bottom, wide ? 26 : 18)

            HStack(alignment: .center, spacing: 10) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(music.context == nil ? "Not Playing" : (music.title.isEmpty ? "Playing" : music.title))
                        .font(.system(size: wide ? 22 : 17, weight: .bold)).lineLimit(1)
                    Text(music.context == nil ? "Choose something in Browse" : [music.artist, music.album].filter { !$0.isEmpty }.joined(separator: " — "))
                        .font(.system(size: wide ? 16 : 14)).foregroundStyle(.white.opacity(0.65)).lineLimit(1)
                }
                Spacer(minLength: 6)
                RouteButton { open(.speakers) }
            }

            Scrubber().padding(.top, wide ? 18 : 14)

            HStack(spacing: wide ? 54 : 40) {
                TransportButton(symbol: "backward.fill", size: wide ? 30 : 24) { music.transport("previous") }
                    .disabled(music.context == nil)
                TransportButton(symbol: music.isPlaying ? "pause.fill" : "play.fill", size: wide ? 44 : 36) { music.transport("play_pause") }
                TransportButton(symbol: "forward.fill", size: wide ? 30 : 24) { music.transport("next") }
                    .disabled(music.context == nil)
            }
            .padding(.top, wide ? 14 : 8)

            VolumeSlider(value: music.volume) { music.setVolume($0) }
                .disabled(music.context == nil)
                .opacity(music.context == nil ? 0.4 : 1)
                .padding(.top, wide ? 18 : 10)

            if !wide {
                HStack {
                    ForEach(PlayerPane.allCases) { p in
                        Button { open(p) } label: {
                            Image(systemName: p.symbol).font(.system(size: 15, weight: .semibold))
                                .frame(maxWidth: .infinity, minHeight: 30)
                                .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .foregroundStyle(current == p ? .white : .white.opacity(0.6))
                        .help(p.title)
                    }
                }
                .padding(.top, 10)
            }
        }
        .foregroundStyle(.white)
        .onAppear { music.watch(true) }
        .onDisappear { music.watch(false) }
    }
}

/// Where it plays, as AirPlay's button names it.
struct RouteButton: View {
    @EnvironmentObject private var music: MusicModel
    var action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 5) {
                Image(systemName: music.readyRooms.count > 1 ? "hifispeaker.2.fill" : "hifispeaker.fill")
                    .font(.system(size: 11, weight: .semibold))
                Text(music.where_.isEmpty ? "Speakers" : music.where_).font(.system(size: 12, weight: .semibold)).lineLimit(1)
            }
            .padding(.horizontal, 10).padding(.vertical, 5)
            .background(.white.opacity(0.16), in: Capsule())
        }
        .buttonStyle(.plain)
        .frame(maxWidth: 170, alignment: .trailing)
        .help("Choose Speakers")
    }
}

struct TransportButton: View {
    let symbol: String
    let size: CGFloat
    let action: () -> Void
    @State private var hover = false

    var body: some View {
        Button(action: action) {
            Image(systemName: symbol).font(.system(size: size, weight: .regular))
                .contentTransition(.symbolEffect(.replace))
                .frame(width: size * 1.7, height: size * 1.7)
                .background(Circle().fill(.white.opacity(hover ? 0.12 : 0)))
                .contentShape(Circle())
        }
        .buttonStyle(PressScale())
        .onHover { hover = $0 }
    }
}

struct PressScale: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label.scaleEffect(configuration.isPressed ? 0.86 : 1)
            .animation(.spring(response: 0.25, dampingFraction: 0.6), value: configuration.isPressed)
    }
}

/// How far in, and the times either side (Apple Music's: elapsed, and what is left).
struct Scrubber: View {
    @EnvironmentObject private var music: MusicModel

    var body: some View {
        TimelineView(.periodic(from: .now, by: 1)) { ctx in
            let p = music.leader
            let d = p?.attributes.media_duration ?? 0
            let t = p?.elapsed(at: ctx.date) ?? 0
            VStack(spacing: 5) {
                GeometryReader { g in
                    ZStack(alignment: .leading) {
                        Capsule().fill(.white.opacity(0.22))
                        Capsule().fill(.white.opacity(0.85)).frame(width: d > 0 ? g.size.width * min(1, t / d) : 0)
                    }
                }
                .frame(height: 4)
                HStack {
                    Text(d > 0 || t > 0 ? clock(t) : "--:--")
                    Spacer()
                    Text(d > 0 ? "-" + clock(d - t) : "--:--")
                }
                .font(.system(size: 11, weight: .semibold).monospacedDigit())
                .foregroundStyle(.white.opacity(0.5))
            }
        }
    }

    private func clock(_ s: Double) -> String {
        let s = max(0, Int(s.rounded(.down)))
        return s >= 3600 ? String(format: "%d:%02d:%02d", s / 3600, s / 60 % 60, s % 60) : String(format: "%d:%02d", s / 60, s % 60)
    }
}

/// A thin track with a white fill that thickens under the pointer, as macOS's Now Playing does.
struct VolumeSlider: View {
    let value: Double
    let set: (Double) -> Void
    var glyphs = true
    @State private var drag: Double?
    @State private var hover = false

    var body: some View {
        HStack(spacing: 10) {
            if glyphs { Image(systemName: "speaker.fill").font(.system(size: 11)).foregroundStyle(.white.opacity(0.6)) }
            GeometryReader { g in
                let v = drag ?? value
                ZStack(alignment: .leading) {
                    Capsule().fill(.white.opacity(0.22))
                    Capsule().fill(.white.opacity(0.88)).frame(width: max(0, g.size.width * v))
                }
                .frame(height: hover || drag != nil ? 8 : 5)
                .frame(maxHeight: .infinity)
                .contentShape(Rectangle())
                .gesture(DragGesture(minimumDistance: 0)
                    .onChanged { e in
                        let nv = max(0, min(1, e.location.x / max(1, g.size.width)))
                        drag = nv
                        set((nv * 100).rounded() / 100)
                    }
                    .onEnded { _ in drag = nil })
                .animation(.easeOut(duration: 0.15), value: hover)
            }
            .frame(height: 18)
            .onHover { hover = $0 }
            if glyphs { Image(systemName: "speaker.wave.3.fill").font(.system(size: 11)).foregroundStyle(.white.opacity(0.6)) }
        }
    }
}

/// Speakers · Up Next · Browse as one glass capsule with the chosen one lit (the window's switcher; Music's own look,
/// not AppKit's segmented control).
struct PaneTabs: View {
    @Binding var selection: PlayerPane
    @Namespace private var lit

    var body: some View {
        HStack(spacing: 2) {
            ForEach(PlayerPane.allCases) { p in
                Button { withAnimation(.spring(response: 0.3, dampingFraction: 0.85)) { selection = p } } label: {
                    HStack(spacing: 6) {
                        Image(systemName: p.symbol).font(.system(size: 12, weight: .semibold))
                        Text(p.title).font(.system(size: 13, weight: .semibold))
                    }
                    .padding(.horizontal, 14).padding(.vertical, 7)
                    .foregroundStyle(selection == p ? .black : .white.opacity(0.8))
                    .background {
                        if selection == p { Capsule().fill(.white).matchedGeometryEffect(id: "lit", in: lit) }
                    }
                    .contentShape(Capsule())
                }
                .buttonStyle(.plain)
            }
        }
        .padding(3)
        .background(.white.opacity(0.12), in: Capsule())
    }
}

/// A sub-page's heading: back to the player, its title.
struct PaneHeader: View {
    let title: String
    var back: (() -> Void)?

    var body: some View {
        HStack(spacing: 8) {
            if let back {
                Button(action: back) {
                    Image(systemName: "chevron.left").font(.system(size: 14, weight: .semibold))
                        .frame(width: 28, height: 28).background(.white.opacity(0.14), in: Circle())
                }
                .buttonStyle(.plain)
                .help("Back to Now Playing")
            }
            Text(title).font(.system(size: 17, weight: .bold))
            Spacer()
        }
        .foregroundStyle(.white)
    }
}
