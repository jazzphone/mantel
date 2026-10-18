# Features

HK Frontend has six optional features. Each one is added on its own, can be
removed on its own, and none of them changes your dashboards when it is not
there.

| Feature | What it does | What it needs |
|---|---|---|
| [Music](Music.md) | Whole-home music: pick rooms, tap a playlist, move music between rooms | Music Assistant |
| [Live TV](Live-TV.md) | An HDHomeRun tuner’s channels, live with sound on your screens, with a guide | An HDHomeRun, ffmpeg on the Home Assistant host |
| [Clean Areas](Clean-Areas.md) | “Clean these rooms,” sent to whichever vacuums reach them | Vacuums, with room maps for those that clean by area |
| [Alarm PIN](Alarm-PIN.md) | A PIN in front of an alarm panel that takes no code of its own | An alarm panel |
| [Energy](Energy.md) | An Energy page with four tabs, Now, Today, This Week and This Month: whole-home power, cost and use against a usual day, and a tile per circuit. And a Power page beside it: right now, what the house battery backs up, its controls and the cars charging | Home Assistant’s Energy settings (or power sensors you pick) |
| [Notifications](Notifications.md) | A banner at the top of the screens when an accessory does something, with a camera’s snapshot | Nothing |

## Adding a feature

Every feature is added the same way. HK Frontend itself must be set up first
(see [Install](Install.md)).

1. Go to **Settings → Devices & services → HK Frontend**.
2. Select **Add feature**, the first button at the top of the page.
3. Pick the feature. The menu lists only the features you have not added yet;
   Alarm PIN can be added once for each alarm you protect.
4. Answer its form (below, under each feature).

The feature appears in the list on HK Frontend’s page, under the HK Frontend
entry, marked **Feature**. From there:

- Its **gear** changes its settings.
- Its **⋮** menu → **Delete** removes it. The dashboards stay; whatever the
  feature drew (the Music page, the Live TV guide, the vacuum area picker)
  goes away or says it is not set up. Its entities go with it.

Once a feature is added, its settings are also on the HK Settings page (in
the sidebar) under **Features**. That page offers everything its gear does,
and a little more, one change at a time.

HK Frontend is a single entry. Its features, like your screens’ settings,
pop-ups, pages and chips, are items of that entry, so every **Add** button at
the top of its page opens its own form.

---
