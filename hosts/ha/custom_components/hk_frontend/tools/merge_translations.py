"""Merge each feature's translations.en.json fragment into translations/en.json
(a deep merge; the fragment's keys win), and report keys that clash between
fragments. Run after changing a feature's strings:

    python3 tools/merge_translations.py
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
# the component's own tools/, or the repository's tools/ beside
# custom_components/hk_frontend
_UP = os.path.dirname(HERE)
COMPONENT = (os.path.join(_UP, "custom_components", "hk_frontend")
             if os.path.isdir(os.path.join(_UP, "custom_components", "hk_frontend")) else _UP)
TARGET = os.path.join(COMPONENT, "translations", "en.json")


def merge(dst, src, path, owner, owners, clashes):
    for k, v in src.items():
        p = path + (k,)
        if isinstance(v, dict) and isinstance(dst.get(k), dict):
            merge(dst[k], v, p, owner, owners, clashes)
            continue
        if p in owners and owners[p] != owner and dst.get(k) != v:
            clashes.append((".".join(p), owners[p], owner))
        dst[k] = v
        owners[p] = owner


def main():
    out = json.load(open(TARGET))
    owners, clashes = {}, []
    feats = os.path.join(COMPONENT, "features")
    for kind in sorted(os.listdir(feats)):
        frag = os.path.join(feats, kind, "translations.en.json")
        if os.path.isfile(frag):
            merge(out, json.load(open(frag)), (), kind, owners, clashes)
            print("merged", kind)
    for c in clashes:
        print("CLASH", *c)
    tmp = TARGET + ".tmp"
    with open(tmp, "w") as f:
        json.dump(out, f, indent=2, ensure_ascii=False)
        f.write("\n")
    os.replace(tmp, TARGET)
    return 1 if clashes else 0


if __name__ == "__main__":
    sys.exit(main())
