// hk-weather-status.js - the screensaver status and alert cards.
//
// PART OF THE WEATHER CARDS (hk-weather.js). Not a card and not run on its own: it registers one
// function, which hk-weather.js calls with the shared kit K once every part has loaded (the
// order is its PARTS list). What this file uses from the shell or from an earlier file it takes
// from K at the top; what the shell or a later file uses of it, it hands back at the bottom.
(function () {
  'use strict';
  (window.hkWeatherParts = window.hkWeatherParts || {})['hk-weather-status'] = function (K) {
    var ALERT_KEYS = K.ALERT_KEYS, Base = K.Base, houseWeather = K.houseWeather, ownKeys = K.ownKeys;

    // ------------------------------------------------------- hk-alert-card
    //
    // The severe-weather band. It renders the event, the severity, the alert
    // count, the affected-area count and the full "expected to last until ..."
    // sentence -- which is why it is INERT: the more-info dialog behind it is
    // the raw sensor, a count for a state and an `Alerts` attribute holding a
    // ~600-character AreasAffected string. Tapping a severe-weather warning
    // and getting that would be the most confusing thing on the page.
    // ------------------------------------------ hk-screensaver-status-card
    // THE HOUSE AT A GLANCE, top-right of the photo screensaver: the tablet
    // header's own security block (hkHeader.security -- the one definition of
    // "secure" the header and the car share), sized for the photos. "Home
    // Secured" when armed and everything is shut, locked and reporting;
    // otherwise what isn't; NOTHING when there is nothing to say (disarmed,
    // all shut), so the photos stay the point.
    //
    // Occupies no space in the screensaver's info box: like the now-playing
    // card it pins itself to its corner (position:fixed), and like it, the
    // shadow is a filter on the text and the info box's text-shadow is off.
    class HkScreensaverStatusCard extends Base {
      static get CSS() {
        return [
          'hk-plate.ssstat{background:none;box-shadow:none;border:none;padding:0;margin:0;height:0;',
          '  overflow:visible;display:block}',
          '.sscorner{position:fixed;top:var(--hk-ss-status-top,44px);right:var(--hk-ss-status-right,50px);',
          // (--hk-ss-status-width: the calendar pane's width, when it sits there)
          '  z-index:5;width:var(--hk-ss-status-width,46vw);pointer-events:none;text-shadow:none;will-change:transform}'
        ].join('');
      }
      setConfig(config) { super.setConfig(Object.assign({}, config || {})); }
      getCardSize() { return 1; }
      _html() {
        var H = window.hkHeader, st = this.client && this.client.states;
        if (!H || !H.security || !st) return '';
        var c = this._config || {};
        // (the screensaver may size the lines for where they sit: --hk-ss-status-l1 and -l2, Big Weather on a phone)
        return H.security(st, { line1Size: c.line1_size || 'var(--hk-ss-status-l1,36px)', lineSize: c.line_size || 'var(--hk-ss-status-l2,24px)',
                                pad: '0px', minHeight: '0px', align: c.align });
      }
      // A CHEAP SIGNATURE (2026-10-29). It was the whole header's HTML, built on every push of the house (about a dozen a
      // second on a wall tablet) just to learn whether it differed from the last: the string was thrown away unless it
      // did. Now it is what the line is made of -- the status the header computes (the same one the HTML is made from,
      // hkHeader.status: the alarm, the counts of what is open or unknown) and the card's own sizes -- and the HTML is
      // built only when that moved (_render still compares what it draws).
      _sigOf() {
        var H = window.hkHeader, st = this.client && this.client.states;
        if (!st) return null;
        if (!H || typeof H.status !== 'function') return this._html();
        var s = H.status(st), c = this._config || {};
        return (s.secured ? 1 : 0) + '|' + s.items.join('|') + '|' + [c.line1_size, c.line_size, c.align].join('|');
      }
      _render() {
        if (!this._built) {
          this._root.innerHTML = '<hk-plate class="ssstat" data-hk-role="card"><div class="sscorner"></div></hk-plate>';
          this._e = this._root.querySelector('.sscorner');
          this._built = true;
          // a rebuild (a new config) starts empty: what it last drew is gone
          this._last = null;
        }
        var html = this._html();
        if (this._last === html) return;
        this._last = html;
        var put = (window.hkCards && window.hkCards.morph) || function (el, v) { el.innerHTML = v; };
        put(this._e, html);
      }
    }

    class HkAlertCard extends Base {
      static get CSS() {
        return [
          // The glass plate, same as every other card on the page, from the
          // shared tokens. This card ONLY RENDERS WHEN AN ALERT IS LIVE, so
          // drift here would be invisible until it matters, which is the
          // argument for it not being hand-rolled.
          'hk-plate.alert{box-sizing:border-box;display:block;',
          '  padding:16px 20px 14px 20px;margin:0px 0px 12px 0px;' + window.hkCards.plate('card') + ';',
          '  --ha-ripple-hover-opacity:0;--ha-ripple-pressed-opacity:0}',
          '.alert .grid{display:grid;',
          '  grid-template-areas:"i title" "i src" "body body" "count count";',
          '  grid-template-columns:min-content minmax(0,1fr);',
          '  grid-template-rows:min-content min-content min-content min-content;',
          '  justify-items:start;align-content:start;column-gap:12px}',
          '.alert .icon{grid-area:i;width:26px;height:26px;--mdc-icon-size:26px;',
          '  align-self:center}',
          '.alert .title{grid-area:title;font-size:19px;font-weight:700;',
          '  letter-spacing:-0.45px;align-self:end;color:' + window.hkCards.v('ink') + '}',
          '.alert .src{grid-area:src;font-size:14px;font-weight:500;',
          '  letter-spacing:-0.2px;align-self:start;color:' + window.hkCards.v('ink-2') + '}',
          '.alert .body{grid-area:body;font-size:15px;font-weight:500;',
          '  letter-spacing:-0.2px;line-height:1.35;text-align:left;margin-top:12px;',
          '  color:' + window.hkCards.v('ink') + '}',
          '.alert .count{grid-area:count;font-size:13px;font-weight:500;',
          '  margin-top:10px;color:' + window.hkCards.v('ink-3') + '}'
        ].join('');
      }
      setConfig(config) {
        this._hkOwn = ownKeys(config, ALERT_KEYS);
        super.setConfig(Object.assign({}, config));
        houseWeather(this, this.client, ALERT_KEYS);
      }
      // each new client: the house's alerts sensor resolved first, then HkBase's step
      _receiveClient() { houseWeather(this, this.client, ALERT_KEYS); super._receiveClient(); }
      getCardSize() { return this._alertShown === false ? 0 : 2; }
      // Home Assistant sets `preview` on the card in its editor, after
      // setConfig: draw again, as the sample, when it arrives.
      get preview() { return !!this._hkPreview; }
      set preview(v) {
        if (this._hkPreview === !!v) return;
        this._hkPreview = !!v;
        if (this._config) this._render();
      }

      // Hidden like the chips (hk-chip.js _show): the host `hidden`, and
      // card-visibility-changed so the hui-card around it hides too -- but
      // only once it is on the page (hui-card reads `hidden` before that).
      _showAlert(on) {
        if (this._alertShown === on) return;
        this._alertShown = on;
        this.hidden = !on;
        if (this.style) this.style.display = on ? '' : 'none';
        if (this.isConnected) {
          this.dispatchEvent(new CustomEvent('card-visibility-changed',
            { detail: { value: on }, bubbles: true, composed: true }));
        }
      }
      connectedCallback() {
        if (super.connectedCallback) super.connectedCallback();
        if (this._alertShown === false) {
          this.dispatchEvent(new CustomEvent('card-visibility-changed',
            { detail: { value: false }, bubbles: true, composed: true }));
        }
      }

      // AN ALERT THAT HAS ENDED IS NOT SHOWN, though the sensor may keep it
      // until its next poll (Ends, else Expires, in the past): no stale
      // warning, and no all-clear of our own either -- the card just goes.
      _first() {
        var st = this._st(this._config.entity);
        var list = (st && st.attributes && st.attributes.Alerts) || [];
        var now = Date.now();
        var live = list.filter(function (a) {
          var end = Date.parse((a && (a.Ends || a.Expires)) || '');
          return !isFinite(end) || end > now;
        });
        var n = Number((st && st.state) || 0) || 0;
        if (list.length) n = live.length;
        return { st: st, a: live[0] || {}, n: n, all: live };
      }
      // THE DETAILS (the Weather page's, `details: true`): the alert's own
      // words -- headline, description and what to do -- in a sheet
      _details() {
        var f = this._first(), X = window.hkDetail;
        if (!f.n || !X || !X.open) return;
        var md = f.all.map(function (a) {
          return ['## ' + (a.Event || 'Weather Alert'), a.Headline ? '**' + a.Headline + '**' : '',
                  a.Severity ? 'Severity: ' + a.Severity + (a.Certainty ? ' · ' + a.Certainty : '') : '',
                  a.Description ? String(a.Description) : '', a.Instruction ? '**What to do:** ' + a.Instruction : '',
                  a.URL ? '[From the National Weather Service](' + a.URL + ')' : ''].filter(Boolean).join('\n\n');
        }).join('\n\n---\n\n');
        X.open(this._config.entity, null, { cards: { cards: [{ type: 'markdown', content: md }] } });
      }

      _render() {
        var cfg = this._config;
        if (!this._built) {
          this._root.innerHTML =
            '<hk-plate class="alert" data-hk-role="card"><div class="grid">' +
            '<hk-icon class="icon" data-hk-role="icon" icon="' +
            (cfg.icon || 'mdi:alert') + '"></hk-icon>' +
            '<div class="title" data-hk-role="title"></div>' +
            '<div class="src" data-hk-role="src"></div>' +
            '<div class="body" data-hk-role="body"></div>' +
            '<div class="count" data-hk-role="count"></div>' +
            '</div></hk-plate>';
          var q = this._root.querySelector.bind(this._root);
          this._e = { icon: q('.icon'), title: q('.title'), src: q('.src'),
                      body: q('.body'), count: q('.count') };
          if (cfg.details) {
            var self = this, card = q('hk-plate');
            card.setAttribute('role', 'button'); card.setAttribute('tabindex', '0');
            card.style.cursor = 'pointer';
            card.addEventListener('click', function () { self._details(); });
            card.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); self._details(); } });
          }
          this._built = true;
        }
        var e = this._e, f = this._first(), a = f.a;
        // ONLY WHILE AN ALERT IS LIVE. With none (or no sensor) the card hides
        // the way a conditional does, so a dashboard needs no wrapper around
        // it. The card editor's preview still draws it, saying when it shows.
        var sample = !f.n && !!this.preview;
        this._showAlert(f.n > 0 || sample);
        if (!f.n && !sample) return;

        // NWS severity vocabulary: Extreme / Severe / Moderate / Minor /
        // Unknown. One colour for all would make a tornado warning and a
        // frost advisory look identical.
        var sev = String(a.Severity || '').toLowerCase();
        e.icon.style.color = (sev === 'extreme' || sev === 'severe')
          ? 'rgba(255, 69, 58, 0.98)'
          : sev === 'moderate' ? 'rgba(255, 159, 10, 0.98)'
          : 'rgba(255, 214, 10, 0.98)';

        var title = cfg.title || 'Severe Weather';
        if (e.title.textContent !== title) e.title.textContent = title;
        var src = cfg.source || 'National Weather Service';
        if (e.src.textContent !== src) e.src.textContent = src;

        var ev = sample ? 'Shown here only while an alert is active'
               : (a.Event || a.Headline || 'Severe weather');
        var iso = a.Ends || a.Expires;
        var body = ev + '.';
        if (iso) {
          var d = new Date(iso);
          if (!isNaN(d)) {
            var t = d.toLocaleTimeString(window.hkLocale.tag(), window.hkLocale.clock({ hour: 'numeric', minute: '2-digit' }));
            var day = d.toLocaleDateString(window.hkLocale.tag(),
              window.hkLocale.zoned({ weekday: 'long', month: 'long', day: 'numeric' }));
            body = ev + '. These conditions are expected to last until ' +
                   t + ', ' + day + '.';
          }
        }
        if (e.body.textContent !== body) e.body.textContent = body;

        var parts = [];
        if (a.Severity) parts.push(a.Severity);
        parts.push(sample ? 'No alerts now' : f.n + ' ' + (f.n === 1 ? 'alert' : 'alerts'));
        // AreasAffected can be a ~600-character semicolon list -- unusable
        // raw on a tablet, and the integration only reports for the home's
        // location anyway, so it is reduced to a count.
        var areas = String(a.AreasAffected || '').split(';')
                      .filter(function (x) { return x.trim(); }).length;
        if (areas > 1) parts.push(areas + ' areas');
        if (cfg.details && !sample) parts.push('Details ›');
        var count = parts.join('  ·  ');
        if (e.count.textContent !== count) e.count.textContent = count;
      }
    }

    // what the shell and the later parts use of this one
    K.HkAlertCard = HkAlertCard; K.HkScreensaverStatusCard = HkScreensaverStatusCard;
  };
})();
