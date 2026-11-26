// scoring.js — pure fuzzy scoring for the fuzzy-palette plugin.
//
// Algorithm (precedence order, first match wins per token):
//   1. substring                          -> 100
//   2. word-prefix (any word startsWith)  -> 70
//   3. subsequence (>=70% chars matched)  -> 50 + 10 * longest_consecutive_run
//      (capped at 100)
//   4. edit-distance (len-similar, ≤2)    -> 30 - 5 * dist
// Per-token best is taken across all targets (title, keywords, subtitle).
// Items with any token scoring 0 are filtered out (AND across tokens).
// A keyword hit adds a +20 boost to the final score.
//
// Stable, deterministic, no globals, no React. <140 LOC.

const STRONG = 100;
const PREFIX = 70;
const SUBSEQ = 50;
const SUBSEQ_RUN_BONUS = 10;
const SUBSEQ_RATIO_MIN = 0.7;
const EDIT_BASE = 30;
const EDIT_PENALTY = 5;
const KEYWORD_BOOST = 20;

const STOP_WORDS = new Set(["a", "an", "the", "for", "to", "of", "in", "on", "is", "do", "how", "i", "my"]);

export function normalize(s) {
  return (s ?? "").toString().toLowerCase().trim();
}

function bestTokenScore(token, target) {
  if (!token || !target) return 0;

  // 1. substring
  if (target.includes(token)) return STRONG;

  const words = target.split(/[\s\-_./>]+/).filter(Boolean);

  // 2. word-prefix
  for (const w of words) {
    if (token.length >= 1 && w.startsWith(token)) return PREFIX;
  }

  // 3. subsequence (lenient: >=70% of chars present in order)
  if (token.length >= 2) {
    const { total, longestRun } = subsequenceStats(token, target);
    if (total / token.length >= SUBSEQ_RATIO_MIN) {
      return Math.min(100, SUBSEQ + SUBSEQ_RUN_BONUS * longestRun);
    }
  }

  // 4. edit distance (only when lengths are within 2x)
  if (token.length >= 3) {
    for (const w of words) {
      if (w.length >= 3 && similarLength(w.length, token.length) && lev(w, token) <= 2) {
        return EDIT_BASE - EDIT_PENALTY * lev(w, token);
      }
    }
    if (similarLength(target.length, token.length) && lev(target, token) <= 2) {
      return EDIT_BASE - EDIT_PENALTY * lev(target, token);
    }
  }
  return 0;
}

function similarLength(a, b) {
  const lo = Math.min(a, b), hi = Math.max(a, b);
  return hi <= lo * 2;
}

function subsequenceStats(token, target) {
  let total = 0, ti = 0, longestRun = 0, curRun = 0;
  for (let i = 0; i < target.length && ti < token.length; i++) {
    if (target[i] === token[ti]) {
      total++; ti++;
      curRun++;
      if (curRun > longestRun) longestRun = curRun;
    } else {
      curRun = 0;
    }
  }
  return { total, longestRun };
}

function lev(a, b) {
  if (a === b) return 0;
  if (!a) return b.length;
  if (!b) return a.length;
  let prev = new Array(b.length + 1);
  let curr = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length];
}

export function score(query, target) {
  const q = normalize(query);
  const t = normalize(target);
  if (!q) return 0;
  const tokens = q.split(/\s+/).filter(Boolean).filter(tok => !STOP_WORDS.has(tok));
  if (tokens.length === 0) return 0;
  let total = 0;
  for (const tok of tokens) {
    const s = bestTokenScore(tok, t);
    if (s === 0) return 0;
    total += s;
  }
  return Math.min(100, Math.round(total / tokens.length));
}

export function scoreItem(query, item) {
  const q = normalize(query);
  if (!q) return 0;
  const targets = [];
  if (item.title) targets.push({ text: normalize(item.title), boost: false });
  if (item.subtitle) targets.push({ text: normalize(item.subtitle), boost: false });
  if (Array.isArray(item.keywords)) {
    for (const k of item.keywords) {
      if (k) targets.push({ text: normalize(k), boost: true });
    }
  }
  const tokens = q.split(/\s+/).filter(Boolean).filter(tok => !STOP_WORDS.has(tok));
  if (tokens.length === 0) return 0;
  let perTokenMax = [];
  for (const tok of tokens) {
    let best = 0, boosted = false;
    for (const t of targets) {
      const s = bestTokenScore(tok, t.text);
      if (s > best) best = s;
      if (s > 0 && t.boost) boosted = true;
    }
    if (best === 0) return 0;
    perTokenMax.push({ score: best, boosted });
  }
  const avg = perTokenMax.reduce((a, b) => a + b.score, 0) / perTokenMax.length;
  const anyBoosted = perTokenMax.some(t => t.boosted);
  return Math.min(100, Math.round(avg + (anyBoosted ? KEYWORD_BOOST : 0)));
}

export function buildItems(rawList) {
  return rawList.map(r => ({
    id: r.id,
    title: r.title ?? "",
    subtitle: r.subtitle ?? "",
    keywords: Array.isArray(r.keywords) ? r.keywords : [],
    group: r.group ?? "Other",
    icon: r.icon ?? null,
    action: r.action ?? null,
  }));
}

export function rank(query, items, limit = 20) {
  return items
    .map(item => ({ item, score: scoreItem(query, item) }))
    .filter(r => r.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.item.title.length - b.item.title.length;
    })
    .slice(0, limit)
    .map(r => ({ ...r.item, score: r.score }));
}
