import ActivityKit
import AppIntents
import SwiftUI
import WidgetKit

/// The house's music on the Lock Screen and in the Dynamic Island, laid out like Apple Music's own player: the
/// cover, title and artist, the speaker where AirPlay shows its route, the track's progress with its times, and
/// large back / play-pause / forward buttons; the background tinted from the cover (§6). Every button is a gateway
/// command (MusicControlIntent). A Live Activity can hold buttons but no slider, so volume is − and + buttons.
struct MusicLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: MusicActivityAttributes.self) { ctx in
            LockScreenPlayer(attributes: ctx.attributes, state: ctx.state)
                .activityBackgroundTint(Color(playerTint: ctx.state.tint))
                .activitySystemActionForegroundColor(.white)
                .widgetURL(URL(string: "mantel://player"))         // a tap: the app's own player
        } dynamicIsland: { ctx in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Cover(file: ctx.state.artFile, size: 56).padding(.leading, 4)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    Image(systemName: "hifispeaker.fill").font(.title3).foregroundStyle(.secondary)
                        .padding(.trailing, 6).padding(.top, 6)
                }
                DynamicIslandExpandedRegion(.center) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(ctx.state.title).font(.headline).lineLimit(1)
                        Text(ctx.state.artist).font(.subheadline).foregroundStyle(.secondary).lineLimit(1)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading).padding(.top, 6)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    VStack(spacing: 8) {
                        Progress(state: ctx.state)
                        Transport(speaker: ctx.attributes.speaker, playing: ctx.state.playing, big: false)
                    }
                    .padding(.horizontal, 4)
                }
            } compactLeading: {
                Cover(file: ctx.state.artFile, size: 22)
            } compactTrailing: {
                Image(systemName: ctx.state.playing ? "waveform" : "pause.fill").foregroundStyle(.orange)
            } minimal: {
                Cover(file: ctx.state.artFile, size: 22)
            }
            .widgetURL(URL(string: "mantel://player"))
        }
    }
}

private struct LockScreenPlayer: View {
    let attributes: MusicActivityAttributes
    let state: MusicActivityAttributes.ContentState

    var body: some View {
        // the Lock Screen gives an activity at most 160 points of height: cover row, progress, buttons fit in ~150
        VStack(spacing: 8) {
            HStack(spacing: 12) {
                Cover(file: state.artFile, size: 50)
                VStack(alignment: .leading, spacing: 2) {
                    Text(state.title).font(.headline).foregroundStyle(.white).lineLimit(1)
                    Text(state.artist).font(.subheadline).foregroundStyle(.white.opacity(0.65)).lineLimit(1)
                }
                Spacer(minLength: 8)
                VStack(spacing: 3) {
                    Image(systemName: "hifispeaker.fill").font(.callout)
                    Text(attributes.room).font(.caption2).lineLimit(2).multilineTextAlignment(.center)
                        .minimumScaleFactor(0.85)
                }
                .foregroundStyle(.white.opacity(0.65)).frame(maxWidth: 84)
            }
            Progress(state: state)
            Transport(speaker: attributes.speaker, playing: state.playing, big: true)
        }
        .padding(.horizontal, 16).padding(.vertical, 12)
    }
}

/// The cover, or a quiet stand-in when there is none.
private struct Cover: View {
    let file: String?
    let size: CGFloat

    var body: some View {
        Group {
            if let file, let url = ArtCache.url(file), let img = UIImage(contentsOfFile: url.path) {
                Image(uiImage: img).resizable().scaledToFill()
            } else {
                ZStack {
                    LinearGradient(colors: [Color(white: 0.35), Color(white: 0.2)], startPoint: .top, endPoint: .bottom)
                    Image(systemName: "music.note").font(.system(size: size * 0.45, weight: .semibold)).foregroundStyle(.white.opacity(0.7))
                }
            }
        }
        .frame(width: size, height: size)
        .clipShape(RoundedRectangle(cornerRadius: size * 0.16, style: .continuous))
    }
}

/// The track's progress and its elapsed / remaining times, running while it plays.
private struct Progress: View {
    let state: MusicActivityAttributes.ContentState

    var body: some View {
        if let span = state.span {
            VStack(spacing: 3) {
                if state.playing {
                    ProgressView(timerInterval: span, countsDown: false).labelsHidden()
                        .tint(.white).progressViewStyle(.linear)
                    // a timer text takes the width of its longest value: bound each and pin it to its edge
                    HStack(spacing: 0) {
                        Text(timerInterval: span, countsDown: false)
                            .multilineTextAlignment(.leading).frame(width: 56, alignment: .leading)
                        Spacer(minLength: 0)
                        (Text("-") + Text(timerInterval: span, countsDown: true))
                            .multilineTextAlignment(.trailing).frame(width: 56, alignment: .trailing)
                    }
                    .font(.caption2.monospacedDigit()).foregroundStyle(.white.opacity(0.6))
                } else {
                    let p = min(state.position ?? 0, state.duration ?? 0)
                    ProgressView(value: p, total: max(state.duration ?? 1, 1)).tint(.white).progressViewStyle(.linear)
                    HStack {
                        Text(clock(p))
                        Spacer()
                        Text("-" + clock((state.duration ?? 0) - p))
                    }
                    .font(.caption2.monospacedDigit()).foregroundStyle(.white.opacity(0.6))
                }
            }
        }
    }

    private func clock(_ s: Double) -> String {
        let t = Int(max(0, s).rounded())
        return t >= 3600 ? String(format: "%d:%02d:%02d", t / 3600, t / 60 % 60, t % 60) : String(format: "%d:%02d", t / 60, t % 60)
    }
}

/// Back, play/pause and forward, large and centred; volume − and + small at the edges.
private struct Transport: View {
    let speaker: String
    let playing: Bool
    let big: Bool

    var body: some View {
        HStack(spacing: 0) {
            Button(intent: MusicControlIntent(.volumeDown, speaker: speaker)) {
                Image(systemName: "speaker.fill").font(.footnote).frame(width: 32, height: 32)
            }
            .foregroundStyle(.white.opacity(0.55))
            Spacer()
            Button(intent: MusicControlIntent(.previous, speaker: speaker)) {
                Image(systemName: "backward.fill").font(.system(size: big ? 24 : 20)).frame(width: 52, height: 34)
            }
            Spacer()
            Button(intent: MusicControlIntent(.playPause, speaker: speaker)) {
                Image(systemName: playing ? "pause.fill" : "play.fill").font(.system(size: big ? 30 : 26))
                    .frame(width: 56, height: 34)
            }
            Spacer()
            Button(intent: MusicControlIntent(.next, speaker: speaker)) {
                Image(systemName: "forward.fill").font(.system(size: big ? 24 : 20)).frame(width: 52, height: 34)
            }
            Spacer()
            Button(intent: MusicControlIntent(.volumeUp, speaker: speaker)) {
                Image(systemName: "speaker.wave.3.fill").font(.footnote).frame(width: 32, height: 32)
            }
            .foregroundStyle(.white.opacity(0.55))
        }
        .buttonStyle(.plain)
        .foregroundStyle(.white)
    }
}
