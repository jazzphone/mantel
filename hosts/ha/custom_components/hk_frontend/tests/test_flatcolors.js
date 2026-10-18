// FLAT COLORS (2026-10-17): the resolver's acceptance matrix
// (hk_house/docs/PLAN-2026-10-17-flat-appearance-colors.md §11), the palette's
// roles, the tiles' off pills, the menu's highlight and the background seed.
// Each field is resolved on its own; Automatic is not inheritance.
if (typeof HK_ROOT === 'undefined') throw new Error('run through tests/run');
load(HK_ROOT + '/tests/dom.js');
document.documentElement = new El('html');
El.prototype.removeAttribute = function (k) { delete this.attrs[k]; };
load(HK_ROOT + '/frontend/modules/hk-settings.js');
load(HK_ROOT + '/frontend/cards/hk-base.js');
load(HK_ROOT + '/frontend/cards/hk-tile.js');
load(HK_ROOT + '/frontend/panels/hk-settings-model.js');
var S = window.hkSettings, C = window.hkCards, M = window.hkSettingsModel, pass = 0, fail = 0;
function ok(n, c, got) { if (c) { pass++; print('PASS ' + n); } else { fail++; print('FAIL ' + n + (got !== undefined ? '   got ' + JSON.stringify(got) : '')); } }

var SAGE = '#7e9b83', LAV = '#9374bc', ROSE = '#c17d91', HARBOR = '#5c91bc', TINT = '#789484';
var R = S.resolveFlatColors;
function look(base, pages) { return { flat_colors: Object.assign({ accent: 'auto', off_tint: 'auto' }, base || {}), flat_page_colors: pages || {} }; }
function v(r, f) { return r[f].value; }

// ---- the matrix, field by field ------------------------------------------
var r = R(look(), null, ['calendar']);
ok('no stored keys: both Automatic', v(r, 'accent') === 'auto' && v(r, 'off_tint') === 'auto' && r.accent.scope === 'house');
r = R({}, { flat_colors: {} }, ['calendar']);
ok('nothing anywhere: the built-in default', r.accent.scope === 'default' && v(r, 'accent') === 'auto');

var G = look({ accent: SAGE, off_tint: 'accent' });
r = R(G, { flat_colors: {} }, ['climate']);
ok('All Screens Sage + linked tint reach a screen with nothing of its own', v(r, 'accent') === SAGE && v(r, 'off_tint') === 'accent' && r.accent.scope === 'house');
var kitchen = { flat_colors: { accent: LAV } };
r = R(G, kitchen, ['climate']);
ok('Kitchen Lavender: its accent, the linked tint inherited as a binding', v(r, 'accent') === LAV && r.accent.scope === 'screen' && v(r, 'off_tint') === 'accent' && r.off_tint.scope === 'house');
ok('another screen stays Sage', v(R(G, { flat_colors: {} }, ['climate']), 'accent') === SAGE);

var GC = look({ accent: SAGE, off_tint: 'accent' }, { calendar: { accent: ROSE } });
r = R(GC, kitchen, ['calendar']);
ok('All Screens Calendar Rose beats Kitchen Lavender (page specificity)', v(r, 'accent') === ROSE && r.accent.scope === 'house-page' && r.accent.page === 'calendar');
var kc = { flat_colors: { accent: LAV }, flat_page_colors: { calendar: { accent: HARBOR } } };
r = R(GC, kc, ['calendar']);
ok('Kitchen Calendar Harbor wins there', v(r, 'accent') === HARBOR && r.accent.scope === 'screen-page');
ok('...only there: another screen’s Calendar stays Rose', v(R(GC, { flat_colors: {} }, ['calendar']), 'accent') === ROSE);

