# Moving from HK Frontend

For a house that wants Mantel to run what [HK Frontend](https://github.com/jazzphone/hk-frontend) runs. A house moves one step at a time, and every step but the last can be undone. Moving is a choice: HK Frontend stays a product of its own, and the two can run together, each wall tablet run by one of them ([HK Frontend and Mantel](https://github.com/jazzphone/mantel/wiki/HK-Frontend-and-Mantel)). Every
entity keeps its entity id, its history and its customisations (Home Assistant moves the same registry entry).
Mantel's guide has the same steps from Mantel's side: [Moving from HK Frontend](https://github.com/jazzphone/mantel/wiki/Moving-from-HK-Frontend).

## If you never used Mantel

1. Install Mantel: the Mantel App (Home Assistant OS or Supervised), or Mantel in Docker or the LXC (Container, Core)
   ([Install](https://github.com/jazzphone/mantel/wiki/Install)).
2. Import HK Frontend's settings into Mantel once, as its Owner: Mantel Settings → Set Up Mantel → Screens (or
   Connections → Home Assistant → Moving from HK Frontend) → **Import HK's Settings from Home Assistant**; or, where
   you run the server, `mantel-server import-settings`. Your screens, tablets, pop-ups and chips come across; nothing changes in Home Assistant.
3. Continue below.

## The steps

1. **Update HK Frontend to its last release** and turn on HK Frontend → Configure → **Linked to Mantel**. (The
   address fills itself in when the Mantel App is installed.)
2. **Install Mantel Link** and add it ([Setup](Setup.md)). It starts **dormant**: linked, its actions work, but it
   shows none of Mantel's entities, because HK Frontend still does.
3. **Hand over the bridge.** Mantel Settings → Connections → Home Assistant → Moving from HK Frontend → Advanced → **Hand the Bridge to Mantel Link**
   (an Owner; it is in the Audit Log). HK Frontend lets go of Mantel's entities; Mantel Link takes the same ones over.
   `hk_frontend.set_black_screen` keeps reaching every tablet throughout.
4. **Move the tablets to Mantel**, one at a time, on Moving from HK Frontend (Wall Tablets: each tablet's Run by
   Mantel), then the rest of the house on its Advanced (The House: Seasonal decorations, the Alarm PIN panel, Live TV's sensors and cameras). Each moves to Mantel Link with
   its entity id and history.
5. **Set the Alarm PIN again in Mantel** (Mantel Settings → Security, under Pages → Change PIN). Home Assistant never gives its
   PIN out, so the PIN HK Frontend kept can't come across; once the rest of the house is Mantel's, the PIN is kept
   only in Mantel and the Alarm PIN panel in Home Assistant checks Mantel's.
6. **Remove HK Frontend** once every tablet and the rest of the house are Mantel's, and everything you used in HK
   Frontend works in Mantel. Make a backup first, then delete HK Frontend's entry, uninstall it in HACS and restart
   Home Assistant. Mantel Link answers the `hk_frontend.*` actions itself as soon as the entry is deleted.

## Going back

- Before step 6: Connections → Home Assistant → Moving from HK Frontend: move the rest of the house (Advanced → The
  House), then each tablet, back to HK Frontend, and **Give the Bridge to HK Frontend** (Advanced). HK Frontend takes the same entities back; Mantel Link goes dormant.
- After step 6: reinstall HK Frontend's last release and link it first; until then Mantel refuses to move anything
  back (nothing in Home Assistant would run it). Your settings are still in Mantel.
- Removing Mantel Link hands its entities back to HK Frontend if HK Frontend is still installed.

## What goes away with HK Frontend

HK Frontend's own dashboards inside Home Assistant (a screen in Home Assistant is Mantel's now: Mantel Settings → the
screen → Show in Home Assistant), the HK Settings panel (it is Mantel Settings), and HK Frontend's engines in Home
Assistant (Mantel has its own).
