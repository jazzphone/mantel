// hk-security.js -- the alarm keypad
//
// hk-alarm-keypad-card. The code is checked SERVER-SIDE (the HK Alarm PIN
// integration's panel); this card only collects it.
//
// Shared pieces -- HkBase, the editor helpers, register(), create(), the
// snapshot cache -- come from hk-base.js through window.hkCards.
(function () {
  'use strict';

  // hk-base.js is a Lovelace resource fetched in PARALLEL with this one, so
  // wait for its ready EVENT (never poll: rAF does not fire in a hidden tab,
  // and a tablet behind the screensaver would define nothing -- see
  // hk-base.js).
  function whenBase(fn) {
    if (window.hkCards && window.hkCards.register) return fn(window.hkCards);
    window.addEventListener('hk-cards-ready', function () {
      if (window.hkCards && window.hkCards.register) fn(window.hkCards);
      else console.error('[hk-security] hk-cards-ready fired without hk-base.js');
    }, { once: true });
  }

  whenBase(function (C) {
    var setting = C.setting;
  if (window.hkSecurity) return;                  // double-load guard
  var HkBase = C.HkBase, M = C.M, register = C.register,
      wireEditor = C.wireEditor, firstOfDomain = C.firstOf,
      HK_LABELS = C.LABELS, create = C.create;

  // =========================================================== alarm keypad
  // The code entry half of the Alarm page and the #alarm pop-up.
  //
  // WHAT THE CARD DOES NOT DO: check the code. That lives in the Alarm PIN
  // feature's alarm_control_panel, which wraps an alarm integration with no
  // code of its own and checks the entered code (against a hash, never the
  // code) before forwarding. A card cannot enforce anything -- anyone who can
  // reach the frontend can call the service directly -- so this card COLLECTS
  // a code and Home Assistant decides whether it was right. It calls
  // alarm_control_panel.alarm_disarm / arm_home / arm_away on the WRAPPER,
  // never on the wrapped panel.
  //
  // THE DIGITS STAY IN THE BROWSER. They are a JS string that never leaves
  // this card until a button is pressed -- not a shared input_text helper,
  // which would hold whatever somebody was half-way through typing, share it
  // between every screen, rebroadcast it to every connected client on each
  // keypress and need excluding from the recorder by hand. The card passes its
  // own digits to the alarm service and clears itself.
  //
  // THERE IS NO ENTER KEY, deliberately. It would call
  // alarm_control_panel.alarm_disarm with the typed code -- identical to the
  // Disarm button in the row below it. Two keys for one action, one of them
  // named after a keyboard convention rather than after what it does, is worse
  // than one key that says Disarm. The 0 widens into its cell, so the bottom
  // row is a double-width 0 and then Clear.
  //
  // WRONG-CODE FEEDBACK still comes from the server, and has to: only the
  // panel knows the code. A refused call answers with an error, which this
  // card shows as "Wrong code" for 3s (a `bad_code_entity` flag is also read
  // for a panel that fails silently).
  class HkAlarmKeypadCard extends HkBase {
    // THE KEYPAD (2026-10-15, the page headers' Security System box): the
    // code in a recessed field that says "Enter code", the digits in a 3 x 4
    // grid with Clear and delete beside the 0, and the ways to arm as
    // capsules under it -- the same on the Security page (`boxed`: in its own
    // plate, the title and the alarm's state as a badge, and whether the
    // entry points are closed) and in the alarm's sheet, so the two look
    // alike and send the same thing. Keys are a key on a plate (`key`), the
    // field a well (`well-bg`); no blur of their own (a blur surface per key
    // is the tablets' cost).
    static get CSS() {
      var v = window.hkCards.v, R = C.R, P = C.PALETTE.icon;
      var key = 'background:' + v('key') + ';border:1px solid ' + v('line') + ';box-sizing:border-box;' +
        'display:flex;align-items:center;justify-content:center;cursor:pointer;user-select:none;-webkit-user-select:none;' +
        '-webkit-tap-highlight-color:transparent;color:' + v('ink') + ';transition:transform .12s ease,background .12s ease';
      return [
        ':host{display:block}',
        // boxed: the page card's plate, padding and corner
        'hk-plate.kp{box-sizing:border-box;display:flex;flex-direction:column;height:100%;padding:' + C.CARD.pad + ';margin:0;' +
          C.plate('card') + ';color:' + v('ink') + '}',
        '.hd{display:flex;align-items:center;justify-content:space-between;gap:10px;min-height:28px;margin-bottom:12px}',
        // the title follows the box's width -- 17 in the tablet's 360 box,
        // about 15 in an iPad's narrower one -- so it and the badge both fit
        'hk-plate.kp{container-type:inline-size}',
        '.hd b{font-size:min(17px,5.5cqw);font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
        '.badge{display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 11px;box-sizing:border-box;border-radius:' + R.capsule('28px') + ';',
        '  background:' + v('key') + ';border:1px solid ' + v('line') + ';font-size:13px;font-weight:500;color:' + v('ink-2') + ';white-space:nowrap;cursor:pointer}',
        '.badge hk-icon{--mdc-icon-size:15px;width:15px;height:15px;display:flex}',
        // the field: recessed, "Enter code" until typed, dots while typing
        '.read{height:var(--hk-kp-key,48px);border-radius:' + R.inner + 'px;margin:0 0 10px;box-sizing:border-box;',
        '  background:' + v('well-bg') + ';border:1px solid ' + v('line') + ';display:flex;align-items:center;justify-content:center}',
        '.read .code{font-size:22px;font-weight:700;letter-spacing:8px;color:' + v('ink') + '}',
        '.read .code.ph{font-size:15px;font-weight:500;letter-spacing:0;color:' + v('ink-3') + '}',
        '.read[data-bad="1"]{border-color:rgba(255,69,58,0.55)}',
        '.read[data-bad="1"] .code{font-size:15px;letter-spacing:0;font-weight:600;color:' + v('fail') + '}',
        // the status in the field, unboxed and at rest (a keypad on its own:
        // nothing else says what the alarm is doing)
        '.read .st{display:none;align-items:center;gap:10px;min-width:0}',
        '.read[data-mode="status"] .st{display:flex}',
        '.read[data-mode="status"] .code{display:none}',
        '.read .st hk-icon{--mdc-icon-size:22px;width:22px;height:22px;flex:none;display:flex}',
        '.read .st span{font-size:17px;font-weight:600;color:' + v('ink') + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
        '.pad{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}',
        '.k{height:var(--hk-kp-key,48px);border-radius:' + R.inner + 'px;font-size:19.7px;font-weight:700;letter-spacing:-0.45px;' + key + '}',
        '.k.sm{font-size:15px;font-weight:500;letter-spacing:0;color:' + v('ink-2') + '}',
        '.k hk-icon{--mdc-icon-size:20px;width:20px;height:20px;display:flex;color:' + v('ink-2') + '}',
        '.k:active,.a:active{transform:scale(0.97);background:' + v('key-strong') + '}',
        '.acts{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-top:10px}',
        '.a{height:44px;border-radius:' + R.capsule('44px') + ';padding:0 6px;gap:6px;font-size:13px;font-weight:600;' + key + '}',
        '.a hk-icon{--mdc-icon-size:16px;width:16px;height:16px;flex:none;display:flex;color:' + v('ink-2') + '}',
        '.a span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
        // the mode the alarm is in: its button lit in the mode's own color
        '.a.cur{background:color-mix(in srgb,var(--c) 20%,transparent);border-color:color-mix(in srgb,var(--c) 50%,transparent)}',
        '.a.cur hk-icon{color:var(--c)}',
        '.a.home{--c:' + P.blue + '}.a.away{--c:' + P.green + '}.a.off{--c:' + P.red + '}',
        // a panel with no code: taller buttons, the only thing to press
        '.tap .a{height:var(--hk-kp-key,48px);border-radius:' + R.capsule('48px') + ';font-size:15px}',
        '.foot{display:flex;align-items:center;justify-content:center;gap:6px;margin-top:auto;padding-top:12px;font-size:11px;font-weight:600;color:' + v('ink-2') + '}',
        '.foot hk-icon{--mdc-icon-size:13px;width:13px;height:13px;display:flex;color:' + P.green + '}',
        '.foot.open hk-icon{color:' + v('warn') + '}',
        // SIDE BY SIDE (`layout: 'side'`, a Home Grid's Large Security block,
        // 2026-10-24): the keys on the left, the field and the ways to arm
        // stacked on the right, so the keys keep their height in a 310 px
        // block (--hk-kp-key, set by the block)
        '.side{display:grid;grid-template-columns:minmax(0,1.5fr) minmax(0,1fr);grid-template-rows:auto minmax(0,1fr);column-gap:12px;height:100%}',
        '.side .read{grid-column:2;grid-row:1;margin:0;height:auto;min-height:var(--hk-kp-key,48px);padding:0 10px}',
        '.side .read .code{letter-spacing:5px}.side .read .code.ph{letter-spacing:0}.side .read .st span{font-size:15px}',
        '.side .pad{grid-column:1;grid-row:1 / span 2;align-content:space-between}',
        '.side .acts{grid-column:2;grid-row:2;grid-template-columns:minmax(0,1fr);align-content:end;gap:8px;margin:0}',
        '.side.tap .acts{grid-column:1 / span 2;grid-row:1 / span 2;grid-template-columns:repeat(2,minmax(0,1fr));align-content:center}',
        '@media (prefers-reduced-motion: reduce){.k,.k:active,.a,.a:active{transition:none;transform:none}}'
      ].join('');
    }
    _onConfig() { this._code = ''; this._msg = ''; this._built = false; }

    // THE ALARM'S STATUS IN THE READOUT, so the keypad itself says what the
    // alarm is doing instead of a separate Status block beside it (whose glyph
    // could never sit on the column of the pills under it). The readout says
    // it while nobody is typing: the shield of the button that sets that
    // state, in that button's colour -- Disarm red, Home blue, Away green --
    // amber while it is on its way, and the word. `status: false` keeps the
    // plain dash (the alarm sheet, which leads with the state word already).
    static status(s) {
      var P = C.PALETTE.icon, st = s && s.state;
      var M2 = {
        disarmed: ['hk:shield-off', P.red, 'Disarmed'],
        armed_home: ['hk:shield-home', P.blue, 'Armed Home'],
        armed_night: ['hk:shield-home', P.blue, 'Armed Night'],
        armed_away: ['hk:shield-lock', P.green, 'Armed Away'],
        armed_vacation: ['hk:shield-lock', P.green, 'Armed Vacation'],
        armed_custom_bypass: ['hk:shield-lock', P.green, 'Armed'],
        arming: ['hk:shield-lock', P.orange, 'Arming\u2026'],
        pending: ['hk:shield-alert', P.orange, 'Pending\u2026'],
        disarming: ['hk:shield-off', P.orange, 'Disarming\u2026'],
        triggered: ['hk:shield-alert', P.red, 'Triggered']
      };
      var m = M2[st] || ['hk:shield-off', 'var(--hk-glyph,rgba(255,255,255,0.55))',
                         !s || st === 'unavailable' || st === 'unknown' ? 'Unavailable' : String(st)];
      return { icon: m[0], color: m[1], word: m[2] };
    }

    // AN ALARM THAT TAKES NO CODE (its code_format null -- a panel that arms
    // and disarms with a tap): no digits, only the buttons it can do, each
    // sent without a code. One that takes a code keeps the keypad.
    static codeless(s) {
      var a = s && s.attributes;
      return !!a && !a.code_format && s.state !== 'unavailable' && s.state !== 'unknown';
    }
    // The modes it can be armed in (supported_features), in the order the
    // buttons go: Home, Away, Night, Vacation, Custom. Not reported: Home and
    // Away, as before.
    static modes(s) {
      var f = s && s.attributes && s.attributes.supported_features;
      if (typeof f !== 'number') return ['home', 'away'];
      return [['home', 1], ['away', 2], ['night', 4], ['vacation', 32], ['custom_bypass', 16]]
        .filter(function (m) { return f & m[1]; }).map(function (m) { return m[0]; });
    }
    // The card's own entity, else the alarm chosen in Configure -> Your home.
    _panel() { return this._config.entity || setting('security.alarm'); }
    // The server's wrong-code flash: the card's own, else Configure -> Advanced.
    _badCode() { return this._config.bad_code_entity || setting('features.alarm_bad_code'); }
    _press(d) { this._code = (this._code + d).slice(0, 10); this._paint(); }
    _clear() { this._code = ''; this._paint(); }

    // NOT named _call: that name is HkBase._call(domain, service, data), and
    // shadowing it makes this method call itself forever -- every
    // Home/Away/Disarm press overflows the stack and sends nothing.
    _alarm(service) {
      if (!this.client) { return; }
      var self = this;
      // WRONG CODE, BUILT IN. An alarm integration that checks the code refuses
      // the call with an error ("Invalid alarm code ..."), and that refusal is
      // shown here for 3 s -- no helper, no automation. An error that is not
      // about the code says the alarm did not answer instead.
      //
      // The optional wrong-code INDICATOR (Configure -> Advanced) stays for
      // panels that fail SILENTLY -- a template panel that checks the code
      // itself and simply does nothing on a mismatch: its own automation turns
      // the indicator on, and _paint shows that too.
      var data = { entity_id: this._panel() };
      if (!this._codeless) data.code = this._code;      // a panel with no code gets none
      this._callErr('alarm_control_panel', service, data).then(function (r) {
        if (r.ok) return;
        self._flash(/code/i.test(String(r.error)) ? 'Wrong code' : 'Alarm not responding');
      });
      // Cleared whether or not the code was right -- a keypad that keeps a
      // rejected code on screen invites a second try at the same wrong digits.
      this._clear();
    }

    _flash(text) {
      var self = this;
      this._msg = text;
      clearTimeout(this._msgT);
      this._msgT = setTimeout(function () { self._msg = ''; self._paint(); }, 3000);
      this._paint();
    }

    // The flash's timer goes with the card (it chains to HkBase's cleanup).
    disconnectedCallback() {
      clearTimeout(this._msgT);
      this._msgT = null;
      this._msg = '';
      super.disconnectedCallback();
    }

    // The wrong-code flag is an input like the panel itself. HkBase's default
    // signature names `entity` only, so without this the server's 3 s flash of
    // the wrong-code flag never reaches the screen: "Wrong code" could not
    // appear unless the panel happened to change in the same moment.
    _sigOf() {
      var h = this.client, c = this._config;
      if (!h || !c) return null;
      // the panel as _panel() finds it: the status in the readout reads it;
      // boxed, the entry points its footer counts too
      var ids = [c.entity || setting('security.alarm'), c.bad_code_entity || setting('features.alarm_bad_code')]
        .concat(c.boxed && Array.isArray(c.entries) ? c.entries : []);
      return ids.map(function (id) {
        var s = id && h.states[id];
        return id + '=' + (s ? s.last_updated : 'x');
      }).join(';');
    }

    _paint() {
      var read = this._root.querySelector('.read');
      // the panel became one with a code, or without one: drawn again
      if (this._built && this._config && this.client) {
        var ps = this._st(this._panel());
        var shape = (HkAlarmKeypadCard.codeless(ps) ? 'tap:' : 'pad:') + HkAlarmKeypadCard.modes(ps).join(',');
        if (this._shape && shape !== this._shape) { this._built = false; this._render(); return; }
      }
      this._paintBox();
      if (!read) { return; }
      var bad = this._st(this._badCode());
      var isBad = !!this._msg || (bad && bad.state === 'on');
      read.setAttribute('data-bad', isBad ? '1' : '0');
      // at rest, a keypad on its own says what the alarm is doing; boxed,
      // the badge says it, and the field asks for the code
      var rest = !isBad && !this._code && this._config.status !== false && !this._config.boxed;
      read.setAttribute('data-mode', rest ? 'status' : 'code');
      // no code and no status to say: the field only for "Alarm not responding"
      if (read.style) read.style.display = this._codeless && !rest && !isBad ? 'none' : '';
      var span = read.querySelector('.code');
      var ph = !isBad && !this._code;
      span.textContent = isBad ? (this._msg || 'Wrong code')
                       : (this._code ? new Array(this._code.length + 1).join('•') : 'Enter code');
      if (span.classList) span.classList.toggle('ph', ph);
      if (!rest) return;
      var s = HkAlarmKeypadCard.status(this._st(this._panel()));
      var icon = read.querySelector('.st hk-icon'), word = read.querySelector('.st span');
      if (icon.getAttribute('icon') !== s.icon) icon.setAttribute('icon', s.icon);
      icon.style.color = s.color;
      word.textContent = s.word;
      read.setAttribute('aria-label', 'Alarm: ' + s.word);
    }

    // BOXED: the state badge, the lit mode and the entry points' line
    _paintBox() {
      if (!this._root.querySelectorAll) return;
      var ps = this._st(this._panel()), st = ps && ps.state;
      var cur = { armed_home: 'home', armed_night: 'home', armed_away: 'away', armed_vacation: 'away',
                  armed_custom_bypass: 'away', disarmed: 'off' }[st];
      this._root.querySelectorAll('.a').forEach(function (a) {
        a.classList.toggle('cur', !!cur && a.classList.contains(cur) && !a.classList.contains('k62'));
      });
      var badge = this._root.querySelector('.badge');
      if (badge) {
        var s = HkAlarmKeypadCard.status(ps);
        var bi = badge.querySelector('hk-icon');
        if (bi.getAttribute('icon') !== s.icon) bi.setAttribute('icon', s.icon);
        bi.style.color = s.color;
        badge.querySelector('span').textContent = s.word;
      }
      var foot = this._root.querySelector('.foot');
      if (foot) {
        var h = this.client, open = (this._config.entries || []).filter(function (id) {
          var x = h && h.states[id];
          return x && /^(on|open|opening)$/.test(x.state);
        });
        foot.classList.toggle('open', open.length > 0);
        var fi = foot.querySelector('hk-icon');
        fi.setAttribute('icon', open.length ? 'hk:alert-circle' : 'hk:check-bold');
        var name = function (id) { var x = h.states[id]; return (x && x.attributes.friendly_name) || id; };
        foot.querySelector('span').textContent = !open.length ? 'All entry points closed'
          : open.slice(0, 2).map(name).join(', ') + (open.length > 2 ? ' and ' + (open.length - 2) + ' more' : '') +
            (open.length === 1 ? ' is open' : ' are open');
      }
    }

    _key(cls, label, fn, icon) {
      var d = document.createElement('div');
      d.className = cls;
      C.button(d, fn);
      if (icon) {
        var i = document.createElement('hk-icon'); i.setAttribute('icon', icon);
        d.appendChild(i);
        if (label) { var s = document.createElement('span'); s.textContent = label; d.appendChild(s); }
        else d.setAttribute('aria-label', 'Delete');
      } else {
        d.textContent = label;
      }
      return d;
    }

    _render() {
      if (!this._config) { return; }
      // what the panel is decides what is drawn: with a code or without, and
      // its modes -- drawn again only when that changes
      var ps = this._st(this._panel());
      var codeless = HkAlarmKeypadCard.codeless(ps), modes = HkAlarmKeypadCard.modes(ps);
      var shape = (codeless ? 'tap:' : 'pad:') + modes.join(',');
      if (this._built && this._shape === shape) { this._paint(); return; }
      this._shape = shape;
      this._codeless = codeless;
      var self = this, c = this._config;
      this._root.innerHTML = '';
      // BOXED: in its own plate, with its title and the state's badge
      var host = this._root;
      if (c.boxed) {
        host = document.createElement('hk-plate');
        host.className = 'kp';
        host.setAttribute('data-hk-role', 'card');
        var hd = document.createElement('div');
        hd.className = 'hd';
        hd.innerHTML = '<b></b><span class="badge" role="button" tabindex="0"><hk-icon></hk-icon><span></span></span>';
        hd.querySelector('b').textContent = c.title || 'Security System';
        hd.querySelector('.badge').addEventListener('click', function () {
          window.hkShell.moreInfo(self._panel(), self);
        });
        host.appendChild(hd);
        this._root.appendChild(host);
      } else if (c.layout === 'side') {
        host = document.createElement('div');
        host.className = 'side' + (codeless ? ' tap' : '');
        this._root.appendChild(host);
      }

      var read = document.createElement('div');
      read.className = 'read';
      read.setAttribute('role', 'status');
      var code = document.createElement('span'); code.className = 'code';
      var st = document.createElement('div'); st.className = 'st';
      st.appendChild(document.createElement('hk-icon'));
      st.appendChild(document.createElement('span'));
      read.appendChild(code); read.appendChild(st);
      host.appendChild(read);

      var WORDS = { home: ['Home', 'hk:shield-home', 'home'], away: ['Away', 'hk:shield-lock', 'away'],
                    night: ['Night', 'hk:weather-night', 'home'], vacation: ['Vacation', 'hk:bag-suitcase', 'away'],
                    custom_bypass: ['Custom', 'hk:shield-lock', 'away'] };
      var foot = function () {
        if (!c.boxed || !Array.isArray(c.entries) || !c.entries.length) return;
        var f = document.createElement('div');
        f.className = 'foot';
        f.innerHTML = '<hk-icon></hk-icon><span></span>';
        host.appendChild(f);
      };
      if (codeless) {
        // NO CODE: a button for each mode it can be armed in, and Disarm --
        // three to a row, like the keypad's own row of actions
        var tap = document.createElement('div'); tap.className = 'acts tap';
        // an even grid: two or four in pairs, three or five three to a row
        var n = modes.length + 1;
        tap.style.gridTemplateColumns = 'repeat(' + (n === 2 || n === 4 ? 2 : Math.min(3, n)) + ',minmax(0,1fr))';
        modes.forEach(function (m) {
          var w = WORDS[m];
          tap.appendChild(self._key('a ' + w[2], w[0], function () { self._alarm('alarm_arm_' + m); }, w[1]));
        });
        tap.appendChild(self._key('a off', 'Disarm', function () { self._alarm('alarm_disarm'); }, 'hk:shield-off'));
        host.appendChild(tap);
        foot();
        this._built = true;
        this._paint();
        return;
      }

      // 1-9, then Clear, 0 and delete: the 0 in the middle column, where a
      // hand goes for it without looking; Clear (all) and delete (one) at
      // its sides. THERE IS NO ENTER: it would be the Disarm button below.
      var pad = document.createElement('div'); pad.className = 'pad';
      ['1','2','3','4','5','6','7','8','9'].forEach(function (d) {
        pad.appendChild(self._key('k', d, function () { self._press(d); }));
      });
      pad.appendChild(self._key('k sm', 'Clear', function () { self._clear(); }));
      pad.appendChild(self._key('k', '0', function () { self._press('0'); }));
      pad.appendChild(self._key('k sm', '', function () { self._code = self._code.slice(0, -1); self._paint(); },
                                'hk:backspace-outline'));
      host.appendChild(pad);

      var acts = document.createElement('div'); acts.className = 'acts';
      // (Home and Away, those it can do: a panel with no Home has no Home key)
      if (modes.indexOf('home') >= 0) acts.appendChild(self._key('a home', 'Home', function () { self._alarm('alarm_arm_home'); }, 'hk:shield-home'));
      if (modes.indexOf('away') >= 0) acts.appendChild(self._key('a away', 'Away', function () { self._alarm('alarm_arm_away'); }, 'hk:shield-lock'));
      acts.appendChild(self._key('a off', 'Disarm', function () { self._alarm('alarm_disarm'); }, 'hk:shield-off'));
      // (side by side, the ways to arm stack in their column: .side .acts)
      if (c.layout !== 'side') acts.style.gridTemplateColumns = 'repeat(' + acts.children.length + ',minmax(0,1fr))';
      host.appendChild(acts);
      foot();

      this._built = true;
      this._paint();
    }
    getCardSize() { return 8; }
  }

  if (!customElements.get('hk-alarm-keypad-card')) {
    customElements.define('hk-alarm-keypad-card', HkAlarmKeypadCard);
  }
  window.customCards.push({
    type: 'hk-alarm-keypad-card',
    name: 'HK Alarm Keypad',
    description: 'A keypad to arm and disarm an alarm panel with a code.',
    preview: false
  });

  // Field labels and help text live in hk-base.js (HK_LABELS / HK_HELPERS).
  wireEditor('hk-alarm-keypad-card', HkAlarmKeypadCard, [
    // NOT required: empty is the home's alarm (Configure -> Your home), so a
    // keypad added in the UI follows a change there instead of keeping a copy.
    { name: 'entity', label: 'Alarm panel',
      selector: { entity: { filter: { domain: 'alarm_control_panel' } } } },
    // Set by the automation that rejects a code, so the keypad can shake.
    { name: 'bad_code_entity',
      selector: { entity: { filter: { domain: 'input_boolean' } } } },
    // In its own plate, with a title and the alarm's state (the Security page)
    { name: 'boxed', selector: { boolean: {} } }
  ], function (client) {
    return setting('security.alarm') ? {} : { entity: firstOfDomain(client, 'alarm_control_panel') };
  });

  window.hkSecurity = { version: '1.0.0' };
  });
})();
