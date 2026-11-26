---
title: "[feature] Fuzzy command palette for settings, hotkeys, slash commands, and skills"
labels: ["enhancement", "desktop", "ux"]
assignees: ""
---

# Summary

Add a single-keystroke fuzzy command palette that surfaces every discoverable
action in Hermes Desktop — settings, slash commands, skills, sessions, and
built-in actions — under one input. Solves the discoverability problem where
the same feature is named differently in source, settings, and the UI.

# Problem

Hermes Desktop Settings has 20+ categories and the literal Settings search
(`Ctrl+K`) is substring-only. Users can't find features they don't already
know the exact name of.

Concrete example I hit today: I wanted to remap the keyboard shortcut that
activates voice dictation.

1. Open Settings — see `Model`, `Chat`, `Voice`, `Keyboard Shortcuts`, `Tools & Keys`, … but nothing says "voice dictation hotkey".
2. Try the Settings search box (`Ctrl+K`) with `dictation` — **no matches**.
3. Try `voice` — too many unrelated results (TTS, wake word, etc.).
4. Try `hotkey` — nothing in the global search because Keyboard Shortcuts is a separate page.
5. Grep the source: `or use the voice shortcut from Settings → Keyboard Shortcuts.`

The feature is named `voice shortcut` in the source. The user thinks "dictation"
or "speech to text". The literal search can never bridge that gap.

(Demo video with real Hermes screen captures: see attached `fuzzy-search-demo.mp4`
or this PR's sibling folder.)

# Proposal

A fuzzy command palette, triggerable with a single keystroke (default
`Ctrl+Shift+K` to avoid colliding with the existing `Ctrl+K` Settings
search). When open:

- Single input box.
- Items ranked by fuzzy score across multiple groups (Settings, Commands,
  Skills, Sessions, Actions, Plugins).
- Keyboard navigation (`↑↓`, `↵`, `esc`).
- Each item carries natural-language `keywords` aliases (curated) so
  queries like "dictation", "speech to text", "wake word" all hit the
  right target on the first keystroke.

Items carry an `action` shape — `navigate(path)`, `runAction(id)`,
`runSlash('/voice')`, `focusSession(id)` — and the palette dispatches via
the existing `ctx.runAction` / `host.navigate` paths so a rebound shortcut
still works.

## Reference implementation

I have a working implementation as a **standalone desktop plugin** in this
PR's `patch/` folder. It's ~400 lines, single file, no external
dependencies beyond `@hermes/plugin-sdk` and the app's React (both
auto-resolved by the SDK). Verified on the local Hermes Desktop install
today (Windows 11, build 2026-11-09).

Files:
- `patch/plugin.js` — the palette (drop into `$HERMES_HOME/desktop-plugins/fuzzy-palette/`)
- `patch/scoring.js` — pure fuzzy scorer (~140 LOC, no React)
- `patch/test-scoring.js` — `node test-scoring.js` (43 tests pass)
- `patch/README.md` — install + verification matrix
- `patch/PLAN.md` — design rationale and open questions

The plugin version is a complete, shippable UX proof. The core-PR version
would promote it to a built-in feature with:
- Auto-discovery of settings items from the Settings manifest (vs. curated catalog)
- Community-maintained aliases file (e.g. `aliases.yaml`) so contributors
  can teach the palette new synonyms without touching plugin code
- Per-user recency tracking across profiles (with a privacy-respecting opt-out)

## Algorithm

Per token (AND across query words, common English stop-words stripped),
take the best match across the item's title, subtitle, and keywords:

1. **substring** → 100
2. **word-prefix** (any word startsWith the token) → 70
3. **subsequence** (≥70% of token chars present in target, in order) → 50 + 10 × longest consecutive run
4. **edit-distance ≤ 2** (similar length) → 30 − 5 × distance

Keyword hits add +20 boost. Final score clamped to [0, 100]. Stable,
deterministic, no globals, ~140 LOC. Unit-tested with 43 cases.

## Verification matrix

After install, the user should be able to do the following with one keystroke:

| Query | Expected top hit |
|---|---|
| `dictation` | Voice shortcut → Settings > Keyboard Shortcuts |
| `speech to text` | Voice shortcut |
| `hotkey for voice` | Voice shortcut |
| `wake` | Wake word listener |
| `theme` | Theme / skin |
| `compress` | /compress (slash command) |
| `memory` | Memory & Context (settings) |

The first row is the user-facing example from the demo video. It currently
fails (literal search returns 0 results). It should pass with the palette.

# Alternatives considered

- **Improve the existing `Ctrl+K` Settings search to use fuzzy.** Smaller
  change, but keeps the search gated behind opening Settings. The whole
  point of a palette is reachability — users should not need to know the
  feature lives in Settings before they can search for it.
- **Adopt `fzf` / `fuse.js` as a dependency.** These are excellent
  libraries but add bundle size and a second fuzziness model. The custom
  ~140-LOC scorer is good enough for this domain and keeps the plugin
  dependency-free.
- **Make it a separate core area (not a plugin).** This is the long-term
  plan — see "Reference implementation" above. Plugin-first lets us ship
  and gather feedback before committing core surface area.

# Open questions

1. **Default keybind.** `Ctrl+Shift+K`? `Ctrl+K` (replacing the existing
   Settings search)? `Cmd+K` on macOS only? Should this be configurable per
   profile?
2. **Settings-item discovery.** Curated catalog (current) vs. auto-discovered
   from the Settings manifest (proposed for core)? The latter removes the
   need to update the catalog when new settings are added.
3. **Aliases source.** Hardcoded `keywords` (current) vs. a community file
   like `~/.hermes/palette-aliases.yaml` (proposed for core)? Latter lets
   non-developers teach the palette their team's jargon.
4. **Recency.** Track per-user recent items (current plugin does this via
   `ctx.storage`)? With a privacy-respecting "clear recent" button? Or
   leave recency out entirely and rely on group ordering?
5. **Should the palette be discoverable from the existing `Ctrl+K` command
   palette?** Yes (proposed). The existing palette is the gateway to
   every rebindable action; the fuzzy palette registers itself there.

# Impact

- **Settings discoverability.** The single biggest UX win for new users.
- **Plugin & skill ecosystem.** Once the palette exists, plugins and skills
  become first-class discoverable items. Currently they're hidden behind
  capability toggles and the Plugins tab.
- **Bundle size.** Zero for the plugin (no deps). For core, the scoring
  function adds ~140 LOC.
- **Risk.** Low. Plugin version is opt-in per-profile. Core version would
  need to ship with a clear "open palette" entry in the existing command
  palette and a discoverable keybind default.

# Checklist

- [x] Working plugin reference implementation
- [x] Pure scoring function with unit tests (43/43 passing)
- [x] Documentation (README, PLAN)
- [x] Verification matrix
- [x] Demo video (real Hermes screen captures)
- [ ] Core-PR-equivalent auto-discovery (proposed for follow-up)
- [ ] Aliases file format + community process (proposed for follow-up)

# Related

- Demo video: `fuzzy-search-demo.mp4` (1:45, real Hermes screens)
- Plugin folder: `patch/` in this PR
- Hermes docs: https://hermes-agent.nousresearch.com/docs/developer-guide/desktop-plugin-sdk
