// Hand-written declarations for the checked parts that are cut out of a big file (phase 18, C1). Not generated:
// tools/typecheck/check.py --globals writes only globals.d.ts.

// A module the page imports by its absolute address (import('/hk/modules/hk-saverclock.js')): the server maps /hk/ to
// web/hk/, so the checker has no file to open; the import resolves to any.
declare module '/hk/*';
declare module '/cards/*';

/** A custom element base class whose other members the checker cannot list: HkBase and the Home Grid's full-size
 *  base, where the card family adds members as it runs. An element, plus anything else. */
interface HkLooseElementConstructor {
  new (...args: any[]): HTMLElement & { [member: string]: any };
  prototype: HTMLElement;
  [member: string]: any;
}

/** What a Home Grid part (web/hk/grid-cards/) is handed: the shell's kit K. Members are any but the card bases. */
interface HkGridKit {
  HkBase: HkLooseElementConstructor;
  HkGridFull: HkLooseElementConstructor;
  HkGridKey: HkLooseElementConstructor;
  HkGridSecurityCard: HkLooseElementConstructor;
  HkGridRoomCard: HkLooseElementConstructor;
  [member: string]: any;
}

// The glyph element (web/hk/iconset/hk-icons.js): `icon` is its one property, set from outside.
interface HTMLElementTagNameMap {
  'hk-icon': HTMLElement & { icon: string };
}

// The page's own events (a CustomEvent's detail is whatever the sender put in it).
interface WindowEventMap {
  'hk-module-ready': CustomEvent<any>;
}
