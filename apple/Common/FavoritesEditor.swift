import MantelKit
import SwiftUI

/// The person's favorites (the widgets, Control Center, Siri and the Mac's menu): pick from the accessories the
/// house lets them see, reorder, remove. The house keeps the list (`/api/app/favorites`); shared by the iPhone app and
/// the Mac app.
struct FavoritesEditor: View {
    @EnvironmentObject private var model: SessionModel
    @State private var all: [EntityChoice] = []
    @State private var chosen: [String] = []
    @State private var query = ""
    @State private var error: String?

    var body: some View {
        List {
            if !chosen.isEmpty {
                Section("Favorites") {
                    ForEach(chosen, id: \.self) { id in
                        Text(all.first { $0.entity_id == id }?.name ?? id)
                            .contextMenu { Button("Remove from Favorites") { chosen.removeAll { $0 == id }; save() } }
                    }
                    .onMove { chosen.move(fromOffsets: $0, toOffset: $1); save() }
                    .onDelete { chosen.remove(atOffsets: $0); save() }
                }
            }
            Section("Accessories") {
                ForEach(all.filter { query.isEmpty || $0.name.localizedCaseInsensitiveContains(query)
                                       || $0.entity_id.localizedCaseInsensitiveContains(query) }) { e in
                    Button {
                        if let i = chosen.firstIndex(of: e.entity_id) { chosen.remove(at: i) } else { chosen.append(e.entity_id) }
                        save()
                    } label: {
                        HStack {
                            VStack(alignment: .leading) {
                                Text(e.name).foregroundStyle(.primary)
                                if let a = e.area { Text(a).font(.caption).foregroundStyle(.secondary) }
                            }
                            Spacer()
                            Image(systemName: chosen.contains(e.entity_id) ? "star.fill" : "star")
                                .foregroundStyle(chosen.contains(e.entity_id) ? .yellow : .secondary)
                        }
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
            }
            if let error { Text(error).foregroundStyle(.red) }
        }
        .searchable(text: $query)
        .navigationTitle("Favorites")
        #if os(iOS)
        .toolbar { EditButton() }
        #endif
        .task {
            guard let client = model.client else { return }
            do {
                async let a = client.entities()
                async let f = client.favorites()
                (all, chosen) = try await (a, f)
            } catch { self.error = error.localizedDescription }
        }
        .task(id: query) {
            // The house sends at most 500 of the list unsearched, so a search asks it, not just what came
            guard !query.isEmpty, let client = model.client else { return }
            try? await Task.sleep(for: .milliseconds(250))
            guard !Task.isCancelled, let found = try? await client.entities(matching: query) else { return }
            let known = Set(all.map(\.entity_id))
            all += found.filter { !known.contains($0.entity_id) }
        }
    }

    private func save() {
        let ids = chosen
        Task {
            do {
                try await model.client?.setFavorites(ids)
                await model.refresh()
            } catch { self.error = error.localizedDescription }
        }
    }
}
