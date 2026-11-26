// plugin.js — Fuzzy Command Palette for Hermes Desktop
// ----------------------------------------------------------------------
// Drop this file into $HERMES_HOME/desktop-plugins/fuzzy-palette/plugin.js
// (or ~/.hermes/desktop-plugins/fuzzy-palette/plugin.js) and Hermes will
// hot-reload it within a few seconds. Trigger with Ctrl+Shift+K
// (rebindable via Settings > Keyboard Shortcuts).
//
// What it searches:
//   - Settings categories and curated settings items (with aliases)
//   - Slash commands (curated list of /voice, /skin, /model, etc.)
//   - Skills (loaded from the gateway)
//   - Sessions (from the session store)
//   - Actions (built-in app actions via ctx.listActions())
//   - Plugins (enabled plugins)
// Pure fuzzy scoring — no Fuse.js / fzf dependency. ~400 lines.
// ----------------------------------------------------------------------

import { jsx, jsxs } from "react/jsx-runtime";
import { useState, useEffect, useRef, useMemo, useCallback } from "react";

// -------------------- 1. PURE FUZZY SCORING --------------------
// Inlined from scoring.js so the plugin is a single file. The standalone
// scoring.js + test-scoring.js live alongside this file for unit tests.

const STOP_WORDS = new Set([
  "a", "an", "the", "for", "to", "of", "in", "on", "is", "do", "how", "i", "my",
]);

const _STRONG = 100, _PREFIX = 70, _SUBSEQ = 50, _RUN_BONUS = 10;
const _RATIO_MIN = 0.7, _EDIT_BASE = 30, _EDIT_PEN = 5, _KW_BOOST = 20;

function _norm(s) { return (s ?? "").toString().toLowerCase().trim(); }

function _subseqStats(tok, tgt) {
  let total = 0, ti = 0, longestRun = 0, curRun = 0;
  for (let i = 0; i < tgt.length && ti < tok.length; i++) {
    if (tgt[i] === tok[ti]) {
      total++; ti++; curRun++;
      if (curRun > longestRun) longestRun = curRun;
    } else curRun = 0;
  }
  return { total, longestRun };
}

function _lev(a, b) {
  if (a === b) return 0;
  if (!a) return b.length; if (!b) return a.length;
  let prev = new Array(b.length + 1);
  let curr = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i-1] === b[j-1] ? 0 : 1;
      curr[j] = Math.min(curr[j-1] + 1, prev[j] + 1, prev[j-1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length];
}

function _simLen(a, b) {
  const lo = Math.min(a, b), hi = Math.max(a, b);
  return hi <= lo * 2;
}

function _bestTok(tok, tgt) {
  if (!tok || !tgt) return 0;
  if (tgt.includes(tok)) return _STRONG;
  const words = tgt.split(/[\s\-_./>]+/).filter(Boolean);
  for (const w of words) if (tok.length >= 1 && w.startsWith(tok)) return _PREFIX;
  if (tok.length >= 2) {
    const { total, longestRun } = _subseqStats(tok, tgt);
    if (total / tok.length >= _RATIO_MIN) {
      return Math.min(100, _SUBSEQ + _RUN_BONUS * longestRun);
    }
  }
  if (tok.length >= 3) {
    for (const w of words) {
      if (w.length >= 3 && _simLen(w.length, tok.length) && _lev(w, tok) <= 2)
        return _EDIT_BASE - _EDIT_PEN * _lev(w, tok);
    }
    if (_simLen(tgt.length, tok.length) && _lev(tgt, tok) <= 2)
      return _EDIT_BASE - _EDIT_PEN * _lev(tgt, tok);
  }
  return 0;
}

