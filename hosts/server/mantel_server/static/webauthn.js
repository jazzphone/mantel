// webauthn.js -- the passkey (WebAuthn) helpers shared by Mantel's own pages: /login signs in with a
// passkey, /admin registers one and steps up with one. An ES module with no side effects, served at
// /webauthn.js (login_page.py); both pages import it as '../webauthn.js', which also holds on disk.
//
// The server speaks WebAuthn's JSON forms (base64url strings, py_webauthn's options_to_json shape);
// the browser API wants ArrayBuffers. Where the browser has the JSON helpers (parse...FromJSON,
// toJSON) they are used; otherwise the conversion is done here.

export const b64 = {
  dec(s) {
    const t = String(s).replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (String(s).length % 4)) % 4);
    return Uint8Array.from(atob(t), (c) => c.charCodeAt(0)).buffer;
  },
  enc(buf) {
    let s = '';
    for (const x of new Uint8Array(buf)) s += String.fromCharCode(x);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  },
};

export const passkeysAvailable = () =>
  !!(globalThis.PublicKeyCredential && globalThis.navigator && globalThis.navigator.credentials);

export function toCreation(o) {
  const PKC = globalThis.PublicKeyCredential;
  if (PKC && PKC.parseCreationOptionsFromJSON) return PKC.parseCreationOptionsFromJSON(o);
  const c = JSON.parse(JSON.stringify(o));
  c.challenge = b64.dec(c.challenge);
  c.user.id = b64.dec(c.user.id);
  for (const x of c.excludeCredentials || []) x.id = b64.dec(x.id);
  return c;
}

export function toRequest(o) {
  const PKC = globalThis.PublicKeyCredential;
  if (PKC && PKC.parseRequestOptionsFromJSON) return PKC.parseRequestOptionsFromJSON(o);
  const c = JSON.parse(JSON.stringify(o));
  c.challenge = b64.dec(c.challenge);
  for (const x of c.allowCredentials || []) x.id = b64.dec(x.id);
  return c;
}

export function credentialJSON(cred) {
  if (cred.toJSON) return cred.toJSON();
  const r = cred.response;
  const response = { clientDataJSON: b64.enc(r.clientDataJSON) };
  if (r.attestationObject) {
    response.attestationObject = b64.enc(r.attestationObject);
    if (r.getTransports) response.transports = r.getTransports();
  } else {
    response.authenticatorData = b64.enc(r.authenticatorData);
    response.signature = b64.enc(r.signature);
    if (r.userHandle) response.userHandle = b64.enc(r.userHandle);
  }
  return { id: cred.id, rawId: b64.enc(cred.rawId), type: cred.type, response,
           clientExtensionResults: cred.getClientExtensionResults ? cred.getClientExtensionResults() : {} };
}
