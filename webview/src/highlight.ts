import type { CSSProperties } from "react";
import { createHighlighterCoreSync, type HighlighterCore, type LanguageRegistration } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import css from "shiki/langs/css.mjs";
import go from "shiki/langs/go.mjs";
import html from "shiki/langs/html.mjs";
import java from "shiki/langs/java.mjs";
import javascript from "shiki/langs/javascript.mjs";
import json from "shiki/langs/json.mjs";
import jsx from "shiki/langs/jsx.mjs";
import markdown from "shiki/langs/markdown.mjs";
import python from "shiki/langs/python.mjs";
import rust from "shiki/langs/rust.mjs";
import scss from "shiki/langs/scss.mjs";
import shellscript from "shiki/langs/shellscript.mjs";
import sql from "shiki/langs/sql.mjs";
import toml from "shiki/langs/toml.mjs";
import tsx from "shiki/langs/tsx.mjs";
import typescript from "shiki/langs/typescript.mjs";
import yaml from "shiki/langs/yaml.mjs";
import darkTheme from "shiki/themes/github-dark-default.mjs";
import lightTheme from "shiki/themes/github-light-default.mjs";

export interface Segment {
  text: string;
  style?: CSSProperties;
}

const LANGS: LanguageRegistration[][] = [
  css, go, html, java, javascript, json, jsx, markdown, python, rust, scss, shellscript, sql, toml, tsx, typescript, yaml,
];

const BY_EXTENSION: Record<string, string> = {
  ts: "typescript", mts: "typescript", cts: "typescript", tsx: "tsx",
  js: "javascript", mjs: "javascript", cjs: "javascript", jsx: "jsx",
  json: "json", jsonc: "json", css: "css", scss: "scss", html: "html", htm: "html",
  md: "markdown", markdown: "markdown", py: "python", rs: "rust", go: "go", java: "java",
  sh: "shellscript", bash: "shellscript", zsh: "shellscript", sql: "sql", toml: "toml", yml: "yaml", yaml: "yaml",
};

/** Hunks past this size render plain: the JS regex engine is slow on very large inputs. */
const MAX_LINES = 2000;

let highlighter: HighlighterCore | null | undefined;

function getHighlighter(): HighlighterCore | null {
  if (highlighter === undefined) {
    try {
      highlighter = createHighlighterCoreSync({
        themes: [lightTheme, darkTheme],
        langs: LANGS.flat(),
        engine: createJavaScriptRegexEngine({ forgiving: true }),
      });
    } catch {
      highlighter = null;
    }
  }
  return highlighter;
}

export function languageFor(file: string): string | undefined {
  const ext = /\.([^./\\]+)$/.exec(file)?.[1]?.toLowerCase();
  return ext ? BY_EXTENSION[ext] : undefined;
}

/**
 * Colours lines that form one continuous stream of code, so grammar state carries across them.
 * Returns null when the language is unknown or highlighting fails; callers then render plain text.
 */
export function highlightLines(lines: readonly string[], file: string): Segment[][] | null {
  const lang = languageFor(file);
  if (!lang || lines.length === 0 || lines.length > MAX_LINES) return null;
  const hl = getHighlighter();
  if (!hl) return null;
  try {
    const tokens = hl.codeToTokens(lines.join("\n"), {
      lang,
      themes: { light: "github-light-default", dark: "github-dark-default" },
      defaultColor: false,
      tokenizeMaxLineLength: 1000,
    }).tokens;
    if (tokens.length !== lines.length) return null;
    return tokens.map((line) => line.map((t) => ({ text: t.content, style: t.htmlStyle as CSSProperties | undefined })));
  } catch {
    return null;
  }
}
