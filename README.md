# Hermes Fuzzy Command Palette

A fuzzy command palette for [Hermes Desktop](https://hermes-agent.nousresearch.com/)
that surfaces every discoverable action — settings, hotkeys, slash commands,
skills, sessions, built-in actions — under one keystroke.

Built as a single-file desktop plugin. Ships with the demo video showing
why this is needed.

## Repo layout

- `patch/` — the plugin (drop into `$HERMES_HOME/desktop-plugins/fuzzy-palette/`)
  - `plugin.js` — the palette (single file, ~400 LOC)
  - `scoring.js` — pure fuzzy scorer (~140 LOC, no React, no globals)
  - `test-scoring.js` — `node test-scoring.js` (43 unit tests, all passing)
  - `README.md` — install + verification matrix
  - `PLAN.md` — design rationale, open questions
  - `GITHUB_ISSUE.md` — discussion-ready issue text
- `fuzzy-search-demo.mp4` — 1:45 narrated demo with real Hermes screens

## The problem (one sentence)

Hermes Settings has 20+ categories and the literal Settings search returns
zero hits for the user's natural-language query ("dictation"), because the
feature is named "voice shortcut" in the source.

See `patch/GITHUB_ISSUE.md` for the full writeup and the discussion-ready
issue text (also filed upstream on `NousResearch/hermes-agent`).

## Quick start

```bash
# Find your Hermes home
hermes config path   # → e.g. C:\Users\<you>\AppData\Local\hermes

# Install the plugin
mkdir -p "$HERMES_HOME/desktop-plugins/fuzzy-palette"
cp patch/plugin.js "$HERMES_HOME/desktop-plugins/fuzzy-palette/plugin.js"

# Hermes Desktop hot-reloads in a few seconds.
# Trigger: Ctrl+Shift+K (rebindable in Settings > Keyboard Shortcuts)
# Try queries: dictation, speech to text, hotkey for voice, wake word
```

## Verify the scoring in isolation

```bash
cd patch
node test-scoring.js
# → 43 passed, 0 failed
```

## License

MIT. Same as Hermes Agent.
