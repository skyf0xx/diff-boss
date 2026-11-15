import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HostToWebview, ReviewState, WebviewToHost } from "../../src/contract";
import { App } from "./App";

const PATCH = [
  "diff --git a/src/balance/validation.ts b/src/balance/validation.ts",
  "--- a/src/balance/validation.ts",
  "+++ b/src/balance/validation.ts",
  "@@ -1,2 +1,2 @@",
  " keep",
  "-old",
  "+new",
  "",
].join("\n");

function hunk(n: number, over: Record<string, unknown> = {}) {
  return {
    id: `h${n}`,
    number: n,
    file: `src/file${n}.ts`,
    status: "modified" as const,
    patch: PATCH,
    summary: `Summary ${n}.`,
    needs: [] as number[],
    staged: false,
    ...over,
  };
}

function state(over: Partial<ReviewState> = {}): ReviewState {
  return {
    currentStage: 0,
    stages: [
      {
        header: "feat(balance): validate token ids",
        commitMessage: "feat(balance): validate token ids",
        committed: false,
        hunks: [hunk(1), hunk(2, { needs: [1], staged: true })],
      },
      {
        header: "fix(ui): align labels",
        commitMessage: "fix(ui): align labels",
        committed: false,
        hunks: [hunk(3, { needs: [1, 2] })],
      },
    ],
    ...over,
  };
}

let sent: WebviewToHost[];
const api = { postMessage: (m: WebviewToHost) => void sent.push(m) };

function host(data: unknown) {
  act(() => {
    window.dispatchEvent(new MessageEvent("message", { data }));
  });
}
function review(s: ReviewState = state()) {
  host({ type: "review", state: s } satisfies HostToWebview);
}
function card(n: number, file = `src/file${n}.ts`) {
  return screen.getByRole("article", { name: `Hunk ${n}: ${file}` });
}

beforeEach(() => {
  sent = [];
  render(<App api={api} />);
});
afterEach(cleanup);

describe("startup", () => {
  it("sends ready on mount and shows the title", () => {
    expect(sent).toEqual([{ type: "ready" }]);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Review unstaged changes");
  });

  it("ignores invalid messages", () => {
    host({ type: "nonsense" });
    host("hello");
    host(null);
    host({ type: "generating", attempt: "x" });
    expect(screen.getByRole("status").textContent).toContain("Collecting");
  });
});

describe("states", () => {
  it("shows generating attempts", () => {
    host({ type: "generating", attempt: 2, maxAttempts: 3 });
    expect(screen.getByRole("status").textContent).toContain("attempt 2 of 3");
  });

  it("counts the seconds of each attempt and restarts on the next one", () => {
    vi.useFakeTimers();
    try {
      host({ type: "generating", attempt: 1, maxAttempts: 3 });
      expect(screen.getByRole("status").textContent).toContain("attempt 1 of 3 · 0 s");
      act(() => void vi.advanceTimersByTime(3000));
      expect(screen.getByRole("status").textContent).toContain("attempt 1 of 3 · 3 s");
      host({ type: "generating", attempt: 2, maxAttempts: 3 });
      expect(screen.getByRole("status").textContent).toContain("attempt 2 of 3 · 0 s");
    } finally {
      vi.useRealTimers();
    }
  });

  it("lists failed problems and reruns", async () => {
    host({ type: "failed", problems: [{ field: "order", message: "hunk h1 does not apply" }] });
    expect(screen.getByText("✗ order: hunk h1 does not apply")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Rerun review" }));
    expect(sent.at(-1)).toEqual({ type: "rerun" });
  });
});

describe("review state", () => {
  it("renders stages, cards, labels and commit controls", () => {
    review();
    expect(screen.getByText("feat(balance): validate token ids")).toBeTruthy();
    expect(screen.getByText("fix(ui): align labels")).toBeTruthy();
    const c1 = card(1);
    expect(within(c1).getByText("Summary 1.")).toBeTruthy();
    expect(within(c1).getByText("@@ -1,2 +1,2 @@")).toBeTruthy();
    expect(within(c1).queryByText(/diff --git/)).toBeNull();
    expect(within(c1).getByText("+new").className).toContain("diff-added");
    expect(within(c1).getByText("-old").className).toContain("diff-removed");
    expect(within(c1).getByText("keep", { exact: false }).className).toContain("diff-context");
    expect(within(c1).getByRole("button", { name: "Stage hunk" })).toBeTruthy();
    expect(within(c1).getByRole("button", { name: "Discard" })).toBeTruthy();
    expect(within(c1).getByRole("button", { name: "Open file ↗" })).toBeTruthy();
    expect(within(card(2)).getByText("Needs hunk 1")).toBeTruthy();
    expect(within(card(3)).getByText("Needs hunk 1")).toBeTruthy();
    expect(within(card(3)).getByText("Needs hunk 2")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Commit feat" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Commit fix" })).toBeTruthy();
    const fields = screen.getAllByLabelText("Commit message") as HTMLInputElement[];
    expect(fields[0].value).toBe("feat(balance): validate token ids");
  });

  it("shows staged cards with Staged and Unstage", () => {
    review();
    const c2 = card(2);
    expect(within(c2).getByText("✓ Staged")).toBeTruthy();
    expect(within(c2).getByRole("button", { name: "Unstage" })).toBeTruthy();
    expect(within(c2).queryByRole("button", { name: "Stage hunk" })).toBeNull();
  });

  it("highlights the current stage and marks committed ones done", () => {
    const s = state({ currentStage: 1 });
    s.stages[0].committed = true;
    review(s);
    const stages = screen.getAllByRole("region");
    expect(stages[0].className).toContain("stage-done");
    expect(stages[0].textContent).toContain("✓ Committed");
    expect(stages[1].className).toContain("stage-current");
    expect(stages[1].getAttribute("aria-current")).toBe("step");
    expect(within(card(1)).getByRole("button", { name: "Stage hunk" }).hasAttribute("disabled")).toBe(true);
    expect(screen.queryByRole("button", { name: "Commit feat" })).toBeNull();
  });
});

