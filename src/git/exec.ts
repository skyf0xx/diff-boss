import { execFile } from "node:child_process";
import { GitCommandError } from "../contract/ports";

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface RunOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  input?: string;
}

/**
 * Runs git with an argument array (never a shell). A non-zero exit is returned
 * as a value; a failure to run git at all is thrown as GitCommandError.
 */
export function runGit(args: readonly string[], options: RunOptions = {}): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      "git",
      [...args],
      {
        cwd: options.cwd,
        env: { ...process.env, ...options.env },
        maxBuffer: 512 * 1024 * 1024,
        encoding: "utf8",
      },
      (error, stdout, stderr) => {
        if (!error) {
          resolve({ code: 0, stdout, stderr });
          return;
        }
        const code = (error as NodeJS.ErrnoException).code;
        if (typeof code === "number") {
          resolve({ code, stdout, stderr });
          return;
        }
        reject(new GitCommandError(`git ${args.join(" ")} failed: ${error.message}`, args, null, stderr ?? ""));
      },
    );
    child.stdin?.on("error", () => {});
    child.stdin?.end(options.input ?? "");
  });
}

export function commandError(args: readonly string[], result: RunResult): GitCommandError {
  const detail = result.stderr.trim() || result.stdout.trim();
  return new GitCommandError(
    `git ${args.join(" ")} exited with ${result.code}${detail ? `: ${detail}` : ""}`,
    args,
    result.code,
    result.stderr,
  );
}

/** Runs git and throws GitCommandError unless the exit code is 0 or in `allowed`. */
export async function runGitChecked(
  args: readonly string[],
  options: RunOptions = {},
  allowed: readonly number[] = [],
): Promise<RunResult> {
  const result = await runGit(args, options);
  if (result.code !== 0 && !allowed.includes(result.code)) throw commandError(args, result);
  return result;
}
