// mantel-stepup.js -- the step-up prompt for Mantel's command gateway (P3.3).
//
// A sensitive action (unlock, disarm, open the garage, ...) without a fresh factor is answered by the
// server with step_up_required; mantel-client.js then fires `hk-step-up-required`. This draws a small
// prompt in HK's overlay layer (hkOverlays.root(): HK's dialog root, above its sheets): the code from
// the person's authenticator app (POST /api/auth/totp/step-up) or their passkey (POST
// /api/auth/passkey/options + /verify, which steps up a signed-in session). When the server accepts
// it, detail.done() and the command is sent again; Cancel (or Escape) gives up. Nothing is stored here.
// A PIN (method `pin`): at a wall tablet the person types their PIN on an on-screen pad (the server
// finds who it is and decides the command as that person at this tablet); a signed-in person may use
// their own PIN instead of the code. The PIN goes back inside the command (detail.submit); a wrong PIN
// keeps the prompt open and says so, a lockout says how long.
(function (global) {
  'use strict';
  if (global.hkMantelStepUp) return;
  var CSS = [
    '#mantel-stepup{position:fixed;inset:0;z-index:10002;display:flex;align-items:center;justify-content:center;',
    '  background:rgba(0,0,0,0.45);font:15px/1.35 -apple-system,"SF Pro Text",system-ui,sans-serif}',
    '#mantel-stepup .plate{width:min(340px,calc(100vw - 32px));box-sizing:border-box;padding:20px;border-radius:18px;',
    '  background:rgba(28,28,32,0.97);color:#fff;box-shadow:0 10px 40px rgba(0,0,0,0.5)}',
    '#mantel-stepup h2{margin:0 0 6px;font-size:17px;font-weight:600}',
    '#mantel-stepup p{margin:0 0 14px;color:rgba(255,255,255,0.7);font-size:14px}',
    '#mantel-stepup input{width:100%;box-sizing:border-box;font:600 22px/1 ui-monospace,monospace;letter-spacing:6px;',
    '  text-align:center;padding:10px;border-radius:12px;border:1px solid rgba(255,255,255,0.2);background:#111;color:#fff}',
    '#mantel-stepup .err{color:#ff453a;min-height:18px;font-size:13px;margin:8px 0 0}',
    '#mantel-stepup .row{display:flex;gap:10px;margin-top:14px}',
    '#mantel-stepup button{flex:1;appearance:none;border:0;border-radius:12px;padding:11px;font:600 15px/1 inherit;',
    '  cursor:pointer;background:rgba(255,255,255,0.12);color:#fff}',
    '#mantel-stepup button.go{background:#0a84ff}',
    '#mantel-stepup .keys{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:12px}',
    '#mantel-stepup .keys button{padding:14px 0;font:600 20px/1 inherit}',
    '#mantel-stepup .keys[hidden]{display:none}'
  ].join('');
  var LABEL = { step_up_required: 'Confirm it is you', person_pin_required: 'A person needs to confirm this' };

  function cookie(name) {
    var m = (global.document.cookie || '').match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
    return m ? decodeURIComponent(m[1]) : '';
  }
  // the session's CSRF token: the readable cookie, else GET /api/session (which also re-sets the cookie)
  function csrf() {
    var c = cookie('mantel_csrf');
    if (c) return Promise.resolve(c);
    return fetch('/api/session', { credentials: 'same-origin' }).then(function (r) { return r.json(); })
      .then(function (j) { return (j && j.csrf) || ''; }, function () { return ''; });
  }
  function post(path, body) {
    return csrf().then(function (token) {
      return fetch(path, { method: 'POST', credentials: 'same-origin',
                           headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token },
                           body: JSON.stringify(body || {}) });
    }).then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { j._status = r.status; return j; }); });
  }
  function b64u(buf) {
    var s = '', b = new Uint8Array(buf);
    for (var i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function unb64u(text) {
    var s = atob(String(text).replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((String(text).length + 3) % 4));
    var b = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
    return b.buffer;
  }
  // a passkey assertion for the signed-in person; the server marks the session fresh
  function passkey() {
    return post('/api/auth/passkey/options', {}).then(function (o) {
      if (!o.ok) throw new Error(o.error || 'passkey unavailable');
      var opt = typeof o.options === 'string' ? JSON.parse(o.options) : o.options;
      var pk = Object.assign({}, opt, { challenge: unb64u(opt.challenge),
        allowCredentials: (opt.allowCredentials || []).map(function (c) { return Object.assign({}, c, { id: unb64u(c.id) }); }) });
      return navigator.credentials.get({ publicKey: pk }).then(function (cred) {
        var r = cred.response;
        return post('/api/auth/passkey/verify', { challenge_id: o.challenge_id, credential: {
          id: cred.id, rawId: b64u(cred.rawId), type: cred.type, clientExtensionResults: {},
          authenticatorAttachment: cred.authenticatorAttachment || undefined,
          response: { clientDataJSON: b64u(r.clientDataJSON), authenticatorData: b64u(r.authenticatorData),
                      signature: b64u(r.signature), userHandle: r.userHandle ? b64u(r.userHandle) : undefined } } });
      });
    }).then(function (v) { if (!v.step_up) throw new Error(v.error || 'not accepted'); });
  }

  function root() {
    var o = global.hkOverlays;
    return (o && o.root && o.root()) || global.document.body;
  }

  function prompt(detail) {
    var d = global.document;
    var box = d.createElement('div');
    box.id = 'mantel-stepup';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    var style = d.createElement('style');
    style.textContent = CSS;
    box.appendChild(style);
    var plate = d.createElement('div');
    plate.className = 'plate';
    var h = d.createElement('h2');
    h.textContent = LABEL[detail.reason] || LABEL.step_up_required;
    var p = d.createElement('p');
    var what = (detail.action || 'This') + (detail.targets && detail.targets.length ? ' on ' + detail.targets.join(', ') : '');
    p.textContent = detail.reason === 'person_pin_required' ? 'Enter your PIN to confirm ' + what + '.' : what + ' needs a fresh confirmation.';
    plate.appendChild(h);
    plate.appendChild(p);
    var methods = detail.methods || [];
    var canPin = methods.indexOf('pin') >= 0 && typeof detail.submit === 'function';
    // the authenticator code when the person has one, else the PIN; with both, a button switches
    var mode = methods.indexOf('totp') >= 0 ? 'totp' : (canPin ? 'pin' : null);
    var input = null, keys = null;
    if (mode) {
      input = d.createElement('input');
      input.setAttribute('inputmode', 'numeric');
      input.setAttribute('autocomplete', 'off');
      plate.appendChild(input);
    }
    if (canPin) {
      // an on-screen PIN pad: a wall tablet has no keyboard
      keys = d.createElement('div');
      keys.className = 'keys';
      ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'].forEach(function (k) {
        var b = d.createElement('button');
        b.type = 'button';
        b.textContent = k;
        if (!k) { b.disabled = true; b.style.visibility = 'hidden'; }
        b.setAttribute('aria-label', k === '⌫' ? 'Delete' : k);
        b.addEventListener('click', function () {
          if (k === '⌫') input.value = String(input.value).slice(0, -1);
          else if (String(input.value).length < 8) input.value = String(input.value) + k;
          input.focus();
        });
        keys.appendChild(b);
      });
      plate.appendChild(keys);
    }
    function setMode(m) {
      mode = m;
      if (!input) return;
      input.value = '';
      input.type = m === 'pin' ? 'password' : 'text';
      input.setAttribute('maxlength', m === 'pin' ? '8' : '6');
      input.setAttribute('aria-label', m === 'pin' ? 'PIN' : 'Code');
      if (m !== 'pin') input.setAttribute('autocomplete', 'one-time-code');
      if (keys) keys.hidden = m !== 'pin';
    }
    var err = d.createElement('div');
    err.className = 'err';
    plate.appendChild(err);
    var row = d.createElement('div');
    row.className = 'row';
    function button(text, cls, fn) {
      var b = d.createElement('button');
      b.type = 'button';
      b.textContent = text;
      if (cls) b.className = cls;
      b.addEventListener('click', fn);
      row.appendChild(b);
      return b;
    }
    var finished = false;
    function close() { if (box.parentNode) box.parentNode.removeChild(box); }
    function ok() { finished = true; close(); detail.done(); }
    function cancel() { if (finished) return; finished = true; close(); detail.cancel(); }
    button('Cancel', '', cancel);
    if (methods.indexOf('passkey') >= 0 && global.navigator && navigator.credentials && global.PublicKeyCredential) {
      button('Passkey', input ? '' : 'go', function () {
        err.textContent = '';
        passkey().then(ok, function () { err.textContent = 'The passkey was not accepted.'; });
      });
    }
    if (canPin && mode === 'totp') {
      var sw = button('Use PIN', '', function () {
        setMode(mode === 'pin' ? 'totp' : 'pin');
        sw.textContent = mode === 'pin' ? 'Use code' : 'Use PIN';
        err.textContent = '';
        input.focus();
      });
    }
    var PIN_ERRORS = { invalid_pin: 'That PIN was not accepted.', ambiguous: 'That PIN cannot be used here; ask an Owner.' };
    function confirmPin(go) {
      var pin = String(input.value || '').replace(/\s/g, '');
      if (!/^\d{4,8}$/.test(pin)) { err.textContent = 'Enter your PIN (4 to 8 digits).'; return; }
      go.disabled = true;
      detail.submit({ method: 'pin', pin: pin }).then(function (r) {
        go.disabled = false;
        if (r && r.ok) { finished = true; close(); return; }      // the command went with the PIN
        input.value = '';
        var e = r && r.error;
        err.textContent = e === 'locked'
          ? 'Too many wrong PINs; try again in ' + Math.max(1, Math.ceil((r.retry_after || 60) / 60)) + ' min.'
          : (PIN_ERRORS[e] || 'That PIN was not accepted.');
      }, function () { go.disabled = false; err.textContent = 'Could not reach the server.'; });
    }
    if (input) {
      setMode(mode);
      var go = button('Confirm', 'go', function () {
        if (mode === 'pin') return confirmPin(go);
        var code = String(input.value || '').replace(/\s/g, '');
        if (!/^\d{6}$/.test(code)) { err.textContent = 'Enter the 6-digit code.'; return; }
        go.disabled = true;
        post('/api/auth/totp/step-up', { code: code }).then(function (r) {
          go.disabled = false;
          if (r.step_up) ok();
          else { err.textContent = r._status === 429 ? 'Too many tries; wait a moment.' : 'That code was not accepted.'; input.value = ''; }
        }, function () { go.disabled = false; err.textContent = 'Could not reach the server.'; });
      });
      input.addEventListener('keydown', function (e) { if (e.key === 'Enter') go.click(); });
    }
    box.addEventListener('keydown', function (e) { if (e.key === 'Escape') cancel(); });
    plate.appendChild(row);
    box.appendChild(plate);
    root().appendChild(box);
    if (input) input.focus();
    return { el: box, cancel: cancel };
  }

  var current = null;
  global.addEventListener('hk-step-up-required', function (e) {
    var detail = e.detail;
    if (!detail || !(detail.methods || []).length) return;   // nobody here can answer: refused upstream
    e.preventDefault();
    if (current) current.cancel();
    current = prompt(detail);
  });
  global.hkMantelStepUp = { prompt: prompt, current: function () { return current; } };
})(globalThis);
