import { createRequire } from "node:module";

Object.assign(globalThis, { require: createRequire(import.meta.url) });
