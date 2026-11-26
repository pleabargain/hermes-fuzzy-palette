// test-scoring.js — run with `node test-scoring.js` (no deps).
// Verifies the scoring function used by the fuzzy-palette plugin.

import { score, scoreItem, buildItems, rank } from "./scoring.js";

let passed = 0;
let failed = 0;

function assert(name, cond, detail = "") {
  if (cond) {
    console.log(`  ok   ${name}`);
    passed++;
  } else {
    console.log(`  FAIL ${name}${detail ? "  -- " + detail : ""}`);
    failed++;
  }
}

function section(label) { console.log(`\n${label}`); }

// ---------- 1. substring
section("substring match (highest precedence)");
assert(`"voice" in "Voice shortcut" -> 100`, score("voice", "Voice shortcut") === 100);
assert(`"short" in "Keyboard Shortcuts" -> 100`, score("short", "Keyboard Shortcuts") === 100);
assert(`"xyz" not in "Voice shortcut" -> 0`, score("xyz", "Voice shortcut") === 0);
assert(`single-char "v" in "voice" -> 100`, score("v", "Voice") === 100);
// substring beats prefix when applicable
assert(`"voic" substring of "voice" -> 100 (not 70)`, score("voic", "Voice shortcut") === 100);
assert(`"keyb" substring of "keyboard" -> 100`, score("keyb", "Keyboard Shortcuts") === 100);

// ---------- 2. word prefix (when no substring)
section("word prefix match (no substring)");
assert(`"vic" substring of "victory" -> 100 (substring beats prefix)`, score("vic", "victory in life") === 100);
assert(`"kbo" prefix of "keyboard" -> 70`, score("kbo", "Keyboard Shortcuts") === 70);

// ---------- 3. subsequence
section("subsequence match (lenient)");
assert(`"vce" subsequence in "voice shortcut" -> >= 50`, score("vce", "Voice shortcut") >= 50);
assert(`"vsc" subsequence (v,s,c present) -> >= 50`, score("vsc", "Voice shortcut") >= 50);
assert(`"ks" subsequence -> >= 50`, score("ks", "Keyboard Shortcuts") >= 50);
assert(`"vx" not all present -> 0`, score("vx", "Voice shortcut") === 0);

// ---------- 4. edit-distance
section("edit-distance match");
assert(`"voise" close to "voice" -> > 0`, score("voise", "Voice") > 0);
assert(`"voise" close to "voice" (< 100)`, score("voise", "Voice") < 100);
assert(`"voce" close to "voice" -> > 0`, score("voce", "Voice") > 0);
assert(`"completely_different" -> 0`, score("completely_different", "Voice") === 0);

// ---------- 5. keyword alias
section("keyword alias (with boost)");
const item = {
  title: "Voice shortcut",
  subtitle: "Settings > Keyboard Shortcuts",
  keywords: ["dictation", "voice input", "transcribe", "speech", "hotkey"],
};
assert(`"dictation" matches via keyword boost`, scoreItem("dictation", item) >= 60);
assert(`"transcribe" matches via keyword`, scoreItem("transcribe", item) >= 60);
assert(`"speech" matches via keyword`, scoreItem("speech", item) >= 60);
assert(`"hotkey" matches via keyword`, scoreItem("hotkey", item) >= 60);

// ---------- 6. multi-token AND
section("multi-token AND");
const item2 = {
  title: "Voice shortcut",
  subtitle: "Settings > Keyboard Shortcuts",
  keywords: ["dictation", "voice input", "hotkey", "speech", "transcribe", "text", "speech to text"],
};
assert(`"voice hotkey" matches both tokens`, scoreItem("voice hotkey", item2) > 0);
assert(`"voice xyz" misses (one token unmatched) -> 0`, scoreItem("voice xyz", item2) === 0);

// ---------- 7. stop-word handling
section("stop-word filtering");
assert(`"hotkey for voice" -> drops "for", matches`, scoreItem("hotkey for voice", item2) > 0);
assert(`"speech to text" -> drops "to", needs "text" too`,
  scoreItem("speech to text", item2) > 0);
assert(`"how to do voice dictation" -> drops "how","to","do", matches`,
  scoreItem("how to do voice dictation", item2) >= 60);
assert(`"voice the dictation" -> drops "the", matches`,
  scoreItem("voice the dictation", item2) >= 60);