function scoreItem(query, item) {
  const q = _norm(query);
  if (!q) return 0;
  const targets = [];
  if (item.title) targets.push({ text: _norm(item.title), boost: false });
  if (item.subtitle) targets.push({ text: _norm(item.subtitle), boost: false });
  if (Array.isArray(item.keywords)) {
    for (const k of item.keywords) if (k) targets.push({ text: _norm(k), boost: true });
  }
  const tokens = q.split(/\s+/).filter(Boolean).filter(t => !STOP_WORDS.has(t));
  if (tokens.length === 0) return 0;
  const perTok = [];
  for (const tok of tokens) {
    let best = 0, boosted = false;
    for (const t of targets) {
      const s = _bestTok(tok, t.text);
      if (s > best) best = s;
      if (s > 0 && t.boost) boosted = true;
    }
    if (best === 0) return 0;
    perTok.push({ score: best, boosted });
  }
  const avg = perTok.reduce((a, b) => a + b.score, 0) / perTok.length;
  return Math.min(100, Math.round(avg + (perTok.some(t => t.boosted) ? _KW_BOOST : 0)));
}

function rank(query, items, limit = 20) {
  return items
    .map(item => ({ item, score: scoreItem(query, item) }))
    .filter(r => r.score > 0)
    .sort((a, b) => b.score !== a.score ? b.score - a.score : a.item.title.length - b.item.title.length)
    .slice(0, limit)
    .map(r => ({ ...r.item, score: r.score }));
}

// -------------------- 2. CURATED CATALOG --------------------
// Static catalog of discoverable items. Each entry carries natural-language
// aliases via `keywords` so users find the right thing without knowing the
// exact name. Add new entries here; no other code needs to change.
//
// `action` shape:
//   { type: 'navigate', path: '/settings/foo' }
//   { type: 'runAction', target: 'view.showFoo' }
//   { type: 'runSlash', target: '/voice' }
//   { type: 'focusSession', target: <sessionId> }

const SETTINGS_CATEGORIES = [
  { id: "settings.model", title: "Model", subtitle: "Settings > Model",
    keywords: ["llm", "ai", "gpt", "claude", "gemini", "main model", "fallback"],
    icon: "chip", action: { type: "navigate", path: "/settings/model" } },
  { id: "settings.chat", title: "Chat", subtitle: "Settings > Chat",
    keywords: ["conversation", "messages", "thread"],
    icon: "comment", action: { type: "navigate", path: "/settings/chat" } },
  { id: "settings.appearance", title: "Appearance", subtitle: "Settings > Appearance",
    keywords: ["theme", "skin", "color", "dark mode", "font", "ui"],
    icon: "paintcan", action: { type: "navigate", path: "/settings/appearance" } },
  { id: "settings.workspace", title: "Workspace", subtitle: "Settings > Workspace",
    keywords: ["project", "folder", "working directory", "cwd"],
    icon: "folder", action: { type: "navigate", path: "/settings/workspace" } },
  { id: "settings.voice", title: "Voice", subtitle: "Settings > Voice",
    keywords: ["tts", "wake word", "stt", "audio", "speech", "transcribe", "dictation", "microphone"],
    icon: "mic", action: { type: "navigate", path: "/settings/voice" } },
  { id: "settings.keyboard-shortcuts", title: "Keyboard Shortcuts",
    subtitle: "Settings > Keyboard Shortcuts",
    keywords: ["hotkey", "keybind", "shortcut", "rebinding", "ctrl", "cmd"],
    icon: "keyboard", action: { type: "navigate", path: "/settings/keyboard-shortcuts" } },
  { id: "settings.memory", title: "Memory & Context", subtitle: "Settings > Memory & Context",
    keywords: ["remember", "context", "memory", "soul", "agents"],
    icon: "history", action: { type: "navigate", path: "/settings/memory" } },
  { id: "settings.providers", title: "Providers", subtitle: "Settings > Providers",
    keywords: ["openai", "anthropic", "google", "api", "model provider"],
    icon: "plug", action: { type: "navigate", path: "/settings/providers" } },
  { id: "settings.plugins", title: "Plugins", subtitle: "Settings > Plugins",
    keywords: ["extension", "add-on", "mcp"],
    icon: "extensions", action: { type: "navigate", path: "/settings/plugins" } },
  { id: "settings.browser", title: "Browser", subtitle: "Settings > Browser",
    keywords: ["chrome", "browser", "web automation"],
    icon: "globe", action: { type: "navigate", path: "/settings/browser" } },
];

