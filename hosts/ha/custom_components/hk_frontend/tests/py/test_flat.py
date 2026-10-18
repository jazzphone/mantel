"""Appearance settings persist independently and reject invalid atomic writes."""
from custom_components.hk_frontend import settings as S, settings_api as A


def test_flat_is_opt_in_and_does_not_migrate_existing_material():
    assert S.merged(None)['look']['flat'] is False
    assert S.merged(None)['look']['flat_theme'] == 'dark'
    assert S.board(None)['flat'] is None
    old = {'dashboard': {'look': {'glass': 'blur_pre', 'blur': 65}}}
    out, err = A.apply_house(old, {'look.flat': True, 'look.flat_theme': 'light'})
    assert not err
    look = S.merged(out)['look']
    assert look['flat'] and look['flat_theme'] == 'light'
    assert look['glass'] == 'blur_pre' and look['blur'] == 65
    restored, err = A.apply_house(out, {'look.flat': False, 'look.glass': 'tinted'})
    assert not err and S.merged(restored)['look']['flat'] is False
    assert S.merged(restored)['look']['glass'] == 'tinted'


def test_explicit_false_survives_trim_and_follow_resets_to_null():
    own = S.board_stored({'flat': False, 'flat_theme': 'light', 'glass': 'house'})
    assert own['flat'] is False
    assert S.board(own)['flat'] is False and S.board(own)['flat_theme'] == 'light'
    follow = S.board_stored(dict(own, flat=None, glass='house'))
    assert 'flat' not in follow and S.board(follow)['flat'] is None
    assert follow['flat_theme'] == 'light', 'theme inheritance resets separately'
    assert A.BOARD['flat'](None) is None and A.BOARD['flat'](False) is False
    assert A.BOARD['flat_theme'](None) is None


def test_flat_validation_is_atomic_and_normalizes_corrupt_cache():
    opts = {'dashboard': {'look': {'flat': True, 'glass': 'frosted'}}}
    same, err = A.apply_house(opts, {'look.flat': False, 'look.flat_theme': 'auto', 'look.glass': 'tinted'})
    assert err == {'look.flat_theme': 'choice'} and same == opts
    assert S.board({'flat': 'false', 'flat_theme': 'auto'})['flat'] is None
    assert S.merged({'dashboard': {'look': {'flat': 'false', 'flat_theme': 'auto'}}})['look']['flat'] is False


def test_flat_backgrounds_default_to_color_and_validate():
    sky = S.merged(None)['sky']
    assert sky['flat_background'] == 'color' and sky['flat_color'] == 'auto'
    assert sky['flat_fade'] == 50 and sky['flat_pages'] == {}
    b = S.board(None)
    assert b['sky_flat_background'] is None and b['sky_flat_pages'] == {}
    out, err = A.apply_house({}, {'sky.flat_background': 'photo', 'sky.flat_color': '#a1b2c3', 'sky.flat_fade': 70,
                                  'sky.flat_pages': {'climate': 'sage', 'room-kitchen': 'photo', 'lights': '', 'rooms': 'auto'}})
    assert not err
    sky = S.merged(out)['sky']
    assert sky['flat_color'] == '#A1B2C3' and sky['flat_fade'] == 70
    assert sky['flat_pages'] == {'climate': 'sage', 'room-kitchen': 'photo', 'rooms': 'auto'}
    for bad in ({'sky.flat_background': 'live'}, {'sky.flat_color': 'midnight'}, {'sky.flat_fade': 120},
                {'sky.flat_pages': {'climate': 'live'}}):
        same, err = A.apply_house(out, bad)
        assert err and same == out, bad
    # a corrupt cache reads as the defaults; a screen's own survives the trim
    assert S.merged({'dashboard': {'sky': {'flat_background': 'live', 'flat_fade': 'x'}}})['sky']['flat_background'] == 'color'
    own = S.board_stored({'sky_flat_background': 'landscapes', 'sky_flat_fade': 0, 'sky_flat_color': 'nope'})
    assert own == {'sky_flat_background': 'landscapes', 'sky_flat_fade': 0}
    assert 'sky_flat_fade' in S.SKY_RESET_BOARD and 'flat_fade' in S.SKY_RESET


