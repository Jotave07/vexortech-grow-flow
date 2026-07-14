import { Buffer as NodeBuffer } from "node:buffer";

declare global {
  var Buffer: typeof NodeBuffer;
}

export {};
