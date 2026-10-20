import MantelKit
import SwiftUI

/// The iPhone's own Now Playing (docs/phase10/NATIVE-FEEL.md item 7): the Mac app's player (Common/PlayerViews.swift,
/// Common/MusicPanes.swift, Common/MusicModel.swift: app_music.py on the house) as a full-height sheet, in place of the
/// Music page's web sheet. Swipe down to close; Speakers, Up Next and Browse open in place, as Apple Music's do.
/// Every button is the Music page's own request through the gateway, with its audit row; nothing is decided here.
struct NowPlayingSheet: View {
    @EnvironmentObject private var music: MusicModel
    @Environment(\.dismiss) private var dismiss
    @State private var pane: PlayerPane?

    var body: some View {
        ZStack {
            PlayerBackdrop(ref: music.leader?.art)
            VStack(spacing: 0) {
                Capsule().fill(.white.opacity(0.4)).frame(width: 38, height: 5).padding(.top, 10).padding(.bottom, 14)
                    .accessibilityHidden(true)
                content
            }
            .padding(.horizontal, 26)
            .padding(.bottom, 12)
        }
        .environment(\.colorScheme, .dark)
        .presentationDragIndicator(.hidden)
        .presentationBackground(.black)
        .sensoryFeedback(.impact(weight: .light), trigger: music.isPlaying)
        .sensoryFeedback(.selection, trigger: pane)
        .task { await music.refresh() }
    }

    @ViewBuilder private var content: some View {
        if music.state?.configured == false {
            VStack(spacing: 12) {
                Spacer()
                Image(systemName: "hifispeaker.2").font(.system(size: 44)).foregroundStyle(.white.opacity(0.6))
                Text("Music isn't set up in Mantel").font(.title3.bold())
                Text("Mantel's music needs Music Assistant and the music settings in Mantel Settings.")
                    .multilineTextAlignment(.center).foregroundStyle(.white.opacity(0.65))
                Spacer()
            }
            .foregroundStyle(.white)
        } else if let p = pane {
            VStack(alignment: .leading, spacing: 14) {
                PaneHeader(title: p.title) { withAnimation(.spring(response: 0.35, dampingFraction: 0.9)) { pane = nil } }
                switch p {
                case .speakers: SpeakersPane()
                case .upNext: UpNextPane()
                case .browse: BrowsePane(columns: 2)
                }
            }
            .frame(maxHeight: .infinity, alignment: .top)
            .transition(.move(edge: .bottom).combined(with: .opacity))
        } else {
            NowPlayingView(open: { p in withAnimation(.spring(response: 0.35, dampingFraction: 0.9)) { pane = p } })
                .padding(.bottom, 8)
                .transition(.opacity)
        }
    }
}