def test_flat_palette_matches_the_dashboard():
    import json, re, subprocess
    from pathlib import Path
    src = (Path(S.__file__).parent / 'frontend/cards/hk-base.js').read_text()
    body = re.search(r"var FLAT_COLORS = (\[.*?\n  \]);", src, re.S)
    assert body
    for cmd in (["node", "-e", "console.log(JSON.stringify(" + body[1] + "))"],
                ["/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc", "-e", "print(JSON.stringify(" + body[1] + "))"]):
        try:
            out = subprocess.run(cmd, capture_output=True, text=True, check=True)
            break
        except FileNotFoundError:
            continue
    assert json.loads(out.stdout) == list(S.FLAT_COLORS)


def test_highlight_color_automatic_is_a_stored_choice():
    assert S.accent('auto') == 'auto' and S.accent('AUTO') == 'auto'
    out, err = A.apply_house({}, {'menu.accent': 'auto'})
    assert not err
    assert A.BOARD['accent']('auto') == 'auto'


def test_each_page_highlight_is_stored_and_checked():
    assert S.merged(None)['look']['page_accents'] == {}
    out, err = A.apply_house({}, {'look.page_accents': {'climate': 'green', 'cameras': '#AB12CD', 'lights': ''}})
    assert not err and S.merged(out)['look']['page_accents'] == {'climate': 'green', 'cameras': '#ab12cd'}
    for bad in ({'climate': 'auto'}, {'climate': 'plaid'}, {'Climate!': 'red'}):
        same, err = A.apply_house(out, {'look.page_accents': bad})
        assert err and same == out, bad


# FLAT COLORS (2026-10-17, PLAN-2026-10-17-flat-appearance-colors.md)
def test_flat_colors_default_to_automatic_and_stay_sparse():
    look = S.merged(None)['look']
    assert look['flat_colors'] == {'accent': 'auto', 'off_tint': 'auto', 'pages': 'accent'}
    assert look['flat_page_colors'] == {}
    b = S.board(None)
    assert b['flat_colors'] == {} and b['flat_page_colors'] == {}
    # nothing stored for the defaults, at either level
    out, err = A.apply_house({}, {'look.flat_colors': {'accent': 'auto', 'off_tint': 'auto'}})
    assert not err and 'flat_colors' not in out['dashboard'].get('look', {})
    assert S.board_stored({'flat_colors': {}, 'flat_page_colors': {'calendar': {}}}) == {}


def test_flat_colors_whole_values_validate_atomically():
    out, err = A.apply_house({}, {'look.flat_colors': {'accent': '#7E9B83', 'off_tint': 'accent'},
                                  'look.flat_page_colors': {'calendar': {'accent': '#C17D91'}, 'room-kitchen': {'off_tint': 'auto'}}})
    assert not err
    look = S.merged(out)['look']
    assert look['flat_colors'] == {'accent': '#7e9b83', 'off_tint': 'accent', 'pages': 'accent'}
    assert look['flat_page_colors'] == {'calendar': {'accent': '#c17d91'}, 'room-kitchen': {'off_tint': 'auto'}}
    for bad in ({'look.flat_colors': {'accent': 'accent'}},           # accent can't bind to itself
                {'look.flat_colors': {'accent': 'plaid'}},
                {'look.flat_colors': {'tint': '#123456'}},             # an unknown field
                {'look.flat_page_colors': {'Calendar!': {'accent': 'red'}}},
                {'look.flat_page_colors': {'calendar': {'off_tint': 12}}},
                {'look.flat_page_colors': {'calendar': 'red'}}):
        same, err = A.apply_house(out, {**bad, 'sky.flat_color': 'sage'})
        assert err and same == out, bad     # nothing else in the call saved either
    # a missing All Screens field is Automatic again
    out2, err = A.apply_house(out, {'look.flat_colors': {'accent': 'red'}})
    assert not err and S.merged(out2)['look']['flat_colors'] == {'accent': 'red', 'off_tint': 'auto', 'pages': 'accent'}


