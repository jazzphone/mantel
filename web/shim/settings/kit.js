// settings/kit.js -- what every page draws with: HK Settings' kit for Mantel, fields and drafts, styles, the Confirm It Is You dialog.
import { mantelUrl, base as BASE } from '../base.js';
import * as photos from '../mantel-photos.js';
import { act, api, ApiError, drafts, hh, K, me, panel, redraw, ROUTE, ui } from './core.js';

// ---------------------------------------------------------------------------------------- the kit, for Mantel
export const group = (o, rows) => K().group(o, rows);
export const info = (label, sub, value, cls) => K().info({ label, sub: sub || null, value, valueCls: cls });
export const button = (label, onClick, o = {}) => K().button({ label, onClick, destructive: !!o.destructive, center: !!o.center,
                                                        disabled: !!o.disabled, fk: o.fk });
export const nav = (label, route, o = {}) => K().nav({ label, sub: o.sub || null, value: o.value, href: '#/' + ROUTE + '/' + route,
                                                 icon: o.icon, tile: o.tile, fk: 'mx:' + route });
export function field(form, name, label, o = {}) {
  const d = drafts[form] = drafts[form] || {};
  if (d[name] === undefined && o.value !== undefined) d[name] = o.value;
  return K().text({ label, value: d[name] || '', placeholder: o.placeholder, type: o.type, maxlength: o.maxlength,
                    inputmode: o.inputmode, autocomplete: o.autocomplete || 'off', fk: 'mx:' + form + ':' + name,
                    onCommit: (v) => { d[name] = v; } });
}
export const draft = (form) => (drafts[form] = drafts[form] || {});
export const clearDraft = (form) => { delete drafts[form]; };
export function choose(form, name, label, options, value, onChange) {
  const d = draft(form);
  if (d[name] === undefined) d[name] = value;
  return K().select({ label, options, value: d[name], fk: 'mx:' + form + ':' + name,
                      onChange: (v) => { d[name] = v; if (onChange) onChange(v); } });
}
export function ticks(form, name, options, chosen) {
  const d = draft(form);
  if (!Array.isArray(d[name])) d[name] = chosen.slice();
  return options.map(([v, t, sub]) => K().check({ label: t, sub: sub || null, multi: true, on: d[name].includes(v), fk: 'mx:' + form + ':' + name + ':' + v,
    onClick: () => { const a = d[name]; const i = a.indexOf(v); if (i >= 0) a.splice(i, 1); else a.push(v); redraw(); } }));
}
// a value shown once, to copy (a credential, a code): its own cell
export function secretCell(text, id) {
  return hh('div', { class: 'cell mxsecret' }, [hh('span', { class: 'url', id, text })]);
}
export function copyButton(text, label = 'Copy') {
  return button(label, async () => {
    try { await navigator.clipboard.writeText(text); ui.flash = { key: '*', text: 'Copied.' }; } catch (e) { ui.flash = { key: '*', text: 'Select it and copy it by hand.', err: true }; }
    redraw();
  });
}
export const pending = (c, what) => c.appendChild(group({ footer: what || 'Loading…' }, []));
export const failed = (c, err) => c.appendChild(group({ footer: hh('span', { class: 'mxerr', text: err instanceof ApiError ? err.message : String(err) }) }, []));
// THE SCREEN ONE OPENS ON (default_screens.py): a picker of Mantel's screens, `none` the label for "not set"
export function screenOptions(list, none) {
  return [['', none]].concat((list || []).map((x) => [x.path, x.title]));
}
export const houseTitle = (d) => { const x = (d.screens || []).find((s) => s.path === d.house); return x ? x.title : d.house; };
export function screenPicker(key, label, sub, value, list, none, put) {
  return K().select({ label, sub, options: screenOptions(list, none), value: value || '', fk: 'mx:screen:' + key,
    onChange: (v) => act(key, () => put(v || null), 'Saved.', 'myscreen', 'dscreens') });
}
// the last action's result, on the page it was done from
export function result(c, key) {
  if (!ui.flash || (ui.flash.key !== key && ui.flash.key !== '*')) return;
  c.appendChild(hh('p', { class: 'mxflash' + (ui.flash.err ? ' err' : ''), role: ui.flash.err ? 'alert' : 'status', text: ui.flash.text }));
}
const STYLE = [
  '.mxflash{margin:8px 0 22px;padding:10px 16px;border-radius:10px;background:var(--hk-cell);font-size:15px;line-height:20px;color:var(--hk-label)}',
  '.mxflash.err{color:var(--hk-red)}',
  '.mxerr{color:var(--hk-red)}',
  '.cell.mxsecret{display:block;padding:12px 16px}',
  '.cell.mxqr{display:flex;justify-content:center;padding:16px}.cell.mxqr img{width:min(280px,70vw);height:auto;border-radius:8px;background:#fff}',
  '.mxfile{position:absolute;width:1px;height:1px;opacity:0;pointer-events:none}',
  // a backup's row (backups.js): Download and Delete at its end
  '.mxbk{display:flex;gap:18px;margin-left:auto;flex:none}',
  '.mxlink{border:0;background:none;padding:6px 0;font:inherit;font-size:17px;color:var(--hk-tint);cursor:pointer}',
  '.mxlink.red{color:var(--hk-red)}',
  // a channel's status dot (alerts.js): green sent, red failing, gray off or never sent
  '.mxdot{flex:none;width:22px;height:22px;display:flex;align-items:center;justify-content:center}',
  ".mxdot::before{content:'';width:10px;height:10px;border-radius:50%;background:var(--hk-gray)}",
  '.mxdot.ok::before{background:var(--hk-green)}',
  '.mxdot.bad::before{background:var(--hk-red)}',
  '.mxdlg .mxin{display:block;box-sizing:border-box;width:calc(100% - 32px);height:36px;margin:0 16px 16px;padding:0 10px;border:0;',
  '  border-radius:8px;background:var(--hk-fill);color:var(--hk-label);font:inherit;font-size:17px;text-align:center;letter-spacing:.2em;outline:none}',
  '.mxdlg .mxin:focus{box-shadow:0 0 0 2px var(--hk-tint)}',
  '.mxdlg .mxe{margin:-6px 16px 12px;padding:0;font-size:13px;color:var(--hk-red);min-height:0}',
].join('\n') + '\n' + photos.STYLE;
export function ensureStyle(root) {
  if (!root || root.querySelector('style[data-mx]')) return;
  const s = document.createElement('style');
  s.setAttribute('data-mx', '');
  s.textContent = STYLE;
  root.appendChild(s);
}

