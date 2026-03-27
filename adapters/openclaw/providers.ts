/**
 * OpenClaw Mem0 plugin — OpenMemory HTTP API provider factory.
 *
 * All memory operations are delegated to the OpenMemory Python service
 * at the configured apiUrl (default: http://localhost:8765).
 */

import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import type { Mem0Config, Mem0Provider } from "./types.ts";
import { OpenMemoryProvider } from "./provider.ts";

export function createProvider(
  cfg: Mem0Config,
  _api: OpenClawPluginApi,
): Mem0Provider {
  return new OpenMemoryProvider(cfg.apiUrl);
}
