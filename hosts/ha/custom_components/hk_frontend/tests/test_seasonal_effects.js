load(HK_ROOT + '/tests/dom.js');
document.documentElement = new El('html');
document.adoptedStyleSheets = [];
var host = new El('hk-view-container');
window.hkShell.use({ tags: { viewContainer: 'hk-view-container' } });
window.location.pathname = '/dashboard-sky/home';
El.prototype.getRootNode = function () { return document; };
El.prototype.remove = function () { if (this.parentNode) this.parentNode.removeChild(this); };
El.prototype.insertBefore = function (node, ref) {
  var index = this.children.indexOf(ref);
  if (index < 0) return this.appendChild(node);
  this.children.splice(index, 0, node);
  node.parentNode = this;
  return node;
};
Object.defineProperties(El.prototype, {
  firstChild: { get: function () { return this.children[0] || null; } },
  lastChild: { get: function () { return this.children[this.children.length - 1] || null; } },
  isConnected: { get: function () { return this === host || !!(this.parentNode && this.parentNode.isConnected); } }
});
load(HK_ROOT + '/frontend/modules/hk-settings.js');
load(HK_ROOT + '/frontend/modules/hk-sky.js');

var S = window.hkSettings, sky = window.hkSky, passed = 0;
var client = { states: {}, entities: {}, config: {} };
var opts = { enable: 'input_boolean.sky', flat: { photo: '/local/landscape.webp', imageLook: { mode: 'tinted', fade: 70 } } };
function ok(name, value) { if (!value) throw Error('FAIL ' + name); passed++; }
function settings(on, animations, override) {
  S._apply({ look: { flat: true, flat_theme: 'light' }, sky: { seasonal_effects: on, animations: animations, decorations: false },
    boards: { 'dashboard-sky': { sky_seasonal_effects: override } } });
}
function render() { sky.render(client, host, opts); return sky.element(); }
function particles(node, name) { return walk(node).filter(function (child) { return child.classList.contains(name); }); }

settings(true, true, null);
sky._pin({ land: 'fall' });
var root = render(), effects = root._hkSeasonalEffects, leaves = particles(effects, 'lf');
ok('fall leaves appear over a photo with Seasonal Decorations off', leaves.length >= 6 && !particles(root, 'canopy').length);
ok('the field is drawn over the photo and its wash', root.lastChild === effects && opts.flat.photo === root.firstChild.src);
ok('the next render keeps the same field and leaves', render()._hkSeasonalEffects === effects && particles(effects, 'lf')[0] === leaves[0]);
ok('the Flat root loads the animation styles once', document.adoptedStyleSheets.length === 1);
opts.fallingLeaves = false;
ok('leaving Home clears the standalone leaf field over a still background', render()._hkSeasonalEffects === null && effects.parentNode === null);
opts.fallingLeaves = true;
ok('returning Home restores the leaves', particles(render(), 'lf').length >= 6);
settings(true, true, false);
ok('a screen can opt out of the house effect', render()._hkSeasonalEffects === null && root.lastChild !== effects);
settings(true, true, null);
opts.fallingLeaves = false;
sky._pin({ land: 'winter' });
ok('winter builds flakes without a garland or sleigh', particles(render(), 'xflake').length > 0 && !particles(root, 'xdecor').length && !particles(root, 'sleigh').length);
settings(true, false, null);
ok('Animations off clears the standalone field', render()._hkSeasonalEffects === null);
settings(false, true, true);
sky._pin({ land: 'spring' });
ok('a screen can opt in to petals when the house effect is off', particles(render(), 'petal').length > 0);
client.states['input_boolean.sky'] = { state: 'off' };
ok('the existing Sky Switch also stops the field', render()._hkSeasonalEffects === null);

var config = { sky: {}, views: [{ path: 'overview' }, { path: 'pages', pages_screen: true }, { path: 'weather', sky_page: 'weather' }] };
window.hkShell.use({ tags: { viewContainer: 'hk-view-container' }, dashboardConfig: function () { return config; }, viewContainer: function () { return host; } });
window.hkHostClient = { current: function () { return client; } };
settings(true, true, null);
sky._pin({ land: 'fall' });
function navigate(path) {
  window.location.pathname = '/dashboard-sky' + path;
  sky.swipeBack();
  return particles(sky.element(), 'lf').length;
}
ok('a custom Home shows leaves at the bare dashboard address', navigate('') > 0);
ok('Apps and Weather each clear the field', navigate('/pages') === 0 && navigate('/weather') === 0);
ok('a direct return to the custom Home restores the leaves', navigate('/overview') > 0);
print('ALL ' + passed + ' SEASONAL EFFECTS TESTS PASS');
