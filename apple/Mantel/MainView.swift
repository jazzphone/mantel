import MantelKit
import SwiftUI

/// The house's own screens and Mantel Settings, in a web view (§1), with a small mark when away from home (§4).
struct MainView: View {
    @EnvironmentObject private var model: SessionModel
    @ObservedObject private var router = NotificationRouter.shared
    @State private var start: URL?
    @State private var showMenu = false
    @State private var loadedDoor: Door?

    var body: some View {
        ZStack(alignment: .topTrailing) {
            if let start {
                HouseWebView(start: start, house: model.house!) { next in
                    Task { await load(next) }       // the web session ended: hand the web view a new one
                }
                .ignoresSafeArea()
                .id(start)
            } else {
                ProgressView("Connecting to \(model.house?.name ?? "Mantel")…")
            }
            HStack(spacing: 8) {
                if model.door == .tunnel {
                    Label("Away", systemImage: "globe").font(.caption.weight(.semibold))
                        .padding(.horizontal, 8).padding(.vertical, 4).background(.ultraThinMaterial, in: Capsule())
                }
                Button { showMenu = true } label: {
                    Image(systemName: "ellipsis.circle.fill").font(.title2).symbolRenderingMode(.hierarchical)
                }
                .accessibilityLabel("Mantel App Settings")
            }
            .padding(.trailing, 12).padding(.top, 4)
        }
        .sheet(isPresented: $showMenu) { AppMenu() }
        .task { await load("/home") }
        .onChange(of: model.door) { _, door in
            if door != nil, door != loadedDoor { Task { await load("/home") } }     // reload only when the door changes
        }
        .onChange(of: router.open) { _, url in
            if let url { router.open = nil; Task { await load(url) } }
        }
        .overlay(alignment: .bottom) {
            if let p = model.problem, start == nil {
                Text(p).padding().background(.thinMaterial, in: RoundedRectangle(cornerRadius: 12)).padding()
            }
        }
    }

    private func load(_ next: String) async {
        if let url = await model.webSessionURL(next: next) {
            loadedDoor = model.door
            start = url
        }
    }
}

/// The app's own settings: favorites for the widgets and Control Center, Face ID, notifications, signing out.
struct AppMenu: View {
    @EnvironmentObject private var model: SessionModel
    @Environment(\.dismiss) private var dismiss
    @State private var faceID = SharedStore.shared.requireFaceID

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    LabeledContent("Mantel", value: model.house?.name ?? "")
                    LabeledContent("Signed In As", value: model.user?.displayName ?? "")
                    LabeledContent("Connected", value: model.door == .lan ? "Home Network" : model.door == .tunnel ? "Away" : "Not Connected")
                }
                Section {
                    NavigationLink("Favorites") { FavoritesEditor() }
                } footer: { Text("Your favorites show in the widgets, Control Center, Siri and on the Mac.") }
                Section {
                    Toggle("Face ID to Open", isOn: $faceID).onChange(of: faceID) { _, v in SharedStore.shared.requireFaceID = v }
                    Button("Turn On Notifications") { Task { await PushRegistrar.shared.requestAndRegister() } }
                }
                Section {
                    Button("Sign Out", role: .destructive) { dismiss(); Task { await model.signOut() } }
                    Button("Forget This Mantel", role: .destructive) { dismiss(); Task { await model.forgetHouse() } }
                }
            }
            .navigationTitle("Mantel App")
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
    }
}
