import AppKit
import MantelKit
import SwiftUI

/// Mantel in the Mac's menu bar (docs/phase10/APPLE-APPS.md §9): music on the person's speaker, their favorites as
/// toggles, and "Open Mantel". It shares MantelKit (sign-in, the device key, the API) with the iPhone app.
@main
struct MantelMacApp: App {
    @StateObject private var model = SessionModel()

    var body: some Scene {
        MenuBarExtra {
            MenuContent().environmentObject(model).frame(width: 320)
        } label: {
            Image(systemName: model.summary?.now_playing?.state == "playing" ? "music.note.house.fill" : "house.fill")
        }
        .menuBarExtraStyle(.window)
    }
}

struct MenuContent: View {
    @EnvironmentObject private var model: SessionModel
    @State private var link = ""
    @State private var address = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text(model.house?.name ?? "Mantel").font(.headline)
                Spacer()
                if model.door == .tunnel { Label("Away", systemImage: "globe").font(.caption).foregroundStyle(.secondary) }
            }
            switch model.phase {
            case .setup: setup
            case .signIn:
                Button("Sign In…") { Task { await model.signIn() } }.disabled(model.busy)
            case .ready: ready
            }
            if let p = model.problem { Text(p).font(.caption).foregroundStyle(.red) }
            Divider()
            HStack {
                if model.phase == .ready {
                    Button("Open Mantel") { Task { if let u = await model.webSessionURL() { NSWorkspace.shared.open(u) } } }
                    Button("Sign Out") { Task { await model.signOut() } }
                }
                Spacer()
                Button("Quit") { NSApp.terminate(nil) }
            }
        }
        .padding(14)
        .task { await model.refresh() }
    }

    private var setup: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Paste the pairing link from Mantel Settings → Me → Mantel App, or type Mantel’s address.")
                .font(.caption).foregroundStyle(.secondary)
            TextField("mantel://pair?…", text: $link).onSubmit {
                if let u = URL(string: link), let l = PairingLink(url: u) { Task { await model.pair(l) } }
            }
            TextField("https://mantel.example.com", text: $address).onSubmit { Task { await model.lookUp(address) } }
            if let h = model.pending {
                Text("“\(h.name)” shows \(model.pendingCode ?? ""). Same six digits in Mantel Settings?").font(.caption)
                Button("Yes, Sign In") { model.confirmPending(); Task { await model.signIn() } }
            }
        }
    }

    @ViewBuilder private var ready: some View {
        if let p = model.summary?.now_playing {
            VStack(alignment: .leading, spacing: 4) {
                Label(p.name, systemImage: "hifispeaker.fill").font(.caption).foregroundStyle(.secondary)
                Text(p.attributes?.media_title ?? "Nothing playing").font(.body.weight(.semibold)).lineLimit(1)
                Text(p.attributes?.media_artist ?? "").font(.caption).foregroundStyle(.secondary)
                HStack(spacing: 16) {
                    control("backward.fill", "media_previous_track", p)
                    control(p.state == "playing" ? "pause.fill" : "play.fill", "media_play_pause", p)
                    control("forward.fill", "media_next_track", p)
                    Slider(value: Binding(get: { p.attributes?.volume_level ?? 0 }, set: { v in
                        Task { await model.run(Command(domain: "media_player", service: "volume_set", entity_id: p.entity_id,
                                                       data: ["volume_level": .number(v)])) }
                    }), in: 0...1)
                }
                .buttonStyle(.plain)
            }
            Divider()
        }
        let favs = model.summary?.favorites ?? []
        if favs.isEmpty {
            Text("Choose favorites in the Mantel app on your iPhone, or in Mantel Settings.").font(.caption).foregroundStyle(.secondary)
        }
        ForEach(favs) { e in
            HStack {
                VStack(alignment: .leading) {
                    Text(e.name)
                    Text(e.detail).font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
                if e.isToggleable {
                    Toggle("", isOn: Binding(get: { e.isOn }, set: { _ in Task { await model.toggle(e) } })).toggleStyle(.switch).labelsHidden()
                } else if e.isAction {
                    Button("Run") { Task { await model.toggle(e) } }
                }
            }
        }
    }

    private func control(_ symbol: String, _ service: String, _ p: EntityState) -> some View {
        Button { Task { await model.run(Command(domain: "media_player", service: service, entity_id: p.entity_id)) } } label: {
            Image(systemName: symbol).font(.title3)
        }
    }
}

/// The Mac has no Live Activity; its music is the menu above.
@MainActor final class MusicActivityController {
    static let shared = MusicActivityController()
    func follow(_ playing: EntityState?, house: House) async {}
    func end() async {}
}

/// Notifications on the Mac are optional (§9) and not wired yet.
@MainActor final class PushRegistrar {
    static let shared = PushRegistrar()
    func register(client: MantelClient) async {}
}
