import type { WebviewToHost } from "../../src/contract";

export interface VsCodeApi {
  postMessage(message: WebviewToHost): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

let cached: VsCodeApi | undefined;

/** acquireVsCodeApi may be called only once per webview, so the result is memoized. */
export function getVsCodeApi(): VsCodeApi {
  if (typeof acquireVsCodeApi !== "function") {
    throw new Error("acquireVsCodeApi is not available: not running inside a VS Code webview");
  }
  cached ??= acquireVsCodeApi();
  return cached;
}
