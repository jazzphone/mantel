// The host contract, shell half (phase 18, C2; docs/development/Rules.md rule 1): what the shared web code uses of
// window.hkShell (web/client/hk-host-shell.js builds it) and what each host's adapter implements for it.
//   * HkShellMethods -- every answer a host can give (the names in hk-host-shell.js's forwarding list).
//   * HkShell        -- window.hkShell, the facade shared code calls: all of HkShellMethods (a missing answer
//                       falls back to hk-host-shell.js's NONE default, a throwing one to null/false) plus its own
//                       navigation, sheet and toast helpers.
//   * HkShellHost    -- what an adapter gives hkShell.use(): the members BOTH hosts implement are required, the
//                       members only one has are optional (the other host's omission is covered by the facade's
//                       defaults). Home Assistant's: hosts/ha/frontend/hk-ha-shell.js; Mantel's:
//                       web/shim/mantel-shell.js.
// Ambient (no import/export) so `@type {HkShell}` works in any file. Loose where it can be (`any`).

type HkShellKind = 'root' | 'main' | 'drawer' | 'sidebar' | 'resolver' | 'panel' | 'dashboard' | 'viewContainer' |
                   'view' | 'viewBackground' | 'card';
type HkShellTags = { [K in HkShellKind]: string | null };
interface HkShellEvents { navigate: string; moreInfo: string; toast: string }
/** An element of the host's page. Loose: the host's own elements carry properties of their own (`hass`, `lovelace`, `narrow`). */
type HkEl = (Element & Record<string, any>) | null;
/** An element, or the shadow root HK's overlays and the host's own dialogs mount in. */
type HkMount = (Element & Record<string, any>) | ShadowRoot | null;
interface HkSidebarData { user: any; panels: any; localize: ((key: string) => string) | null }
/** haNav(): 'own' (the host IS Home Assistant), a row opening `link` (in the top window when `top`), or nothing. */
type HkHaNav = 'own' | { link: string; top: boolean } | null;
interface HkHostMenuRow { title: string; icon?: string; href?: string; run?: () => any; section?: string }
interface HkHostPhoto {
  id: string; title: string; url: string;
  variants?: Array<[number, string]>; focus?: [number, number]; faces?: number[][];
  depth?: { mask: string }; album?: string; year?: number;
}

interface HkShellMethods {
  root(): HkEl;
  /** root and shadow root HK's overlays (menu, tab bar, pop-ups, players) mount in */
  overlayRoot(): HkMount;
  main(): HkEl;
  mainRoot(): HkMount;
  drawer(): HkEl;
  sidebar(): HkEl;
  resolver(): HkEl;
  panel(): HkEl;
  dashboard(panel?: HkEl): HkEl;
  dashboardRoot(panel?: HkEl): HkMount;
  viewContainer(panel?: HkEl): HkEl;
  viewSlot(panel?: HkEl): HkEl;
  view(container?: HkEl): HkEl;
  viewBackground(container?: HkEl): HkEl;
  toolbar(panel?: HkEl): HkEl;
  dashboardConfig(panel?: HkEl): any;
  onDashboard(): boolean;
  /** true / false, null while the host cannot say yet */
  isDashboard(): boolean | null;
  /** the host's shell element has been defined (its page has started) */
  defined(): boolean;
  showNotifications(): void;
  keepAwake(root?: HkEl): void;
  sidebarData(): HkSidebarData | null;
  haNav(): HkHaNav;
  haNavigate(path: string): any;
  openHaMenu(): boolean;
  hostMenu(): HkHostMenuRow[];
  /** the host's own settings pages (web/shim/mantel-settings.js), null for a host with none */
  settingsHost(): any;
  /** hold back writes on the host's own connection: true once in place (or when it sends none) */
  holdWrites(isWrite: (message: any) => boolean, onHeld: (message: any) => void): boolean;
  menuButton(el?: HkEl, opts?: { narrow?: boolean; client?: HKClient | null }): HkEl;
  hostDetail(entityId?: string): boolean;
  openHostDetail(entityId: string, from?: HkEl): boolean;
  hostToast(): boolean;
  dialogRoot(): HkMount;
  serviceUrl(name: string): string | null;
  photoSource(source?: string): string | null;
  listPhotos(source?: string): Promise<HkHostPhoto[]> | null;
  artSized(url: string, size?: number): string;
  productName(): string;
  settingsName(): string;
  settingsPlace(path: string): string;
  haPlace(path: string): string;
  haName(name: string): string;
  docsUrl(page: string, anchor?: string): string | null;
  notHouseCameraPlatforms(): string[];
  tabletRoom(client?: HKClient | null): string | null;
  atTablet(client?: HKClient | null): boolean;
}

