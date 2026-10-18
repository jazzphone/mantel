"""Sparse image treatments, atomic edits, inheritance removals, and compatibility."""
import pytest
from custom_components.hk_frontend import settings as S, settings_api as A


def test_existing_settings_stay_legacy_and_sparse():
    old = {'dashboard': {'sky': {'flat_tint': '#123456', 'flat_tint_light': 100}}}
    sk = S.merged(old)['sky']
    assert sk['flat_image_look'] == {} and sk['flat_page_image_looks'] == {}
    assert sk['flat_tint_light'] == 100 and sk['flat_tint'] == '#123456'
    assert S.board(None)['sky_flat_image_look'] == {}
    assert 'flat_image_look' in S.SKY_RESET and 'sky_flat_image_look' in S.SKY_RESET_BOARD


def test_house_edits_patch_current_store_and_reset_one_field():
    out, err = A.apply_house({}, {'sky.flat_image_look.patch': {'mode': 'tinted', 'color': '#AA88CC', 'depth': 30}})
    assert not err
    out, err = A.apply_house(out, {'sky.flat_image_look.patch': {'strength': 85}})
    assert not err and S.merged(out)['sky']['flat_image_look'] == {
        'mode': 'tinted', 'color': '#aa88cc', 'depth': 30, 'strength': 85}
    out, err = A.apply_house(out, {'sky.flat_image_look.patch': {'depth': None}})
    assert not err and 'depth' not in S.merged(out)['sky']['flat_image_look']
    out, err = A.apply_house(out, {'sky.flat_image_look.patch': None})
    assert not err and S.merged(out)['sky']['flat_image_look'] == {}


def test_page_patches_preserve_other_fields_and_pages():
    out, err = A.apply_house({}, {'sky.flat_page_image_looks.room-kitchen': {'mode': 'original'},
                                  'sky.flat_page_image_looks.rooms': {'depth': 90}})
    assert not err
    out, err = A.apply_house(out, {'sky.flat_page_image_looks.room-kitchen': {'brightness': 20}})
    assert not err and S.merged(out)['sky']['flat_page_image_looks'] == {
        'room-kitchen': {'mode': 'original', 'brightness': 20}, 'rooms': {'depth': 90}}
    out, err = A.apply_house(out, {'sky.flat_page_image_looks.room-kitchen': None})
    assert not err and S.merged(out)['sky']['flat_page_image_looks'] == {'rooms': {'depth': 90}}


def test_board_patches_and_own_storage_remain_sparse():
    b, err = A.apply_board({}, {'sky_flat_image_look.patch': {'color': 'accent', 'mode': 'tinted'},
                               'sky_flat_page_image_looks.calendar': {'fade': 0}})
    assert not err
    b, err = A.apply_board(b, {'sky_flat_image_look.patch': {'depth': 75}})
    assert not err and b['sky_flat_image_look'] == {'color': 'accent', 'mode': 'tinted', 'depth': 75}
    assert S.board_stored(b)['sky_flat_page_image_looks'] == {'calendar': {'fade': 0}}
    b, err = A.apply_board(b, {'sky_flat_page_image_looks.calendar': {'fade': None}})
    assert not err and b['sky_flat_page_image_looks'] == {}


def test_whole_object_copy_replaces_while_patch_preserves_fields():
    b, err = A.apply_board({'sky_flat_image_look': {'mode': 'tinted', 'depth': 90}},
                          {'sky_flat_image_look': {'mode': 'original'}})
    assert not err and b['sky_flat_image_look'] == {'mode': 'original'}
    out, err = A.apply_house({'dashboard': {'sky': {'flat_image_look': {'mode': 'tinted', 'depth': 90}}}},
                            {'sky.flat_image_look': {'mode': 'original'}})
    assert not err and S.merged(out)['sky']['flat_image_look'] == {'mode': 'original'}


def test_mixed_house_transaction_keeps_earlier_changes():
    out, err = A.apply_house({}, {'sky.flat_fade': 80,
                                  'sky.flat_image_look': {'mode': 'tinted', 'color': '#123456'},
                                  'sky.flat_image_look.patch': {'depth': 90},
                                  'sky.flat_page_image_looks.calendar': {'brightness': 10}})
    sky = S.merged(out)['sky']
    assert not err and sky['flat_fade'] == 80
    assert sky['flat_image_look'] == {'mode': 'tinted', 'color': '#123456', 'depth': 90}
    assert sky['flat_page_image_looks'] == {'calendar': {'brightness': 10}}


@pytest.mark.parametrize('bad', [{'mode': 'rich'}, {'color': 'none'}, {'color': 1}, {'depth': True},
                                {'depth': 101}, {'brightness': -51}, {'strength': 2.5}, {'fade': float('nan')},
                                {'extra': None}, [], False])
def test_invalid_updates_are_atomic(bad):
    old = {'sky_flat_image_look': {'mode': 'original'}}
    out, err = A.apply_board(old, {'sky_flat_image_look.patch': bad, 'sky_flat_fade': 10})
    assert err and out == S.board(old)
    house = {'dashboard': {'sky': {'flat_image_look': {'mode': 'original'}}}}
    out, err = A.apply_house(house, {'sky.flat_image_look.patch': bad, 'sky.flat_fade': 10})
    assert err and out == house


def test_corrupt_entries_are_pruned_on_read_and_rejected_on_write():
    assert S.flat_image_look({'mode': 'tinted', 'depth': -1, 'extra': 'x'}) == {'mode': 'tinted'}
    assert S.flat_page_image_looks({'../bad': {'mode': 'original'}, 'calendar': {'mode': 'original'}}) == {'calendar': {'mode': 'original'}}
    _, err = A.apply_house({}, {'sky.flat_page_image_looks': {'../bad': {'mode': 'original'}}})
    assert err
