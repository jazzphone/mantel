// An AudioWorklet module's own scope (web/hk/modules/hk-mic-tap.js): not in TypeScript's DOM library.
declare class AudioWorkletProcessor {
  constructor(options?: any);
  readonly port: MessagePort;
}
declare function registerProcessor(name: string, processorCtor: any): void;