r = R(look({ accent: SAGE, off_tint: 'accent' }, { weather: { off_tint: TINT } }), kitchen, ['weather']);
ok('a page overriding only off_tint: accent from the next source', v(r, 'off_tint') === TINT && v(r, 'accent') === LAV && r.accent.scope === 'screen');
r = R(look({ accent: SAGE, off_tint: 'accent' }, { weather: { accent: ROSE } }), null, ['weather']);
ok('a page overriding only accent: the inherited Match Accent follows it', v(r, 'accent') === ROSE && v(r, 'off_tint') === 'accent');
r = R(look({ accent: SAGE }, { energy: { accent: 'auto' } }), null, ['energy']);
ok('explicit page accent:auto stops at Automatic (no Sage recovered)', v(r, 'accent') === 'auto' && r.accent.scope === 'house-page');
r = R(look({ accent: SAGE, off_tint: TINT }, { energy: { off_tint: 'auto' } }), null, ['energy']);
ok('explicit page off_tint:auto stops at Automatic', v(r, 'off_tint') === 'auto' && v(r, 'accent') === SAGE);

var GR = look({}, { 'room-kitchen': { accent: ROSE } });
r = R(GR, { flat_page_colors: { rooms: { accent: LAV } } }, ['room-kitchen', 'rooms']);
ok('global specific room beats the screen’s Room Pages', v(r, 'accent') === ROSE && r.accent.scope === 'house-page');
r = R(look({}, { 'room-kitchen': { accent: ROSE }, rooms: { accent: SAGE } }),
      { flat_page_colors: { 'room-kitchen': { accent: HARBOR }, rooms: { accent: LAV } } }, ['room-kitchen', 'rooms']);
ok('a screen’s own room beats the global room and both Room Pages', v(r, 'accent') === HARBOR && r.accent.scope === 'screen-page');
r = R(look({ off_tint: TINT }, { rooms: { accent: SAGE } }), { flat_page_colors: { 'room-kitchen': {} } }, ['room-kitchen', 'rooms']);
ok('an empty room entry falls through: Room Pages’ accent, All Screens’ tint', v(r, 'accent') === SAGE && v(r, 'off_tint') === TINT);
r = R(look(), { flat_page_colors: { 'room-kitchen': { off_tint: TINT } } }, ['room-kitchen', 'rooms']);
ok('a removed field keeps the other local field', v(r, 'off_tint') === TINT && r.off_tint.scope === 'screen-page' && v(r, 'accent') === 'auto');
r = R(look({ accent: SAGE, off_tint: TINT }), { flat_colors: { accent: 'auto' } }, []);
ok('screen Automatic suppresses an inherited custom accent', v(r, 'accent') === 'auto' && r.accent.scope === 'screen');
r = R(look({ accent: SAGE }), { flat_colors: {} }, []);
ok('screen reset (nothing stored) follows its parent again', v(r, 'accent') === SAGE);
r = R(look({ accent: SAGE }, { calendar: { accent: ROSE } }), null, ['music']);
ok('a stale or unrelated page entry is never applied elsewhere', v(r, 'accent') === SAGE);
var stored = JSON.parse(JSON.stringify(kc));
R(GC, kc, ['calendar']);
ok('resolving writes nothing back', JSON.stringify(kc) === JSON.stringify(stored));

// ---- through the live settings: the current page's context -----------------
S._apply({ look: { flat: true, flat_theme: 'light', flat_colors: { accent: SAGE, off_tint: 'accent' },
                   flat_page_colors: { calendar: { accent: ROSE } } },
           boards: { 'dashboard-k': { accent: 'orange', flat_colors: { accent: LAV } } }, sky: {} });
location.pathname = '/dashboard-k/calendar';
ok('the page’s address gives its key before the config is there', S.flatColors().keys.join() === 'calendar');
ok('Calendar on Kitchen: Rose', S.flatColors().accent.value === ROSE);
location.pathname = '/dashboard-k/room-office';
ok('a room’s address: the room, then Room Pages', S.flatColors().keys.join() === 'room-office,rooms');
ok('a room on Kitchen with nothing of its own: Kitchen’s Lavender', S.flatColors().accent.value === LAV);
location.pathname = '/dashboard-other/0';
ok('a screen with no item: All Screens’ Sage', S.flatColors().accent.value === SAGE);
location.pathname = '/dashboard-k/music-browse';
ok('music-browse is the Music page', S.flatColors().keys.join() === 'music');

