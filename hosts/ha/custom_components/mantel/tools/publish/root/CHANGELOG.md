# Changelog

Mantel Link's releases, newest first. A GitHub release's notes are its section here (`tools/publish/publish.py
--release`). Home Assistant 2026.9 or newer.

## Unreleased

## 0.1.12 - 2026-11-02

- **Mantel by its address:** Mantel's address on your network at its own link port (`https://<address>:8766`, shown in Mantel Settings with the pairing code) works without a name, DNS or proxy. Pairing hands Mantel Link Mantel's own certificate authority inside Mantel's proof, and the credential sealed under the code; Mantel Link then trusts that authority alone for the link. An address that is an IP, or on port 8766, pairs this way at once; another whose certificate isn't a public one falls back to it. Reconfigure takes a pairing code for a new address. Needs Mantel 0.1.117 or newer. A discovered Mantel that announces its link address is linked there.

## 0.1.11 - 2026-11-02

- **Versions:** Mantel Link tells Mantel its own version and HK Frontend's when it connects, for Mantel's update check (About → Updates). Needs Mantel 0.1.114 or newer; an older Mantel ignores it.
- **Doorbell talk:** a talk session can stay open between holds, keeping one audio stream to the doorbell so the start of each hold is heard (a UniFi Protect doorbell loses the start of every new stream), and one person talks at a time on a doorbell: the others are told who, and the stream of whoever spoke before is closed first.

## 0.1.10 - 2026-11-02

- **Re-authentication:** when Mantel refuses Mantel Link's credential (it was revoked), Home Assistant asks you to re-authenticate it with a new pairing code (or a credential), and the link retries less and less often until then, instead of every 30 seconds for good.
- **Pairing again** revokes the credential Mantel Link used before, so only one is live.
- A configuration check no longer logs that the link was lost.

## 0.1.9 - 2026-11-01

- **Live TV:** the channels play again after the link to Mantel drops and comes back. Each channel camera picks Home Assistant's live player again once the link has settled (Home Assistant's own picks could leave it with none, and every channel then failed to start).

## 0.1.8 - 2026-10-29

- The code Mantel Link shares with HK Frontend (the link to Mantel, the doorbell's talk-back, page headers) is one copy, kept in step with HK Frontend's.

## 0.1.7 - 2026-10-28

- Hassfest accepts the translations: the addresses in the setup texts are description placeholders.
- Logos for Home Assistant's own brand folder (`logo.png`, `dark_logo.png` and their `@2x` files).

## 0.1.6 - 2026-10-26

- Pairing protocol v2: the address Mantel Link used is in both proofs, so a look-alike cannot be handed the link.
- An older Mantel is named ("Update Mantel first"); a wrong address has its own message.

## 0.1.5 - 2026-10-21

- Mantel in Home Assistant by product; Home Assistant's users each once in People.

## 0.1.4 - 2026-10-21

- Audit: Mantel Link never follows an announced address; a Mantel that moved is given its new address with Reconfigure.

## 0.1.3 - 2026-10-20

- Live TV in the Home Assistant App without HK Frontend: Mantel serves it through Mantel Link.

## 0.1.2 - 2026-10-20

- Show Menu opens Home Assistant's sidebar Home Assistant's own way, so it stays open.
- Without HK Frontend: the house's entities, the Alarm PIN keypad, the doorbell's talk-back, the Energy plan's helper
  sources and the Lights page's Tonight list.
- The entities keep their English names when they are handed over.

## 0.1.1 - 2026-10-19

- A screen's Home Assistant section follows where the screen is: Home Assistant's sidebar inside Home Assistant, one
  row at Mantel's own address.

## 0.1.0 - 2026-10-19

- The first release: one authenticated link to Mantel, found by itself ("Discovered: Mantel") from the Mantel App
  or on the network, with pairing codes.
- Wall tablets as entities, and the actions `set_black_screen`, `show_popup`, `close_popup` and `notify`, also under
  HK Frontend's names.
- Mantel's screens in Home Assistant's sidebar, with a way back; notifications on people's phones through the
  Companion app.