// Curated SETTINGS ITEMS — the long-tail things hidden inside categories.
// Each one carries aliases that point users there from natural-language
// queries. This is the part that gets the most value out of fuzzy search.
const SETTINGS_ITEMS = [
  { id: "settings.voice-shortcut", title: "Voice shortcut",
    subtitle: "Settings > Keyboard Shortcuts > voice shortcut",
    keywords: ["dictation", "voice input", "transcribe", "speech", "hotkey",
               "speech to text", "voice to text", "microphone key", "push to talk"],
    icon: "mic", group: "Settings",
    action: { type: "navigate", path: "/settings/keyboard-shortcuts" } },
  { id: "settings.wake-word", title: "Wake word",
    subtitle: "Settings > Voice > wake word listener",
    keywords: ["hey hermes", "wake", "hands free", "voice activation", "listening"],
    icon: "mic", group: "Settings",
    action: { type: "navigate", path: "/settings/voice" } },
  { id: "settings.tts-provider", title: "Text-to-speech provider",
    subtitle: "Settings > Voice > TTS",
    keywords: ["read aloud", "tts", "speak", "voice output", "elevenlabs", "openai tts"],
    icon: "unmute", group: "Settings",
    action: { type: "navigate", path: "/settings/voice" } },
  { id: "settings.stt-provider", title: "Speech-to-text provider",
    subtitle: "Settings > Voice > STT",
    keywords: ["dictation", "transcribe", "whisper", "groq", "voice input"],
    icon: "mute", group: "Settings",
    action: { type: "navigate", path: "/settings/voice" } },
  { id: "settings.skin", title: "Theme / skin",
    subtitle: "Settings > Appearance > skin",
    keywords: ["appearance", "color", "dark mode", "theme"],
    icon: "paintcan", group: "Settings",
    action: { type: "navigate", path: "/settings/appearance" } },
  { id: "settings.profile", title: "Switch profile",
    subtitle: "Settings > Profiles",
    keywords: ["profile", "account", "switch user"],
    icon: "person", group: "Settings",
    action: { type: "runSlash", target: "/profile" } },
  { id: "settings.export", title: "Export profile",
    subtitle: "Settings > Backup & Transfer",
    keywords: ["export", "backup", "share", "archive"],
    icon: "export", group: "Settings",
    action: { type: "runSlash", target: "/export" } },
  { id: "settings.import", title: "Import profile",
    subtitle: "Settings > Backup & Transfer",
    keywords: ["import", "restore", "load"],
    icon: "import", group: "Settings",
    action: { type: "runSlash", target: "/import" } },
];

const SLASH_COMMANDS = [
  { id: "cmd.new", title: "/new", subtitle: "Start a new chat",
    keywords: ["reset", "clear", "fresh", "new conversation"],
    icon: "add", group: "Commands", action: { type: "runSlash", target: "/new" } },
  { id: "cmd.voice", title: "/voice", subtitle: "Open voice chat",
    keywords: ["microphone", "voice mode", "speak", "dictation"],
    icon: "mic", group: "Commands", action: { type: "runSlash", target: "/voice" } },
  { id: "cmd.skin", title: "/skin", subtitle: "Switch theme",
    keywords: ["theme", "appearance", "color", "dark", "light"],
    icon: "paintcan", group: "Commands", action: { type: "runSlash", target: "/skin" } },
  { id: "cmd.profile", title: "/profile", subtitle: "Switch Hermes profile",
    keywords: ["account", "user", "switch"],
    icon: "person", group: "Commands", action: { type: "runSlash", target: "/profile" } },
  { id: "cmd.compress", title: "/compress", subtitle: "Compress conversation context",
    keywords: ["compact", "shrink", "context", "summarize"],
    icon: "compress", group: "Commands", action: { type: "runSlash", target: "/compress" } },
  { id: "cmd.branch", title: "/branch", subtitle: "Branch into a new chat",
    keywords: ["fork", "split", "alternate"],
    icon: "git-branch", group: "Commands", action: { type: "runSlash", target: "/branch" } },
  { id: "cmd.retry", title: "/retry", subtitle: "Retry the last message",
    keywords: ["redo", "again", "resend"],
    icon: "refresh", group: "Commands", action: { type: "runSlash", target: "/retry" } },
  { id: "cmd.undo", title: "/undo", subtitle: "Back up N user turns and re-prompt",
    keywords: ["rollback", "rewind"],
    icon: "discard", group: "Commands", action: { type: "runSlash", target: "/undo" } },
  { id: "cmd.palette", title: "/palette", subtitle: "Open the command palette",
    keywords: ["commands", "search", "find"],
    icon: "search", group: "Commands", action: { type: "runSlash", target: "/palette" } },
  { id: "cmd.help", title: "/help", subtitle: "Show desktop slash commands",
    keywords: ["commands", "usage", "how to"],
    icon: "question", group: "Commands", action: { type: "runSlash", target: "/help" } },
  { id: "cmd.steer", title: "/steer", subtitle: "Inject a message after next tool call",
    keywords: ["redirect", "guide", "inject"],
    icon: "direction", group: "Commands", action: { type: "runSlash", target: "/steer" } },
  { id: "cmd.yolo", title: "/yolo", subtitle: "Auto-approve dangerous commands",
    keywords: ["auto approve", "skip approval", "dangerous"],
    icon: "warning", group: "Commands", action: { type: "runSlash", target: "/yolo" } },
];