// ---- the palette's roles --------------------------------------------------
location.pathname = '/dashboard-k/climate';
var pal = C.flatPalette();
ok('a coordinated seed and its tint', pal.seed === LAV && pal.tint === LAV && pal.tinted);
ok('the ground: 10 % into #F4F2EE (as a page’s own tone)', pal.ground === C.flatRole(LAV, 'light', 'ground') && pal.ground.toLowerCase() === '#eae5e9', pal.ground);
var a = C.flatIdle('rgba(255, 204, 0, 0.98)', false, pal), b = C.flatIdle('rgba(10, 132, 255, 0.98)', false, pal);
ok('one tint: every off pill the same wash, whatever its own color', a.pill === b.pill && a.well === b.well && a.glyph === b.glyph);
ok('pill 8 % into white, well 22 %', a.pill === C.flatRole(LAV, 'light', 'pill') && a.well === C.flatRole(LAV, 'light', 'well'));
ok('off glyph at 3:1 against its well', C.contrast(a.glyph, a.well) >= 3, C.contrast(a.glyph, a.well));
var bare = C.flatIdle('rgba(255, 255, 255, 0.88)', true, pal);
ok('a bare glyph keeps no circle, reads 3:1 on the pill', bare.well === null && C.contrast(bare.glyph, bare.pill) >= 3);
var m = C.menu.accent();
ok('the Flat accent is the whole menu highlight: the page you’re on and every icon', m.color === LAV && m.flat === true && m.base === LAV);

// Automatic: each accessory its own color, Light
S._apply({ look: { flat: true, flat_theme: 'light' }, boards: {}, sky: {} });
location.pathname = '/dashboard-x/lights';
pal = C.flatPalette();
ok('Automatic Light: no seed, no single tint, still washed (the Flat White baseline)', pal.seed === null && pal.tint === null && pal.tinted === true);
var light = C.flatIdle('rgba(255, 204, 0, 0.98)', false, pal), fan = C.flatIdle('rgba(10, 132, 255, 0.98)', false, pal);
ok('Automatic: each its own wash', light.pill !== fan.pill && light.well !== fan.well);
ok('Automatic glyphs at 3:1 on their wells', C.contrast(light.glyph, light.well) >= 3 && C.contrast(fan.glyph, fan.well) >= 3);
var appletv = C.flatIdle('rgba(255, 255, 255, 0.88)', true, pal), tvw = C.flatIdle('rgba(255, 255, 255, 0.85)', false, pal);
var gray = C.flatIdle(null, false, pal);
ok('media: a white source is neutral, as any white accessory is -- no media rule', tvw.pill === gray.pill && tvw.well === gray.well);
ok('the neutral fallback for an uncolored scene or an unavailable pill', gray.pill === C.flatRole('#8E8E93', 'light', 'pill'));
ok('Automatic highlight: the legacy one, unchanged', C.menu.accent().flat === undefined);

// Dark: Automatic keeps its surfaces; a chosen tint washes
S._apply({ look: { flat: true, flat_theme: 'dark' }, boards: {}, sky: {} });
pal = C.flatPalette();
ok('Automatic Dark keeps today’s surfaces (no wash)', pal.tinted === false);
S._apply({ look: { flat: true, flat_theme: 'dark', flat_colors: { accent: 'auto', off_tint: TINT } }, boards: {}, sky: {} });
pal = C.flatPalette();
ok('Dark with a custom tint: washed into graphite, 20 % / 36 %', pal.tinted && C.flatIdle(null, false, pal).pill === C.flatRole(TINT, 'dark', 'pill') && C.flatIdle(null, false, pal).well === C.flatRole(TINT, 'dark', 'well'));
ok('Dark off glyph reads 3:1 on its well', C.contrast(C.flatIdle(null, false, pal).glyph, C.flatIdle(null, false, pal).well) >= 3);
// a custom tint survives accent and theme changes
S._apply({ look: { flat: true, flat_theme: 'light', flat_colors: { accent: ROSE, off_tint: TINT } }, boards: {}, sky: {} });
pal = C.flatPalette();
ok('an independent tint stays itself when the accent and theme change', pal.tint === TINT && pal.seed === ROSE);
// Match Accent with Automatic accent: the page's own highlight
S._apply({ look: { flat: true, flat_theme: 'light', flat_colors: { accent: 'auto', off_tint: 'accent' } },
           boards: { 'dashboard-x': { accent: 'auto' } }, sky: {} });
