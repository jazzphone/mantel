"""Saved designs are isolated snapshots, bounded and validated on existing settings writes."""
import copy

import pytest

from hk_core.settings import model as M, changes as C


def design(ident='blue', **options):
    return {'id': ident, 'name': 'Blue', 'options': {'show': 'clock', 'clock_style': 'solar', **options}}


def test_old_options_keep_their_behavior_and_library_is_opt_in():
    value = M.saver_options({'show': 'forecast', 'clock_style': 'planted'})
    assert value['show'] == 'forecast' and value['clock_style'] == 'planted'
    assert value['designs'] == [] and value['active_design'] == ''


def test_roundtrip_all_faces_widgets_options_and_independent_scope():
    for style in M.SAVER_DESIGN_FACES:
        options = {'clock_style': style, 'clock_options': {'cities': [{'name': 'London', 'zone': 'Europe/London'}],
                   'watch_shape': 'cushion', 'metal': 'gold', 'market_entities': ['sensor.index'], 'news_entity': 'sensor.news'}}
        value = {'designs': [design(**options)], 'active_design': 'blue', **options}
        cleaned = C._saver_options(value)
        assert cleaned['clock_options'] == options['clock_options']
        assert cleaned['designs'][0]['options']['clock_style'] == style
        local = copy.deepcopy(cleaned)
        local['designs'][0]['name'] = 'Local'
        assert cleaned['designs'][0]['name'] == 'Blue'


@pytest.mark.parametrize('value', [
    {'designs': [design(), design()]},
    {'designs': [design('bad space')]},
    {'designs': [dict(design(), name=' ')]},
    {'designs': [dict(design(), name='x' * 61)]},
    {'designs': [design(str(i)) for i in range(13)]},
    {'designs': [design(designs=[])]},
    {'designs': [design(active_design='blue')]},
    {'designs': [design(clock_style='invented')]},
    {'active_design': 'missing'},
    {'clock_options': {'cities': [{'name': 'City', 'zone': 'Not/A_Zone'}]}},
    {'clock_options': {'rotation': True}},
    {'clock_options': {'rotation': float('nan')}},
    {'clock_options': {'market_entities': ['light.kitchen']}},
    {'clock_options': {'unknown': 'value'}},
])
def test_invalid_library_and_face_options_refused(value):
    assert M.saver_options(value) is None
    with pytest.raises(C.Invalid):
        C._saver_options(value)


def test_a_saved_layout_is_checked_as_strictly_as_the_active_layout():
    bad = {'v': 2, 'big': {'kind': 'time'}, 'zones': {'line': [{'piece': 'camera', 'shape': 'card'}]}}
    with pytest.raises(C.Invalid):
        C._saver_options({'designs': [design(layout=bad)]})


def test_sparse_snapshots_keep_values_derived_from_legacy_options():
    cleaned = M.saver_options({'designs': [design(music_slide=True)]})
    snapshot = cleaned['designs'][0]['options']
    assert snapshot['music_slide'] is False
    assert snapshot['music_first'] is True
    assert M.saver_options(snapshot)['music_first'] is True