const STATIC_CATALOG = [
  ...SETTINGS_CATEGORIES,
  ...SETTINGS_ITEMS,
  ...SLASH_COMMANDS,
];

// -------------------- 3. PLUGIN REGISTRATION --------------------

const RECENT_KEY = "recent";
const MAX_RECENT = 8;

async function loadRecent(ctx) {
  try { return (await ctx.storage.get(RECENT_KEY)) ?? []; } catch { return []; }
}
async function saveRecent(ctx, ids) {
  try { await ctx.storage.set(RECENT_KEY, ids.slice(0, MAX_RECENT)); } catch {}
}

export default {
  id: "fuzzy-palette",
  name: "Fuzzy Command Palette",
  defaultEnabled: true,
  register(ctx) {
    const { host, PALETTE_AREA, KEYBINDS_AREA } = ctx;

    // 3a. Register the action so it shows up in the existing command palette.
    ctx.register({
      id: "fuzzy-palette.open",
      area: PALETTE_AREA,
      data: {
        title: "Open fuzzy command palette",
        description: "Search across settings, slash commands, skills, sessions, and actions",
        category: "Navigation",
        icon: "search",
        shortcut: { win: "Ctrl+Shift+K", mac: "Cmd+Shift+K" },
      },
      // When the user picks this from the existing palette, open our modal.
      onSelect: () => openModal(ctx),
    });

    // 3b. Register a rebindable keybind so the framework handles the trigger.
    ctx.register({
      id: "fuzzy-palette.keybind",
      area: KEYBINDS_AREA,
      data: {
        label: "Open fuzzy command palette",
        defaultShortcut: { win: "Ctrl+Shift+K", mac: "Cmd+Shift+K" },
        action: () => openModal(ctx),
      },
    });

    // 3c. Fallback: a window-level keydown listener for when the framework
    // keybind isn't registered (e.g. during dev / hot-reload flicker).
    useEffect(() => {
      const onKey = (e) => {
        if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "k") {
          e.preventDefault();
          openModal(ctx);
        }
      };
      window.addEventListener("keydown", onKey);
      return () => window.removeEventListener("keydown", onKey);
    }, []);
  },
};

// -------------------- 4. MODAL --------------------
// Opens a centered overlay with input + ranked results.

async function openModal(ctx) {
  const { host } = ctx;
  // Build dynamic catalog (skills, sessions, actions).
  const items = await collectItems(ctx);

  // Mount the modal as a portal-ish overlay. Hermes plugins render into the
  // app's React tree via jsx(); for a full-screen overlay we attach to body.
  const root = await mountOverlay();
  const close = () => unmountOverlay(root);
  renderModal(root, { ctx, items, close });
}

