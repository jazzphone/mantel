// hkLocale (hk-client.js): the house's language, country, time zone and units, read from the client.
// An en-US house reads as the screens always did; an en-GB / de-DE house gets its own order, its 24-hour
// clock and its metric unit labels.
if (typeof HK_ROOT === 'undefined') throw new Error('run tests/run locale');
load(HK_ROOT + '/tests/dom.js');
load(HK_ROOT + '/tests/card_harness.js');

var AT = Date.UTC(2026, 9, 21, 15, 5);          // Wed 21 Oct 2026, 15:05 UTC
var IMPERIAL = { temperature: '°F', wind_speed: 'mph', length: 'mi' };
var METRIC = { temperature: '°C', wind_speed: 'km/h', length: 'km' };
function house(config, locale) {
  window.hkClient.create({ states: {}, config: config, language: config && config.language, locale: locale || {} });
  return window.hkLocale;
}
H.run('HK LOCALE', [function () {
  // no client yet reading these: the screens' own en-US
  var L = window.hkLocale;
  H.ok('hkLocale exists', !!L);
  // an en-US house: the same text the screens' own 'en-US' calls gave, in the house's zone
  L = house({ language: 'en', country: 'US', time_zone: 'America/New_York', unit_system: IMPERIAL });
  H.eq('en-US tag', L.tag(), 'en-US');
  H.eq('en-US time is the old call', L.time(AT, { hour: 'numeric', minute: '2-digit' }),
       new Date(AT).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }));
  H.eq('en-US date is the old call', L.date(AT, { weekday: 'long', month: 'short', day: 'numeric' }),
       new Date(AT).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'America/New_York' }));
  H.eq('en-US number is the old call', L.number(1234567.891, { maximumFractionDigits: 1 }),
       (1234567.891).toLocaleString('en-US', { maximumFractionDigits: 1 }));
  H.ok('en-US is a 12-hour house', !L.is24());
  H.eq('en-US units', JSON.stringify(L.units()), JSON.stringify({ temp: '°F', speed: 'mph', length: 'mi' }));
  // no language told: still en-US (and no config: the old unit fallbacks)
  L = house({});
  H.eq('no config: en-US', L.tag(), 'en-US');
  H.eq('no config: units fall back to the old ones', L.units().temp + L.units().speed, '°Fmph');
}, function () {
  // a British house: language 'en' with country GB
  var L = house({ language: 'en', country: 'GB', time_zone: 'Europe/London', unit_system: METRIC });
  H.eq('en-GB tag', L.tag(), 'en-GB');
  H.ok('en-GB is a 24-hour house', L.is24());
  H.eq('en-GB time', L.time(AT, { hour: 'numeric', minute: '2-digit' }), '16:05');   // BST
  H.eq('en-GB time is the locale own', L.time(AT, { hour: 'numeric', minute: '2-digit' }),
       new Date(AT).toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit', timeZone: 'Europe/London' }));
  H.eq('metric units', L.units().temp + ' ' + L.units().speed, '°C km/h');
  // a person who chose a 12-hour clock gets one
  L = house({ language: 'en', country: 'GB', time_zone: 'Europe/London' }, { time_format: 'am_pm' });
  H.ok('chosen 12-hour clock', !L.is24());
  H.ok('and shows AM / PM', /pm/i.test(L.time(AT, { hour: 'numeric', minute: '2-digit' })));
  // the locale's zone 'local': the browser's own
  L = house({ language: 'en', country: 'GB', time_zone: 'Asia/Tokyo' }, { time_zone: 'local' });
  H.eq('local zone is the browser’s', L.zone(), undefined);
}, function () {
  // a German house
  var L = house({ language: 'de', country: 'DE', time_zone: 'Europe/Berlin', unit_system: METRIC });
  H.eq('de-DE tag', L.tag(), 'de-DE');
  H.ok('de-DE is a 24-hour house', L.is24());
  H.eq('de-DE time', L.time(AT, { hour: 'numeric', minute: '2-digit' }), '17:05');   // CEST
  var d = L.date(AT, { weekday: 'long', month: 'long', day: 'numeric' });
  H.eq('de-DE date is the locale’s own', d, new Date(AT).toLocaleDateString('de-DE', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'Europe/Berlin' }));
  H.ok('and in German', d.indexOf('Mittwoch') === 0);
  H.eq('de-DE number marks', L.number(1234.5, { minimumFractionDigits: 1 }), (1234.5).toLocaleString('de-DE', { minimumFractionDigits: 1 }));
  // a region the language already has is kept; HA's own number setting wins
  L = house({ language: 'pt-BR', country: 'PT', time_zone: 'Europe/Lisbon' }, { number_format: 'comma_decimal' });
  H.eq('region kept', L.tag(), 'pt-BR');
  H.eq('number setting', L.number(1234.5, { minimumFractionDigits: 1 }), '1,234.5');
}]);
