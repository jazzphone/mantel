<h1 align="center">HK Frontend is now Mantel</h1>

<p align="center">
HK Frontend's dashboards now run in <b>Mantel</b>, and Home Assistant's side of it is <b>Mantel Link</b>.
</p>

HK Frontend is retired. This is its final release: it raises one repair in Home Assistant pointing here, and otherwise
works as before until your house has moved. It gets security fixes only, and this repository will be archived.

## Moving

- **Mantel** draws your screens outside Home Assistant: as a Home Assistant App (Home Assistant OS or Supervised), or
  in Docker or an LXC (Container, Core).
- **Mantel Link** (HACS) is Home Assistant's side: your wall tablets as entities, the actions your automations call
  (`hk_frontend.*` keep working), Mantel's screens in the sidebar, notifications on your phone.
- Your screens, tablets, pop-ups and chips move across; every entity keeps its entity id and history.

The move, step by step: [Moving from HK Frontend](https://github.com/jazzphone/mantel-link/blob/main/docs/Moving-from-HK-Frontend.md).

MIT License.