describe("actions", () => {
  it("posts stage, unstage and open file", async () => {
    review();
    await userEvent.click(within(card(1)).getByRole("button", { name: "Stage hunk" }));
    await userEvent.click(within(card(2)).getByRole("button", { name: "Unstage" }));
    await userEvent.click(within(card(1)).getByRole("button", { name: "Open file ↗" }));
    expect(sent.slice(1)).toEqual([
      { type: "stageHunk", hunkId: "h1" },
      { type: "unstageHunk", hunkId: "h2" },
      { type: "openFile", hunkId: "h1" },
    ]);
  });

  it("commits with the edited message", async () => {
    review();
    const field = screen.getAllByLabelText("Commit message")[0];
    await userEvent.clear(field);
    await userEvent.type(field, "feat: edited");
    await userEvent.click(screen.getByRole("button", { name: "Commit feat" }));
    expect(sent.at(-1)).toEqual({ type: "commit", stageIndex: 0, message: "feat: edited" });
  });

  it("skips the current stage and disables commit and skip elsewhere", async () => {
    review();
    await userEvent.click(screen.getAllByRole("button", { name: "Skip" })[0]);
    expect(sent.at(-1)).toEqual({ type: "skip", stageIndex: 0 });
    expect(screen.getByRole("button", { name: "Commit fix" }).hasAttribute("disabled")).toBe(true);
  });
});

describe("discard", () => {
  it("requests, then confirms with dependents named", async () => {
    review();
    await userEvent.click(within(card(1)).getByRole("button", { name: "Discard" }));
    expect(sent.at(-1)).toEqual({ type: "requestDiscard", hunkId: "h1" });
    host({ type: "confirmDiscard", hunkId: "h1", dependents: [4, 6] });
    const dialog = within(card(1)).getByRole("alertdialog");
    expect(dialog.textContent).toContain("Hunks 4 and 6 need this hunk.");
    await userEvent.click(within(dialog).getByRole("button", { name: "Confirm discard" }));
    expect(sent.at(-1)).toEqual({ type: "confirmDiscard", hunkId: "h1" });
    expect(within(card(1)).queryByRole("alertdialog")).toBeNull();
  });

  it("shows a plain confirm without dependents", async () => {
    review();
    host({ type: "confirmDiscard", hunkId: "h1", dependents: [] });
    const dialog = within(card(1)).getByRole("alertdialog");
    expect(dialog.textContent).not.toMatch(/need/);
    expect(dialog.textContent).toContain("Discard this hunk?");
    await userEvent.click(within(dialog).getByRole("button", { name: "Confirm discard" }));
    expect(sent.at(-1)).toEqual({ type: "confirmDiscard", hunkId: "h1" });
  });

  it("sends nothing on cancel", async () => {
    review();
    host({ type: "confirmDiscard", hunkId: "h1", dependents: [4] });
    const before = sent.length;
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(sent.length).toBe(before);
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });
});

describe("stale", () => {
  it("shows the banner, disables actions and reruns", async () => {
    review();
    host({ type: "stale" });
    expect(screen.getByRole("alert").textContent).toContain("Files changed since this plan was made");
    for (const name of ["Stage hunk", "Discard", "Unstage", "Open file ↗", "Commit feat", "Skip"]) {
      for (const b of screen.getAllByRole("button", { name })) {
        expect(b.hasAttribute("disabled")).toBe(true);
      }
    }
    expect((screen.getAllByLabelText("Commit message")[0] as HTMLInputElement).disabled).toBe(true);
    const before = sent.length;
    fireEvent.click(within(card(1)).getByRole("button", { name: "Stage hunk" }));
    expect(sent.length).toBe(before);
    await userEvent.click(within(screen.getByRole("alert")).getByRole("button", { name: "Rerun review" }));
    expect(sent.at(-1)).toEqual({ type: "rerun" });
  });

  it("re-enables actions when a new review arrives", () => {
    review();
    host({ type: "stale" });
    review();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(within(card(1)).getByRole("button", { name: "Stage hunk" }).hasAttribute("disabled")).toBe(false);
  });

  it("drops a pending discard confirm", () => {
    review();
    host({ type: "confirmDiscard", hunkId: "h1", dependents: [] });
    host({ type: "stale" });
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });
});
