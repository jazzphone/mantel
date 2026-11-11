# TV

Phase 23, 2026-11-10. A room's TV and the Apple TV beside it, as one: a Home Grid block, a detail sheet with an arrow remote,
Show When's **A TV Is On**, and Settings → Accessories → TVs. The plan and mockups the owner approved:
https://claude.ai/artifact/8NE4LZLB5Y27St2gLJtuGF (version 2, after "some of the larger cards have a lot of space that isn't
getting utilized").

The owner's words: a user "may want real tv controls (inputs..possible real volume if offered) and Apple TV controls maybe at the
same time"; "the Touchpad, arrow keys are just easier"; favorite apps "like we have playlist select in the music card"; Live TV stays
its own block ("it does something completely different").

## Where the code is

| Part | File |
| --- | --- |
| The rules: a TV's wiring, favorites, app counts, App Store icons, learning an input | `hk_core/tv.py` |
| The server: counts the apps each Apple TV opens, fetches and keeps icons, learns inputs, `sensor.hk_tv`, `/api/tv/icon/<id>` | `hosts/server/mantel_server/tv.py`, migration `0038_tv_apps.sql` |
| The page's half: rooms' sets, what's on, each brand's remote keys, volume, apps, A TV Is On | `web/hk/modules/hk-tv.js` |
| The sheet (`hk-detail-tv`): any TV or Apple TV tile opens it | `web/hk/sheets/hk-sheet-tv.js` |
| The block (`hk-grid-tv-card`, `tv` in the catalogs) | `web/hk/cards/hk-tv-card.js` |
| Accessories → TVs, one TV's wiring, TV Apps | `web/hk/settings/hk-settings-accessories.js` |

## A room's set

A TV is a media player with `device_class: tv`; a player is an Apple TV (the `apple_tv` integration, or a media player that reports
`app_id` and isn't a speaker: Music Assistant's HomePods report one too). Automatic pairs a TV with the player in its Home Assistant
area. A player with no TV in its room (the Guest Bedroom) is a set of its own: the card and sheet have no input or TV side.

Settings → Accessories → TVs → a TV (`features.tv_sets`, `[{tv, player?, input?, volume?, hidden?}]`, only what isn't Automatic):

- **Player**: Automatic (the one in the room), another, or None.
- **On the TV's Input**: the input the player shows on. Automatic is **learned**: when the player and the TV come on within 45
  seconds of each other (either order), the TV's input then is the player's. A label is no guide: on the house the Master
  Bedroom's Apple TV shows through the soundbar's input (`LG S95TR`), not the one named `Apple TV` (tested 2026-11-10).
- **Volume**: Automatic (the TV when it takes a level or steps, else the player), This TV, The Player, None, or a receiver.
- **Inputs**: the ones nobody uses, turned off, are left out of the sheet.

## What the arrows drive

Whatever is on screen: the player when the TV shows its input, or when that input isn't known yet and the player is awake; the TV's
own remote otherwise. The sheet and Extra Large show **Apple TV | TV**, already set; a tap on the other side lasts until the sheet
closes. One table of keys per brand (`REMOTES` in hk-tv.js):

| Brand | How | Keys |
| --- | --- | --- |
| Apple TV | `remote.send_command` | up, down, left, right, select, menu (Back), home, play_pause |
| LG webOS | `webostv.button` on the TV (no remote entity) | UP, DOWN, LEFT, RIGHT, ENTER, BACK, HOME; play/pause is `media_play_pause` |
| Roku | `remote.send_command` | up, down, left, right, select, back, home, play |
| Samsung, Android TV, Vizio | `remote.send_command` | their own key names |

Tested on the house's Master Bedroom (LG C5 and Apple TV 4K), 2026-11-10: every Apple TV key, Settings opened by `select_source`,
and every LG button were accepted; the screen itself wasn't seen. The Roku and Vizio keys are untested.

## Volume

A slider where the device takes a level (`volume_set`: the LGs, the Vizio), − and + where it only steps (the Rokus), nothing where
neither works or the device is off.

## Apps

- **Recent** (the default): the apps opened most in the house first, from `sensor.hk_tv`, then the favorites, then the common
  streaming apps the player has, then the rest of its list. Apple's own utilities (App Store, Arcade, Computers, Settings...) are left
  out until someone opens one.
- **Favorites**: Accessories → TVs → TV Apps, one list for every Apple TV, in its order.
- A block may show Recent, Favorites or One App.
- **Icons**: Home Assistant gives app names and, for the open app, its bundle id. Mantel's server looks the id up in Apple's App
  Store once (`https://itunes.apple.com/lookup?bundleId=`), fetches the picture from Apple's host (`*.mzstatic.com`; is1 to is5)
  and keeps it in its database. **Firewall: allow the Mantel server to reach `itunes.apple.com` and `*.mzstatic.com`.** The tablets
  only ever ask Mantel. Off with Look Up App Icons. Apple's own apps aren't in the lookup: they use the house's glyphs. An app nobody
  has opened yet has no id, so it's a tile with its name.
- Tapping an app from a dark room: the player on, the TV on (where it can be turned on), the TV to the player's input when that's
  known, then the app.

## The block

S, W, T, L, XL on square and tile cells; every size fills its plate. Small: the app and play/pause, or power when off. Wide: what's
on over five apps. Tall: the picture with its title on it, volume steps, four apps. Large: a wide picture, play/pause and volume, five
apps, Remote and power. Extra Large: Large's left side beside the arrow pad. **TV** is Automatic (the wall tablet's room; elsewhere
the first TV) or one TV; **Shows** Recent, Favorites or one app. The plate and Remote open the sheet.

## Show When: A TV Is On

`{kind: "tv_on", entity?}`: a TV or its player, Tablet's Room, or none for any TV. It holds while the set's TV or player is on.

## Checks

- `tests/test_tv.py`: the settings, counting, icons (asked once, never for Apple's own, only from Apple's host, not when off),
  learning an input either way, and in node the sets, what's on, each brand's keys, an app from a dark room, the apps' order, A TV Is On.
- HK Frontend's suites: the block at every size on both cells and its tap (`test_blocks_taps.js`), the sheet's CSS.
- Drawn on the house's twin at 1280 × 800: the sheet on the Master Bedroom HomeView and the block at every size on both cells.
