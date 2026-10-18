"""THE HK KIOSK THEME'S GLASS, WRITTEN FROM THE DESIGN TABLE (design consolidation 5.2).

hkCards.T in frontend/cards/hk-base.js is the one place a design value lives.
The HK Kiosk theme (theme/hk_kiosk_theme.yaml) publishes the glass set for the
views that use it; this writes those keys from T, value for value, and leaves
every comment and every other key exactly as it is:

    python3 tools/gen_theme.py              rewrite the theme's hk-* glass keys
    python3 tools/gen_theme.py --check      exit 1 if the theme differs from T
    python3 tools/gen_theme.py --tokens OUT.json
                                            the design system's tokens.json
                                            (dark and light, lists not maps)

The theme is read by the integration at start (themes.py); a value changed
here reaches the screens after Home Assistant restarts.
"""
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
# the component's own tools/, or the repository's tools/ beside
# custom_components/hk_frontend
_UP = os.path.dirname(HERE)
COMPONENT = (os.path.join(_UP, "custom_components", "hk_frontend")
             if os.path.isdir(os.path.join(_UP, "custom_components", "hk_frontend")) else _UP)
BASE = os.path.join(COMPONENT, "frontend", "cards", "hk-base.js")
THEME = os.path.join(COMPONENT, "theme", "hk_kiosk_theme.yaml")

# the theme's keys that come from T (the glass set and the two status colors)
THEME_KEYS = ["glass-bg", "glass-border", "glass-shadow-sm", "glass-shadow-lg", "glass-radius",
              "glass-shadow-pill", "glass-shadow-scene", "glass-shadow-tall", "glass-shadow-chip",
              "warn", "fail", "well-bg"]


def _block(src, start, end):
    a = src.index(start)
    return src[a:src.index(end, a)]


def read_table(path=BASE):
    """(T, LIGHT) as dicts, parsed from hk-base.js."""
    src = open(path, encoding="utf-8").read()
    t = dict(re.findall(r"^\s*'([a-z0-9-]+)': '([^']*)'", _block(src, "  var T = {", "\n  };"), re.M))
    light = dict(re.findall(r"^\s*'--hk-([a-z0-9-]+)': '([^']*)'", _block(src, "  var LIGHT = {", "\n  };"), re.M))
    return t, light


def flat(v):
    return re.sub(r"\s+", "", str(v)).strip('"\'')


def yaml_value(v):
    return '"%s"' % v if v.startswith("#") else v


def render(theme_text, t):
    """The theme with each THEME_KEYS line's value set from T."""
    out, done = [], set()
    for line in theme_text.split("\n"):
        m = re.match(r"^(\s*)hk-([a-z0-9-]+):(\s*)(.*)$", line)
        if m and m.group(2) in THEME_KEYS and m.group(2) not in done:
            line = "%shk-%s: %s" % (m.group(1), m.group(2), yaml_value(t[m.group(2)]))
            done.add(m.group(2))
        out.append(line)
    missing = [k for k in THEME_KEYS if k not in done]
    if missing:
        raise SystemExit("gen_theme: the theme has no line for %s" % ", ".join(missing))
    return "\n".join(out)


def differences(theme_text, t):
    got = dict(re.findall(r"^\s*hk-([a-z0-9-]+):\s*(.*)$", theme_text, re.M))
    return [(k, got.get(k), t[k]) for k in THEME_KEYS if flat(got.get(k)) != flat(t[k])]


# what each token is for, for the design system's tokens.json
USAGE = {
    "ink": "Main text on glass.", "ink-2": "Secondary text.", "ink-3": "Faint text.",
    "line": "Hairlines, dividers, grid lines.", "line-strong": "Tracks: a slider, a progress bar, a ring, a bar's empty.",
    "key": "A key, chip or field on a plate.", "key-strong": "A selected or pressed key; a hollow well.",
    "glyph": "An off glyph with no color of its own.", "mark": "Chevrons, ticks, notches, dashed edges.",
    "track-fill": "A progress fill with no accent.", "glass-bg": "The glass plate.", "glass-border": "The plate's edge.",
    "glass-shadow-sm": "Small tiles' shadow.", "glass-shadow-lg": "Larger blocks' shadow.",
    "glass-shadow-pill": "A pill: its lit rim and shadow.", "glass-shadow-tall": "A tall tile, a page card, a panel.",
    "glass-shadow-scene": "A scene pill's lit rim.", "glass-shadow-chip": "A status chip.", "glass-radius": "THE corner.",
    "well-bg": "The icon well on a pill.", "warn": "A warning, as text.", "fail": "A failure, as text.",
    "accent": "Where you are; the logo's orange.", "glow": "What text carries over the sky or a photo.",
    "overlay": "Translucent over its own blur: sheets, banners, the menu, the tab bar.",
    "overlay-solid": "Near-solid, no blur: Tinted's menu and bar, the readout pill, the event editor.",
    "float-plate": "The floating strip outside the Tinted look.",
}
SHADOWS = {"glass-shadow-sm", "glass-shadow-lg", "glass-shadow-pill", "glass-shadow-tall", "glass-shadow-scene",
           "glass-shadow-chip", "glow"}


def tokens(t, light):
    """tokens.json in the design system's format (families as lists)."""
    color, shadow, radius, other = [], [], [], []
    for k, v in t.items():
        lv = light.get(k)
        entry = {"name": "hk-" + k, "usage": USAGE.get(k, "")}
        if k in SHADOWS:
            entry["value"] = v
            shadow.append(entry)
        elif k == "glass-radius":
            entry["value"] = v
            radius.append(entry)
        elif re.match(r"^(rgba?\(|#)", v):
            entry["value"] = {"dark": v}
            # a light value that follows the theme (var(--primary-text-color,
            # #1c1c1e)) is stored as its fallback: the design system takes no var()
            m = lv and re.search(r"(rgba?\([^()]*\)|#[0-9a-fA-F]{3,8})\)?\s*$", lv)
            if m:
                entry["value"]["light"] = m.group(1)
            color.append(entry)
        else:
            entry["value"] = v
            other.append(entry)
    out = {"name": "HK Frontend", "version": 1, "meta": {"source": "custom_components/hk_frontend/frontend/cards/hk-base.js (hkCards.T, LIGHT)"},
           "color": {"themes": [{"id": "dark", "name": "Dark"}, {"id": "light", "name": "Light"}], "tokens": color},
           "shadow": {"tokens": shadow}, "radius": {"tokens": radius}}
    if other:
        out["other"] = {"tokens": other}
    return out


def main(argv):
    # anything but the three modes (--help too): the usage, nothing written
    if [a for a in argv if a not in ("--check", "--tokens")] and "--tokens" not in argv:
        print(__doc__ or "gen_theme.py [--check | --tokens OUT.json]")
        return 2
    t, light = read_table()
    text = open(THEME, encoding="utf-8").read()
    if "--tokens" in argv:
        dest = argv[argv.index("--tokens") + 1]
        json.dump(tokens(t, light), open(dest, "w"), indent=1)
        print("wrote", dest)
        return 0
    if "--check" in argv:
        diff = differences(text, t)
        for k, got, want in diff:
            print("hk-%s: theme %r, T %r" % (k, got, want))
        return 1 if diff else 0
    new = render(text, t)
    if new != text:
        open(THEME, "w", encoding="utf-8").write(new)
        print("updated", THEME)
    else:
        print("unchanged", THEME)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
