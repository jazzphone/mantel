# Moving from HK Frontend

You already use HK Frontend inside Home Assistant and want Mantel to run your
screens. This page moves a home one step at a time. Your screens, tablets,
pop-ups and chips come across; every entity keeps its entity id and history;
your automations keep calling the same `hk_frontend.*` actions. Every step but
the last can be undone, and HK Frontend keeps working until you move each
part.

Moving is a choice: [HK Frontend](https://github.com/jazzphone/hk-frontend)
stays a product of its own, and the two can run together
([HK Frontend and Mantel](HK-Frontend-and-Mantel.md)). Mantel Link's own
repository has the same steps from Home Assistant's side:
[Moving from HK Frontend](https://github.com/jazzphone/mantel-link/blob/main/docs/Moving-from-HK-Frontend.md).

## Before you start

- **Make a Home Assistant backup** before each step that changes Home
  Assistant (**Settings → System → Backups**).
- **Write down each wall tablet's start address** in its kiosk app. Putting it
  back is how you roll a tablet back.
- **Keep the tablets' Home Assistant users** (and `trusted_networks`, if they
  sign in that way) until the move is finished. A tablet's HK Frontend
  dashboard is its way back.
- Do one step at a time, and use your home for a day or two before the next.

| Step | Changes Home Assistant | Undo |
|---|---|---|
| 1. Install Mantel and import | No | Remove Mantel |
| 2. Side by side, read-only | No | Nothing to undo |
| 3. Turn commands on | No | Turn them off |
| 4. Link HK Frontend and add Mantel Link | Yes | Turn linked mode off, remove Mantel Link |
| 5. Move the tablets | Yes | Move each one back |
| 6. Phones and computers | No | Use HK Frontend's dashboards again |
| 7. Move the rest of the house | Yes | Move it back |
| 8. Remove HK Frontend (optional) | Yes | Reinstall HK Frontend's last release |

## 1. Install Mantel and import your settings

1. **Install Mantel**: the Mantel App on Home Assistant OS or Supervised, or
   Docker or the Proxmox container on any install ([Install](Install.md)).
2. **Create the first Owner and connect Home Assistant**
   ([First Run](First-Run.md)). Mantel's Home Assistant user must be an
   administrator: the import reads HK Frontend's settings as that user.
3. **Import HK's settings, once**, as the Owner: in **Mantel Settings** →
   **Set Up Mantel** → **Screens** (or **Connections** → **Home Assistant** →
   **Moving from HK Frontend**), under **Import from HK Frontend**, select
   **Import HK's Settings from Home Assistant**. In Docker or the LXC you can
   also run `docker compose exec mantel-server mantel import-settings`. Both
   use the Home Assistant connection Mantel already has: the App's own, or
   the one you made on the Connections page or in the `ha_token` secret
   file.

   Your looks, rooms, screens, tablets, pop-ups, custom pages, chips and
   accessories come across, along with the settings of HK's features
   (Notifications, Clean Areas, Energy, Live TV and Music). Nothing is written
   to Home Assistant. Running it again changes nothing; anything you have
   already edited in Mantel is left alone.
4. **Connect Music Assistant**, if you use HK's Music
   ([Music and Cameras](Music-and-Cameras.md)).

From now on Mantel keeps its own copy. A change made in HK Settings inside
Home Assistant does not reach Mantel, and the other way round.

**Your files.** Apple's SF Pro font and the SF Symbols glyphs can't ship with
Mantel either. Add them once in **Mantel Settings → Your Files**, from the
same files HK Frontend uses.

## 2. Run side by side, read-only

A new Mantel **cannot send a command** to your home. Its screens show
everything live, and settings saves work, but every button that would change
something is refused.

1. Open Mantel on a phone or computer ([Signing In](Signing-In.md)) and compare
   its screens with HK Frontend's.
2. Fix what looks wrong in **Mantel Settings**. It is HK Settings, plus
   Mantel's own pages (People, Roles & Grants, Connections, Audit
   Log and more).
3. Set up people and roles ([People and Roles](People-and-Roles.md)).

HK Frontend keeps running your tablets the whole time.

## 3. Turn house commands on

When Mantel's screens look right, turn commands on. Every command is then
checked against the person's role and written to the
[Audit Log](Commands-and-Audit.md) before it is sent.

- **Everywhere** (the Mantel App, Docker, the container): as the Owner, open
  **Mantel Settings** → **General** and turn on **Allow Control of the House**.
  Mantel asks you to confirm it is you. It applies at once, with no restart. See
  [Commands and Audit](Commands-and-Audit.md).

**Undo**: turn it off again. That is always safe.

## 4. Link HK Frontend and add Mantel Link


1. **Update HK Frontend** to its latest release in HACS and restart Home
   Assistant.
2. **Make a credential**: **Mantel Settings → Connections → Home Assistant →
   HK Frontend → Link HK Frontend…**. Copy it; it is shown once.
3. In Home Assistant, **Settings → Devices & services → HK Frontend →
   Configure → Linked to Mantel**. Turn on **Linked to Mantel**, check **Mantel's
   address** (it fills itself in when the Mantel App or Mantel Link is
   installed), paste the **Service credential**, and save.
   Nothing changes yet: every tablet is still Home Assistant's.
