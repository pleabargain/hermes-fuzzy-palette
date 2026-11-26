# Fuzzy Command Palette — Hermes Desktop plugin

A single-file desktop plugin that adds a **fuzzy command palette** to Hermes
Desktop, letting users find any discoverable action in one keystroke without
knowing the exact name or where it lives.

**Trigger:** <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>K</kbd> (rebindable in Settings).

## What it searches

| Group | Examples |
|---|---|
| **Settings** (categories) | Model, Voice, Keyboard Shortcuts, Plugins, … |
| **Settings** (items) | Voice shortcut, Wake word, TTS provider, Theme, … |
| **Commands** (`/` slash) | `/voice`, `/skin`, `/compress`, `/branch`, … |
| **Skills** (loaded) | every installed skill |
| **Sessions** | every session title |
| **Actions** | every built-in app action (`ctx.listActions()`) |

Each item carries natural-language `keywords` aliases, so queries like
**"dictation"**, **"speech to text"**, **"hotkey for voice"**, **"wake word"**
all resolve to the right item in one keystroke.

## The problem it solves

Hermes Desktop Settings has 20+ categories and the actual hotkey for voice
dictation lives at `Settings > Keyboard Shortcuts > voice shortcut` — verified
in source (`dist/assets/markdown-code-DT2C-KAx.js`):

> "or use the voice shortcut from Settings → Keyboard Shortcuts."

The existing `Ctrl+K` Settings search is literal: typing **"dictation"**
returns nothing because the source names the feature **"voice shortcut"**.

A demo video showing this pain: <https://github.com/.../fuzzy-search-demo.mp4>
(or `v1/fuzzy-search-demo.mp4` in this repo, if included).

## Install

```bash
# 1. Find your Hermes home
hermes config path
# → C:\Users\<you>\AppData\Local\hermes (default)

# 2. Copy the plugin
mkdir -p "$HERMES_HOME/desktop-plugins/fuzzy-palette"
cp plugin.js "$HERMES_HOME/desktop-plugins/fuzzy-palette/plugin.js"

# 3. The desktop app hot-reloads within a few seconds. If it doesn't,
#    press Ctrl+K → "Reload desktop plugins".

# 4. Try it: Ctrl+Shift+K, then type "dictation".
```

If `$HERMES_HOME` is not set, the default is `~/.hermes/` (or
`%LOCALAPPDATA%\hermes\` on Windows).

## Verification

After install, type the following and confirm the top result is the right
item:

| Query | Expected top hit |
|---|---|
| `dictation` | Voice shortcut → Settings > Keyboard Shortcuts |
| `dict` | Voice shortcut (substring match via "dictation" keyword) |
| `speech to text` | Voice shortcut (via "speech to text" keyword) |
| `hotkey for voice` | Voice shortcut (hotkey keyword + voice substring) |
| `transcribe` | Voice shortcut (via "transcribe" keyword) |
| `wake` | Wake word (via "wake word" keyword) |
| `theme` | Theme / skin |
| `/compress` | /compress (slash command) |
| `memory` | Memory & Context (settings) |

Run `node test-scoring.js` to unit-test the scoring algorithm in isolation
(43 tests, no external deps).

## Files

| File | Purpose |
|---|---|
| `plugin.js` | The plugin (drop into `$HERMES_HOME/desktop-plugins/fuzzy-palette/`) |
| `scoring.js` | Pure scoring function (no React, no globals) |
| `test-scoring.js` | `node test-scoring.js` — 43 unit tests |
| `PLAN.md` | Design rationale, open questions |
| `GITHUB_ISSUE.md` | Discussion-ready issue text for NousResearch/hermes-agent |

## Algorithm

Per token (AND across query words, stop-words stripped), take the best of:

1. **substring** → 100
2. **word-prefix** → 70
3. **subsequence** (≥70% chars matched in order) → 50 + 10 × longest run
4. **edit-distance** (≤2, similar length) → 30 − 5 × distance

Keyword hits add +20 boost. Final score clamped to [0, 100]. Stable,
deterministic, no globals. ~140 LOC.

## Limitations

- **Settings items are curated** — not every settings leaf is included. The
  curated list covers the items that users most commonly search for (voice
  shortcut, wake word, theme, profile, …). A core-PR (track B in PLAN.md)
  would discover these from the Settings manifest automatically.
- **Keyword synonyms are static** — `dictation → voice shortcut` is hardcoded.
  A core-PR could load these from a community-maintained aliases file.
- **Skills and sessions are fetched on open** — first keystroke may feel
  slow if many skills are installed. Caching is straightforward but left
  for the core-PR.

## License

MIT. Same as Hermes Agent.
