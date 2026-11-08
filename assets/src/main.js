import { Popcorn } from "@swmansion/popcorn";
import { EditorView, basicSetup } from "codemirror";
import { keymap } from "@codemirror/view";
import { Compartment, EditorState, Prec } from "@codemirror/state";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { setDiagnostics } from "@codemirror/lint";
import { tags as t } from "@lezer/highlight";
import { elixir } from "codemirror-lang-elixir";
import { formatDialect, postgresql } from "sql-formatter";
import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from "lz-string";
import { EXAMPLES } from "./examples.js";

const $ = (id) => document.getElementById(id);
const els = {
  versions: $("versions"),
  examples: $("examples"),
  run: $("run"),
  share: $("share"),
  output: $("output"),
  status: $("status"),
};

// ---------------------------------------------------------------------------
// State: one buffer per mode, restored from the URL or a local draft
// ---------------------------------------------------------------------------

const DRAFT_KEY = "pocket-beam:drafts";
let mode = "elixir";
// True while an example is being loaded, so that edit doesn't clear the
// example's name from the dropdown.
let loadingExample = false;
const buffers = {
  elixir: EXAMPLES.elixir[0].code,
  ecto: EXAMPLES.ecto[0].code,
};

try {
  Object.assign(buffers, JSON.parse(localStorage.getItem(DRAFT_KEY) ?? "{}"));
} catch {}

const shared = readShareLink();
if (shared) {
  mode = shared.mode;
  buffers[shared.mode] = shared.code;
}

function saveDrafts() {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(buffers));
  } catch {}
}

// ---------------------------------------------------------------------------
// Editor
// ---------------------------------------------------------------------------

// One palette per theme. The page's CSS reads data-theme on <html>; the
// editor gets its own theme through a compartment so it can switch live.
const PALETTES = {
  dark: {
    bg: "#18111f", text: "#f6f1e7", gutter: "#5e5070", activeLine: "#1f1727", selection: "#4a3566",
    cursor: "#f4b942", tooltip: "#2b2036", tooltipBorder: "#3a2e46",
    keyword: "#c9a6f0", atom: "#8fd6c4", string: "#f4d58d", number: "#ffb08a", comment: "#8a7c99",
    func: "#7fc8ff", module: "#f4b942", operator: "#e6a1c8",
  },
  light: {
    bg: "#fffdf8", text: "#1c1424", gutter: "#a89cb4", activeLine: "#f8f2e8", selection: "#e3d5f3",
    cursor: "#7a4fb0", tooltip: "#fffdf8", tooltipBorder: "#ddd3c4",
    keyword: "#7a4fb0", atom: "#0e7c66", string: "#8a5a00", number: "#c2410c", comment: "#8a7f94",
    func: "#1f6fb2", module: "#a15c00", operator: "#b4387a",
  },
};

function editorTheme(name) {
  const c = PALETTES[name];

  const highlight = HighlightStyle.define([
    { tag: [t.keyword, t.controlKeyword, t.definitionKeyword, t.operatorKeyword], color: c.keyword },
    { tag: [t.atom, t.bool, t.special(t.string)], color: c.atom },
    { tag: [t.string, t.character], color: c.string },
    { tag: [t.number, t.integer, t.float], color: c.number },
    { tag: [t.comment, t.lineComment], color: c.comment, fontStyle: "italic" },
    { tag: [t.function(t.variableName), t.function(t.propertyName)], color: c.func },
    { tag: [t.namespace, t.className, t.typeName], color: c.module },
    { tag: [t.attributeName, t.propertyName], color: c.atom },
    { tag: t.operator, color: c.operator },
  ]);

  const theme = EditorView.theme(
    {
      "&": { backgroundColor: c.bg, color: c.text, fontSize: "14px" },
      ".cm-content": { fontFamily: "'JetBrains Mono', monospace", fontVariantLigatures: "none", caretColor: c.cursor, padding: "14px 0" },
      ".cm-gutters": { backgroundColor: c.bg, color: c.gutter, border: "none" },
      ".cm-activeLine, .cm-activeLineGutter": { backgroundColor: c.activeLine },
      "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": { backgroundColor: `${c.selection} !important` },
      ".cm-cursor": { borderLeftColor: c.cursor },
      ".cm-tooltip": { backgroundColor: c.tooltip, border: `1px solid ${c.tooltipBorder}`, color: c.text },
      ".cm-diagnostic": { fontFamily: "'JetBrains Mono', monospace", whiteSpace: "pre-wrap" },
    },
    { dark: name === "dark" },
  );

  return [theme, syntaxHighlighting(highlight)];
}

const THEME_KEY = "pocket-beam:theme";
const themeSlot = new Compartment();
let currentTheme = initialTheme();
document.documentElement.dataset.theme = currentTheme;

