# Plan — Fuzzy Command Palette for Hermes Desktop

## Why

Setting items in Hermes Desktop are buried under nested menus and named
inconsistently. A user looking for "voice dictation hotkey" has no way to
find it without prior knowledge of the exact path `Settings > Keyboard
Shortcuts > voice shortcut`. Verified by `grep`:

```
dist/assets/markdown-code-DT2C-KAx.js
"or use the voice shortcut from Settings → Keyboard Shortcuts."
```

Existing Settings search (`Ctrl+K`) is literal — typing `dictation`
returns nothing because the source calls the feature `voice shortcut`.

(Demo video: `v1/fuzzy-search-demo.mp4` in this folder.)

## What

A **fuzzy command palette** that surfaces every discoverable action in
the app under one keystroke. Single trigger, ranked results, keyboard
navigation, runs the chosen action.

## Two-track delivery

| Track | Artifact | Audience | Time to ship |
|---|---|---|---|
| **A. Plugin** | `plugin.js` in `$HERMES_HOME/desktop-plugins/fuzzy-palette/` | anyone running Hermes Desktop | minutes |
| **B. Core proposal** | `GITHUB_ISSUE.md` in this folder | Hermes maintainers | after discussion |

Track A ships the UX today. Track B proposes a permanent home in core
and uses Track A as the reference implementation.

## Data sources (track A, plugin)

Items are aggregated from six sources. Each item has the same shape:

```js
{
  id, title, subtitle, group, icon, keywords,
  action: { type: 'navigate'|'runSlash'|'runAction'|'openSession', target }
}
```

| Group | Source call | Cadence |
|---|---|---|
| Settings categories | static catalog (~20 items) | build-time |
| Settings items | static catalog (curated, ~50 items) | build-time |
| Slash commands | `ctx.runAction` introspection + static catalog of `/voice`, `/skin`, … | plugin-load |
| Skills | `host.request('skills.list')` | per-keystroke, debounced |
| Sessions | `host.request('sessions.list')` | on-open + per-keystroke |
| Actions | `ctx.listActions()` | plugin-load |
| Plugins | `host.request('plugins.list')` | on-open |

Curated settings items carry `keywords` so natural-language queries find
the right thing:

```js
{
  id: 'settings.voice-shortcut',
  title: 'Voice shortcut',
  subtitle: 'Settings > Keyboard Shortcuts',
  group: 'Settings',
  icon: 'mic',
  keywords: ['dictation', 'voice input', 'transcribe', 'speech', 'hotkey'],
  action: { type: 'navigate', path: '/settings/keyboard-shortcuts' }
}
```

## Scoring algorithm (track A)

Pure function `score(query, item) -> number`. No external dependency.

```
1. Normalize query and item title + keywords (lowercase, trim).
2. If query is empty → 0 (handled by caller).
3. Split query into tokens on whitespace; item must match each (AND).
4. For each token, take the best score across:
     - substring(token, target)           -> 100
     - word-prefix(token, target)         -> 70
     - subsequence(token, target)         -> 50 + 10 * max_consecutive_run
     - edit-distance(token, target) ≤ 2   -> 30 - 5 * distance
     - substring in any item.keywords[i]  -> same algorithm, +20 boost
5. Sum / average across tokens; clamp to [0, 100].
6. Return 0 if any token missed everything (filter out).
7. Final sort: score DESC, then title length ASC (prefer tight matches).
```

Inputs to keep the algorithm stable and testable:
- 100 lines of code
- 6 test cases covering substring, prefix, subsequence, edit-distance,
  keyword boost, multi-token AND
- Pure (no globals, no React)

## UX (track A)

Trigger: `Ctrl+Shift+K` (does NOT collide with existing `Ctrl+K` Settings
search; documented in the plugin README).

Modal layout (centered horizontally, near top):
- Input: 14px font, autofocus, placeholder "Type to search…"
- Results list: max 20 visible, grouped with sticky group headers
- Each row: icon | title + subtitle | group tag | score (dim)
- Empty query: show 8 most-recently-used (from localStorage) +
  4 popular ("Settings", "New session", "Voice shortcut", "Switch profile")
- With query: 20 best matches
- Keyboard: `↑↓` navigate, `Enter` activate, `Esc` close, `Tab` cycles groups
- Activation dispatches via `ctx.runAction` (preferred — uses the
  app's own action handler so a rebound shortcut still works)
  or `host.navigate(path)` for Settings pages

## Files

```
patch/
├── plugin.js           # the palette, ESM, SDK-only imports
├── scoring.js          # pure scoring fn (kept inline in plugin.js for now)
├── test-scoring.js     # node-runnable unit tests (no deps)
├── README.md           # install + usage
├── GITHUB_ISSUE.md     # discussion-ready issue
└── PLAN.md             # this file
```

## Open questions (for the maintainers)

1. Should the palette be the **default** `Ctrl+K` in Settings (replace
   the literal search) or a **second** keystroke (`Ctrl+Shift+K`)?
2. Should it include **tool invocations** (e.g. fuzzy for `tools/list`)?
   Could be a "Tools" group that picks a tool and asks Hermes to run it.
3. Should `keywords` come from a **community-maintained aliases file** in
   the repo (like `dictation.txt`) so contributors can teach the palette
   new synonyms without touching plugin code?
4. Should the plugin's appearance live in **`$HERMES_HOME/desktop-plugins/`**
   or be promoted to a **bundled extension** in the catalog?
5. Should scoring be **deterministic** (current design) or **learned**
   (boost recently-used items per user)? The latter is a UX nicety but
   adds a privacy/clearedata concern.

## Verification plan

Track A:
1. `node patch/test-scoring.js` — pure scoring tests pass.
2. `cp -r patch $HERMES_HOME/desktop-plugins/fuzzy-palette/`
3. Open Hermes Desktop, run `Ctrl+Shift+K`, type "dict".
4. Expected: `Voice shortcut` (Settings > Keyboard Shortcuts) is the top hit.
5. Press Enter — Settings navigates to Keyboard Shortcuts.

Track B:
1. Open the issue from `GITHUB_ISSUE.md`.
2. Attach the demo video.
3. Reference the plugin as the reference implementation.
