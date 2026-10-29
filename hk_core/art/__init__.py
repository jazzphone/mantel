"""Album art, scaled to the size a tile draws: shared by HK Frontend (art.py) and Mantel (connectors/media_art.py).

* ``resize``: the size buckets, ``render`` (what to serve for a picture's bytes: pixels only, never anything a browser
  would run) and ``Cache`` (most recently used, bounded by bytes and by count).
* ``fetch``: where artwork may be fetched from (the internet; on the home network only Music Assistant's image
  proxy), the address as it travels (base64url), and ``async_fetch`` (a fetch that follows redirects by hand and
  checks every hop). The host gives it a name resolver and a way to run ``render`` off the event loop.
"""
