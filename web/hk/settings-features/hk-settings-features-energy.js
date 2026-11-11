// hk-settings-features-energy.js - the Energy pages.
//
// PART OF THE FEATURE PAGES OF HK SETTINGS (hk-settings-features.js). Not a card and not run on its own: it registers one
// function, which hk-settings-features.js calls with the shared kit KIT once every part has loaded (the
// order is its PARTS list). What this file uses from the shell or from an earlier file it takes
// from KIT at the top; what the shell or a later file uses of it, it hands back at the bottom.
(function () {
  'use strict';
  (window.hkSettingsFeaturesParts = window.hkSettingsFeaturesParts || {})['hk-settings-features-energy'] = function (KIT) {
    var form = KIT.form, openIn = KIT.openIn, PN = KIT.PN, removeRow = KIT.removeRow;

    var K;
    // (set when the page starts, not now: the shell calls bindLate() once it has assigned them)
    KIT.late.push(function (s) {
      K = s.K;
    });

    // ---------------------------------------------------------------- energy
    // ENERGY (features/energy): the Energy page a screen shows, built from
    // Home Assistant's Energy settings. Its page here sorts the devices into
    // sections, names them and picks the rows; each change goes through
    // hk_energy/settings/set (or /device/set for one device), whose answer is
    // the page again. `d`: options (as stored), plan (what the screens draw),
    // devices (every one, hidden too), batteries, sections (as resolved).
    var EN = 'hk_energy';
    var EN_COLORS = [['', 'Automatic'], ['white', 'White'], ['yellow', 'Yellow'], ['orange', 'Orange'], ['red', 'Red'],
                     ['pink', 'Pink'], ['purple', 'Purple'], ['blue', 'Blue'], ['teal', 'Teal'], ['mint', 'Mint'],
                     ['green', 'Green'], ['cyan', 'Cyan']];
    // how a device's power sensor was found, in the page's words
    function energyFound(dev) {
      return { own: 'Chosen here', energy: 'From Home Assistant’s Energy settings',
               source: 'Found through its meter’s source', device: 'Found on its meter’s device' }[dev.found] ||
             'None found: its tile shows today’s kWh';
    }
    // the sections as resolved, with one device moved to another (or out of
    // every section: back to where its guess puts it) -- what is saved once a
    // device is placed by hand
    function sectionsAfter(d, key, to) {
      var out = (d.sections || []).map(function (s) {
        return { id: s.id, name: s.name, items: s.items.filter(function (k) { return k !== key; }),
                 link: s.link || undefined, color: s.color || undefined };
      });
      if (to) {
        var s = out.filter(function (x) { return x.id === to; })[0];
        if (!s) {
          var kinds = {};
          (d.section_kinds || []).forEach(function (k) { kinds[k[0]] = k[1]; });
          s = { id: to, name: kinds[to] || to, items: [] };
          out.push(s);
        }
        s.items.push(key);
      }
      return out.map(function (x) {
        var y = { id: x.id, name: x.name, items: x.items };
        if (x.link) y.link = x.link;
        if (x.color) y.color = x.color;
        return y;
      });
    }
    function energySet(P, changes) { return P.featSet(EN, changes); }
    // an entity's name; one with none of its own (Home Assistant's own cost
    // sensor) by its id, not a made-up one
    function enName(P, id) {
      var st = P.client && P.client.states[id];
      return st && st.attributes && st.attributes.friendly_name ? P.name(id) : id;
    }
    function energyDev(P, key, changes) {
      return P.featCall(EN, { type: 'hk_energy/device/set', key: key, changes: changes }, Object.keys(changes));
    }
    function devByKey(d, key) { return (d.devices || []).filter(function (x) { return x.key === key; })[0] || null; }
    function sectionOf(d, key) {
      return (d.sections || []).filter(function (s) { return s.items.indexOf(key) >= 0; })[0] || null;
    }
    function plural2(n, one, many) { return n + ' ' + (n === 1 ? one : many); }

    function energyMain(P, c, d) {
      var o = d.options || {}, pl = d.plan || {}, T = pl.total || {}, en = d.energy || {};
      var ha = en.grid || en.devices
        ? [en.grid ? 'the grid meter' : null, en.devices ? plural2(en.devices, 'device', 'devices') : null].filter(Boolean).join(' and ')
        : null;
      c.appendChild(K.group({ header: 'Home Assistant’s Energy Settings',
          footer: ha ? 'The page starts from ' + ha + ' in Home Assistant’s Energy settings: their meters, which device is inside which, and their power sensors.'
                     : 'Home Assistant’s Energy settings list nothing yet. Add the grid and your devices there, or add devices here.' }, [
        K.toggle({ label: 'List Their Devices', sub: 'Every device there gets a tile, new ones too', on: o.follow !== false,
                   sk: 'f:' + EN + ':follow', onChange: function (on) { energySet(P, { follow: on }); } }),
        K.nav({ label: 'Energy Settings', sub: 'In Home Assistant', href: en.url || '/config/energy', icon: 'mdi:open-in-new',
                fk: 'energy:ha' })]));
      var pg = o.page || {};
      var pageSet = function (ch) { return energySet(P, { page: ch }); };
      var ringNames = { energy: 'Energy', cost: 'Cost', solar: 'Solar', water: 'Water', gas: 'Gas' };
      c.appendChild(K.group({ header: 'The Page', footer: 'Now is live power; Today, This Week and This Month are energy from Home Assistant\u2019s statistics.' }, [
        K.text({ label: 'Title', sk: 'f:' + EN + ':title', value: o.title || '', placeholder: 'Energy', maxlength: 40,
                 error: P.err('f:' + EN + ':title'), onCommit: function (v) { energySet(P, { title: v.trim() || null }); } }),
        K.select({ label: 'Opens On', sk: 'f:' + EN + ':page:opens_on', value: pg.opens_on || '',
                   options: [['', 'Automatic (Now)'], ['now', 'Now'], ['day', 'Today'], ['week', 'This Week'], ['month', 'This Month']],
                   onChange: function (v) { pageSet({ opens_on: v || null }); } }),
        K.nav({ label: 'Rings', sub: 'Each fills toward a usual day', value: Array.isArray(pg.rings) && pg.rings.length
                  ? pg.rings.map(function (k) { return ringNames[k]; }).join(', ') : 'Automatic',
                href: '#/features/energy/rings', fk: 'energy:rings' }),
        K.select({ label: 'A Usual Day', sk: 'f:' + EN + ':page:typical', value: pg.typical ? String(pg.typical) : '',
                   options: [['', 'The 30 Days Before'], ['14', 'The 14 Days Before'], ['7', 'The 7 Days Before']],
                   onChange: function (v) { pageSet({ typical: v ? Number(v) : null }); } }),
        K.toggle({ label: 'Highlights', sub: 'What stood out, beside the summary', on: pg.highlights !== false,
                   sk: 'f:' + EN + ':page:highlights', onChange: function (on) { pageSet({ highlights: on ? null : false }); } }),
        K.nav({ label: 'Readings', sub: 'Today\u2019s cost, thermostats, outside \u00b7 on Now', value: String((pl.top || []).length),
                href: '#/features/energy/top', fk: 'energy:top' }),
        K.nav({ label: 'Tracking', sub: pl.usages_auto === false ? 'A row each on the page, following the tabs' : 'None: each device\u2019s sheet has its bars',
                value: pl.usages_auto === false ? String((pl.usages || []).length) : 'Automatic',
                href: '#/features/energy/usages', fk: 'energy:usages' }),
        K.nav({ label: 'Sections', value: String((pl.sections || []).length), href: '#/features/energy/sections', fk: 'energy:sections' }),
        K.nav({ label: 'Devices', value: String((d.devices || []).length), href: '#/features/energy/devices', fk: 'energy:devices' }),
        K.nav({ label: 'Batteries', value: String((d.batteries || []).length), href: '#/features/energy/batteries', fk: 'energy:batteries' }),
        K.toggle({ label: 'Home Assistant’s Charts', sub: 'Its own four energy cards, at the end', on: o.detail === true,
                   sk: 'f:' + EN + ':detail', onChange: function (on) { energySet(P, { detail: on }); } })]));
      var pwo = o.power && typeof o.power === 'object' ? o.power : null;
      c.appendChild(K.group({ footer: 'Right now and the controls, beside this page: the house, the battery, the cars, and what the battery backs up.' }, [
        K.nav({ label: 'Power Page', value: pwo && pwo.on !== false ? 'On' : 'Off', href: '#/features/energy/power', fk: 'energy:power' })]));
      var tot = o.total || {};
      c.appendChild(K.group({ header: 'Whole Home', footer: 'Automatic: the grid meter in Home Assistant’s Energy settings, its cost, and the power sensor behind it (or the Energy chip’s Power Use).'
        }, [
        P.entityRow({ label: 'Power', sk: 'f:' + EN + ':total:power', value: tot.power || null,
                      none: 'Automatic' + (T.power && !tot.power ? ' (' + enName(P, T.power) + ')' : ''),
                      filter: { domains: ['sensor'], dc: 'power' },
                      onPick: function (v) { energySet(P, { total: Object.assign({}, tot, { power: v || '' }) }); } }),
        P.entityRow({ label: 'Energy Meter', sk: 'f:' + EN + ':total:stat', value: tot.stat || null,
                      none: 'Automatic' + (T.stat && !tot.stat ? ' (' + enName(P, T.stat) + ')' : ''),
                      filter: { domains: ['sensor'], dc: 'energy' },
                      onPick: function (v) { energySet(P, { total: Object.assign({}, tot, { stat: v || '' }) }); } }),
        P.entityRow({ label: 'Cost', sk: 'f:' + EN + ':total:cost', value: tot.cost || null,
                      none: 'Automatic' + (T.cost && !tot.cost ? ' (' + enName(P, T.cost) + ')' : T.price ? ' (meter × price)' : ''),
                      filter: { domains: ['sensor'], dc: 'monetary' },
                      onPick: function (v) { energySet(P, { total: Object.assign({}, tot, { cost: v || '' }) }); } })]));
      // WHERE IT IS SHOWN: the screens that list it
      var boards = (P.data && P.data.boards) || {};
      var on = (P.data.dashboards || []).filter(function (x) {
        var b = boards[x.path];
        if (!b) return false;
        if (b.home_page === false) {
          return (b.only_pages || []).length ? b.only_pages.indexOf('energy') >= 0 : (b.custom_pages || []).indexOf('energy') >= 0;
        }
        return !(b.pages || []).length || (b.pages || []).indexOf('energy') >= 0;
      });
      c.appendChild(K.group({ header: 'Screens', footer: 'A screen shows it once Energy is on its Pages (Automatic pages include it). An Energy Display is a screen that is only this page.' },
        on.map(function (x) {
          return K.nav({ label: x.title, sub: '/' + x.path, href: '#/screens/' + encodeURIComponent(x.path) + '/pages', fk: 'energy:screen:' + x.path });
        }).concat([K.button({ label: 'Add an Energy Display', fk: 'energy:display', onClick: function () {
          P._new = { name: 'Energy', kind: 'energy', admin: false, shows: 'energy' };
          P.go('#/add-screen');
        } })])));
      openIn(c, 'Energy', EN);
    }

    // THE RINGS: in this order, each only where the house has its source (four
    // at most); Automatic is every one it has
    function energyRings(P, c, d) {
      var o = d.options || {}, pg = o.page || {}, pl = d.plan || {}, src = pl.sources || {};
      var have = { energy: true, cost: src.cost !== false, solar: !!src.solar, water: !!src.water, gas: !!src.gas };
      var ORDER = [['energy', 'Energy', 'What the house used'], ['cost', 'Cost', 'What it cost'], ['solar', 'Solar', 'What the sun made'],
                   ['water', 'Water', 'From Home Assistant\u2019s Energy settings'], ['gas', 'Gas', 'From Home Assistant\u2019s Energy settings']];
      var auto = !Array.isArray(pg.rings) || !pg.rings.length;
      var on = auto ? ORDER.map(function (r) { return r[0]; }).filter(function (k) { return have[k]; }).slice(0, 4) : pg.rings;
      c.appendChild(K.group({ footer: 'Automatic: every one the house has, up to four.' }, [
        K.toggle({ label: 'Automatic', on: auto, sk: 'f:' + EN + ':rings:auto',
                   onChange: function (v) { energySet(P, { page: { rings: v ? null : on } }); } })]));
      if (auto) return;
      c.appendChild(K.group({ header: 'Rings', footer: 'Each fills toward a usual day, from the outside in. One the house has no source for is left out.' },
        ORDER.map(function (r) {
          var lit = on.indexOf(r[0]) >= 0;
          return K.check({ label: r[1], sub: have[r[0]] ? r[2] : 'Not in this house', multi: true, on: lit, sk: 'f:' + EN + ':rings:' + r[0],
            onClick: function (want) {
              var next = ORDER.map(function (x) { return x[0]; }).filter(function (k) { return k === r[0] ? want : on.indexOf(k) >= 0; });
              if (!next.length || next.length > 4) return;
              energySet(P, { page: { rings: next } });
            } });
        })));
    }
    function energyTop(P, c, d) {
      var o = d.options || {}, pl = d.plan || {};
      var auto = !Array.isArray(o.top);
      var ids = (pl.top || []).filter(function (t) { return t.entity; }).map(function (t) { return t.entity; });
      c.appendChild(K.group({}, [K.toggle({ label: 'Today’s Cost', sub: 'First, from the whole home’s meter', on: o.cost !== false,
        sk: 'f:' + EN + ':cost', onChange: function (on) { energySet(P, { cost: on }); } })]));
      c.appendChild(K.listEditor({ fk: 'entop', auto: auto, minRows: 0, announce: P.announce.bind(P),
        autoFooter: 'Automatic: the first two thermostats (Accessories → Thermostats) and the outside temperature (Weather).',
        shownFooter: 'Up to four readings, today’s cost among them.',
        rows: ids.map(function (id) { return { value: id, label: P.name(id), sub: id }; }),
        onAuto: function (on) { energySet(P, { top: on ? null : ids }); },
        onChange: function (v) { energySet(P, { top: v }); },
        addLabel: ids.length < 4 - (o.cost !== false ? 1 : 0) ? 'Add Reading' : null,
        onAddOther: function () {
          P.go(P.picker('energy-top', { title: 'Add Reading', value: null, items: function () {
            return P.entityIds({ domains: ['climate', 'sensor'], shown: true }).filter(function (id) {
              var a = (P.client.states[id] || {}).attributes || {};
              return id.indexOf('climate.') === 0 || a.device_class === 'temperature' || a.device_class === 'humidity' ||
                     a.device_class === 'power';
            }).map(function (id) { return { value: id, label: P.name(id), sub: id }; });
          }, onPick: function (v) { if (v) energySet(P, { top: ids.concat(v).slice(0, 4) }); } }));
        } }));
    }

    function energyUsages(P, c, d) {
      var o = d.options || {}, pl = d.plan || {};
      var auto = !Array.isArray(o.usages);
      var rows = (pl.usages || []).map(function (u) { return { entity: u.entity, stat: u.stat, name: u.name, color: u.color }; });
      var save = function (list) {
        energySet(P, { usages: list.map(function (u) {
          var x = { entity: u.entity };
          if (u.stat && u.stat !== u.entity) x.stat = u.stat;
          if (u.name) x.name = u.name;
          if (u.color) x.color = u.color;
          return x;
        }) });
      };
      c.appendChild(K.listEditor({ fk: 'enuse', auto: auto, minRows: 0, announce: P.announce.bind(P),
        autoFooter: 'Automatic: no Tracking card; each device\u2019s sheet has its own bars. Turn this off to follow meters and runtimes of your own.',
        shownFooter: 'A row each on the page\u2019s Tracking card: its figure and bars for the tab, against its usual. A runtime sensor (hours) shows its hours.',
        rows: rows.map(function (u, i) {
          return { value: String(i), label: u.name, sub: u.entity, href: auto ? null : '#/features/energy/usages/' + i };
        }),
        onAuto: function (on) { if (on) energySet(P, { usages: null }); else save(rows); },
        onChange: function (v) { save(v.map(function (i) { return rows[Number(i)]; })); },
        addLabel: rows.length < 9 ? 'Add to Tracking' : null,
        onAddOther: function () {
          P.go(P.picker('energy-usage', { title: 'Add to Tracking', value: null, items: function () {
            return P.entityIds({ domains: ['sensor'], shown: true }).filter(function (id) {
              var a = (P.client.states[id] || {}).attributes || {};
              return ['power', 'energy', 'duration'].indexOf(a.device_class) >= 0;
            }).map(function (id) { return { value: id, label: P.name(id), sub: id }; });
          }, onPick: function (v) {
            if (!v) return;
            var dev = (d.devices || []).filter(function (x) { return x.power === v || x.stat === v; })[0];
            save(rows.concat([{ entity: v, stat: dev ? dev.stat : null, name: dev ? dev.name : null }]));
          } }));
        } }));
    }
    function energyUsage(P, c, d, i) {
      var o = d.options || {};
      var list = Array.isArray(o.usages) ? o.usages.slice() : null;
      var u = list && list[i];
      if (!u) { c.appendChild(K.group({ footer: 'That bar is gone.' }, [])); return; }
      var put = function (ch) {
        list[i] = Object.assign({}, u, ch);
        Object.keys(list[i]).forEach(function (k) { if (list[i][k] === '' || list[i][k] == null) delete list[i][k]; });
        energySet(P, { usages: list });
      };
      var shown = ((d.plan || {}).usages || [])[i] || {};
      c.appendChild(K.group({}, [
        K.text({ label: 'Name', sk: 'f:' + EN + ':usage:name', value: u.name || '', placeholder: shown.name || '', maxlength: 40,
                 onCommit: function (v) { put({ name: v.trim() }); } }),
        K.select({ label: 'Color', sk: 'f:' + EN + ':usage:color', value: u.color || '', options: EN_COLORS,
                   onChange: function (v) { put({ color: v }); } }),
        P.entityRow({ label: 'Reading', sk: 'f:' + EN + ':usage:entity', value: u.entity, required: true,
                      filter: { domains: ['sensor'] }, onPick: function (v) { if (v) put({ entity: v }); } }),
        P.entityRow({ label: 'Daily Use From', sk: 'f:' + EN + ':usage:stat', value: u.stat || null, none: 'The reading itself',
                      filter: { domains: ['sensor'] }, onPick: function (v) { put({ stat: v || '' }); } })]));
    }

    function energySections(P, c, d) {
      var o = d.options || {};
      var auto = !Array.isArray(o.sections);
      var secs = d.sections || [];
      var names = {};
      (d.devices || []).forEach(function (x) { names[x.key] = x.name; });
      (d.batteries || []).forEach(function (x) { names[x.key] = x.name; });
      var asStored = function (list) {
        return list.map(function (s) {
          var y = { id: s.id, name: s.name, items: s.items };
          if (s.link) y.link = s.link;
          if (s.color) y.color = s.color;
          return y;
        });
      };
      c.appendChild(K.listEditor({ fk: 'ensec', auto: auto, minRows: 1, announce: P.announce.bind(P),
        autoFooter: 'Automatic: each device in the section its name suggests — Heating & Cooling, Rooms, Appliances, Outlets, Charging.',
        shownFooter: 'The page’s sections, in this order. A device in none goes to the section its name suggests, or Other.',
        rows: secs.map(function (s) {
          return { value: s.id, label: s.name, sub: s.items.map(function (k) { return names[k] || k; }).join(', ') || 'Empty',
                   href: '#/features/energy/sections/' + encodeURIComponent(s.id) };
        }),
        onAuto: function (on) { energySet(P, { sections: on ? null : asStored(secs) }); },
        onChange: function (v) {
          energySet(P, { sections: asStored(v.map(function (id) { return secs.filter(function (s) { return s.id === id; })[0]; })) });
        },
        addLabel: 'Add Section',
        onAddOther: function () {
          var n = 1, id = 'section-1';
          while (secs.some(function (s) { return s.id === id; })) id = 'section-' + (++n);
          energySet(P, { sections: asStored(secs).concat([{ id: id, name: 'New Section', items: [] }]) })
            .then(function (done) { if (done) P.go('#/features/energy/sections/' + id); });
        } }));
    }
    function energySection(P, c, d, id) {
      var secs = d.sections || [];
      var s = secs.filter(function (x) { return x.id === id; })[0];
      if (!s) { c.appendChild(K.group({ footer: 'That section is gone.' }, [])); return; }
      var names = {}, subs = {};
      (d.devices || []).forEach(function (x) { names[x.key] = x.name; subs[x.key] = x.hidden ? 'Hidden' : null; });
      (d.batteries || []).forEach(function (x) { names[x.key] = x.name; subs[x.key] = 'Battery'; });
      var asStored = function (list) {
        return list.map(function (x) {
          var y = { id: x.id, name: x.name, items: x.items };
          if (x.link) y.link = x.link;
          if (x.color) y.color = x.color;
          return y;
        });
      };
      var put = function (ch) {
        energySet(P, { sections: asStored(secs.map(function (x) { return x.id === id ? Object.assign({}, x, ch) : x; })) });
      };
      var link = s.link || {};
      c.appendChild(K.group({}, [
        K.text({ label: 'Name', sk: 'f:' + EN + ':section:name', value: s.name, maxlength: 40, error: P.err('f:' + EN + ':sections'),
                 onCommit: function (v) { if (v.trim()) put({ name: v.trim() }); } })]));
      // ITS COLOR: its part of Where it went and its tiles' lines
      var autoCol = { hvac: 'Light Blue', rooms: 'Purple', appliances: 'Pink', outlets: 'Yellow', charging: 'Green' }[s.id] || 'One of HK\u2019s';
      c.appendChild(K.group({ footer: 'Its part of Where it went, and its tiles\u2019 lines.' }, [
        K.select({ label: 'Color', sk: 'f:' + EN + ':section:color', value: s.color || '',
                   options: [['', 'Automatic (' + autoCol + ')']].concat(EN_COLORS.slice(1)),
                   onChange: function (v) { put({ color: v || null }); } })]));
      c.appendChild(K.group({ header: 'Link', footer: 'Optional: its heading opens another page — a panel’s own dashboard, say (“/dashboard-home/my-page”).' }, [
        K.text({ label: 'Page', sk: 'f:' + EN + ':section:link', value: link.path || '', placeholder: 'None', maxlength: 120,
                 onCommit: function (v) { put({ link: v.trim() ? { path: v.trim(), text: link.text || '' } : null }); } }),
        K.text({ label: 'Link Text', sk: 'f:' + EN + ':section:linktext', value: link.text || '', placeholder: 'More', maxlength: 40,
                 onCommit: function (v) { if (link.path) put({ link: { path: link.path, text: v.trim() } }); } })]));
      var others = [];
      secs.forEach(function (x) {
        if (x.id !== id) x.items.forEach(function (k) { others.push({ value: k, label: names[k] || k, sub: 'In ' + x.name }); });
      });
      c.appendChild(K.listEditor({ fk: 'ensecitems', minRows: 0, announce: P.announce.bind(P), shownHeader: 'Tiles',
        shownFooter: 'In this order. A device taken out goes back to the section its name suggests.',
        rows: s.items.map(function (k) {
          return { value: k, label: names[k] || k, sub: subs[k],
                   href: devByKey(d, k) ? '#/features/energy/devices/' + encodeURIComponent(k) : null };
        }),
        more: others, moreHeader: 'Move Here',
        onChange: function (v) {
          // a tile moved here leaves its old section
          var moved = asStored(secs.map(function (x) {
            return x.id === id ? Object.assign({}, x, { items: v }) : Object.assign({}, x, { items: x.items.filter(function (k) { return v.indexOf(k) < 0; }) });
          }));
          energySet(P, { sections: moved });
        } }));
      if (secs.length > 1) {
        c.appendChild(K.group({}, [K.button({ label: 'Delete Section', destructive: true, fk: 'energy:section:rm', onClick: function () {
          K.confirm(P.shadowRoot, { title: 'Delete “' + s.name + '”?', destructive: true, ok: 'Delete',
                                    message: 'Its tiles go back to the sections their names suggest.' })
            .then(function (yes) {
              if (!yes) return;
              energySet(P, { sections: asStored(secs.filter(function (x) { return x.id !== id; })) })
                .then(function (done) { if (done) P.back('#/features/energy/sections'); });
            });
        } })]));
      }
    }

    function energyDevices(P, c, d) {
      var secs = d.sections || [];
      var byKey = {};
      (d.devices || []).forEach(function (x) { byKey[x.key] = x; });
      secs.forEach(function (s) {
        var rows = s.items.filter(function (k) { return byKey[k]; }).map(function (k) {
          var x = byKey[k];
          return K.nav({ label: x.name, sub: x.hidden ? 'Hidden' : (x.power ? P.name(x.power) : 'No power sensor'), icon: x.icon,
                         href: '#/features/energy/devices/' + encodeURIComponent(k), fk: 'energy:dev:' + k });
        });
        if (rows.length) c.appendChild(K.group({ header: s.name }, rows));
      });
      c.appendChild(K.group({ footer: 'A device Home Assistant’s Energy settings don’t list: a circuit or a plug with its own power sensor.' }, [
        K.nav({ label: 'Add Device', href: '#/features/energy/add', icon: 'mdi:plus-circle-outline', fk: 'energy:add' })]));
    }
    function energyDevice(P, c, d, key) {
      var x = devByKey(d, key);
      if (!x) { c.appendChild(K.group({ footer: 'That device isn’t listed any more.' }, [])); return; }
      var own = ((d.options || {}).devices || {})[key] || {};
      var e = function (f) { return P.err('f:' + EN + ':' + f); };
      c.appendChild(K.group({}, [
        K.text({ label: 'Name', sk: 'f:' + EN + ':name', value: own.name || '', placeholder: x.name, maxlength: 40, error: e('name'),
                 onCommit: function (v) { energyDev(P, key, { name: v.trim() || null }); } }),
        K.text({ label: 'Glyph', sk: 'f:' + EN + ':icon', value: own.icon || '', placeholder: x.icon, maxlength: 60, error: e('icon'),
                 onCommit: function (v) { energyDev(P, key, { icon: v.trim() || null }); } }),
        K.select({ label: 'Color', sk: 'f:' + EN + ':color', value: own.color || '', options: EN_COLORS,
                   onChange: function (v) { energyDev(P, key, { color: v || null }); } }),
        K.toggle({ label: 'Show on the Energy Page', on: !x.hidden, sk: 'f:' + EN + ':hidden',
                   onChange: function (on) { energyDev(P, key, { hidden: !on }); } })]));
      var sec = sectionOf(d, key);
      c.appendChild(K.group({ header: 'Section' }, [
        K.select({ label: 'Section', sk: 'f:' + EN + ':section', value: sec ? sec.id : '',
                   options: (d.sections || []).map(function (s) { return [s.id, s.name]; }).concat(
                     (d.section_kinds || []).filter(function (k) {
                       return !(d.sections || []).some(function (s) { return s.id === k[0]; });
                     }).map(function (k) { return [k[0], k[1] + ' (new)']; })),
                   onChange: function (v) { if (v) energySet(P, { sections: sectionsAfter(d, key, v) }); } })]));
      // POWER AND ENERGY, KEPT APART: what each tab of the page reads
      c.appendChild(K.group({ header: 'Now \u00b7 Live Power', footer: energyFound(x) + '. Watts as they happen; without one, Now shows today\u2019s kWh on this tile.' }, [
        P.entityRow({ label: 'Power Sensor', sk: 'f:' + EN + ':power', value: own.power || null,
                      none: 'Automatic' + (x.power && !own.power ? ' (' + P.name(x.power) + ')' : ''),
                      filter: { domains: ['sensor'], dc: 'power' },
                      onPick: function (v) { energyDev(P, key, { power: v || null }); } })]));
      c.appendChild(K.group({ header: 'Today, This Week, This Month \u00b7 Energy',
          footer: x.stat ? 'kWh from Home Assistant\u2019s statistics: the same numbers as its Energy dashboard.'
                         : 'No energy meter: this tile shows only Now. Add one in Home Assistant\u2019s Energy settings to give it history.' }, [
        x.stat ? K.info({ label: 'Energy Meter', sub: x.stat, value: P.name(x.stat) }) : K.info({ label: 'Energy Meter', value: 'None' }),
        P.entityRow({ label: 'Daily Runtime', sub: 'An AC\u2019s hours, beside its kWh', sk: 'f:' + EN + ':runtime', value: own.runtime || null,
                      none: 'Automatic' + (x.runtime && !own.runtime ? ' (' + P.name(x.runtime) + ')' : ''),
                      filter: { domains: ['sensor'], dc: 'duration' },
                      onPick: function (v) { energyDev(P, key, { runtime: v || null }); } })]));
      c.appendChild(K.group({}, [
        P.entityRow({ label: 'Switched By', sub: 'A power button on its tile; its sheet shows the switch', sk: 'f:' + EN + ':control', value: own.control || null,
                      none: 'Automatic' + (x.control && !own.control ? ' (' + P.name(x.control) + ')' : ''),
                      filter: { domains: ['switch'] },
                      onPick: function (v) { energyDev(P, key, { control: v || null }); } })]));
      energyBacked(P, c, d, key);
      var rel = [];
      if (x.parent_name) rel.push(K.info({ label: 'Part Of', value: x.parent_name }));
      (x.children || []).forEach(function (k) {
        var y = devByKey(d, k);
        rel.push(K.nav({ label: 'Includes', value: y ? y.name : k, href: '#/features/energy/devices/' + encodeURIComponent(k) }));
      });
      if (rel.length) c.appendChild(K.group({ header: 'In Home Assistant’s Energy Settings' }, rel));
      if (x.extra) {
        c.appendChild(K.group({}, [K.button({ label: 'Remove Device', destructive: true, fk: 'energy:dev:rm', onClick: function () {
          var extra = ((d.options || {}).extra || []).filter(function (y) { return y.key !== key; });
          energySet(P, { extra: extra }).then(function (done) { if (done) P.back('#/features/energy/devices'); });
        } })]));
      }
    }
    function energyAdd(P, c, d) {
      var st = P.feat(EN), f = form(st, 'add', function () { return { name: '', power: null, stat: null }; });
      c.appendChild(K.group({ footer: 'A power sensor gives its tile live watts; an energy meter gives its kWh today and its daily bars. Either will do.' }, [
        K.text({ label: 'Name', sk: 'f:' + EN + ':extra', value: f.name, placeholder: 'Network Rack', maxlength: 40,
                 error: P.err('f:' + EN + ':extra'), onCommit: function (v) { f.name = v; } }),
        P.entityRow({ label: 'Power Sensor', sk: 'energy-add-power', value: f.power, none: 'None',
                      filter: { domains: ['sensor'], dc: 'power' }, onPick: function (v) { f.power = v; P.render(); } }),
        P.entityRow({ label: 'Energy Meter', sk: 'energy-add-stat', value: f.stat, none: 'None',
                      filter: { domains: ['sensor'], dc: 'energy' }, onPick: function (v) { f.stat = v; P.render(); } })]));
      c.appendChild(K.group({}, [K.button({ label: 'Add Device', fk: 'energy:add:go', disabled: !(f.power || f.stat), onClick: function () {
        var inp = P.shadowRoot && P.shadowRoot.querySelector('[data-fk="f:' + EN + ':extra"]');
        var name = String((inp && inp.value) || f.name || '').trim();
        if (!name) { P.errors['f:' + EN + ':extra'] = 'Give it a name.'; P.render(); return; }
        var key = f.stat || f.power;
        var extra = ((d.options || {}).extra || []).filter(function (y) { return y.key !== key; })
          .concat([{ key: key, name: name, power: f.power || null, stat: f.stat || null }]);
        energySet(P, { extra: extra }).then(function (done) {
          if (!done) return;
          delete st.forms.add;
          P.go('#/features/energy/devices/' + encodeURIComponent(key));
        });
      } })]));
    }

    // THE BATTERIES AS STORED, from rows as shown (d.batteries, resolved):
    // only what the house set itself -- a battery already in the stored list
    // keeps its own entry; one taken from Automatic is just its entity, and
    // the house battery's flag (the plan's own, else its automatic glyph).
    // Never the resolved name, label, suffix or glyph: pinned, they outlived
    // the choice that made them (The House Battery off kept the house glyph,
    // and the next save turned it back on).
    var HOUSE_GLYPH = 'hk:home-battery-outline', BATTERY_GLYPH = 'hk:battery-high';
    function batteriesStored(d, list) {
      var own = {};
      var o = (d && d.options) || {};
      (Array.isArray(o.batteries) ? o.batteries : []).forEach(function (b) { if (b && b.entity) own[b.entity] = b; });
      return list.filter(Boolean).map(function (b) {
        var key = b.entity || b.key;
        if (own[key]) return Object.assign({}, own[key]);
        var y = { entity: key };
        if (b.house === true || (b.house === undefined && b.icon === HOUSE_GLYPH)) y.house = true;
        return y;
      });
    }
    function energyBatteries(P, c, d) {
      var o = d.options || {};
      var auto = !Array.isArray(o.batteries);
      var bats = d.batteries || [];
      var asStored = function (list) { return batteriesStored(d, list); };
      c.appendChild(K.listEditor({ fk: 'enbat', auto: auto, minRows: 0, announce: P.announce.bind(P),
        autoFooter: 'Automatic: the house battery’s level (Home Assistant’s Energy settings) and every car’s — a battery level on a device that also reports a range.',
        shownFooter: 'Their level, colored by it, in the Charging section (or where Sections places them).',
        rows: bats.map(function (b) {
          return { value: b.key, label: b.name, sub: b.label ? 'With ' + enName(P, b.label) : b.key,
                   href: auto ? null : '#/features/energy/batteries/' + encodeURIComponent(b.key) };
        }),
        onAuto: function (on) { energySet(P, { batteries: on ? null : asStored(bats) }); },
        onChange: function (v) {
          energySet(P, { batteries: asStored(v.map(function (k) { return bats.filter(function (b) { return b.key === k; })[0]; })) });
        },
        addLabel: 'Add Battery',
        onAddOther: function () {
          P.go(P.picker('energy-battery', { title: 'Add Battery', value: null, items: function () {
            return P.entityIds({ domains: ['sensor'], dc: 'battery', shown: true })
              .map(function (id) { return { value: id, label: P.name(id), sub: id }; });
          }, onPick: function (v) { if (v) energySet(P, { batteries: asStored(bats).concat([{ entity: v }]) }); } }));
        } }));
    }
    function energyBattery(P, c, d, key) {
      var o = d.options || {};
      var list = Array.isArray(o.batteries) ? o.batteries.slice() : [];
      var i = -1;
      list.forEach(function (b, j) { if (b.entity === key) i = j; });
      var shown = (d.batteries || []).filter(function (b) { return b.key === key; })[0];
      if (i < 0 || !shown) { c.appendChild(K.group({ footer: 'That battery isn’t listed any more.' }, [])); return; }
      var b = list[i];
      var put = function (ch) {
        list[i] = Object.assign({}, b, ch);
        Object.keys(list[i]).forEach(function (k) { if (list[i][k] === '' || list[i][k] == null) delete list[i][k]; });
        energySet(P, { batteries: list });
      };
      c.appendChild(K.group({}, [
        K.text({ label: 'Name', sk: 'f:' + EN + ':bat:name', value: b.name || '', placeholder: shown.name, maxlength: 40,
                 onCommit: function (v) { put({ name: v.trim() }); } }),
        P.entityRow({ label: 'Under Its Name', sub: 'A range, or the energy stored', sk: 'f:' + EN + ':bat:label',
                      value: b.label || null, none: shown.label && !b.label ? 'Automatic (' + P.name(shown.label) + ')' : 'Nothing',
                      filter: { domains: ['sensor'] }, onPick: function (v) { put({ label: v || '' }); } }),
        K.text({ label: 'After It', sk: 'f:' + EN + ':bat:suffix', value: b.label_suffix != null ? b.label_suffix : '',
                 placeholder: shown.label_suffix || ' mi range', maxlength: 40, onCommit: function (v) { put({ label_suffix: v }); } }),
        K.toggle({ label: 'The House Battery', sub: 'Its glyph is the house’s', on: !!b.house, sk: 'f:' + EN + ':bat:house',
                   // a default glyph saved by an older page goes with it, or
                   // the house's glyph would stay after turning this off
                   onChange: function (on) {
                     put({ house: on || null, icon: b.icon === HOUSE_GLYPH || b.icon === BATTERY_GLYPH ? null : b.icon });
                   } })]));
    }

    // ---- THE POWER PAGE (features/energy/power.py): the Energy feature's
    // second page, right now and the controls. Every reading Automatic until
    // chosen; the battery's own controls as named. Stored whole as the
    // feature's `power` option.
    function powerOf(d) { var o = (d.options || {}).power; return o && typeof o === 'object' ? o : null; }
    function powerSet(P, d, changes) {
      var cur = powerOf(d) || {}, next = Object.assign({}, cur);
      Object.keys(changes).forEach(function (k) {
        var v = changes[k];
        if (v === null || v === '' || v === undefined) delete next[k]; else next[k] = v;
      });
      return energySet(P, { power: next });
    }
    function energyPower(P, c, d) {
      var o = powerOf(d), pl = (d.plan || {}).power || null;
      var on = !!o && o.on !== false;
      c.appendChild(K.group({ footer: 'Right now and the controls: the whole house, the grid, the sun, the house battery and its own controls, the cars, ' +
          'and every device marked when the battery backs it up. The Energy page is the same devices over time.' }, [
        K.toggle({ label: 'Show the Power Page', on: on, sk: 'f:' + EN + ':power:on',
                   onChange: function (v) { powerSet(P, d, { on: v ? null : false }); } })]));
      if (!on) return;
      var B = o.battery || {};
      var bat = function (k, v) { var b = Object.assign({}, B); if (v) b[k] = v; else delete b[k]; return powerSet(P, d, { battery: Object.keys(b).length ? b : null }); };
      var auto = function (cur) { return 'Automatic' + (cur ? ' (' + enName(P, cur) + ')' : ''); };
      var PWR = { domains: ['sensor'], dc: 'power' };
      c.appendChild(K.group({ header: 'The Page' }, [
        K.text({ label: 'Title', sk: 'f:' + EN + ':power:title', value: o.title || '', placeholder: 'Power', maxlength: 40,
                 onCommit: function (v) { powerSet(P, d, { title: v.trim() || null }); } }),
        K.text({ label: 'Picture Folder', sk: 'f:' + EN + ':power:art', value: o.art || '', placeholder: 'Built In',
                 sub: 'Your own house: a folder of your files with art.json and its layers, e.g. /hk/art/my-house/. Empty: the house that comes with ' + PN(), error: P.err('f:' + EN + ':power:art'),
                 onCommit: function (v) { v = v.trim(); if (v && v.charAt(0) !== '/') v = '/' + v; if (v && v.slice(-1) !== '/') v += '/'; powerSet(P, d, { art: v || null }); } })]
        .concat([K.select({ label: 'Picture', sk: 'f:' + EN + ':power:picture', value: o.picture || 'house',
                   options: [['house', 'The House'], ['chart', 'A Flow Chart']], onChange: function (v) { powerSet(P, d, { picture: v === 'house' ? null : v }); } })])
        .concat([
        K.select({ label: 'Devices', sk: 'f:' + EN + ':power:groups', value: o.groups || 'type',
                   options: [['type', 'By Type'], ['backup', 'Backed Up First']], onChange: function (v) { powerSet(P, d, { groups: v === 'type' ? null : v }); } }),
        K.info({ label: 'Address', sub: 'Screens show it where they list it', value: '/' + ((pl && pl.path) || 'power') })])));
      var row = function (label, sub, key, filter, cur) {
        return P.entityRow({ label: label, sub: sub, sk: 'f:' + EN + ':power:' + key, value: o[key] || null, none: auto(cur), filter: filter,
                             onPick: function (v) { var ch = {}; ch[key] = v || null; powerSet(P, d, ch); } });
      };
      c.appendChild(K.group({ header: 'Readings', footer: 'Whole House is everything the house uses: the main meter, never a battery panel’s own output.' }, [
        row('Whole House', 'Power', 'home', PWR, pl && pl.home),
        row('The Grid', 'Power in; negative is out', 'grid', PWR, pl && pl.grid),
        row('To the Grid', 'Only with a sensor of its own', 'grid_export', PWR, null),
        row('Grid Up', 'On while the grid is up', 'grid_status', { domains: ['binary_sensor'] }, null),
        row('The Sun', 'Power', 'solar', PWR, pl && pl.solar),
        row('Battery Panel Output', 'What the battery’s circuits draw', 'backed_power', PWR, null)]));
      var brow = function (label, k, filter) {
        return P.entityRow({ label: label, sk: 'f:' + EN + ':power:battery:' + k, value: B[k] || null, none: 'None', filter: filter,
                             onPick: function (v) { bat(k, v || null); } });
      };
      var NUM = { domains: ['number', 'input_number', 'sensor'] }, SW = { domains: ['switch', 'binary_sensor'] };
      c.appendChild(K.group({ header: 'House Battery', footer: 'Its level, its power in and out, and what it says about itself. Without a level the page has no battery.' }, [
        brow('Level', 'level', { domains: ['sensor'], dc: 'battery' }), brow('Charging', 'charge', PWR), brow('Giving', 'discharge', PWR),
        brow('Reserve', 'reserve', NUM), brow('Charge Limit', 'limit', NUM), brow('Stored Energy', 'stored', { domains: ['sensor'] }),
        brow('Backup Time', 'backup', { domains: ['sensor'] }), brow('Charging Speed', 'speed', NUM), brow('EPS', 'eps', SW),
        brow('Storm Mode', 'storm', SW), brow('Fault', 'problem', { domains: ['binary_sensor'] }),
        K.select({ label: 'Backs Up', sk: 'f:' + EN + ':power:backs_up', value: o.backs_up || '',
                   options: [['', 'Automatic' + (pl ? ' (' + ({ some: 'Some Circuits', all: 'The Whole House', none: 'Nothing' })[pl.backs_up] + ')' : '')],
                             ['some', 'Some Circuits'], ['all', 'The Whole House'], ['none', 'Nothing']],
                   onChange: function (v) { powerSet(P, d, { backs_up: v || null }); } })]));
      var mode = o.mode || null;
      c.appendChild(
        K.group({ header: 'Battery Controls', footer: 'Its mode as the page’s choice, with what each one does; its levels as sliders. Each device’s own page says whether the battery backs it up.' }, [
        P.entityRow({ label: 'Mode', sk: 'f:' + EN + ':power:mode', value: mode ? mode.entity : null, none: 'None', filter: { domains: ['select', 'input_select'] },
                      onPick: function (v) { powerSet(P, d, { mode: v ? Object.assign({}, mode && mode.entity === v ? mode : {}, { entity: v }) : null }); } }),
        K.info({ label: 'Its Choices', value: mode && mode.options ? String(mode.options.length) : 'The select’s own' })]));
      // ITS LEVELS: a slider each (a number the battery takes: its reserve for
      // backup, a charge limit, a discharge floor), in the order added
      var lv = o.levels || [], lsk = 'f:' + EN + ':power:levels';
      var lvRows = lv.map(function (x) {
        return K.check({ label: x.name || P.name(x.entity), sub: x.entity + ' · tap to remove', multi: true, on: true, fk: lsk + ':' + x.entity,
                         onClick: function () { var left = lv.filter(function (y) { return y.entity !== x.entity; }); powerSet(P, d, { levels: left.length ? left : null }); } });
      });
      lvRows.push(K.nav({ label: 'Add…', icon: 'mdi:plus-circle-outline', fk: lsk + ':add',
        href: P.picker('power-levels', { title: 'Battery Levels', value: null, multi: true,
          items: function () {
            var have = lv.map(function (x) { return x.entity; });
            return P.entityIds({ domains: ['number', 'input_number'], shown: true }).filter(function (id) { return have.indexOf(id) < 0; })
              .map(function (id) { return { value: id, label: P.name(id), sub: id }; });
          },
          onPick: function (v) {
            var have = lv.map(function (x) { return x.entity; });
            var add = [].concat(v || []).filter(function (id) { return have.indexOf(id) < 0; }).map(function (id) { return { entity: id }; });
            if (add.length) powerSet(P, d, { levels: lv.concat(add) });
          } }) }));
      c.appendChild(K.group({ header: 'Battery Levels', footer: 'Sliders on the page for the numbers the battery takes, such as its backup reserve or charge limit.' }, lvRows));
      // EACH CAR: its name (blank: its integration's) and what reads its
      // charging -- Automatic, a Wall Connector or a monitored circuit, or the
      // car's own reading
      var cars = (pl && pl.cars) || [], CO = o.car_opts || {};
      var carSet = function (lvl, k, v) {
        var all = Object.assign({}, CO), one = Object.assign({}, all[lvl] || {});
        if (v) one[k] = v; else delete one[k];
        if (Object.keys(one).length) all[lvl] = one; else delete all[lvl];
        return powerSet(P, d, { car_opts: Object.keys(all).length ? all : null });
      };
      if (!cars.length) c.appendChild(K.group({ header: 'Cars' }, [K.info({ label: 'No cars found' })]));
      cars.forEach(function (k, i) {
        var co = CO[k.level] || {}, found = k.found_name || k.name || P.name(k.level), cur = co.charger || null;
        var sk = 'f:' + EN + ':power:car:' + i;
        var href = P.picker(sk + ':charger', { title: 'Charging Power', value: cur, none: 'Automatic',
          items: function () {
            return (k.power ? [{ value: 'car', label: 'The Car’s Own Reading', sub: P.name(k.power) }] : [])
              .concat(P.entityIds(PWR).map(function (id) { return { value: id, label: P.name(id), sub: id }; }));
          },
          onPick: function (v) { carSet(k.level, 'charger', v || null); } });
        var val = cur === 'car' ? 'The Car’s Own Reading' : cur ? (P.client.states[cur] ? P.name(cur) : cur + ' (missing)') : 'Automatic';
        var where = k.home && P.client && P.client.states[k.home] ? (P.client.states[k.home].state === 'home' ? 'Home' : 'Away') : '';
        c.appendChild(K.group({ header: co.name || found, footer: i < cars.length - 1 ? null :
            'Name: blank is the name its integration gives it. Charging Power: what reads its charging. Automatic shares the chargers’ watts among the cars that say they are ' +
            'charging, so with two cars charging it can guess wrong; choose its charger, the circuit it charges on, or its own reading (minutes behind) to know.' }, [
          K.text({ label: 'Name', sk: sk + ':name', value: co.name || '', placeholder: found, maxlength: 40,
                   onCommit: function (v) { carSet(k.level, 'name', v.trim() || null); } }),
          P.withError(K.nav({ label: 'Charging Power', value: val, href: href, sk: sk + ':charger' }), sk + ':charger'),
          K.info({ label: 'Found', sub: [k.home ? 'location' : null, k.plugged ? 'cable' : null, k.charge ? 'charge switch' : null, k.power ? 'its own charging power' : null].filter(Boolean).join(
            ', ') || 'its level',
                   value: where })]));
      });
    }
    // a device's Backed Up row (its own page): Automatic says why
    function energyBacked(P, c, d, key) {
      var o = powerOf(d), pl = (d.plan || {}).power;
      if (!o || o.on === false || !pl || pl.backs_up !== 'some') return;
      var it = null;
      (pl.sections || []).forEach(function (s) { (s.items || []).forEach(function (i) { if (i.key === key) it = i; }); });
      var own = (o.backed || {})[key];
      var autoText = it && it.why !== 'chosen' ? (it.backed ? 'Yes: ' + it.why : 'No') : 'Automatic';
      c.appendChild(
        K.group(
        { header: 'On the Power Page',
        footer:
        'Automatic is Yes when its power sensor or switch is on the battery’s device, its switch is a group of the battery’s circuits, or it sits inside a backed-up circuit. Choose Yes or No where ' +
        'Home Assistant can’t tell (a plug on a backed-up circuit).' }, [
        K.select({ label: 'Backed Up', sk: 'f:' + EN + ':power:backed', value: own === true ? 'yes' : own === false ? 'no' : '',
                   options: [['', own === undefined ? autoText : 'Automatic'], ['yes', 'Yes'], ['no', 'No']],
                   onChange: function (v) {
                     var b = Object.assign({}, o.backed || {});
                     if (v === 'yes') b[key] = true; else if (v === 'no') b[key] = false; else delete b[key];
                     powerSet(P, d, { backed: Object.keys(b).length ? b : null });
                   } })]));
    }

    function energyPage(P, sub, mk, withData, name, domain) {
      var back = ['Energy', '#/page/energy'];
      var d0 = P.feat(domain).data || {};
      if (sub[0] === 'top') return mk('Readings', withData(function (c, d) { energyTop(P, c, d); }), back);
      if (sub[0] === 'rings') return mk('Rings', withData(function (c, d) { energyRings(P, c, d); }), back);
      if (sub[0] === 'power') return mk('Power Page', withData(function (c, d) { energyPower(P, c, d); }), back);
      if (sub[0] === 'usages' && sub[1] !== undefined) {
        return mk('Tracked', withData(function (c, d) { energyUsage(P, c, d, Number(sub[1])); }), ['Tracking', '#/features/energy/usages']);
      }
      if (sub[0] === 'usages') return mk('Tracking', withData(function (c, d) { energyUsages(P, c, d); }), back);
      if (sub[0] === 'sections' && sub[1]) {
        var sid = decodeURIComponent(sub[1]);
        var ss = (d0.sections || []).filter(function (x) { return x.id === sid; })[0];
        return mk(ss ? ss.name : 'Section', withData(function (c, d) { energySection(P, c, d, sid); }), ['Sections', '#/features/energy/sections']);
      }
      if (sub[0] === 'sections') return mk('Sections', withData(function (c, d) { energySections(P, c, d); }), back);
      if (sub[0] === 'devices' && sub[1]) {
        var key = decodeURIComponent(sub[1]);
        var dv = devByKey(d0, key);
        return mk(dv ? dv.name : 'Device', withData(function (c, d) { energyDevice(P, c, d, key); }), ['Devices', '#/features/energy/devices']);
      }
      if (sub[0] === 'devices') return mk('Devices', withData(function (c, d) { energyDevices(P, c, d); }), back);
      if (sub[0] === 'add') return mk('Add Device', withData(function (c, d) { energyAdd(P, c, d); }), ['Devices', '#/features/energy/devices']);
      if (sub[0] === 'batteries' && sub[1]) {
        var bk = decodeURIComponent(sub[1]);
        return mk('Battery', withData(function (c, d) { energyBattery(P, c, d, bk); }), ['Batteries', '#/features/energy/batteries']);
      }
      if (sub[0] === 'batteries') return mk('Batteries', withData(function (c, d) { energyBatteries(P, c, d); }), back);
      return { title: name, top: true, scope: SCOPE[domain], body: withData(function (c, d) { energyMain(P, c, d); removeRow(P, c, name, domain); }) };
    }
    var SCOPE = {
      hk_tv: 'An HDHomeRun tuner’s channels, live on every screen.',
      hk_alarm_pin: 'A PIN in front of the alarm, asked for on every screen.',
      hk_clean_areas: 'Clean chosen rooms with whichever vacuum reaches them.',
      hk_energy: 'An Energy page for your screens, built from Home Assistant’s Energy settings.',
      hk_music: 'Whole-home music through Music Assistant.',
      hk_notify: 'A banner at the top of your screens when something happens at home.'
    };

    // what the shell and the later parts use of this one
    KIT.batteriesStored = batteriesStored; KIT.energyFound = energyFound; KIT.energyPage = energyPage;
    KIT.SCOPE = SCOPE; KIT.sectionsAfter = sectionsAfter;
  };
})();
