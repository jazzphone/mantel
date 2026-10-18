"""Mantel Connect: HA's sidebar in front of a Mantel Server that runs outside Home Assistant.

protocol.py / pki.py   the pairing exchange and the keys, shared with Mantel Server (connect_pairing.py)
pairing.py             the App's side of pairing and certificate renewal
app.py, __main__.py    the App itself: an Ingress reverse proxy over mutual TLS
channel.py, proxy.py   the Phase 0 identity proof's signed-header channel (kept for its tests and the proof App)
"""