/** window.hkShell */
interface HkShell extends HkShellMethods {
  readonly kind: string;
  readonly events: Readonly<HkShellEvents>;
  readonly tags: Readonly<HkShellTags>;
  readonly viewTags: string[];
  readonly foreignTags: string[];
  /** the navigation event's name */
  readonly navEvent: string;
  /** a host installs its implementation; its omissions keep the defaults */
  use(impl: HkShellHost | null): HkShell;
  is(el: Element | null | undefined, kind: HkShellKind): boolean;
  announce(init?: CustomEventInit, from?: EventTarget | null): CustomEvent;
  navigate(path: string, init?: CustomEventInit, opts?: { replace?: boolean }): CustomEvent;
  onNavigate(fn: (event: Event) => void): () => void;
  offNavigate(fn: (event: Event) => void): void;
  moreInfo(entityId: string, from?: Element | null, extra?: any): CustomEvent | null;
  toast(detail: { message: string; duration?: number; action?: any }, from?: Element | null): CustomEvent | null;
  /** the defaults a host's omissions keep */
  _none: HkShellHostFull;
}

// What BOTH adapters implement.
type HkShellBoth =
  'root' | 'overlayRoot' | 'panel' | 'viewContainer' | 'viewSlot' | 'view' | 'dashboardConfig' | 'onDashboard' |
  'isDashboard' | 'sidebarData' | 'holdWrites' | 'menuButton' | 'hostDetail' | 'openHostDetail' | 'hostToast' |
  'showNotifications' | 'tabletRoom' | 'atTablet';
// Home Assistant only (Mantel has no HA elements, no toolbar, no socket to keep awake, and its overlays mount in
// its own root, so the facade's default dialogRoot does).
type HkShellHaOnly =
  'main' | 'mainRoot' | 'drawer' | 'sidebar' | 'resolver' | 'dashboard' | 'dashboardRoot' | 'viewBackground' |
  'toolbar' | 'defined' | 'keepAwake' | 'dialogRoot';
// Mantel only (Home Assistant is the product these answers are about, or needs none).
type HkShellMantelOnly =
  'haNav' | 'haNavigate' | 'openHaMenu' | 'hostMenu' | 'settingsHost' | 'serviceUrl' | 'photoSource' | 'listPhotos' |
  'artSized' | 'productName' | 'settingsName' | 'haPlace' | 'haName' | 'docsUrl' | 'notHouseCameraPlatforms';
// Neither: only the facade's default (settingsName() → path) answers.
type HkShellNeither = 'settingsPlace';

interface HkShellHostBase {
  kind: string;
  tags: Partial<HkShellTags>;
  viewTags: string[];
  /** the host's own pages a card can be placed on (HA's views and card editor); Mantel has none */
  foreignTags?: string[];
  events?: Partial<HkShellEvents>;
}

/** What an adapter gives hkShell.use(). */
type HkShellHost = HkShellHostBase & Pick<HkShellMethods, HkShellBoth> &
  Partial<Pick<HkShellMethods, HkShellHaOnly | HkShellMantelOnly | HkShellNeither>>;

/** The facade's NONE defaults: every answer. */
type HkShellHostFull = HkShellHostBase & HkShellMethods;

/** Home Assistant's adapter (window.hkHAShell): the host plus its two modes. */
type HkHaShellHost = HkShellHost & {
  ownPanel(el: Element, viewHost: any, url?: string | null): HkShell;
  lovelace(el?: Element | null): HkShell;
  currentMode(): 'panel' | 'lovelace';
};

// hk-ha-shell.js builds its object as a literal and then adds the rest one assignment at a time (HA.tabletRoom = ...),
// which TypeScript cannot follow against a declared type: while it is being built these are optional. Their
// signatures are still checked where they are assigned; that none is forgotten is not (the list below is the whole
// of them, and test_shell_boundary.py's text checks cover the rest).
type HkHaShellLate = 'tabletRoom' | 'atTablet' | 'sidebarData' | 'holdWrites' | 'menuButton' | 'hostDetail' |
                     'openHostDetail' | 'hostToast' | 'dialogRoot' | 'ownPanel' | 'lovelace' | 'currentMode';
type HkHaShellBuilding = Omit<HkHaShellHost, HkHaShellLate> & Partial<Pick<HkHaShellHost, HkHaShellLate>>;

/** Mantel's adapter (window.hkMantelShell): what home.js and settings-page.js wire in. */
interface HkMantelShell {
  attach(viewHost: any): void;
  install(host: any): void;
  saverOnly(): void;
  setServices(services: any): void;
  setRole(role: string): void;
  setRoom(room: string | null): void;
  setAtTablet(value: boolean): void;
  setSettings(host: any): void;
  setHaAddress(address: string): void;
  hostMenu: HkShellMethods['hostMenu'];
  haNav: HkShellMethods['haNav'];
  serviceUrl: HkShellMethods['serviceUrl'];
  tabletRoom: HkShellMethods['tabletRoom'];
  atTablet: HkShellMethods['atTablet'];
  kind: 'mantel';
}