async function collectItems(ctx) {
  const items = [...STATIC_CATALOG];
  try {
    const skills = await ctx.host?.request?.("skills.list", {});
    if (Array.isArray(skills)) {
      for (const s of skills) {
        items.push({
          id: `skill.${s.name ?? s.id ?? Math.random()}`,
          title: s.name ?? s.id ?? "skill",
          subtitle: s.description ?? "Skill",
          group: "Skills",
          icon: "tools",
          action: { type: "runSlash", target: `/skills ${s.name ?? ""}`.trim() },
        });
      }
    }
  } catch {}
  try {
    const sessions = await ctx.host?.request?.("sessions.list", { limit: 50 });
    if (Array.isArray(sessions?.sessions)) {
      for (const s of sessions.sessions) {
        items.push({
          id: `session.${s.id}`,
          title: s.title ?? s.name ?? "Untitled session",
          subtitle: s.preview ?? "Session",
          group: "Sessions",
          icon: "comment",
          action: { type: "focusSession", target: s.id },
        });
      }
    }
  } catch {}
  try {
    const actions = await ctx.listActions?.();
    if (Array.isArray(actions)) {
      for (const a of actions) {
        if (a.id?.startsWith("fuzzy-palette.")) continue;
        items.push({
          id: `action.${a.id}`,
          title: a.title ?? a.id,
          subtitle: a.description ?? "Action",
          group: "Actions",
          icon: "zap",
          action: { type: "runAction", target: a.id },
        });
      }
    }
  } catch {}
  return items;
}

async function mountOverlay() {
  // The plugin SDK exposes app surfaces; for a true overlay we use a portal
  // container attached to document.body. Falls back to a div if missing.
  const existing = document.getElementById("fuzzy-palette-root");
  if (existing) return existing;
  const div = document.createElement("div");
  div.id = "fuzzy-palette-root";
  div.style.cssText = "position:fixed;inset:0;z-index:2147483647;pointer-events:auto;";
  document.body.appendChild(div);
  return div;
}
function unmountOverlay(root) {
  if (root && root.parentNode) root.parentNode.removeChild(root);
}

// Tiny React renderer (we don't import react-dom to keep the plugin single-file).
// Hermes injects a renderer via the SDK; we use it if exposed, else fall back.
function renderModal(root, props) {
  const renderer = (typeof window !== "undefined" && window.__hermesPluginRender)
    || ((node, el) => { /* fallback: do nothing if renderer missing */ });
  renderer(jsx(Modal, props), root);
}

// -------------------- 5. MODAL COMPONENT --------------------