def test_flat_colors_patches_keep_unrelated_pages_and_fields():
    base = {'dashboard': {'look': {'flat_page_colors': {'calendar': {'accent': '#c17d91', 'off_tint': 'accent'},
                                                        'climate': {'accent': 'blue'}},
                                   'flat_colors': {'accent': '#7e9b83', 'off_tint': 'accent'}}}}
    # one field of one page, then the other page, in one call
    out, err = A.apply_house(base, {'look.flat_page_colors.calendar': {'accent': None},
                                    'look.flat_page_colors.weather': {'off_tint': '#789484'},
                                    'look.flat_colors.accent': '#9374bc'})
    assert not err
    look = S.merged(out)['look']
    assert look['flat_page_colors'] == {'calendar': {'off_tint': 'accent'}, 'climate': {'accent': 'blue'},
                                        'weather': {'off_tint': '#789484'}}
    assert look['flat_colors'] == {'accent': '#9374bc', 'off_tint': 'accent', 'pages': 'accent'}, 'the other field survives'
    # a page emptied goes; All Screens' field removed is Automatic
    out, err = A.apply_house(out, {'look.flat_page_colors.calendar': {'off_tint': None},
                                   'look.flat_page_colors.climate': None, 'look.flat_colors.off_tint': None})
    assert not err
    look = S.merged(out)['look']
    assert look['flat_page_colors'] == {'weather': {'off_tint': '#789484'}}
    assert look['flat_colors'] == {'accent': '#9374bc', 'off_tint': 'auto', 'pages': 'accent'}
    for bad in ({'look.flat_page_colors.calendar': {'shade': 'red'}}, {'look.flat_page_colors.calendar': 'red'},
                {'look.flat_colors.accent': 'accent'}, {'look.flat_colors.off_tint': 'plaid'},
                {'look.flat_page_colors.Bad Key': {'accent': 'red'}}):
        same, err = A.apply_house(out, bad)
        assert err and same == out, bad


def test_a_screens_flat_colors_patch_and_trim():
    data = {'flat_colors': {'accent': '#9374bc'}, 'flat_page_colors': {'calendar': {'accent': '#5c91bc', 'off_tint': 'accent'}}}
    out, err = A.apply_board(data, {'flat_colors.off_tint': 'accent', 'flat_page_colors.room-kitchen': {'off_tint': 'auto'},
                                    'flat_page_colors.calendar': {'off_tint': None}})
    assert not err
    assert out['flat_colors'] == {'accent': '#9374bc', 'off_tint': 'accent'}
    assert out['flat_page_colors'] == {'calendar': {'accent': '#5c91bc'}, 'room-kitchen': {'off_tint': 'auto'}}
    stored = S.board_stored(out)
    assert stored['flat_colors'] == out['flat_colors'] and stored['flat_page_colors'] == out['flat_page_colors']
    # Reset This Screen's Flat Colors: both maps whole, empty
    reset, err = A.apply_board(out, {'flat_colors': {}, 'flat_page_colors.calendar': None})
    assert not err and reset['flat_colors'] == {} and 'calendar' not in reset['flat_page_colors']
    # atomic: one bad change, nothing saved
    same, err = A.apply_board(out, {'flat_colors.accent': 'red', 'flat_page_colors.calendar': {'accent': 'plaid'}})
    assert err and same == S.board(out)
    # Glass settings and the legacy highlight are never touched by Flat Colors
    assert out['accent'] == S.board(None)['accent'] and out['glass'] == 'house'
    # a corrupt store reads as what can be read, never a crash
    assert S.board({'flat_colors': {'accent': 'plaid', 'off_tint': 'accent'}, 'flat_page_colors': {'x y': {}, 'ok': {'accent': 'red', 'zz': 1}}}) \
        ['flat_page_colors'] == {'ok': {'accent': 'red'}}
    assert S.board({'flat_colors': 'red'})['flat_colors'] == {}


