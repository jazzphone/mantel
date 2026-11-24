"""AIRPLAY OUT: Mantel sends a Live TV channel to an AirPlay screen (Apple HomeView first), phase 35
(docs/phase35/PLAN.md, the owner 2026-11-24: "tap the widget from the HomeView and have the mantel server feed the
homeview the AirPlay stream of the channel").

Video only, and only what a HomeView needs: the screen fetches the channel's keyed HLS address itself
(cameras/stream_keys.py), so nothing here carries media. The pieces:

* ``hap``: HomeKit pairing (SRP pair-setup with the code on the screen, pair-verify) and the encrypted framing;
* ``rtsp``: one AirPlay control connection (HTTP for pairing, RTSP after), and the screen's event channel;
* ``session``: pairing a screen, and a show: the steps of the plan's table, its feedback, its end.

Ported in part from pyatv (https://github.com/postlund/pyatv), MIT License, Copyright (c) 2017-2025 Pierre Ståhl:
the HAP pairing and channel encryption, kept to what this needs and rewritten on ``cryptography`` alone.
"""
