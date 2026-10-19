import ActivityKit
import Foundation
import MantelKit
import os

/// The Live Activity for the person's speaker (§6): started when the summary says it plays, updated as it changes,
/// ended when it stops. Started from the app for now; a push-updated activity (ActivityKit push tokens through
/// APNs) needs the developer account (M10-6).
@MainActor
final class MusicActivityController {
    static let shared = MusicActivityController()
    private var activity: Activity<MusicActivityAttributes>?
    private let log = Logger(subsystem: "app.mantel", category: "music")

    func follow(_ playing: EntityState?, house: House) async {
        guard ActivityAuthorizationInfo().areActivitiesEnabled else {
            log.info("Live Activities are off for Mantel")
            return
        }
        guard let p = playing, ["playing", "paused"].contains(p.state ?? "") else {
            await end()
            return
        }
        var cover: (String, String)?
        if let ref = p.art { cover = await ArtCache.store(ref, using: MantelClient(house: house)) }
        let state = MusicActivityAttributes.ContentState(p, artFile: cover?.0, tint: cover?.1)
        let live = Activity<MusicActivityAttributes>.activities.filter { $0.activityState == .active }
        if let a = (activity.map { [$0] } ?? live).first(where: { $0.activityState == .active }), a.attributes.speaker == p.entity_id {
            activity = a
            await a.update(ActivityContent(state: state, staleDate: Date().addingTimeInterval(1800)))
            return
        }
        await end()
        do {
            activity = try Activity.request(attributes: MusicActivityAttributes(speaker: p.entity_id, room: p.area ?? p.name),
                                            content: ActivityContent(state: state, staleDate: Date().addingTimeInterval(1800)))
            log.info("music activity started for \(p.entity_id, privacy: .public)")
        } catch {
            log.error("music activity not started: \(error.localizedDescription, privacy: .public)")
            activity = nil
        }
    }

    func end() async {
        for a in Activity<MusicActivityAttributes>.activities { await a.end(nil, dismissalPolicy: .immediate) }
        activity = nil
    }
}