// "CONFIRM IT IS YOU": the authenticator code or a passkey, then the refused request once more.
// A MODAL'S FOCUS (WCAG 2.4.3): Tab and Shift-Tab go round the dialog's own controls, never into the page behind
// it, and closing gives focus back to what opened it, as the kit's own confirm does. Returns the give-back.
export function holdFocus(root, bd, dlg) {
  const prev = root.activeElement || document.activeElement;
  bd.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const items = [...dlg.querySelectorAll('button, input, select, textarea, [tabindex]:not([tabindex="-1"])')]
      .filter((x) => !x.disabled && x.offsetParent !== null);
    if (!items.length) return;
    e.preventDefault();
    const i = items.indexOf(root.activeElement);
    items[(i + (e.shiftKey ? items.length - 1 : 1)) % items.length].focus();
  });
  return () => { if (prev && prev.focus) { try { prev.focus(); } catch (e) { /* gone */ } } };
}

// An alert in HK Settings' own look (the kit's .dlg), with a field for the code.
export function stepUp() {
  const u = me && me.user;
  const canTotp = !!(u && u.totp);
  const canPasskey = !!(u && u.passkeys > 0 && window.PublicKeyCredential);
  const root = panel.shadowRoot;
  return new Promise((resolve) => {
    const err = hh('p', { class: 'mxe', role: 'alert' });
    const code = canTotp ? hh('input', { class: 'mxin', inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: 8,
                                         'aria-label': 'Code from your authenticator app' }) : null;
    const buttons = [hh('button', { type: 'button', class: 'cx', text: 'Cancel' })];
    if (canPasskey) buttons.push(hh('button', { type: 'button', text: 'Use Passkey' }));
    if (canTotp) buttons.push(hh('button', { type: 'button', class: 'bold', text: 'Confirm' }));
    const msg = canTotp || canPasskey ? 'This needs a fresh confirmation, within the last five minutes.'
      : 'You have no authenticator app or passkey yet. Sign out and sign in again, then do this within five minutes.';
    const dlg = hh('div', { class: 'dlg mxdlg', role: 'alertdialog', 'aria-modal': 'true', 'aria-label': 'Confirm It Is You' },
      [hh('h2', { text: 'Confirm It Is You' }), hh('p', { text: msg }), code, err, hh('div', { class: 'db' + (buttons.length > 2 ? ' stack' : '') }, buttons)]);
    const bd = hh('div', { class: 'dlgbd' }, dlg);
    const giveBack = holdFocus(root, bd, dlg);
    const close = (v) => { bd.remove(); giveBack(); resolve(v); };
    buttons[0].addEventListener('click', () => close(false));
    const totp = async () => {
      try { await api('POST', '/api/auth/totp/step-up', { code: code.value.trim() }, { retry: false }); close(true); } catch (e) { err.textContent = e.message; }
    };
    const passkey = async () => {
      try {
        const w = await import(mantelUrl('/webauthn.js'));
        const opt = await api('POST', '/api/auth/passkey/options', { username: u.username || undefined }, { retry: false });
        const cred = await navigator.credentials.get({ publicKey: w.toRequest(opt.options) });
        const got = await api('POST', '/api/auth/passkey/verify', { challenge_id: opt.challenge_id, credential: w.credentialJSON(cred), step_up: true }, { retry: false });
        if (!got || got.step_up !== true) throw new Error('That passkey is someone else’s. Use your own.');
        close(true);
      } catch (e) { err.textContent = e.message || 'The passkey was not accepted.'; }
    };
    if (canPasskey) buttons[1].addEventListener('click', passkey);
    if (canTotp) { buttons[buttons.length - 1].addEventListener('click', totp); code.addEventListener('keydown', (e) => { if (e.key === 'Enter') totp(); }); }
    bd.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); close(false); } });
    root.appendChild(bd);
    (code || buttons[buttons.length - 1]).focus();
  });
}

export async function signOut() {
  try { await api('POST', '/api/session/logout', {}, { retry: false }); } catch (e) { /* signing out anyway */ }
  if (BASE) location.reload(); else location.assign('/login');
}