function initialTheme() {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === "light" || saved === "dark") return saved;
  } catch {}
  return matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

function setTheme(name) {
  currentTheme = name;
  document.documentElement.dataset.theme = name;
  editor.dispatch({ effects: themeSlot.reconfigure(editorTheme(name)) });
  try {
    localStorage.setItem(THEME_KEY, name);
  } catch {}
}

const runKeys = Prec.highest(
  keymap.of([
    { key: "Mod-Enter", run: () => (run(), true) },
    { key: "Shift-Enter", run: () => (run(), true) },
  ]),
);

const editor = new EditorView({
  parent: $("editor"),
  state: makeState(buffers[mode]),
});

function makeState(doc) {
  return EditorState.create({
    doc,
    extensions: [
      basicSetup,
      elixir(),
      themeSlot.of(editorTheme(currentTheme)),
      runKeys,
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          buffers[mode] = update.state.doc.toString();
          saveDrafts();
          if (!loadingExample) els.examples.value = "";
        }
      }),
    ],
  });
}

function setMode(next) {
  if (next === mode) return;
  buffers[mode] = editor.state.doc.toString();
  mode = next;
  editor.setState(makeState(buffers[mode]));
  document.querySelectorAll(".tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.mode === mode));
  fillExamples();
  showEmpty();
}

function showEmpty() {
  const [title, text] =
    mode === "ecto"
      ? ["Schemas in, SQL out", "Define schemas and end with a query or a changeset."]
      : ["Write some Elixir", "It compiles and runs here, in your browser!"];
  const kbd = (key) => el("kbd", {}, key);
  els.output.replaceChildren(
    el(
      "div",
      { class: "empty" },
      el("img", { src: "/favicon.svg", alt: "" }),
      el("h2", {}, title),
      el("p", {}, text),
      el("p", {}, "Press ", kbd("⌘"), " ", kbd("↵"), " or ", kbd("⇧"), " ", kbd("↵"), " to run."),
    ),
  );
}

function setStatus(text, state) {
  els.status.textContent = text;
  els.status.dataset.state = state;
}

function fillExamples() {
  els.examples.innerHTML = `<option value="" disabled selected>Examples…</option>`;
  EXAMPLES[mode].forEach((example, i) => {
    const option = document.createElement("option");
    option.value = i;
    option.textContent = example.name;
    els.examples.append(option);
  });
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === "class") node.className = value;
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value);
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

function prettySql(sql) {
  try {
    return formatDialect(sql, { dialect: postgresql, keywordCase: "upper" });
  } catch {
    return sql;
  }
}

