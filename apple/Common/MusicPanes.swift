import MantelKit
import SwiftUI

// MARK: - Speakers

/// Where the music plays, as Control Center's AirPlay list: presets as capsules, every room with a check, a volume for
/// each room that plays. Playing, the checks are what Update makes true (hk_frontend.music_transfer: rooms join, let
/// go, or the music moves); nothing playing, they are where the next pick plays.
struct SpeakersPane: View {
    @EnvironmentObject private var music: MusicModel
    @State private var ticks: Set<String> = []
    @State private var tickedFor: String?

    var body: some View {
        let s = music.state
        VStack(alignment: .leading, spacing: 12) {
            if let s, !s.presets.isEmpty {
                PaneScroll(axis: .horizontal) {
                    HStack(spacing: 8) {
                        ForEach(s.presets) { p in
                            let on = Set(p.members ?? []) == ticks
                            Button { pick(Set(p.members ?? [])) } label: {
                                Text(p.name).font(.system(size: 13, weight: .semibold))
                                    .padding(.horizontal, 14).padding(.vertical, 7)
                                    .background(on ? AnyShapeStyle(.white) : AnyShapeStyle(.white.opacity(0.14)), in: Capsule())
                                    .foregroundStyle(on ? .black : .white)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
            }
            PaneScroll {
                VStack(spacing: 6) {
                    ForEach(sections, id: \.0) { title, rooms in
                        if let title {
                            Text(title.uppercased()).font(.system(size: 11, weight: .semibold)).foregroundStyle(.white.opacity(0.5))
                                .frame(maxWidth: .infinity, alignment: .leading).padding(.top, 6)
                        }
                        ForEach(rooms) { r in RoomRow(room: r, ticked: ticks.contains(r.entity)) { toggle(r.entity) } }
                    }
                }
            }
            footer
        }
        .foregroundStyle(.white)
        .onAppear { sync(force: true) }
        .onChange(of: music.context?.key) { _, _ in sync(force: true) }
    }

    private var sections: [(String?, [MusicState.Speaker])] {
        guard let s = music.state else { return [] }
        let rooms = s.rooms
        guard !s.floors.isEmpty else { return [(nil, rooms)] }
        var out: [(String?, [MusicState.Speaker])] = []
        var used = Set<String>()
        for f in s.floors {
            let rs = rooms.filter { f.entities.contains($0.entity) }
            if !rs.isEmpty { out.append((f.name, rs)); used.formUnion(rs.map(\.entity)) }
        }
        let rest = rooms.filter { !used.contains($0.entity) }
        if !rest.isEmpty { out.append((out.isEmpty ? nil : "Other", rest)) }
        return out
    }

    @ViewBuilder private var footer: some View {
        let now = Set(music.context?.members ?? [])
        if let c = music.context {
            HStack(spacing: 8) {
                Button { music.stop(c.members) } label: { Image(systemName: "stop.fill").frame(width: 32, height: 30) }
                    .buttonStyle(GlassButton()).help("Stop")
                Spacer()
                Button("Reset") { ticks = now }.buttonStyle(GlassButton()).disabled(ticks == now)
                Button { music.playOn(ordered(ticks)) } label: { Label("Update", systemImage: "checkmark") }
                    .buttonStyle(GlassButton(prominent: true)).disabled(ticks == now || ticks.isEmpty)
            }
        } else {
            Text(ticks.isEmpty ? "Choose where the next music plays."
                 : "The next music you pick plays on \(ordered(ticks).map { music.state?.name($0) ?? $0 }.joined(separator: ", ")).")
                .font(.system(size: 12)).foregroundStyle(.white.opacity(0.6))
        }
    }

    private func ordered(_ set: Set<String>) -> [String] {
        (music.state?.rooms.map(\.entity) ?? []).filter { set.contains($0) }
    }

    private func sync(force: Bool) {
        let key = music.context?.key ?? "ready"
        guard force || tickedFor != key else { return }
        tickedFor = key
        ticks = Set(music.readyRooms)
    }

    private func pick(_ set: Set<String>) {
        ticks = set
        if music.context == nil { music.target = ordered(set) }
    }

    private func toggle(_ e: String) {
        if ticks.contains(e) { ticks.remove(e) } else { ticks.insert(e) }
        if music.context == nil { music.target = ordered(ticks) }
    }
}

struct RoomRow: View {
    @EnvironmentObject private var music: MusicModel
    let room: MusicState.Speaker
    let ticked: Bool
    let toggle: () -> Void

    var body: some View {
        let p = music.state?.player(room.entity)
        let inMusic = music.context?.members.contains(room.entity) ?? false
        VStack(spacing: 8) {
            Button(action: toggle) {
                HStack(spacing: 12) {
                    Image(systemName: "hifispeaker.fill").font(.system(size: 15))
                        .frame(width: 32, height: 32).background(.white.opacity(0.14), in: Circle())
                    VStack(alignment: .leading, spacing: 1) {
                        Text(room.name).font(.system(size: 14, weight: .semibold))
                        if let line = status(p, inMusic) {
                            Text(line).font(.system(size: 11)).foregroundStyle(.white.opacity(0.55)).lineLimit(1)
                        }
                    }
                    Spacer()
                    Image(systemName: ticked ? "checkmark.circle.fill" : "circle")
                        .font(.system(size: 20)).foregroundStyle(ticked ? .white : .white.opacity(0.35))
                        .contentTransition(.symbolEffect(.replace))
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            if inMusic && ticked {
                VolumeSlider(value: music.volume(of: room.entity), set: { music.setVolume($0, entities: [room.entity]) },
                             glyphs: false)
                    .padding(.leading, 44)
            }
        }
        .padding(.horizontal, 10).padding(.vertical, 8)
        .background(.white.opacity(ticked ? 0.12 : 0.06), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
    }

    private func status(_ p: MusicState.Player?, _ inMusic: Bool) -> String? {
        guard let p, p.active else { return nil }
        if inMusic { return p.state == "playing" ? "Playing here" : "Paused here" }
        let t = p.attributes.media_title ?? ""
        return (p.state == "playing" ? "Playing " : "Paused ") + (t.isEmpty ? "" : "“\(t)”")
    }
}

struct GlassButton: ButtonStyle {
    var prominent = false
    @Environment(\.isEnabled) private var enabled
    func makeBody(configuration: Configuration) -> some View {
        configuration.label.font(.system(size: 13, weight: .semibold))
            .padding(.horizontal, 14).padding(.vertical, 7)
            .background(prominent ? AnyShapeStyle(.white) : AnyShapeStyle(.white.opacity(0.14)), in: Capsule())
            .foregroundStyle(prominent ? .black : .white)
            .opacity(enabled ? (configuration.isPressed ? 0.7 : 1) : 0.4)
            .scaleEffect(configuration.isPressed ? 0.96 : 1)
    }
}

// MARK: - Up Next

/// What plays and what comes next (Music Assistant's queue for the music's player); a click plays that song.
struct UpNextPane: View {
    @EnvironmentObject private var music: MusicModel

    var body: some View {
        Group {
            if music.context == nil {
                empty("Nothing is playing.")
            } else if let q = music.queue, q.ok, !q.items.isEmpty {
                PaneScroll {
                    LazyVStack(alignment: .leading, spacing: 2) {
                        ForEach(Array(q.items.enumerated()), id: \.element.id) { i, item in
                            if i == 0 { label("Now Playing") } else if i == 1 { label("Up Next") }
                            Button { if i > 0 { music.playQueueItem(item.id) } } label: { QueueRow(item: item, current: i == 0) }
                                .buttonStyle(.plain)
                        }
                    }
                }
            } else if let q = music.queue {
                empty(q.message ?? "Nothing comes next.")
            } else if let problem = music.queueProblem {
                empty(problem)
            } else {
                ProgressView().controlSize(.small).frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .foregroundStyle(.white)
        .task(id: (music.context?.key ?? "") + music.title) { await music.loadQueue() }
    }

    private func label(_ s: String) -> some View {
        Text(s.uppercased()).font(.system(size: 11, weight: .semibold)).foregroundStyle(.white.opacity(0.5))
            .padding(.top, 8).padding(.bottom, 2)
    }

    private func empty(_ s: String) -> some View {
        Text(s).font(.system(size: 13)).foregroundStyle(.white.opacity(0.6)).frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

struct QueueRow: View {
    let item: MusicQueue.Item
    let current: Bool
    @State private var hover = false

    var body: some View {
        HStack(spacing: 10) {
            ArtImage(ref: item.image).frame(width: 40, height: 40).clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
            VStack(alignment: .leading, spacing: 1) {
                Text(item.title ?? "").font(.system(size: 13, weight: .semibold)).lineLimit(1)
                Text(item.artist ?? "").font(.system(size: 11)).foregroundStyle(.white.opacity(0.55)).lineLimit(1)
            }
            Spacer()
            if current {
                Image(systemName: "waveform").font(.system(size: 12)).foregroundStyle(.white.opacity(0.7))
                    .symbolEffect(.variableColor.iterative, options: .repeating)
            } else if let d = item.duration, d > 0 {
                Text(String(format: "%d:%02d", Int(d) / 60, Int(d) % 60)).font(.system(size: 11).monospacedDigit())
                    .foregroundStyle(.white.opacity(0.5))
            }
        }
        .padding(6)
        .background(.white.opacity(current || hover ? 0.1 : 0), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        .contentShape(Rectangle())
        .onHover { hover = $0 }
    }
}

// MARK: - Browse

/// Something else to play: the house's playlists, then Music Assistant's library -- search, and its playlists,
/// albums, artists, songs and radio -- played on the music's speakers (or where the next music plays).
struct BrowsePane: View {
    @EnvironmentObject private var music: MusicModel
    var columns = 3
    /// A pane as wide as a window's: the library's tiles take the size the person picks (the slider), as many to a
    /// row as fit, instead of `columns` stretched across it.
    var sizable = false
    @AppStorage("browseKind") private var kind = Kind.playlist
    @AppStorage("browseTileSize") private var tileSize = 160.0
    static let tileSizes: ClosedRange<Double> = 110...280
    @State private var search = ""

    enum Kind: String, CaseIterable, Identifiable {
        case playlist, album, artist, track, radio
        var id: String { rawValue }
        var title: String {
            switch self { case .playlist: "Playlists"; case .album: "Albums"; case .artist: "Artists"; case .track: "Songs"; case .radio: "Radio" }
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 6) {
                Image(systemName: "magnifyingglass").foregroundStyle(.white.opacity(0.6))
                TextField("Artists, Albums, Songs", text: $search).textFieldStyle(.plain)
                if !search.isEmpty {
                    Button { search = "" } label: { Image(systemName: "xmark.circle.fill") }.buttonStyle(.plain)
                        .foregroundStyle(.white.opacity(0.6))
                }
            }
            .font(.system(size: 13))
            .padding(.horizontal, 10).padding(.vertical, 7)
            .background(.white.opacity(0.12), in: RoundedRectangle(cornerRadius: 9, style: .continuous))

            HStack(spacing: 12) {
                PaneScroll(axis: .horizontal) {
                    HStack(spacing: 6) {
                        ForEach(Kind.allCases) { k in
                            Button { withAnimation(.easeOut(duration: 0.15)) { kind = k } } label: {
                                Text(k.title).font(.system(size: 12, weight: .semibold)).lineLimit(1).fixedSize()
                                    .padding(.horizontal, 11).padding(.vertical, 6)
                                    .background(kind == k ? AnyShapeStyle(.white) : AnyShapeStyle(.white.opacity(0.12)), in: Capsule())
                                    .foregroundStyle(kind == k ? .black : .white.opacity(0.85))
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
                if sizable && kind != .track { sizeSlider }
            }

            PaneScroll {
                VStack(alignment: .leading, spacing: 14) {
                    if search.isEmpty, kind == .playlist, let lists = music.state?.playlists, !lists.isEmpty {
                        Text("Your Playlists").font(.system(size: 15, weight: .bold))
                        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: max(2, columns - 1)), spacing: 8) {
                            ForEach(lists) { p in HousePlaylistTile(playlist: p) }
                        }
                        if music.state?.library == true { Text("Library").font(.system(size: 15, weight: .bold)).padding(.top, 4) }
                    }
                    if music.state?.library == true {
                        let items = music.library[MusicModel.libraryKey(kind.rawValue, search)] ?? []
                        let loading = music.libraryLoading, problem = music.libraryProblem
                        if kind == .track {
                            LazyVStack(spacing: 2) { ForEach(items) { i in SongRow(item: i) } }
                        } else {
                            LazyVGrid(columns: grid, spacing: 14) {
                                ForEach(items) { i in LibraryTile(item: i, round: kind == .artist) }
                            }
                        }
                        if loading && items.isEmpty { ProgressView().controlSize(.small).frame(maxWidth: .infinity) }
                        if let problem { Text(problem).font(.system(size: 12)).foregroundStyle(.white.opacity(0.6)) }
                        if !loading && items.isEmpty && problem == nil {
                            Text(search.isEmpty ? "Nothing here yet." : "No results for “\(search)”.")
                                .font(.system(size: 12)).foregroundStyle(.white.opacity(0.6))
                        }
                    }
                }
                .padding(.bottom, 8)
            }
        }
        .foregroundStyle(.white)
        .animation(.easeOut(duration: 0.15), value: tileSize)
        .task(id: "\(kind.rawValue)|\(search)") {
            if !search.isEmpty { try? await Task.sleep(for: .milliseconds(350)) }      // typing: wait for a pause
            guard !Task.isCancelled else { return }
            await music.loadLibrary(kind.rawValue, search: search)
        }
    }

    private var grid: [GridItem] {
        sizable
            ? [GridItem(.adaptive(minimum: tileSize, maximum: tileSize * 1.25), spacing: 12, alignment: .top)]
            : Array(repeating: GridItem(.flexible(), spacing: 12, alignment: .top), count: columns)
    }

    /// Photos' zoom: smaller tiles at the left, larger at the right.
    private var sizeSlider: some View {
        HStack(spacing: 6) {
            Button { tileSize = max(Self.tileSizes.lowerBound, tileSize - 30) } label: {
                Image(systemName: "square.grid.3x3.fill").font(.system(size: 10))
            }
            Slider(value: $tileSize, in: Self.tileSizes).controlSize(.mini).frame(width: 90)
            Button { tileSize = min(Self.tileSizes.upperBound, tileSize + 30) } label: {
                Image(systemName: "square.grid.2x2.fill").font(.system(size: 13))
            }
        }
        .buttonStyle(.plain)
        .foregroundStyle(.white.opacity(0.6))
        .tint(.white)
        .help("Tile size")
    }
}

struct HousePlaylistTile: View {
    @EnvironmentObject private var music: MusicModel
    let playlist: MusicState.Playlist
    @State private var hover = false
    @State private var choosing = false

    var body: some View {
        Button {
            if let options = playlist.options, !options.isEmpty { choosing = true } else { music.play(playlist: playlist.key) }
        } label: { tile }
        .buttonStyle(PressScale())
        .onHover { hover = $0 }
        .popover(isPresented: $choosing, arrowEdge: .bottom) { choices }
    }

    private var tile: some View {
        HStack(spacing: 10) {
            HouseGlyph(icon: playlist.icon).font(.system(size: 14, weight: .semibold))
                .frame(width: 30, height: 30).background(.white.opacity(0.16), in: Circle())
            Text(playlist.name).font(.system(size: 13, weight: .semibold)).lineLimit(1)
            Spacer(minLength: 0)
            if playlist.options?.isEmpty == false {
                Image(systemName: "chevron.down").font(.system(size: 10, weight: .bold)).foregroundStyle(.white.opacity(0.5))
            }
        }
        .padding(8)
        .background(.white.opacity(hover ? 0.18 : 0.1), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .foregroundStyle(.white)
        .contentShape(Rectangle())
    }

    /// A playlist with a choice (the decades): its options, each plays.
    private var choices: some View {
        VStack(alignment: .leading, spacing: 2) {
            ForEach(playlist.options ?? []) { o in
                Button {
                    choosing = false
                    music.play(playlist: o.key)
                } label: {
                    Text(o.name).font(.system(size: 13, weight: .medium))
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal, 10).padding(.vertical, 6)
                        .contentShape(Rectangle())
                }
                .buttonStyle(ChoiceRow())
            }
        }
        .padding(6)
        .frame(minWidth: 160)
    }
}

/// A row in a little list of choices: lit under the pointer, as a menu's.
private struct ChoiceRow: ButtonStyle {
    @State private var hover = false
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .background(Color.accentColor.opacity(hover || configuration.isPressed ? 0.85 : 0), in: RoundedRectangle(cornerRadius: 6))
            .foregroundStyle(hover ? Color.white : Color.primary)
            .onHover { hover = $0 }
    }
}

struct LibraryTile: View {
    @EnvironmentObject private var music: MusicModel
    let item: MusicItem
    var round = false
    @State private var hover = false

    var body: some View {
        Button { music.play(item) } label: {
            VStack(alignment: round ? .center : .leading, spacing: 5) {
                ZStack(alignment: .bottomTrailing) {
                    ArtImage(ref: item.image, placeholder: round ? "music.mic" : "music.note.list")
                        .aspectRatio(1, contentMode: .fit)
                        .clipShape(round ? AnyShape(Circle()) : AnyShape(RoundedRectangle(cornerRadius: 8, style: .continuous)))
                        .shadow(color: .black.opacity(0.3), radius: hover ? 10 : 4, y: hover ? 6 : 2)
                    if hover && !round {
                        Image(systemName: "play.fill").font(.system(size: 12, weight: .bold)).foregroundStyle(.black)
                            .frame(width: 28, height: 28).background(.white, in: Circle()).padding(6)
                            .transition(.scale.combined(with: .opacity))
                    }
                }
                Text(item.name).font(.system(size: 12, weight: .semibold)).lineLimit(1)
                if !item.subtitle.isEmpty {
                    Text(item.subtitle).font(.system(size: 11)).foregroundStyle(.white.opacity(0.55)).lineLimit(1)
                }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { h in withAnimation(.easeOut(duration: 0.15)) { hover = h } }
        .help("Play “\(item.name)”")
    }
}

struct SongRow: View {
    @EnvironmentObject private var music: MusicModel
    let item: MusicItem
    @State private var hover = false

    var body: some View {
        Button { music.play(item) } label: {
            HStack(spacing: 10) {
                ArtImage(ref: item.image ?? item.album?.image).frame(width: 36, height: 36)
                    .clipShape(RoundedRectangle(cornerRadius: 5, style: .continuous))
                VStack(alignment: .leading, spacing: 1) {
                    Text(item.name).font(.system(size: 13, weight: .semibold)).lineLimit(1)
                    Text([item.subtitle, item.album?.name ?? ""].filter { !$0.isEmpty }.joined(separator: " — "))
                        .font(.system(size: 11)).foregroundStyle(.white.opacity(0.55)).lineLimit(1)
                }
                Spacer()
                if hover { Image(systemName: "play.fill").font(.system(size: 11)) }
            }
            .padding(6)
            .background(.white.opacity(hover ? 0.1 : 0), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hover = $0 }
    }
}
