# Virtual Pairs: two speakers as one room (2026-10-31)

The owner: "If I create a group in Music Assistant of 2 speakers in 1 room, I can't assign them with other speakers,
because they are already in a group. So I need to be able to virtually pair 2 speakers to appear as 1 in Mantel ...
and then you have the Actual Group Pair from Music Assistant so Mantel is aware of it as well, so it can choose it at
the appropriate time."

## What there was

A **stereo pair** (0.1.90, `hk_core/music/groups.py`) is a Music Assistant sync group of two players picked as one
speaker. Music Assistant cannot put a group inside another group, so such a room plays on its own or through a preset
whose own Music Assistant group holds both of its players; with any other room it is refused (`engine.pair_alone`).

## What a virtual pair is

Two Music Assistant players Mantel treats as **one room**, with no group in Music Assistant:

* **Stored with the speakers** (`house/music` options `pairs`: `[{players: [first, second], name}]`). The first player
  is the room: it stays in the speakers list (its place, its floor, its home rooms), and the second leaves the list.
  The name is optional; without one the room is named by the first player's area, as every room is.
* **One speaker everywhere.** The screens' feed lists the room once (`speakers[].parts`: its two players), so the
  Music page, Speakers sheets, the Side Pane, the Music and Now Playing blocks, home rooms and Plays On all show one
  speaker. The second player is folded into the first wherever a group's members are read (`MusicConfig.room_of`,
  `hkMusic.fold`).
* **Grouped at play time.** Playing to the room joins the second player to the first (`players/cmd/group_many`),
  exactly as two rooms are joined; with other rooms both players join the leader. So each player is free the rest of
  the time, and the pair joins any other room.
* **Both together.** Volume (the slider, the steps, the house volume at Play) goes to both players. Play, pause, next
  and previous go to the first, which leads the pair, so both follow.

## Music Assistant's own groups

Mantel stays aware of real Music Assistant groups (`players/all`, read every 30 s):

1. **Rooms that are exactly a preset's** play through its group, as before. A preset's rooms are read from its group
   (a group with dynamic members: from its settings, not the members it holds now), the pair's two players folded
   back into the pair; a group holding only one of them is a problem the settings page
   names.
2. **The pair alone, when Music Assistant has a group of exactly its two players**, plays through that group (the
   "Actual Group Pair"): it was made for that room.
3. **Anything else** joins the players ad hoc: the pair's two and the other rooms'. If the pair's own group is
   playing, it is stopped first, so its players are free to join; a move from it hands its queue on as any move does.

A preset always wins over the ad-hoc join, and the pair's own group is used only for the pair alone.

**Mantel writing a preset's group (2026-11-01, MANTEL-FEATURES.md "Presets write Music Assistant's groups").** A
preset's rooms set in Mantel go to its sync group as players: the pair as both of its players (a stereo pair as its
two parts). The pair's own group is never written: its players are the pair, so a preset on it with other rooms is
refused, and the settings page shows its rooms read-only.

## Where the decisions are

`hk_core` (Rules.md rule 2): `config.py` (the pairs, `players_of`, `room_of`, the pair's own group), `groups.py`
(`group_of`, a preset's rooms with the pairs folded), `engine.py` (what is in the way, who leads, what joins, the
volume's players, Browse's target) and `settings.py` (the check and the save). Mantel's engine (music.py) runs the
steps. HK Frontend's engine in Home Assistant keeps working as before; it does not offer virtual pairs (the settings
check refuses them there), since its steps are not built for them.

## Checked

`tests/test_hk_core_music.py` (the decisions), `tests/test_music.py` (the exact Music Assistant commands against the
fictional Music Assistant) and the Settings page in WebKit on the fictional house (`tools/app_dev_server.py --music`).