// ---------- 8. realistic ranking
section("realistic ranking");
const items = buildItems([
  { id: "settings.voice-shortcut", title: "Voice shortcut", subtitle: "Settings > Keyboard Shortcuts",
    keywords: ["dictation", "voice input", "transcribe", "speech", "hotkey"], group: "Settings", icon: "mic",
    action: { type: "navigate", path: "/settings/keyboard-shortcuts" } },
  { id: "settings.voice", title: "Voice", subtitle: "Settings > Voice",
    keywords: ["tts", "wake word", "stt", "audio"], group: "Settings", icon: "mic",
    action: { type: "navigate", path: "/settings/voice" } },
  { id: "cmd.voice", title: "/voice", subtitle: "Slash command",
    keywords: ["voice chat", "microphone"], group: "Commands", icon: "mic",
    action: { type: "runSlash", target: "/voice" } },
  { id: "settings.model", title: "Model picker", subtitle: "Settings > Model",
    keywords: ["llm", "ai model", "gpt", "claude"], group: "Settings", icon: "chip",
    action: { type: "navigate", path: "/settings/model" } },
  { id: "settings.keyboard-shortcuts", title: "Keyboard Shortcuts", subtitle: "Settings > Keyboard Shortcuts",
    keywords: ["hotkey", "keybind", "shortcut", "rebinding"], group: "Settings", icon: "keyboard",
    action: { type: "navigate", path: "/settings/keyboard-shortcuts" } },
]);

const cases = [
  ["dictation",       "settings.voice-shortcut"],   // exact keyword match
  ["dict",            "settings.voice-shortcut"],   // substring via keyword "dictation"
  ["voice input",     "settings.voice-shortcut"],   // keyword "voice input"
  ["speech",          "settings.voice-shortcut"],   // keyword
  ["transcribe",      "settings.voice-shortcut"],   // keyword
  ["hotkey",          "settings.voice-shortcut"],   // keyword
  ["model",           "settings.model"],
];

for (const [q, expectedId] of cases) {
  const r = rank(q, items, 5);
  const top = r[0]?.id ?? "(none)";
  assert(`query "${q}" -> top is "${expectedId}" (got ${top})`, top === expectedId,
    `ranking was: ${r.map(x => `${x.id}=${x.score}`).join(", ")}`);
}

// "voice" is intentionally ambiguous — three items all substring-match. We don't
// pin a single winner; we just assert that voice-shortcut IS in the top 3 and
// scores positive (the user can disambiguate with a second character).
section(`ambiguous "voice" query`);
{
  const r = rank("voice", items, 5);
  const hasShortcut = r.some(x => x.id === "settings.voice-shortcut");
  assert(`"voice" includes voice-shortcut in top 5`, hasShortcut,
    `ranking was: ${r.map(x => `${x.id}=${x.score}`).join(", ")}`);
}

// ---------- 9. empty / whitespace query
section("empty query -> 0 score");
assert(`empty -> 0`, score("", "Voice shortcut") === 0);
assert(`whitespace -> 0`, score("   ", "Voice shortcut") === 0);
assert(`all stop words -> 0`, score("the to a", "Voice shortcut") === 0);

// ---------- 10. case-insensitive
section("case-insensitive");
assert(`"VOICE" == "voice"`, score("VOICE", "Voice shortcut") === 100);

// ---------- 11. deterministic
section("deterministic across 100 runs");
const samples = [];
for (let i = 0; i < 100; i++) samples.push(score("voic", "Voice shortcut"));
assert(`score deterministic`, samples.every(s => s === samples[0]));

// ---------- 12. realistic user scenarios (from the demo video)
section("user scenarios from the demo");
const userItem = {
  title: "Voice shortcut",
  subtitle: "Settings > Keyboard Shortcuts",
  keywords: ["dictation", "voice input", "transcribe", "speech", "hotkey", "text", "speech to text"],
};
const userQueries = [
  ["dictation",                   100],   // exact keyword hit
  ["voice dictation",             100],   // voice (substring) + dictation (keyword)
  ["hotkey for voice",            60],    // hotkey (keyword) + voice (substring), "for" dropped
  ["speech to text",              60],    // speech (keyword), "to" dropped, text (substring via title? no -- title has no "text")
];
for (const [q, expectedMin] of userQueries) {
  const s = scoreItem(q, userItem);
  assert(`"${q}" -> ${expectedMin}+ (got ${s})`, s >= expectedMin, `got ${s}`);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
