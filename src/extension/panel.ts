import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import * as vscode from "vscode";
import type { HostToWebview } from "../contract/messages";

export function buildCsp(nonce: string, cspSource: string): string {
  return [
    "default-src 'none'",
    `script-src 'nonce-${nonce}' ${cspSource}`,
    `style-src ${cspSource}`,
    `font-src ${cspSource}`,
    `img-src ${cspSource} data:`,
  ].join("; ");
}

/** Pure transform of the built index.html: asset URIs, nonce and CSP. */
export function renderHtml(
  html: string,
  options: { nonce: string; cspSource: string; assetUri: (relative: string) => string },
): string {
  const { nonce, cspSource, assetUri } = options;
  const rewritten = html
    .replace(/(src|href)="\.\/(assets\/[^"]*)"/g, (_m, attr: string, rel: string) => `${attr}="${assetUri(rel)}"`)
    .replace(/<script\b(?![^>]*\bnonce=)/g, `<script nonce="${nonce}"`);
  const csp = `<meta http-equiv="Content-Security-Policy" content="${buildCsp(nonce, cspSource)}">`;
  return rewritten.replace(/<head(\s[^>]*)?>/i, (open) => `${open}\n    ${csp}`);
}

export class ReviewPanel {
  private readonly panel: vscode.WebviewPanel;
  private readonly subscriptions: vscode.Disposable[] = [];

  constructor(
    private readonly extensionUri: vscode.Uri,
    callbacks: { onMessage(raw: unknown): void; onDispose(): void },
  ) {
    const webviewRoot = vscode.Uri.joinPath(extensionUri, "dist", "webview");
    this.panel = vscode.window.createWebviewPanel("diffBoss.review", "diff-boss: Review", vscode.ViewColumn.Active, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [webviewRoot],
    });
    this.subscriptions.push(
      this.panel.webview.onDidReceiveMessage((raw: unknown) => callbacks.onMessage(raw)),
      this.panel.onDidDispose(() => {
        for (const d of this.subscriptions) d.dispose();
        callbacks.onDispose();
      }),
    );
  }

  async load(): Promise<void> {
    const webviewRoot = vscode.Uri.joinPath(this.extensionUri, "dist", "webview");
    const html = await readFile(vscode.Uri.joinPath(webviewRoot, "index.html").fsPath, "utf8");
    const webview = this.panel.webview;
    webview.html = renderHtml(html, {
      nonce: randomBytes(16).toString("base64"),
      cspSource: webview.cspSource,
      assetUri: (rel) => webview.asWebviewUri(vscode.Uri.joinPath(webviewRoot, ...rel.split("/"))).toString(),
    });
  }

  post(message: HostToWebview): void {
    void this.panel.webview.postMessage(message);
  }

  reveal(): void {
    this.panel.reveal();
  }

  dispose(): void {
    this.panel.dispose();
  }
}
