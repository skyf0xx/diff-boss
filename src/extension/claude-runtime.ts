import { accessSync, constants, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import type { ClaudeQueryFn } from "../providers/claude";
import { ProviderError } from "../contract/ports";

export const CLAUDE_NOT_FOUND_MESSAGE =
  "Claude Code was not found on PATH. Install it, run `claude` once to sign in, then try again";

function isExecutable(file: string): boolean {
  try {
    accessSync(file, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** The user's installed `claude`: PATH first, then the usual install locations GUI-launched hosts may miss. */
export function findClaudeExecutable(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  home: string = homedir(),
  fallbackDirs: readonly string[] = ["/opt/homebrew/bin", "/usr/local/bin"],
): string | undefined {
  const names = platform === "win32" ? ["claude.exe", "claude.cmd"] : ["claude"];
  const dirs = (env.PATH ?? "").split(delimiter).filter(Boolean);
  dirs.push(join(home, ".local", "bin"), join(home, ".claude", "local"), ...fallbackDirs);
  for (const dir of dirs) {
    for (const name of names) {
      const candidate = join(dir, name);
      if (isExecutable(candidate)) {
        try {
          return realpathSync(candidate);
        } catch {
          return candidate;
        }
      }
    }
  }
  return undefined;
}

/**
 * The bundled SDK cannot find its own native Claude Code binary (it is an optional
 * platform package resolved relative to the SDK's files), so the provider's query
 * is pointed at the developer's installed `claude`, which carries their login.
 */
export function createClaudeQuery(
  find: () => string | undefined = () => findClaudeExecutable(),
  loadSdk: () => Promise<{ query: ClaudeQueryFn }> = () => import("@anthropic-ai/claude-agent-sdk"),
): ClaudeQueryFn {
  return (params) => {
    async function* run() {
      const executable = find();
      if (!executable) throw new ProviderError(CLAUDE_NOT_FOUND_MESSAGE, "claude");
      const sdk = await loadSdk();
      yield* sdk.query({
        ...params,
        options: { ...params.options, pathToClaudeCodeExecutable: executable },
      });
    }
    return run();
  };
}