async function copy(text, message) {
  try {
    await navigator.clipboard.writeText(text);
    toast(message);
  } catch {
    // Older browsers, or a page without focus: fall back to a hidden textarea.
    const area = el("textarea", { readonly: "" });
    area.value = text;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.append(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    toast(ok ? message : "Could not copy. Select the text and copy it by hand.");
  }
}

function block(title, meta, ...content) {
  return el("div", { class: "block" }, el("h2", {}, title, meta ? el("span", { class: "meta" }, meta) : null), ...content);
}

function showDiagnosticsInEditor(diagnostics) {
  const doc = editor.state.doc;
  const marks = diagnostics
    .filter((d) => d.line && d.line <= doc.lines)
    .map((d) => {
      const line = doc.line(d.line);
      const from = d.column ? Math.min(line.from + d.column - 1, line.to) : line.from;
      return { from, to: line.to > from ? line.to : from, severity: d.severity === "error" ? "error" : "warning", message: d.message };
    });
  editor.dispatch(setDiagnostics(editor.state, marks));
}

function goToLine(lineNumber) {
  if (!lineNumber || lineNumber > editor.state.doc.lines) return;
  const line = editor.state.doc.line(lineNumber);
  editor.dispatch({ selection: { anchor: line.from }, scrollIntoView: true });
  editor.focus();
}

function render(res) {
  const out = [];

  if (res.diagnostics.length) {
    out.push(
      block(
        res.diagnostics.length === 1 ? "1 warning" : `${res.diagnostics.length} warnings`,
        "from the compiler and the type checker",
        res.diagnostics.map((d) =>
          el(
            "div",
            { class: `diagnostic ${d.severity}`, onclick: () => goToLine(d.line) },
            el("div", { class: "where" }, `${d.severity} · line ${d.line ?? "?"}`),
            el("pre", {}, d.message.trim()),
          ),
        ),
      ),
    );
  }

  if (res.kind === "sql") {
    const sql = prettySql(res.sql);
    const withValues = prettySql(res.inlined);
    const copyButtons = el(
      "span",
      { class: "copy-buttons" },
      el("button", { class: "mini", onclick: () => copy(sql, "Copied") }, "Copy"),
      el("button", { class: "mini", onclick: () => copy(withValues, "Copied with values") }, "Copy with values"),
    );
    out.push(block("SQL · PostgreSQL", copyButtons, el("pre", { class: "sql" }, sql)));
    out.push(
      block(
        "Parameters",
        null,
        res.params.length ? el("table", {}, res.params.map((p, i) => el("tr", {}, el("td", {}, `$${i + 1}`), el("td", {}, p)))) : el("pre", {}, "none"),
      ),
    );
  }

  if (res.kind === "changeset") {
    const cs = res.changeset;
    out.push(block("Changeset", null, el("span", { class: `badge ${cs.valid ? "valid" : "invalid"}` }, cs.valid ? "✓ Valid" : "✕ Invalid")));
    if (cs.errors.length) {
      out.push(block("Errors", null, el("table", {}, cs.errors.map((e) => el("tr", {}, el("td", {}, e.field), el("td", {}, e.messages.join(", ")))))));
    }
    out.push(block("Changes", null, el("pre", {}, cs.changes)));
  }

  if (res.stdout) out.push(block("Output", null, el("pre", {}, res.stdout)));

  if (res.kind !== "sql" || !res.ok) {
    out.push(block(res.ok ? "Result" : "Error", `${res.time_ms} ms`, el("pre", { class: `result ${res.ok ? "" : "error"}` }, res.result)));
  } else {
    out.push(block("Query", `${res.time_ms} ms`, el("pre", {}, res.result)));
  }

  els.output.replaceChildren(...out);
}

// ---------------------------------------------------------------------------
// Sharing
// ---------------------------------------------------------------------------

function readShareLink() {
  const match = location.hash.match(/^#(elixir|ecto)\/(.+)$/);
  if (!match) return null;
  const code = decompressFromEncodedURIComponent(match[2]);
  return code ? { mode: match[1], code } : null;
}

async function share() {
  const code = editor.state.doc.toString();
  const url = `${location.origin}${location.pathname}#${mode}/${compressToEncodedURIComponent(code)}`;
  history.replaceState(null, "", url);
  try {
    await navigator.clipboard.writeText(url);
    toast("Link copied.");
  } catch {
    toast("Link ready in the address bar.");
  }
}

function toast(message) {
  document.querySelector(".toast")?.remove();
  const node = el("div", { class: "toast" }, message);
  document.body.append(node);
  setTimeout(() => node.remove(), 2600);
}

// ---------------------------------------------------------------------------
// The BEAM
// ---------------------------------------------------------------------------

let popcorn = null;
let running = false;

async function run() {
  if (!popcorn || running) return;
  running = true;
  els.run.disabled = true;
  setStatus("Running…", "running");

  const code = editor.state.doc.toString();
  const reply = await popcorn.tryCall("pocket_beam", ["run", mode, code], { timeoutMs: 20_000 });

  running = false;
  els.run.disabled = false;

  if (!reply.ok) {
    setStatus("The BEAM did not answer. Reload the page to restart it.", "error");
    console.error(reply.error);
    return;
  }

  const res = reply.data;
  showDiagnosticsInEditor(res.diagnostics);
  render(res);
  setStatus(`${res.ok ? "Ran" : "Failed"} in ${res.time_ms} ms`, res.ok ? "ready" : "error");
}

async function boot() {
  const started = performance.now();
  setStatus("Downloading and booting the BEAM…", "loading");

  try {
    popcorn = await Popcorn.init({ onStdout: () => {}, onStderr: console.error });
  } catch (error) {
    setStatus("Could not start the BEAM. Check the console.", "error");
    throw error;
  }

  const info = await popcorn.tryCall("pocket_beam", "info");
  if (info.ok) {
    const { elixir: ex, otp, ecto } = info.data;
    els.versions.textContent = `Elixir ${ex} · Erlang/OTP ${otp} · Ecto ${ecto}`;
  }

  els.run.disabled = false;
  setStatus(`BEAM ready in ${Math.round(performance.now() - started)} ms`, "ready");
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

document.querySelectorAll(".tab").forEach((tab) => tab.addEventListener("click", () => setMode(tab.dataset.mode)));

els.examples.addEventListener("change", () => {
  const example = EXAMPLES[mode][Number(els.examples.value)];
  if (!example) return;
  loadingExample = true;
  editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: example.code } });
  loadingExample = false;
});

els.run.addEventListener("click", run);
$("theme").addEventListener("click", () => setTheme(currentTheme === "dark" ? "light" : "dark"));
els.share.addEventListener("click", share);

if (mode !== "elixir") {
  const target = mode;
  mode = "elixir";
  setMode(target);
}
fillExamples();
showEmpty();
boot();