location.pathname = '/dashboard-x/climate';
ok('Match Accent under Automatic: the page’s highlight (Climate blue)', C.flatPalette().tint === '#0a84ff', C.flatPalette().tint);
location.pathname = '/dashboard-x/lights';
ok('...and Lights’ yellow after moving, no stale tint', C.flatPalette().tint === '#ffd60a', C.flatPalette().tint);

// in Flat the page you're on is white over any highlight
S._apply({ look: { flat: true, flat_theme: 'light' }, boards: { 'dashboard-x': { accent: 'auto' } }, sky: {} });
location.pathname = '/dashboard-x/weather';
ok('Weather in Flat Light: Apple’s light cyan, white over it', C.menu.accent().color === '#32ADE6' && C.menu.accent().on === '#fff', C.menu.accent());
location.pathname = '/dashboard-x/lights';
ok('...and over Lights’ yellow', C.menu.accent().on === '#fff');
S._apply({ look: { flat: false, glass: 'blur' }, boards: { 'dashboard-x': { accent: 'auto' } }, sky: {} });
location.pathname = '/dashboard-x/weather';
ok('...Glass’s dark cyan keeps black, as before', C.menu.accent().on === '#000');
// Glass and an explicit opt-out: nothing
S._apply({ look: { flat: false, glass: 'blur', flat_colors: { accent: SAGE, off_tint: 'accent' } }, boards: {}, sky: {} });
ok('Glass: no palette at all', C.flatPalette() === null);
S._apply({ look: { flat: true, flat_colors: { accent: SAGE } }, boards: { 'dashboard-x': { flat: false } }, sky: {} });
ok('a screen that opts out of Flat: no palette', C.flatPalette() === null);
ok('...and its highlight is the Highlight Color', C.menu.accent().flat === undefined);
// a standalone Flat screen under Glass reads All Screens' Flat defaults
S._apply({ look: { flat: false, glass: 'blur', flat_colors: { accent: SAGE, off_tint: 'accent' } }, boards: { 'dashboard-x': { flat: true } }, sky: {} });
ok('a Flat screen under a Glass house uses All Screens’ Flat Colors', C.flatPalette() && C.flatPalette().seed === SAGE);
// preview on the URL, never saved
location.search = '?hkflat_accent=c17d91&hkflat_tint=auto';
ok('a preview overrides here only', S.flatColors().accent.value === ROSE && S.flatColors().accent.scope === 'preview' && S.flatColors().off_tint.value === 'auto');
ok('...and is not in the settings', S.get('look.flat_colors').accent === SAGE);
location.search = '';

