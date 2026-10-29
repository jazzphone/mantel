"""What HK Frontend and Mantel Link, the two Home Assistant integrations, share (written once; each vendors it).

Unlike the rest of hk_core, `talk`, `talk_live` and `page_headers` run INSIDE Home Assistant and import it
(tests/test_boundaries.py allows exactly these three); Mantel Server never imports this package.
"""
