import MantelKit
import MediaPlayer

/// The keyboard's play/pause (and next/previous) keys for the house's speaker, without playing any audio on the Mac.
///
/// macOS gives the media keys to the app that says it is playing: Mantel sets `MPNowPlayingInfoCenter`'s
/// `playbackState` and the song's title, artist and times from the person's speaker (the summary's `now_playing`),
/// and answers `MPRemoteCommandCenter`'s commands with the same gateway commands as the menu's buttons
/// (`/api/app/command`). The same commands come from Control Center's Now Playing. Off by default and whenever nothing
/// plays on the house's speaker (then Apple Music and the others keep the keys): not yet seen working on macOS 27
/// (2026-10-19: nothing here could press a media key; the menu's toggle turns it on to try).
@MainActor
final class NowPlayingKeys {
    static let enabledKey = "mediaKeys"
    private weak var model: SessionModel?
    private var registered = false
    private var entity: String?

    var enabled: Bool { UserDefaults.standard.bool(forKey: Self.enabledKey) }

    func attach(_ model: SessionModel) { self.model = model }

    /// Follow the speaker: claim the keys while it plays or is paused, let them go when it stops or is turned off.
    func follow(_ p: EntityState?) {
        let center = MPNowPlayingInfoCenter.default()
        guard enabled, let p, ["playing", "paused", "buffering"].contains(p.state) else {
            entity = nil
            if registered { unregister() }
            center.nowPlayingInfo = nil
            center.playbackState = .stopped
            return
        }
        entity = p.entity_id
        if !registered { register() }
        var info: [String: Any] = [MPMediaItemPropertyTitle: p.attributes?.media_title ?? p.name,
                                   MPNowPlayingInfoPropertyMediaType: MPNowPlayingInfoMediaType.audio.rawValue,
                                   MPNowPlayingInfoPropertyPlaybackRate: p.state == "playing" ? 1.0 : 0.0]
        if let a = p.attributes?.media_artist { info[MPMediaItemPropertyArtist] = a }
        if let a = p.attributes?.media_album_name { info[MPMediaItemPropertyAlbumTitle] = a }
        if let d = p.attributes?.media_duration { info[MPMediaItemPropertyPlaybackDuration] = d }
        if var t = p.attributes?.media_position {
            if p.state == "playing", let at = p.attributes?.positionAt { t += max(0, Date().timeIntervalSince(at)) }
            info[MPNowPlayingInfoPropertyElapsedPlaybackTime] = t
        }
        center.nowPlayingInfo = info
        center.playbackState = p.state == "playing" ? .playing : .paused
    }

    private func register() {
        let c = MPRemoteCommandCenter.shared()
        let send: (String) -> MPRemoteCommandHandlerStatus = { [weak self] service in
            guard let self, let model = self.model, let e = self.entity else { return .noActionableNowPlayingItem }
            NSLog("Mantel: media key -> media_player.%@", service)
            Task { await model.run(Command(domain: "media_player", service: service, entity_id: e)) }
            return .success
        }
        c.togglePlayPauseCommand.addTarget { _ in send("media_play_pause") }
        c.playCommand.addTarget { _ in send("media_play") }
        c.pauseCommand.addTarget { _ in send("media_pause") }
        c.nextTrackCommand.addTarget { _ in send("media_next_track") }
        c.previousTrackCommand.addTarget { _ in send("media_previous_track") }
        for cmd in [c.togglePlayPauseCommand, c.playCommand, c.pauseCommand, c.nextTrackCommand, c.previousTrackCommand] {
            cmd.isEnabled = true
        }
        registered = true
    }

    private func unregister() {
        let c = MPRemoteCommandCenter.shared()
        for cmd in [c.togglePlayPauseCommand, c.playCommand, c.pauseCommand, c.nextTrackCommand, c.previousTrackCommand] {
            cmd.removeTarget(nil)
        }
        registered = false
    }
}
