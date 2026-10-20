import LocalAuthentication
import MantelKit
import SwiftUI

struct RootView: View {
    @EnvironmentObject private var model: SessionModel
    @Environment(\.scenePhase) private var scenePhase
    @State private var unlocked = !SharedStore.shared.requireFaceID

    var body: some View {
        Group {
            switch model.phase {
            case .setup: SetupView()
            case .signIn: SignInView()
            case .ready:
                if unlocked { MainView() } else { LockView(unlocked: $unlocked) }
            }
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .background, SharedStore.shared.requireFaceID { unlocked = false }
            if phase == .active { Task { await model.reconnect() } }
        }
    }
}

/// Face ID before the app opens (decision M10-3: a 30-day device-bound credential, with Face ID to open the app).
///
/// Asked by itself whenever the app comes to the front locked. Not before: the lock goes on as the app goes to the
/// background, and a prompt asked then is refused by iOS (the app is not active), which left only the Unlock button
/// on return.
struct LockView: View {
    @Binding var unlocked: Bool
    @Environment(\.scenePhase) private var scenePhase
    @State private var failed = false
    @State private var asking = false

    var body: some View {
        VStack(spacing: 20) {
            Image(systemName: "lock.fill").font(.system(size: 44)).foregroundStyle(.secondary)
            Text("Mantel is Locked").font(.title2.bold())
            Button("Unlock") { unlock() }.buttonStyle(.borderedProminent)
            if failed { Text("Try again, or use your passcode.").foregroundStyle(.secondary) }
        }
        .onAppear { if scenePhase == .active { unlock() } }
        .onChange(of: scenePhase) { _, phase in if phase == .active { unlock() } }
    }

    private func unlock() {
        guard !asking, !unlocked else { return }
        let ctx = LAContext()
        var err: NSError?
        #if targetEnvironment(simulator)
        // a Simulator without Face ID enrolled (Features → Face ID): nothing real to ask; never its passcode
        if !ctx.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &err) {
            unlocked = true
            return
        }
        #endif
        guard ctx.canEvaluatePolicy(.deviceOwnerAuthentication, error: &err) else {
            unlocked = true           // no passcode set at all (a fresh Simulator): nothing to ask
            return
        }
        asking = true
        ctx.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: "Open Mantel") { ok, error in
            DispatchQueue.main.async {
                asking = false
                unlocked = ok
                // the system or the app called it off (the app left the front): not a failure, asked again on return
                let code = (error as? LAError)?.code
                failed = !ok && code != .systemCancel && code != .appCancel
            }
        }
    }
}

struct SignInView: View {
    @EnvironmentObject private var model: SessionModel

    var body: some View {
        VStack(spacing: 18) {
            Spacer()
            Image("Hearth").resizable().frame(width: 96, height: 96).clipShape(RoundedRectangle(cornerRadius: 22))
            Text(model.house?.name ?? "Mantel").font(.largeTitle.bold())
            Text("Sign in with your Mantel account: a passkey, your password, or Home Assistant.")
                .multilineTextAlignment(.center).foregroundStyle(.secondary).padding(.horizontal)
            Button { Task { await model.signIn() } } label: {
                Text("Sign In").frame(maxWidth: 320).padding(.vertical, 6)
            }
            .buttonStyle(.borderedProminent).disabled(model.busy)
            if let p = model.problem { Text(p).foregroundStyle(.red).multilineTextAlignment(.center).padding(.horizontal) }
            Spacer()
            Button("Use Another Mantel", role: .destructive) { Task { await model.forgetHouse() } }.padding(.bottom)
        }
        .padding()
    }
}