4. **Install Mantel Link** ([Mantel Link](Mantel-Link.md)). It starts
   **dormant**: linked, but showing none of Mantel's entities, because HK
   Frontend still does.
5. **Hand over the bridge**: **Mantel Settings → Connections → Home Assistant
   → Moving from HK Frontend → Advanced → Hand the Bridge to Mantel Link**. HK Frontend lets go of Mantel's
   entities and Mantel Link takes over the same ones, with the same entity ids
   and history. `hk_frontend.set_black_screen` keeps working throughout.

Check in Home Assistant that your tablet entities still have their entity ids,
and that a sleep script or the doorbell automation still runs.

**Undo**: **Give the Bridge to HK Frontend**, then turn **Linked to
Mantel** off. Removing Mantel Link hands its entities back to HK Frontend
first.

## 5. Move the wall tablets, one at a time

Start with a tablet you can reach easily. For each tablet:

1. **Point it at Mantel.** Set its kiosk app's start address to Mantel and
   sign it in as a wall tablet ([Wall Tablets](Wall-Tablets.md)). Under the
   Mantel App, a tablet can instead keep its own Home Assistant user and open
   Mantel's App panel; an Owner links that user as a wall tablet.
2. **Move it to Mantel**: **Mantel Settings → Connections → Home Assistant
   → Moving from HK Frontend**, group **Wall Tablets**: turn on that tablet's **Run by Mantel**. Mantel now
   runs its Sleep Screen and black screen; its four entities keep their ids.
3. **Check it** for a day and a night: the black screen and wake, the
   screensaver, the doorbell pop-up, and the automations that call
   `hk_frontend.set_black_screen` on it.

**Undo**: turn its **Run by Mantel** off again on the same page, and put its
old start address back.

## 6. Phones and computers

Each person signs in to Mantel at its own address or through Home Assistant's
sidebar ([Signing In](Signing-In.md)). In Home Assistant, a person can make a
Mantel screen their default dashboard (**Profile → Dashboard**) so the
Companion app opens on it: turn on **Show in Home Assistant** on that screen in
Mantel Settings first (it needs direct access, so browsers reach Mantel at an
address of its own: in the App, **Direct access** set to `proxy` or `https`). iPhone, iPad and Mac users can use the
[apps](iPhone-and-Mac-Apps.md).

## 7. Move the rest of the house

When every tablet is Mantel's, move the rest: Seasonal decorations, the Alarm
PIN panel, and Live TV's sensors and cameras. **Set Up Mantel** lists this step
(**Move the House to Mantel**) while HK Frontend is still in Home Assistant, and
**Connections → Home Assistant** says **Move the House** once every tablet is
Mantel's. (If you remove HK Frontend instead, Mantel takes the house by itself.)

1. Make a Home Assistant backup.
2. **Mantel Settings → Connections → Home Assistant → Moving from HK Frontend →
   Advanced**: move the rest of the house to Mantel. Each entity moves with its entity id and history.
3. **Set the Alarm PIN again**: **Mantel Settings → Security** (under
   **Pages**) **→ Change PIN**.
   Home Assistant never gives its PIN out, so the PIN HK Frontend kept can't
   come across. From now on the PIN is kept only in Mantel, and the Alarm PIN
   panel in Home Assistant checks Mantel's.
4. Run your house automations once by hand: sleep and wake scripts, the
   doorbell and alarm pop-ups.

**Undo**: move the rest of the house back first, then any tablet.

## 8. Remove HK Frontend (optional, last)

Only when every tablet and the rest of the house are Mantel's, and everything
you used in HK Frontend works in Mantel.

1. Make a full Home Assistant backup.
2. **Settings → Devices & services → HK Frontend → Delete**.
3. In HACS, uninstall HK Frontend, then restart Home Assistant.

Mantel Link answers the `hk_frontend.*` actions itself from the moment the
entry is deleted, so your automations and scripts keep working unchanged.
Renaming them to `mantel.*` is optional.

What goes away: HK Frontend's own dashboards inside Home Assistant, the HK
Settings panel (it is Mantel Settings), and HK Frontend's engines in Home
Assistant (Mantel has its own).

**Undo**: restore the backup, or reinstall HK Frontend's last release and link
it again. Until it is linked, Mantel refuses to move anything back, because
nothing in Home Assistant would run it. Your settings are still in Mantel.

## If something goes wrong

| Symptom | First thing to try |
|---|---|
| A tablet shows Mantel's sign-in page | Sign it in as a wall tablet again ([Wall Tablets](Wall-Tablets.md)) |
| Buttons do nothing, the console says `commands_disabled` | House commands are off (step 3) |
| An automation's `hk_frontend.set_black_screen` doesn't reach a tablet | Check who runs that tablet (**Connections → Home Assistant → Moving from HK Frontend**) and who holds the bridge (its **Advanced**) |
| Entities are unavailable | The link to Mantel is down; Mantel Link's diagnostics say why |
| Anything else | Roll that step back, then see [Troubleshooting](Troubleshooting.md) |