function Modal({ ctx, items, close }) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const [recent, setRecent] = useState([]);
  const inputRef = useRef(null);

  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => { loadRecent(ctx).then(setRecent); }, [ctx]);

  const results = useMemo(() => {
    const q = query.trim();
    if (!q) {
      // Empty query: recent first, then a curated short list.
      const recentItems = recent
        .map(id => items.find(i => i.id === id))
        .filter(Boolean);
      const fallback = items
        .filter(i => ["settings.voice-shortcut", "cmd.voice", "settings.model",
                      "cmd.palette", "cmd.help"].includes(i.id))
        .slice(0, 5);
      return [...recentItems, ...fallback].slice(0, 12);
    }
    return rank(q, items, 20);
  }, [query, items, recent]);

  useEffect(() => { setSelected(0); }, [query]);

  const onKey = useCallback((e) => {
    if (e.key === "Escape") { e.preventDefault(); close(); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); setSelected(s => Math.min(s + 1, results.length - 1)); return; }
    if (e.key === "ArrowUp")   { e.preventDefault(); setSelected(s => Math.max(s - 1, 0)); return; }
    if (e.key === "Enter") {
      e.preventDefault();
      const item = results[selected];
      if (item) activate(ctx, item, close, setRecent);
    }
  }, [results, selected, ctx, close]);

  // Group results by group label, preserving order of first appearance.
  const grouped = useMemo(() => {
    const seen = new Map();
    for (const r of results) {
      if (!seen.has(r.group)) seen.set(r.group, []);
      seen.get(r.group).push(r);
    }
    return Array.from(seen, ([group, list]) => ({ group, list }));
  }, [results]);

  return jsx("div", {
    onClick: (e) => { if (e.target === e.currentTarget) close(); },
    style: {
      position: "fixed", inset: 0,
      background: "rgba(0,0,0,0.55)",
      display: "flex", justifyContent: "center", alignItems: "flex-start",
      paddingTop: "12vh", fontFamily: "var(--ui-font-family)",
    },
    children: jsxs("div", {
      onKeyDown: onKey,
      style: {
        width: "min(640px, 92vw)",
        background: "var(--ui-bg-primary, #1a1b20)",
        border: "1px solid var(--ui-stroke-secondary, #2c2f38)",
        borderRadius: 12,
        boxShadow: "0 16px 64px rgba(0,0,0,0.5)",
        overflow: "hidden",
      },
      children: [
        jsx("input", {
          ref: inputRef,
          value: query,
          onChange: (e) => setQuery(e.target.value),
          placeholder: "Type to search settings, commands, skills, sessions…",
          style: {
            width: "100%", padding: "16px 18px", fontSize: 16,
            background: "transparent", color: "var(--ui-fg-primary, #e8eaf0)",
            border: "none", borderBottom: "1px solid var(--ui-stroke-secondary, #2c2f38)",
            outline: "none",
          },
        }),
        jsx("div", {
          style: { maxHeight: "60vh", overflowY: "auto" },
          children: grouped.length === 0
            ? jsx("div", {
                style: { padding: "20px", color: "var(--ui-fg-tertiary, #888)",
                         textAlign: "center", fontSize: 13 },
                children: "No matches. Try fewer or different words.",
              })
            : grouped.map(({ group, list }) =>
                jsxs("div", { children: [
                  jsx("div", {
                    style: {
                      padding: "8px 18px 4px", fontSize: 10,
                      textTransform: "uppercase", letterSpacing: 1,
                      color: "var(--ui-fg-tertiary, #6b7280)",
                    },
                    children: group,
                  }),
                  list.map((item, idxInGroup) => {
                    const flatIdx = results.indexOf(item);
                    const isSel = flatIdx === selected;
                    return jsx("div", {
                      onClick: () => activate(ctx, item, close, setRecent),
                      onMouseEnter: () => setSelected(flatIdx),
                      style: {
                        padding: "10px 18px",
                        background: isSel ? "var(--ui-bg-quaternary, #2a2d36)" : "transparent",
                        cursor: "pointer",
                        display: "flex", alignItems: "center", gap: 12,
                        borderLeft: isSel ? "2px solid var(--ui-accent, #ff9d3d)" : "2px solid transparent",
                      },
                      children: jsxs("div", { style: { flex: 1, minWidth: 0 }, children: [
                        jsx("div", {
                          style: { fontSize: 14, color: "var(--ui-fg-primary, #e8eaf0)",
                                   whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
                          children: item.title,
                        }),
                        item.subtitle ? jsx("div", {
                          style: { fontSize: 12, color: "var(--ui-fg-tertiary, #888)",
                                   whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
                          children: item.subtitle,
                        }) : null,
                      ] }),
                      jsx("div", {
                        style: { fontSize: 11, color: "var(--ui-fg-quaternary, #555)" },
                        children: String(item.score ?? ""),
                      }),
                    ] });
                  }),
                ] })
              ),
        }),
        jsx("div", {
          style: {
            padding: "8px 18px", fontSize: 11,
            color: "var(--ui-fg-tertiary, #6b7280)",
            borderTop: "1px solid var(--ui-stroke-secondary, #2c2f38)",
            display: "flex", gap: 16,
          },
          children: [
            jsx("span", { children: "↑↓ navigate" }),
            jsx("span", { children: "↵ open" }),
            jsx("span", { children: "esc close" }),
            jsx("span", { style: { marginLeft: "auto" }, children: `${results.length} result${results.length === 1 ? "" : "s"}` }),
          ],
        }),
      ],
    }),
  });
}

async function activate(ctx, item, close, setRecent) {
  try {
    switch (item.action?.type) {
      case "navigate":
        await ctx.host?.navigate?.(item.action.path);
        break;
      case "runAction":
        await ctx.runAction?.(item.action.target);
        break;
      case "runSlash":
        await ctx.host?.request?.("chat.send", { text: item.action.target });
        break;
      case "focusSession":
        await ctx.host?.request?.("session.focus", { id: item.action.target });
        break;
    }
    // Update recents (LRU).
    setRecent?.((prev) => {
      const next = [item.id, ...prev.filter(x => x !== item.id)].slice(0, MAX_RECENT);
      saveRecent(ctx, next);
      return next;
    });
  } catch (e) {
    ctx.host?.notify?.({ kind: "error", message: `Failed: ${e?.message ?? e}` });
  } finally {
    close();
  }
}