// ---- the tiles: off washed, lit white, bare stays bare ----------------------
S._apply({ look: { flat: true, flat_theme: 'light', flat_colors: { accent: SAGE, off_tint: 'accent' } }, boards: {}, sky: {} });
var Tile = customElements.get('hk-tile-card'), Media = customElements.get('hk-media-card');
function proto(Ctor, cfg, st) { var c = Object.create(Ctor.prototype); c._config = cfg; c._hass = { states: st ? { [st.entity_id]: st } : {} }; return c; }
ok('a calm off color is the Automatic source (a leak sensor’s drop)', proto(Tile, { off_icon_color: 'blue', icon_color: 'red' })._idleSource({ off_icon_color: 'blue', icon_color: 'red' }, null) !== proto(Tile, {})._idleSource({ icon_color: 'red' }, null));
ok('unavailable has no color of its own (neutral)', proto(Tile, {})._idleSource({ icon_color: 'red' }, { state: 'unavailable', entity_id: 'light.x' }) === null);
ok('media: its own color through the one rule (no override)', proto(Media, {})._idleSource({ icon_color: 'cyan' }, { state: 'off', entity_id: 'media_player.tv' }) === proto(Tile, {})._idleSource({ icon_color: 'cyan' }, { state: 'off', entity_id: 'light.x' }));
ok('bare by what the card says: Safari’s none and Chrome’s transparent alike', Tile.prototype._bareWell({}, 'none') && Tile.prototype._bareWell({}, 'transparent') && Tile.prototype._bareWell({ bare_icon: true }, '#fff') && !Tile.prototype._bareWell({}, 'var(--hk-look-well)'));
var css = C.flatCss();
ok('a lit pill is pure white in Flat Light (no wash rule)', !/14%,#fff/.test(css) && !/hk-tile-tint/.test(css));
ok('off pills wear --hk-idle-pill', /ha-card\.card\[data-hk-idle\]:not\(\[data-on="1"\]\):not\(\.hk-tapped\)\{background:var\(--hk-idle-pill\)!important\}/.test(css));
ok('a lit or tapped scene is white feedback, an idle one the scene tone', /\.scene:not\(\.hk-tapped\):not\(\[data-on="1"\]\)\{background:var\(--hk-flat-scene\)/.test(css));

// ---- the settings' display model agrees ---------------------------------------
ok('presets: dashboard and settings agree', JSON.stringify(C.FLAT_ACCENTS) === JSON.stringify(M.FLAT_ACCENTS));
var GCK = look({ accent: SAGE, off_tint: 'accent' }, { calendar: { accent: ROSE } });
var d = M.flatColorsOf(GCK, kc, ['calendar']);
ok('model and dashboard resolve the same', d.accent.value === R(GCK, kc, ['calendar']).accent.value && d.off_tint.value === R(GCK, kc, ['calendar']).off_tint.value);
ok('a source label names where it comes from', M.flatSourceLabel(R(GC, kitchen, ['calendar']).accent, { title: 'Kitchen' }) === 'Calendar on All Screens', M.flatSourceLabel(R(GC, kitchen, ['calendar']).accent, { title: 'Kitchen' }));
ok('a preset reads by its name, your own by Custom', M.flatColorName(SAGE) === 'Sage' && M.flatColorName('#123456') === 'Custom' && M.flatColorName('auto') === 'Automatic' && M.flatColorName('accent') === 'Match Accent');
// choosing an accent where the tint is Automatic links it, in one change
ok('choosing an accent over an Automatic tint links it at that scope', JSON.stringify(M.flatAccentChange(SAGE, R(look(), null, []))) === JSON.stringify({ accent: SAGE, off_tint: 'accent' }));
ok('...over an inherited custom tint leaves the tint alone', JSON.stringify(M.flatAccentChange(SAGE, R(look({ off_tint: TINT }), {}, []))) === JSON.stringify({ accent: SAGE }));
ok('...over a matched tint leaves the binding alone', JSON.stringify(M.flatAccentChange(ROSE, R(look({ accent: SAGE, off_tint: 'accent' }), null, []))) === JSON.stringify({ accent: ROSE }));

// ---- a photo's Tint (Sky / Background -> Tint): the photo turned to a color --
ok('the fade is the theme’s own wash, tint or not', C.flatFade(50, 'light') === 'rgba(238,236,230,0.460)' && C.flatFade(50, 'dark') === 'rgba(10,11,12,0.450)');
S._apply({ look: { flat: true, flat_theme: 'light', flat_colors: { accent: SAGE } }, boards: {}, sky: { flat_background: 'photo', photo: '/local/p.jpg', flat_tint: 'accent' } });
location.pathname = '/dashboard-x/0';
ok('the background says its tint, strength and brightness', S.flatBackground(null, false).tint === 'accent' && S.flatBackground(null, false).tintAmount === 60 && S.flatBackground(null, false).tintLight === 50);
ok('Match Accent is the Flat accent', C.flatAccentHex() === SAGE);
S._apply({ look: { flat: true, flat_theme: 'light' }, boards: { 'dashboard-x': { accent: 'auto', sky_flat_tint: '#112233' } }, sky: { flat_background: 'photo', photo: '/local/p.jpg', flat_tint: 'accent' } });
ok('a screen’s own tint over All Screens’', S.flatBackground(null, false).tint === '#112233');
location.pathname = '/dashboard-x/climate';
ok('...and with no Flat accent, the page’s own highlight', C.flatAccentHex() === '#0a84ff');

// ---- Pages: follow the accent, or keep their own (2026-10-17, the user) ---
var PO = look({ accent: SAGE, off_tint: 'accent', pages: 'own' });
r = R(PO, null, ['climate']);
ok('Keep Their Own Colors: Climate goes back to Automatic', v(r, 'accent') === 'auto' && r.accent.scope === 'own-page' && r.accent.page === 'climate');
ok('...and says so', M.flatSourceLabel(r.accent) === 'Pages Keep Their Own Colors');
ok('...Home takes the accent', v(R(PO, null, []), 'accent') === SAGE);
ok('...a room takes the accent', v(R(PO, null, ['room-kitchen', 'rooms']), 'accent') === SAGE);
ok('...a custom page takes the accent', v(R(PO, null, ['my-page']), 'accent') === SAGE);
ok('...a page’s own Flat accent stays its own', v(R(look({ accent: SAGE, pages: 'own' }, { climate: { accent: ROSE } }), null, ['climate']), 'accent') === ROSE);
ok('...a screen’s accent is held back too', v(R(look({ pages: 'own' }), { flat_colors: { accent: LAV } }, ['lights']), 'accent') === 'auto');
ok('a screen can follow where All Screens keeps', v(R(PO, { flat_colors: { pages: 'accent' } }, ['climate']), 'accent') === SAGE);
ok('...and keep where All Screens follows', v(R(look({ accent: SAGE }), { flat_colors: { pages: 'own' } }, ['climate']), 'accent') === 'auto');
ok('missing: Follow Accent', R(look({ accent: SAGE }), null, ['climate']).pages.value === 'accent' && v(R(look({ accent: SAGE }), null, ['climate']), 'accent') === SAGE);
S._apply({ look: { flat: true, flat_theme: 'light', flat_colors: { accent: SAGE, off_tint: 'accent', pages: 'own' } }, boards: {}, sky: {} });
location.pathname = '/dashboard-x/climate';
ok('the dashboard: Climate’s palette is its own blue', C.flatPalette({ board: null, keys: ['climate'] }).seed === '#0a84ff');
ok('...its Match Accent tint too', C.flatPalette({ board: null, keys: ['climate'] }).tint === '#0a84ff');
S._apply({ look: { flat: true, flat_theme: 'light', flat_colors: { accent: SAGE, off_tint: 'accent', pages: 'own' }, page_accents: { lights: 'pink' } }, boards: { 'dashboard-x': { accent: 'orange' } }, sky: {} });
ok('...blue under an orange Highlight Color too', C.flatPalette({ board: null, keys: ['climate'] }).seed === '#0a84ff');
ok('...a page’s own Highlight Color is its color', C.flatPalette({ board: null, keys: ['lights'] }).seed === '#ff375f');
ok('...Home’s is Sage', C.flatPalette({ board: null, keys: [] }).seed === SAGE);

print(fail ? 'FLAT COLORS: ' + fail + ' FAILED' : 'ALL ' + pass + ' FLAT COLORS TESTS PASS');
if (fail) throw new Error(fail + ' failed');
