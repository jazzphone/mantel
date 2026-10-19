import AVFoundation
import MantelKit
import SwiftUI

/// Finding the house (§2): scan the code from Mantel Settings → Me → Mantel App (best: nothing to type, the house
/// pinned from the start), a Mantel announced on this Wi-Fi, or its address typed in.
struct SetupView: View {
    @EnvironmentObject private var model: SessionModel
    @State private var found: [HouseBrowser.Found] = []
    @State private var address = ""
    @State private var scanning = false
    @State private var pasted = ""
    private let browser = HouseBrowser()

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    VStack(spacing: 10) {
                        Image("Hearth").resizable().frame(width: 72, height: 72).clipShape(RoundedRectangle(cornerRadius: 16))
                        Text("Welcome to Mantel").font(.title2.bold())
                        Text("Your home's screens, music and accessories, on this device.").foregroundStyle(.secondary)
                            .multilineTextAlignment(.center)
                    }.frame(maxWidth: .infinity).listRowBackground(Color.clear)
                }
                Section {
                    Button { scanning = true } label: { Label("Scan the Code", systemImage: "qrcode.viewfinder") }
                    TextField("Or paste the mantel://pair link", text: $pasted)
                        .textInputAutocapitalization(.never).autocorrectionDisabled()
                        .onSubmit { usePasted() }
                } footer: {
                    Text("In Mantel Settings on another screen: Me → Mantel App → Add iPhone, iPad or Mac.")
                }
                if !found.isEmpty {
                    Section("On This Network") {
                        ForEach(found) { f in
                            Button { Task { await model.lookUp(f.url.absoluteString) } } label: {
                                LabeledContent(f.name, value: f.url.host ?? "")
                            }
                        }
                    }
                }
                Section {
                    TextField("mantel.example.com", text: $address)
                        .keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
                        .onSubmit { Task { await model.lookUp(address) } }
                    Button("Continue") { Task { await model.lookUp(address) } }.disabled(address.isEmpty || model.busy)
                } header: { Text("Type Its Address") }
                if let p = model.problem { Section { Text(p).foregroundStyle(.red) } }
            }
            .navigationTitle("Set Up")
            .sheet(isPresented: $scanning) {
                ScannerSheet { text in
                    scanning = false
                    if let url = URL(string: text), let link = PairingLink(url: url) { Task { await model.pair(link) } }
                    else { model.problem = "That code is not a Mantel pairing code." }
                }
            }
            .alert("Is This Your Mantel?", isPresented: .constant(model.pending != nil), presenting: model.pending) { _ in
                Button("Yes, Sign In") { model.confirmPending(); Task { await model.signIn() } }
                Button("Cancel", role: .cancel) { model.pending = nil }
            } message: { h in
                Text("“\(h.name)” shows \(model.pendingCode ?? "") here. Check that Mantel Settings → Me → Mantel App shows the same six digits.")
            }
            .onAppear { browser.start { r in Task { @MainActor in found = r } } }
            .onDisappear { browser.stop() }
        }
    }

    private func usePasted() {
        guard let url = URL(string: pasted.trimmingCharacters(in: .whitespaces)), let link = PairingLink(url: url) else {
            model.problem = "That is not a Mantel pairing link."
            return
        }
        Task { await model.pair(link) }
    }
}

/// The camera, reading one QR code. The Simulator has no camera: it says so (paste the link instead).
struct ScannerSheet: View {
    let onCode: (String) -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Group {
                if AVCaptureDevice.default(for: .video) == nil {
                    ContentUnavailableView("No Camera", systemImage: "camera.slash",
                                           description: Text("Paste the pairing link instead."))
                } else {
                    QRScanner(onCode: onCode).ignoresSafeArea()
                }
            }
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
        }
    }
}

struct QRScanner: UIViewControllerRepresentable {
    let onCode: (String) -> Void

    func makeUIViewController(context: Context) -> ScannerController {
        let c = ScannerController()
        c.onCode = onCode
        return c
    }

    func updateUIViewController(_ controller: ScannerController, context: Context) {}

    final class ScannerController: UIViewController, AVCaptureMetadataOutputObjectsDelegate {
        var onCode: ((String) -> Void)?
        private let session = AVCaptureSession()
        private var done = false

        override func viewDidLoad() {
            super.viewDidLoad()
            guard let cam = AVCaptureDevice.default(for: .video), let input = try? AVCaptureDeviceInput(device: cam),
                  session.canAddInput(input) else { return }
            session.addInput(input)
            let out = AVCaptureMetadataOutput()
            guard session.canAddOutput(out) else { return }
            session.addOutput(out)
            out.setMetadataObjectsDelegate(self, queue: .main)
            out.metadataObjectTypes = [.qr]
            let layer = AVCaptureVideoPreviewLayer(session: session)
            layer.videoGravity = .resizeAspectFill
            layer.frame = view.bounds
            view.layer.addSublayer(layer)
            DispatchQueue.global(qos: .userInitiated).async { [session] in session.startRunning() }
        }

        func metadataOutput(_ output: AVCaptureMetadataOutput, didOutput objects: [AVMetadataObject], from: AVCaptureConnection) {
            guard !done, let code = (objects.first as? AVMetadataMachineReadableCodeObject)?.stringValue else { return }
            done = true
            session.stopRunning()
            onCode?(code)
        }
    }
}
