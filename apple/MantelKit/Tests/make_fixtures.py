"""Make MantelKit's cross-language fixtures from the server's own crypto (app_crypto.py), so the Swift tests prove
the two sides agree. Fictional, test-only keys. Run: .venv/bin/python apple/MantelKit/Tests/make_fixtures.py"""
import hashlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "hosts/server"))
from cryptography.hazmat.primitives.asymmetric import ec  # noqa: E402

from mantel_server import app_auth, app_crypto  # noqa: E402

out = {}
# a notification sealed to a phone's key
dev = ec.derive_private_key(0x1F2E3D4C5B6A79881F2E3D4C5B6A79881F2E3D4C5B6A79881F2E3D4C5B6A7988, ec.SECP256R1())
content = {"title": "Front Door", "body": "Opened", "entity": "lock.front_door", "tag": "door", "important": True}
out["device_private"] = app_crypto.b64u(dev.private_numbers().private_value.to_bytes(32, "big"))
out["sealed"] = app_crypto.seal_for_device(json.dumps(content).encode(), app_crypto.raw_public(dev.public_key()))
out["content"] = content
# the house's hello, signed
house = ec.derive_private_key(0x2A3B4C5D6E7F80912A3B4C5D6E7F80912A3B4C5D6E7F80912A3B4C5D6E7F8091, ec.SECP256R1())
fp = app_crypto.fingerprint(house.public_key())
nonce = "fixture-nonce-0123456789"
out["hello"] = {"service": "mantel", "name": "The Example House", "fingerprint": fp,
                "key": app_crypto.b64u(app_crypto.raw_public(house.public_key())), "door": "lan",
                "addresses": {"local": "https://mantel.home.example", "remote": None}, "nonce": nonce,
                "signature": app_crypto.b64u(app_crypto.es256_sign(house, app_auth.hello_message(nonce, fp)))}
out["short_code"] = app_crypto.short_code(fp)
# a device signing key and its thumbprint, as the server computes it
sig = ec.derive_private_key(0x3C4D5E6F708192A33C4D5E6F708192A33C4D5E6F708192A33C4D5E6F708192A3, ec.SECP256R1())
out["signing_private"] = app_crypto.b64u(sig.private_numbers().private_value.to_bytes(32, "big"))
out["thumbprint"] = app_crypto.thumbprint(app_crypto.jwk_of(sig.public_key()))
out["pkce"] = {"verifier": "fixture-verifier-" + "a" * 40,
               "challenge": app_crypto.b64u(hashlib.sha256(("fixture-verifier-" + "a" * 40).encode()).digest())}
path = Path(__file__).parent / "MantelKitTests/Fixtures/crypto.json"
path.write_text(json.dumps(out, indent=2) + "\n")
print("wrote", path)
