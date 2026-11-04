// The host contract, client half (phase 18, C2; docs/development/Rules.md rule 1): what the shared web code uses
// of an HKClient, and what each host's adapter hands hkClient.create(port) to build one.
//   * HKClient       -- the object shared code holds (web/client/hk-client.js create()): read-only data, the read
//                       methods, `actions` for everything that changes the house.
//   * HkClientPort   -- what a host adapter gives create(): Home Assistant's is hosts/ha/frontend/
//                       hk-ha-client.js, Mantel's web/shim/mantel-client.js.
//   * HkClientFactory-- window.hkClient (the shared half: create, subscriptions, is, isWrite, ...).
//   * HkHostClient   -- window.hkHostClient (the adapter: from, current, bridge, entry), HkMantelClient the extras.
// Ambient (no import/export) so `@type {HKClient}` works in any file. Loose where it can be (`any`): the presence
// of a member and its arity are what this pins.

/** A subscription the shared code opens (HKClient.subscriptions): reads only, on the allowlist in hk-client.js. */
interface HkSubscriptionPort {
  subscribeMessage(callback: (message: any) => void, message: any, options?: any): Promise<() => any>;
  addEventListener(name: string, callback: (event: any) => void): void;
  removeEventListener(name: string, callback: (event: any) => void): void;
}

/** client.actions: everything that changes something. A host without a method gets a refusal (commands_disabled). */
interface HkActionPort {
  callService(domain: string, service: string, data?: any, target?: any, notifyOnError?: boolean, returnResponse?: boolean): Promise<any>;
  callWS(message: any): Promise<any>;
  request(path: string, init?: RequestInit): Promise<any>;
  liveSocket(speaker?: string): Promise<{ url: string; token: () => string }>;
  /** The Intercom (docs/phase17/INTERCOM.md): a one-time ticket for /ws/intercom. Mantel's adapter only. */
  intercom?(mode: string, rate: number): Promise<{ url: string; token: string }>;
  /** ms the doorbell card waits for the live socket; undefined: the card's own wait. */
  readonly liveWaitMs: number | undefined;
}

/** The client as shared code sees it. Members the shared code checks before it calls them are optional. */
interface HKClient {
  readonly states: Record<string, any>;
  readonly entities: Record<string, any>;
  readonly devices: Record<string, any>;
  readonly areas: Record<string, any>;
  readonly floors: Record<string, any>;
  readonly services: Record<string, any>;
  readonly config: any;
  readonly locale: any;
  readonly language: string;
  readonly user: any;
  readonly themes: any;
  /** false while the host's socket is down; undefined when the host cannot say. */
  readonly connected: boolean | undefined;
  readonly subscriptions: HkSubscriptionPort | null;
  // (all checked before use: formatEntity* in hk-sheet-generic.js and hk-sheet-sensor.js, bindStateIcon in
  // hk-detail.js and hk-sheet-sensor.js, callWS and callApi in hk-calendar.js, hk-stats.js and hk-sheet-sensor.js,
  // cameraOffer in hk-cameras.js and hk-view-host.js)
  readonly formatEntityState?: (stateObj: any, state?: string) => string;
  readonly formatEntityAttributeValue?: (stateObj: any, attribute: string, value?: any) => string;
  readonly formatEntityAttributeName?: (stateObj: any, attribute: string) => string;
  /** WebSocket reads; a write message is refused before the host (use actions.callWS). */
  readonly callWS?: (message: any) => Promise<any>;
  /** REST reads: GET only. */
  readonly callApi?: (method: string, path: string, parameters?: any) => Promise<any>;
  readonly bindStateIcon?: (element: any, stateObj: any) => void;
  readonly cameraOffer?: (message: any, quality: 'low' | 'medium' | 'high') => any;
  readonly actions: HkActionPort;
}

/** What a host adapter passes to hkClient.create(port): the data it reads from its own object, and its action port. */
interface HkClientPort {
  /** The Intercom's feed (a read): subscribe(cb) -> unsubscribe. Mantel's adapter only. */
  intercom?: { subscribe(cb: (event: any, error: any) => void): () => void };
  states?: Record<string, any>;
  entities?: Record<string, any>;
  devices?: Record<string, any>;
  areas?: Record<string, any>;
  floors?: Record<string, any>;
  services?: Record<string, any>;
  config?: any;
  locale?: any;
  language?: string;
  user?: any;
  themes?: any;
  connected?: boolean;
  subscriptions?: HkSubscriptionPort | null;
  formatEntityState?: (stateObj: any, state?: string) => string;
  formatEntityAttributeValue?: (stateObj: any, attribute: string, value?: any) => string;
  formatEntityAttributeName?: (stateObj: any, attribute: string) => string;
  callWS?: (message: any) => Promise<any>;
  callApi?: (method: string, path: string, parameters?: any) => Promise<any>;
  bindStateIcon?: (element: any, stateObj: any) => void;
  cameraOffer?: (message: any, quality: string) => any;
  actions?: Partial<Omit<HkActionPort, 'liveWaitMs'>> & { liveWaitMs?: number };
  /** told when an action is refused (commands off): Mantel dispatches hk-command-refused. */
  refused?: (detail: { kind: string; what: string }) => void;
}

/** window.hkClient: the shared half, loaded first by both hosts. */
interface HkClientFactory {
  create(port: HkClientPort): HKClient;
  subscriptions(transport: any): HkSubscriptionPort | null;
  is(value: any): boolean;
  isWrite(message: any): boolean;
  subscribable(message: any): boolean;
  DATA: string[];
  METHODS: string[];
  WRITES: string[];
  SUBSCRIPTIONS: string[];
  SUBSCRIBE_EVENTS: string[];
  ACTIONS: string[];
}

/** window.hkHostClient (the host's adapter): turns what the host holds into a client, and hands one to a child. */
interface HkHostClient {
  /** a host's object (HA's hass; Mantel's snapshot) or a client already: the client, null for nothing. */
  from(input: any): HKClient | null;
  /** the client for the page's current state, null before there is one. */
  current(): HKClient | null;
  /** hands a child element what goes with a client (the host's own object, or the client itself). */
  bridge(element: any, client: HKClient | null): void;
  /** gives a Lovelace-entry card class its `hass` and `client` accessors. */
  entry(ctor: Function): void;
}

/** Mantel's adapter (window.hkMantelClient): the contract plus what home.js wires in. */
interface HkMantelClient extends HkHostClient {
  setCurrent(snapshot: any): void;
  useCommands(hub: any): void;
  useScreens(host: any): void;
  kind: 'mantel';
  SETTINGS_SAVES: string[];
  FEATURE_SAVES: string[];
}
