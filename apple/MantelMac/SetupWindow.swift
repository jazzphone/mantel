import MantelKit
import SwiftUI

/// Finding the house and signing in on the Mac (§2, as the iPhone's SetupView): paste the `mantel://pair` link from
/// Mantel Settings → Me → Mantel App (or click it: the app opens it), pick a Mantel announced on this network, or type
/// its address and compare the six digits; then Mantel's own sign-in in ASWebAuthenticationSession. A window of its
/// own, not the menu: the sign-in sheet needs a window that stays while the person signs in.
struct SetupWindow: View {
    @EnvironmentObject private var model: SessionModel
    @Environment(\.dismissWindow) private var dismissWindow
    @State private var found: [HouseBrowser.Found] = []
    @State private var link = ""
    @State private var address = ""
    private let browser = HouseBrowser()

    var body: some View {
        Form {
            switch model.phase {
            case .setup: find
            case .signIn: signIn
            case .ready:
                Section {
                    Label("Signed in to \(model.house?.name ?? "Mantel") as \(model.user?.displayName ?? "you").",
                          systemImage: "checkmark.circle.fill")
                    Text("Music and your favorites are in the menu bar.").foregroundStyle(.secondary)
                    Button("Done") { dismissWindow(id: "setup") }.keyboardShortcut(.defaultAction)
                }
            }
            if let p = model.problem { Section { Text(p).foregroundStyle(.red) } }
        }
        .formStyle(.grouped)
        .frame(width: 460)
        .fixedSize(horizontal: false, vertical: true)
        .disabled(model.busy)
        .onAppear { browser.start { r in Task { @MainActor in found = r } } }
        .onDisappear { browser.stop() }
        .onChange(of: model.phase) { _, phase in
            if phase == .ready { model.problem = nil }
        }
    }

    @ViewBuilder private var find: some View {
        if let h = model.pending {
            Section("Is This Your Mantel?") {
                Text("“\(h.name)” shows **\(model.pendingCode ?? "")**. Check that Mantel Settings → Me → Mantel App shows the same six digits.")
                HStack {
                    Button("Cancel") { model.pending = nil }
                    Spacer()
                    Button("Yes, Sign In") { model.confirmPending(); Task { await model.signIn() } }.keyboardShortcut(.defaultAction)
                }
            }
        } else {
            Section {
                TextField("Pairing link", text: $link, prompt: Text("mantel://pair?…")).onSubmit(usePasted)
                Button("Pair") { usePasted() }.disabled(link.isEmpty)
            } header: { Text("Paste the Pairing Link") } footer: {
                Text("In Mantel Settings on another screen: Me → Mantel App → Add iPhone, iPad or Mac. Clicking the link on this Mac works too.")
            }
            if !found.isEmpty {
                Section("On This Network") {
                    ForEach(found) { f in
                        Button { Task { await model.lookUp(f.url.absoluteString) } } label: {
                            LabeledContent(f.name, value: f.url.host ?? "")
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
            Section("Or Type Its Address") {
                TextField("Address", text: $address, prompt: Text("mantel.example.com"))
                    .onSubmit { Task { await model.lookUp(address) } }
                Button("Continue") { Task { await model.lookUp(address) } }.disabled(address.isEmpty)
            }
        }
    }

    private var signIn: some View {
        Section {
            Text("Sign in to \(model.house?.name ?? "Mantel") with your Mantel account.")
            HStack {
                Button("Use Another Mantel") { Task { await model.forgetHouse() } }
                Spacer()
                Button("Sign In…") { Task { await model.signIn() } }.keyboardShortcut(.defaultAction)
            }
        }
    }

    private func usePasted() {
        guard let url = URL(string: link.trimmingCharacters(in: .whitespacesAndNewlines)), let l = PairingLink(url: url) else {
            model.problem = "That is not a Mantel pairing link."
            return
        }
        link = ""
        Task { await model.pair(l) }
    }
}
