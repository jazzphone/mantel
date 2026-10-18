// Run by tests/test_shim_alarm.py with node: HK's alarm keypad through Mantel's client port
// (web/shim/mantel-client.js) and HKClient's action port (web/client/hk-client.js), loaded as the page
// loads them, with a fake hub that records every gateway command. The call is made exactly as HK's
// keypad card makes it (web/hk/cards/hk-security.js _alarm -> hk-base.js _callErr), and the card's
// own rule turns the refusal into what it shows. Prints one JSON object of what was observed.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const [clientSrc, shimSrc] = process.argv.slice(2, 4).map((p) => readFileSync(p, 'utf8'));
const denied = [];
globalThis.window = globalThis;
const listeners = {};
globalThis.addEventListener = (n, fn) => { (listeners[n] = listeners[n] || []).push(fn); };
globalThis.dispatchEvent = (ev) => {
  if (ev.type === 'hk-command-denied') denied.push(ev.detail);
  let heard = false;
  for (const fn of listeners[ev.type] || []) { fn(ev); heard = true; }
  return !(heard && ev.cancelable);
};
globalThis.CustomEvent = class CustomEvent { constructor(type, o) { this.type = type; this.detail = (o || {}).detail; this.cancelable = !!(o || {}).cancelable; } };
vm.runInThisContext(clientSrc);
vm.runInThisContext(shimSrc);

const sent = [];
let replies = [];
hkMantelClient.useCommands({
  commandsEnabled: () => true,
  command(body) { sent.push(JSON.parse(JSON.stringify(body))); return Promise.resolve(replies.shift() || { type: 'command_result', result: {} }); },
  write() { return Promise.reject(new Error('not used')); },
});
const act = hkMantelClient.from({ states: {}, connection: {} }).actions;
const PANEL = 'alarm_control_panel.house_pin';

// hk-base.js _callErr + hk-security.js _alarm, in what they pass and how they read the answer
async function press(service, code) {
  const data = { entity_id: PANEL };
  if (code !== undefined) data.code = code;
  let r;
  try { await act.callService('alarm_control_panel', service, data, undefined, false); r = { ok: true }; } catch (err) {
    r = { ok: false, error: (err && (err.message || err.code)) || String(err) };
  }
  r.shows = r.ok ? null : (/code/i.test(String(r.error)) ? 'Wrong code' : 'Alarm not responding');
  return r;
}

const out = {};
replies = [{ type: 'command_result', result: { context: {} }, audit_id: 1 }];
out.ok = await press('alarm_disarm', '8642');
replies = [{ type: 'command_result', error: { code: 'invalid_code', message: 'Wrong code' }, audit_id: 2 }];
out.wrong = await press('alarm_disarm', '1357');
replies = [{ type: 'command_result', error: { code: 'code_locked', message: 'Wrong code too many times; the keypad is locked for 16 min', retry_after: 901 }, audit_id: 3 }];
out.locked = await press('alarm_disarm', '1357');
replies = [{ type: 'command_result', error: { code: 'code_required', message: 'Enter the alarm code' }, audit_id: 4 }];
out.required = await press('alarm_arm_away');
out.deniedAfterKeypad = denied.splice(0);
replies = [{ type: 'command_result', error: { code: 'forbidden', reason: 'explicit_deny', message: 'not allowed' }, audit_id: 5 }];
out.forbidden = await press('alarm_disarm', '8642');
out.deniedAfterForbidden = denied.splice(0);
out.sent = sent;
console.log(JSON.stringify(out));
