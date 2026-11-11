// hk-base-editors.js - the config editors and nested cards.
//
// PART OF THE CARDS' FOUNDATION (hk-base.js). Not a card and not run on its own: it registers one
// function, which hk-base.js calls with the shared kit K once every part has loaded (the
// order is its PARTS list). What this file uses from the shell or from an earlier file it takes
// from K at the top; what the shell or a later file uses of it, it hands back at the bottom.
(function () {
  'use strict';
  (window.hkBaseParts = window.hkBaseParts || {})['hk-base-editors'] = function (K) {
    var asClient = K.asClient, sentenceCase = K.sentenceCase;

    // ========================================================= CONFIG EDITORS
    //
    // Many of these configs are written by hand in YAML -- one shared file
    // reaching several dashboards is what stops them drifting apart. An
    // editor is still worth having: it is what the card
    // PICKER and the preview pane use, which is how a card gets dropped onto a
    // page without looking up its options first.
    //
    // ha-form does the work. Two things about it that this depends on, both
    // verified against the served frontend rather than assumed:
    //   * it PRESERVES keys that are not in the schema (`type` above all), and
    //     emits the whole merged object -- so there is no manual merge here.
    //   * every selector these schemas use exists: entity, text, icon, select,
    //     boolean, object (a YAML sub-editor) and ui_action.
    //
    // The one rule the card set keeps: options must be
    // LEGIBLE AND FEW. A schema that needs a scrollbar is a card with too many
    // options, not a card that needs a bigger form.
    // WORDS ARE US ENGLISH, matching the rest of Home Assistant's UI ("color",
    // "Favorite"). The CONFIG KEYS keep their spelling (icon_color, colour in
    // chart opts) -- those are data, and renaming them would break every YAML
    // file. Only what a person reads is US English.
    //
    // A field missing from HK_LABELS falls back to a humanized key ("min_hour_col"
    // -> "Min hour col") so nothing ever shows a raw snake_case name; a schema
    // entry may also carry its own `label` / `helper` when a word means something
    // different on one card (the vacuum's `room` is a SENSOR, a tile's is text).
    var HK_LABELS = {
      // the status chips (hk-chip.js): a kind, and the row's lists
      kind: 'Kind', quiet: 'Only when there is something to report', chips: 'Chips',
      scenes: 'Scenes', looks: 'How each looks',
      // shared by most cards
      entity: 'Entity', name: 'Name', icon: 'Icon', icon_states: 'Icon for each state',
      icon_size: 'Icon size', icon_color: 'Icon color', bare_icon: 'Hide icon circle',
      bare_icon_color: 'Icon color without circle', well_background: 'Icon circle color',
      room: 'Room name', label: 'Status text (fixed)', label_mode: 'Status text',
      label_map: 'Status text for each state', label_default: 'Status text fallback',
      animation: 'Icon animation', layout: 'Layout', elevated: 'Drop shadow', size: 'Tile size',
      color: 'Color',
      option: 'Lit when state is', navigation_path: 'Link to page',
      chevron: 'Link text', height: 'Height', padding: 'Padding', margin: 'Margin',
      width: 'Width', gap: 'Gap', grid_rows: 'Row height',
      group: 'Group members', group_lit: 'Tile lights up when',
      tap_action: 'Tap action',
      icon_tap_action: 'Icon tap action',
      // readings
      value: 'Value (fixed text)', mode: 'Show', value_mode: 'Value format',
      value_attribute: 'Read attribute', value_suffix: 'Value suffix',
      value_peer: 'Energy meter sensor', idle_text: 'Idle text',
      power: 'Power sensor', stat: 'Energy statistic', peers: 'Compare with', cost_stat: 'Cost statistic',
      label_entity: 'Status from entity', label_suffix: 'Status suffix',
      label_decimals: 'Status decimals', icon_color_steps: 'Icon color by value',
      charge: 'Charging power sensor', discharge: 'Discharging power sensor',
      stored: 'Stored energy sensor', runtime: 'Backup runtime sensor',
      reserve: 'Backup reserve level', limit: 'Charge limit',
      opts: 'Chart options', trace: 'Graph options',
      // controls
      control: 'Control type', bare: 'No glass background', entity_from: 'Follow a selector',
      // layout
      card: 'Card', material: 'Background', phone: 'On a phone', parents: 'Parent pages', variant: 'Style',
      fill: 'Fill color', icon_colors: 'Icon color for each state',
      card_width: 'Card width', phone_card_width: 'Card width on phones',
      phone_gap: 'Gap on phones', pad_top: 'Top padding', pad_bottom: 'Bottom padding',
      pad_left: 'Left padding', pad_right: 'Right padding', cards: 'Cards',
      temperature: 'Temperature sensor', downstairs: 'Downstairs thermostat',
      upstairs: 'Upstairs thermostat', garage: 'Garage door',
      // weather and clock
      weather_path: 'Weather page', alarm_path: 'Security page', title: 'Title',
      source: 'Source name', caption: 'Caption', speed: 'Wind speed sensor',
      gust: 'Wind gust sensor', sun: 'Sun entity', phase: 'Moon phase sensor',
      uv: 'UV index sensor', hours: 'Hours to show', days: 'Days to show',
      min_hour_col: 'Narrowest hour column (px)', min_day_col: 'Narrowest day column (px)',
      now_width: 'Today’s column width (px)',
      plain: 'No plate (white text, shadowed)', narrow: 'Stood up (as on a phone)',
      place: 'Location label', time_size: 'Time size', ampm_size: 'AM/PM size',
      date_size: 'Date size', date_color: 'Date color', shadow: 'Text shadow',
      date_format: 'Date format', time_line_height: 'Time line height',
      main_size: 'Temperature size',
      detail_size: 'Detail text size', glyph_size: 'Weather icon size',
      dim_color: 'Secondary text color',
      // media
      meta_card: 'Controls card', browse_url: 'Browse page',
      players: 'Players, in priority order', selector: 'Selector',
      // home
      start_script: 'Clean script', floors: 'Floors and areas', order: 'Room order',
      create_script: 'Start timer script', name_chips: 'Suggested names',
      timers: 'Timers', empty_text: 'Text when nothing is running', tint: 'Accent color',
      bad_code_entity: 'Wrong code flag', battery: 'Battery sensor',
      progress: 'Cleaning progress sensor', error: 'Error sensor',
      dock_error: 'Dock error sensor', scale: 'Size', fixed: 'Pin to bottom of screen',
      plated: 'Glass behind each timer', chips: 'Chips',
      // cameras
      seam: 'Gap between images (px)', refresh: 'Snapshot refresh (seconds)',
      radius: 'Corner radius', seam_color: 'Gap color',
      // pop-up
      hash: 'Opens on', position: 'Position', background: 'Background',
      blur: 'Background blur', backdrop: 'Page dimming', clip: 'Clip to corners',
      vars: 'Card style variables', auto_close: 'Close after (ms)',
      close_outside: 'Close when tapping outside', trigger: 'Open when',
      trigger_close: 'Close when no longer true', dismissable: 'Stay closed once dismissed',
      dismiss_scope: 'Show again when these change', close_action: 'Action on close'
    };

    // One line under the field, only where the label cannot carry the meaning.
    var HK_HELPERS = {
      kind: 'Counts what HK finds for it (HK Settings → Accessories, that type’s page). Leave empty for a chip of your own (an entity).',
      chips: 'The row when this dashboard\'s settings (under Dashboards) name none. Empty: every kind the house has.',
      scenes: 'The row when this dashboard\'s settings name none. Empty: every scene, A to Z.',
      looks: 'YAML: entity: {name, icon, icon_color, tap_action}.',
      icon_size: 'CSS size, e.g. 30px. Leave empty for the default.',
      icon_states: 'YAML: state: icon. Quote on and off, e.g. "on": hk:lightbulb-on',
      bare_icon: 'While on, draw the icon without the colored circle behind it.',
      size: 'Tall spans two rows: give it view_layout grid-row: span 2. Empty: the card\'s own.',
      well_background: 'e.g. transparent. Leave empty for the default.',
      label: 'Replaces the status text completely.',
      label_mode: 'How the state becomes the status text under the name.',
      group: 'Other entities this tile stands for. Used by the "group" status texts.',
      group_lit: 'Light the tile from the main entity, or when any group member is on.',
      icon_tap_action: 'Tapping the icon does this; the rest of the tile uses Tap action.',
      room: 'Shown small, above the name.',
      option: 'Leave empty to light when on. Enter a state (e.g. Everywhere) to light when the entity equals it.',
      navigation_path: 'e.g. ./cameras. A path starting with ./ works on every dashboard.',
      chevron: 'Extra text after the title, e.g. "Details›".',
      grid_rows: 'CSS height of the heading row, e.g. 44px.',
      height: 'CSS height, e.g. 44px.', padding: 'CSS padding, e.g. 0px 0px 0px 3px.',
      margin: 'CSS margin, e.g. 0px 0px 12px 0px.', width: 'CSS width, e.g. 184px.',
      value: 'Shows this text instead of the reading.',
      value_mode: 'Leave empty to show the state as it is.',
      value_attribute: 'Temperature format: read this attribute instead of the state.',
      value_suffix: 'Temperature format: default °F.',
      value_peer: 'Cost format: the kWh meter shown after the price.',
      idle_text: 'Runtime and flow formats: shown when nothing is running.',
      power: 'Live power reading. Defaults to the entity.',
      stat: 'Today\'s energy, shown under the name.',
      peers: 'Other devices to compare today\'s use against.',
      label_entity: 'Status text is this entity\'s state instead.',
      icon_color_steps: 'YAML list, first match wins: - above: 60 / color: green, then - color: red. above is strict (more than 60), at_least inclusive -- as in a chip\'s when.',
      charge: 'Flow format: shown with + while charging.',
      discharge: 'Flow format: shown with − while discharging.',
      reserve: 'Number entity for the backup reserve %.', limit: 'Number entity for the charge limit %.',
      opts: 'YAML passed to the chart, e.g. colour: orange.',
      trace: 'YAML: hours: 3, colour: orange, title: Whole Home Power',
      control: 'Normally picked from the entity type.',
      bare: 'For use inside another card that already has a background.',
      entity_from: 'YAML: selector: input_select.x and map: {Option: entity}. Replaces Entity.',
      card: 'Any card, in YAML, e.g. type: energy-usage-graph',
      parents: 'YAML: page: parent page, for pages not opened from the dashboard, e.g. music-browse: playmusic',
      fill: 'Filled style only, e.g. rgba(255, 159, 10, 0.95).',
      icon_colors: 'Entity state type only. YAML: state: color.',
      temperature: 'Climate type only.', downstairs: 'Climate type only.', upstairs: 'Climate type only.',
      garage: 'Security type only.',
      phone_card_width: 'Used on screens narrower than 640px.', phone_gap: 'Used on screens narrower than 640px.',
      cards: 'The cards in the row, as a YAML list.',
      weather_path: 'Opened by tapping the weather. Default ./weather',
      alarm_path: 'Opened by tapping the security summary. Default ./alarm',
      title: 'Default: Severe Weather.', source: 'Default: National Weather Service.',
      speed: 'For Wind.', gust: 'For Wind.', sun: 'For Sunrise / sunset.',
      phase: 'For Moon. Empty: the built-in phase, the same one the live sky draws.', uv: 'For UV index.',
      min_hour_col: 'Hours are dropped rather than squeezed narrower than this.',
      now_width: 'Today’s conditions, left of the hours and days. 120 to 400; empty is 300.',
      min_day_col: 'Days are dropped rather than squeezed narrower than this.',
      plain: 'Drawn straight on what is behind it, as on the screensaver.',
      narrow: 'Today’s conditions above the hours and the days, whatever the width.',
      place: 'Shown at the top, e.g. HOME · SPRINGFIELD. Empty: Configure -> Weather, else the home name',
      meta_card: 'Drawn under the title — usually HK Media Controls following the same selector.',
      browse_url: 'Opened by the Browse button.',
      players: 'The first one playing is shown. List speaker groups before their members.',
      start_script: 'Optional. Receives the selected area ids. Empty: HK Clean Areas sends each vacuum the areas on its room map.',
      floors: 'Empty: the rooms Clean Areas offers (HK Settings → Pages → Vacuums), by floor, kept up to date. Or a YAML list: name, areas: [{id, name}] (id is the Home Assistant area id).',
      order: 'Optional, for automatic rooms: the order to show them in on each floor. Empty: this screen\'s Room order when it is used on pages, else A to Z.',
      create_script: 'Optional. Receives the duration and name. Empty: script.quick_timer_create (the shipped quick-timer helpers).', name_chips: 'Names offered as one-tap choices.',
      timers: 'YAML list: entity, label, glyph, label_entity.',
      bad_code_entity:
        'Optional. Only for a panel that fails silently on a wrong code: an on/off entity turned on briefly when a code is rejected. A panel that refuses the code shows "Wrong code" without it.',
      progress: 'Percent complete while cleaning.',
      scale: '1 is normal size.', fixed: 'For the screensaver.',
      seam: 'Space between the camera images.', refresh: 'How often the snapshots update. 0 turns it off.',
      hash: 'The page address ending that opens it, e.g. #doorbell',
      backdrop: '0 to 1. Default 0.8.', auto_close: 'e.g. 60000 for one minute.',
      trigger: 'YAML list of conditions. Opens by itself when they become true.',
      dismissable: 'Closed by hand, it stays closed on this screen until the conditions end.',
      vars: 'YAML: CSS variable: value, e.g. ha-card-background: transparent'
    };

    // Readable names for the fixed choices. A value missing here is humanized.
    var HK_OPTION_LABELS = {
      // tile status texts
      on_off: 'On / Off', state: 'State (Open, Locked…)', sentence: 'State as a sentence',
      title: 'State in Title Case', on_off_sentence: 'On / Off, else the state',
      open_closed: 'Open / Closed', leak: 'Leak / Dry', alarm: 'Alarm (Home, Away…)',
      brightness: 'Brightness %', humidity: 'Humidity target', vacuum: 'Vacuum status',
      position: 'Position %', duration: 'Timer duration', group_brightness: 'Group: average brightness',
      group_count: 'Group: number on', setpoint: 'Target temperature',
      setpoint_verb: 'Target temperature with mode (Cool to 72°)',
      source_first: 'Source, else playback state',
      // other choices
      spin: 'Spin while on', none: 'None', entity: 'The entity is on', any: 'Any group member is on',
      hero: 'Value', pct: 'Percent', rank: 'Power use', energy: 'Energy today',
      temperature: 'Temperature', power: 'Power', runtime: 'Runtime', cost: 'Cost', cost_today: 'Cost today (statistics)',
      flow: 'Charge / discharge',
      glass: 'Glass', flat: 'Flat', filled: 'Filled',
      climate: 'Climate', security: 'Security', number: 'Slider', media_player: 'Media controls',
      wind: 'Wind', sun: 'Sunrise / sunset', moon: 'Moon', uv: 'UV index',
      weekday: 'Sunday, September 13th', monthday: 'September, 13th',
      center: 'Center', bottom: 'Bottom'
    };

    function humanize(key) {
      return sentenceCase(String(key || '').replace(/_/g, ' '));
    }

    // The colour names the tile colour map understands. custom_value stays on
    // because several tiles pass a literal rgba() instead of a name.
    var HK_COLOURS = ['yellow', 'orange', 'blue', 'green', 'red', 'purple',
                      'pink', 'teal', 'cyan', 'brown', 'gray', 'mint', 'white',
                      'black'];

    function selColour() {
      return { select: { mode: 'dropdown', custom_value: true,
                         options: HK_COLOURS.map(function (c) {
                           return { value: c, label: sentenceCase(c) };
                         }) } };
    }

    // values: strings (named through HK_OPTION_LABELS) or [value, label] pairs.
    // custom_value stays on so a hand-written value outside the list still shows
    // rather than being blanked by the dropdown.
    function selOptions(values) {
      return { select: { mode: 'dropdown', custom_value: true,
                         options: values.map(function (v) {
                           return Array.isArray(v) ? { value: v[0], label: v[1] }
                             : { value: v, label: HK_OPTION_LABELS[v] || humanize(v) };
                         }) } };
    }

    // A collapsible group of fields whose values stay FLAT in the config -- the
    // YAML does not change shape. Verified against the served frontend: ha-form
    // passes the whole data object to an expandable with `flatten` or no name.
    function section(title, schema, icon, expanded) {
      return { type: 'expandable', name: '', flatten: true, title: title,
               icon: icon, expanded: !!expanded, schema: schema };
    }

    function hkEditor(tag, schema) {
      var etag = tag + '-editor';
      if (customElements.get(etag)) return etag;

      class HkConfigEditor extends HTMLElement {
        setConfig(config) {
          this._config = Object.assign({}, config);
          this._render();
        }
        // each new client (the host adapter's entry, below): HA's ha-form
        // gets what goes with it through the adapter
        _onClient(c) {
          if (this._form) window.hkHostClient.bridge(this._form, c);
        }

        _render() {
          if (!this._form) {
            this._form = document.createElement('ha-form');
            // A schema entry's own label/helper wins -- including an EMPTY
            // helper, which means "none here" rather than "use the shared one".
            this._form.computeLabel = function (s) {
              return ('label' in s) ? s.label : (HK_LABELS[s.name] || humanize(s.name));
            };
            this._form.computeHelper = function (s) {
              return ('helper' in s) ? s.helper : ((s.name && HK_HELPERS[s.name]) || '');
            };
            this._form.addEventListener('value-changed', this._changed.bind(this));
            this.appendChild(this._form);
          }
          window.hkHostClient.bridge(this._form, this.client);
          this._form.schema = schema;
          this._form.data = this._config || {};
        }

        _changed(ev) {
          ev.stopPropagation();
          var cfg = Object.assign({}, ev.detail.value);
          // A cleared field should DISAPPEAR from the YAML rather than persist as
          // an empty string -- these configs are read by hand.
          Object.keys(cfg).forEach(function (k) {
            if (cfg[k] === '' || cfg[k] === null || cfg[k] === undefined) delete cfg[k];
          });
          this.dispatchEvent(new CustomEvent('config-changed', {
            detail: { config: cfg }, bubbles: true, composed: true
          }));
        }
      }

      window.hkHostClient.entry(HkConfigEditor);
      customElements.define(etag, HkConfigEditor);
      return etag;
    }

    // ------------------------------------------------------- nested cards
    //
    // A card that draws ANOTHER card inside itself -- the player's progress bar
    // and volume slider are an hk-media-control-card on the player's own glass.
    //
    // THE ORDER IS THE WHOLE POINT. A custom element that is not upgraded yet
    // has no setConfig, and HA's own cards throw if they are handed the frontend's
    // object before a config. So: create, wait for the definition if need be, then
    // setConfig, and only then start forwarding. `hkSetClient` is a function on
    // the returned element rather than a plain property assignment so a caller
    // can hand it the client on every render without knowing whether it is ready
    // yet; what the child gets goes through the host adapter (hkHostClient.bridge).
    function create(cfg) {
      if (!cfg || !cfg.type) return null;
      var t = String(cfg.type);
      var tag = t.indexOf('custom:') === 0 ? t.slice(7) : ('hui-' + t + '-card');
      var el = document.createElement(tag);
      var ready = false, pending = null;
      function configure() {
        try {
          el.setConfig(cfg);
          ready = true;
          if (pending) { window.hkHostClient.bridge(el, pending); pending = null; }
        } catch (e) {
          console.error('[hk] nested card setConfig failed', e, cfg);
        }
      }
      el.hkSetClient = function (source) {
        var c = asClient(source);
        if (!c) return;
        if (ready) window.hkHostClient.bridge(el, c); else pending = c;
      };
      if (typeof el.setConfig === 'function') configure();
      else if (window.customElements && customElements.whenDefined) {
        customElements.whenDefined(tag).then(configure, function () {
          console.error('[hk] nested card type never defined:', tag);
        });
      }
      return el;
    }
    // MAKE A CHILD CARD (Phase 2 P2.3): the one way a container card (hk-row,
    // the scenes row, the camera tiles) makes a card inside itself from a config.
    //
    // WITH LOVELACE -- the host names its card wrapper (hkShell.tags.card: HA's
    // hui-card) -- the child is that wrapper, made exactly as the containers
    // made it before: the wrapper owns lazy module loading, the error card for
    // an unknown type and the rebuild when a card's code arrives late, so HA's
    // behaviour does not change. WITHOUT LOVELACE (Mantel, HK's own panel) the
    // child is the card element itself, made by HK's view host the same way it
    // makes a view's cards (web/hk/shell/hk-view-host.js): `custom:` cards by
    // their tag, a few container types drawn by HK, a labelled placeholder for
    // any other Lovelace type -- never a host element.
    //
    // `client` is the container's own; the child gets what goes with it through
    // the host adapter's bridge, as every nested card does.
    function cardWrapper() {
      var S = window.hkShell;
      return (S && S.tags && S.tags.card) || null;
    }
    function createCard(config, client) {
      var tag = cardWrapper();
      if (tag) {
        var el = document.createElement(tag);
        window.hkHostClient.bridge(el, client);
        el.preview = false;
        el.config = config;
        el.load();
        return el;
      }
      var V = window.hkViewHost;
      if (V && V.createCardElement) return V.createCardElement(config, client);
      // neither (a bare page): an HK card by its tag, anything else a note
      var t = String((config && config.type) || '');
      if (t.indexOf('custom:') === 0) {
        var own = create(config);
        if (own && client) own.hkSetClient(client);
        return own;
      }
      var note = document.createElement('div');
      note.textContent = 'Not drawn here: ' + (t || 'a card with no type');
      return note;
    }

    // THE SEGMENTED CONTROL, one for every page that has one (the calendar's
    // Day / Week / Month, the Energy tabs, a select's segments): HK's glass
    // plate 44 px tall, 36 px choices at 15 px, the choice white with dark text,
    // and the white SLIDING to the new choice with a spring (2026-10-10, as
    // the menu's and the tab bar's highlights do). The markup: `sel` holding
    // <button aria-selected> choices; after a choice changes, slideSeg(the new
    // button, segBox(the old one)) runs the slide.
    var SEG_SPRING = 'cubic-bezier(.34,1.24,.42,1)';

    // what the shell and the later parts use of this one
    K.cardWrapper = cardWrapper; K.create = create; K.createCard = createCard; K.HK_COLOURS = HK_COLOURS;
    K.HK_HELPERS = HK_HELPERS; K.HK_LABELS = HK_LABELS; K.HK_OPTION_LABELS = HK_OPTION_LABELS; K.hkEditor = hkEditor;
    K.section = section; K.SEG_SPRING = SEG_SPRING; K.selColour = selColour; K.selOptions = selOptions;
  };
})();