def test_flat_colors_survive_settings_trim_and_resolved():
    opts = {'dashboard': {'look': {'flat_colors': {'accent': 'red', 'off_tint': 'auto'}}}}
    trimmed, boards, _ = S.settings_trimmed(opts, {'k': {'flat_colors': {'off_tint': '#112233'}}}, {})
    look = S.merged(trimmed or opts)['look']
    assert look['flat_colors'] == {'accent': 'red', 'off_tint': 'auto', 'pages': 'accent'}
    assert boards['k'] == {'flat_colors': {'off_tint': '#112233'}}
    r = S.resolved(S.board(boards['k']), opts)
    assert r['flat_colors'] == {'off_tint': '#112233'}, 'raw, never filled in from All Screens'


def test_a_photos_tint_is_stored_checked_and_reset():
    assert S.merged(None)['sky']['flat_tint'] == 'none' and S.board(None)['sky_flat_tint'] is None
    out, err = A.apply_house({}, {'sky.flat_tint': '#AA3344'})
    assert not err and S.merged(out)['sky']['flat_tint'] == '#aa3344'
    out, err = A.apply_house(out, {'sky.flat_tint': 'accent'})
    assert not err and S.merged(out)['sky']['flat_tint'] == 'accent'
    same, err = A.apply_house(out, {'sky.flat_tint': 'plaid'})
    assert err and same == out
    b, err = A.apply_board({}, {'sky_flat_tint': 'accent'})
    assert not err and b['sky_flat_tint'] == 'accent'
    b, err = A.apply_board(b, {'sky_flat_tint': None})
    assert not err and b['sky_flat_tint'] is None
    assert 'flat_tint' in S.SKY_RESET and 'sky_flat_tint' in S.SKY_RESET_BOARD
    # its strength, 0-100, 35 by default
    assert S.merged(None)['sky']['flat_tint_amount'] == 60 and S.board(None)['sky_flat_tint_amount'] is None
    assert S.merged(None)['sky']['flat_tint_light'] == 50 and S.board(None)['sky_flat_tint_light'] is None
    out0, err = A.apply_house({}, {'sky.flat_tint_light': 80})
    assert not err and S.merged(out0)['sky']['flat_tint_light'] == 80
    assert 'flat_tint_light' in S.SKY_RESET and 'sky_flat_tint_light' in S.SKY_RESET_BOARD
    out, err = A.apply_house({}, {'sky.flat_tint_amount': 15})
    assert not err and S.merged(out)['sky']['flat_tint_amount'] == 15
    same, err = A.apply_house(out, {'sky.flat_tint_amount': 140})
    assert err and same == out
    assert 'flat_tint_amount' in S.SKY_RESET and 'sky_flat_tint_amount' in S.SKY_RESET_BOARD


def test_flat_colors_pages_follow_or_keep_their_own():
    """Pages (2026-10-17): whether pages with a color of their own take a
    screen-wide accent -- All Screens and a screen only, never a page."""
    out, err = A.apply_house({}, {'look.flat_colors.pages': 'own'})
    assert not err and S.merged(out)['look']['flat_colors']['pages'] == 'own'
    out, err = A.apply_house(out, {'look.flat_colors.pages': None})
    assert not err and S.merged(out)['look']['flat_colors']['pages'] == 'accent'
    for bad in ({'look.flat_colors.pages': 'auto'}, {'look.flat_colors.pages': '#123456'},
                {'look.flat_page_colors.climate': {'pages': 'own'}},
                {'look.flat_page_colors': {'climate': {'pages': 'own'}}}):
        same, err = A.apply_house(out, bad)
        assert err and same == out, bad
    b, err = A.apply_board({}, {'flat_colors.pages': 'own'})
    assert not err and b['flat_colors'] == {'pages': 'own'}
    b, err = A.apply_board(b, {'flat_colors.pages': None})
    assert not err and b['flat_colors'] == {}
    same, err = A.apply_board({}, {'flat_page_colors.climate': {'pages': 'own'}})
    assert err
