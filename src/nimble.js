// Klient modelu decyzyjnego (Jev-style) przez endpoint Ollama /v1/systemone.
import { AI, HUMAN, boardToText, legalColumns, winningColumns, fallbackMove } from './rules.js';

// Domyślnie 'nimble' — gra sama wybierze zainstalowany tag (np. nimble:9b-q4_K_M).
export let MODEL = import.meta.env?.VITE_NIMBLE_MODEL || 'nimble';
const ENDPOINT = '/ollama/v1/systemone'; // proxowane przez Vite na localhost:11434

export async function checkOllama() {
  try {
    const r = await fetch('/ollama/api/tags');
    if (!r.ok) return { ok: false, reason: `HTTP ${r.status}` };
    const { models = [] } = await r.json();
    const names = models.map((m) => m.name);
    const found = names.find((n) => n === MODEL) ||
      names.find((n) => n === MODEL + ':latest') ||
      names.find((n) => n.startsWith(MODEL + ':'));
    if (!found) return { ok: false, reason: `brak modelu "${MODEL}" — uruchom: ollama pull ${MODEL}` };
    MODEL = found;
    return { ok: true, model: found };
  } catch {
    return { ok: false, reason: 'Ollama nie działa na localhost:11434' };
  }
}

function buildRequest(board) {
  const legal = legalColumns(board);
  const aiWins = winningColumns(board, AI).map((c) => c + 1);
  const humanWins = winningColumns(board, HUMAN).map((c) => c + 1);

  const criteria = {};
  for (const c of legal) {
    const free = board.filter((row) => row[c] === 0).length;
    criteria[`col${c + 1}`] = `Drop an O disc into column ${c + 1} (${free} free cells left)`;
  }

  return {
    model: MODEL,
    state: {
      game: 'Connect Four on a 6x7 grid. Discs fall to the lowest free cell. Four in a row (horizontal, vertical or diagonal) wins.',
      you: 'You play O. The human opponent plays X.',
      board: boardToText(board),
      tactics:
        `Columns where O wins immediately: ${aiWins.join(', ') || 'none'}. ` +
        `Columns where X would win on their next move (must block): ${humanWins.join(', ') || 'none'}.`,
    },
    questions: {
      move: {
        type: 'choice',
        instructions: 'Which column should O play to maximise the chance of winning? Win immediately if possible, otherwise block X, otherwise prefer central columns and building threats.',
        criteria,
      },
      threat: {
        type: 'noul',
        instructions: 'Is X threatening to win on their next move?',
      },
      eval: {
        type: 'score',
        instructions: 'Who is currently winning this position?',
        criteria: ['X (human) is winning', 'Even position', 'O (Nimble) is winning'],
      },
    },
  };
}

// Zwraca { col, probs: {col: p}, threat, eval, confidence, ms, source }
export async function nimbleMove(board) {
  const t0 = performance.now();
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildRequest(board)),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const a = data.answers ?? {};
    const legal = legalColumns(board);

    const probs = {};
    for (const [k, v] of Object.entries(a.move?.probabilities ?? {})) {
      const c = parseInt(k.replace('col', ''), 10) - 1;
      if (legal.includes(c)) probs[c] = Number(v);
    }
    let col = parseInt(String(a.move?.choice ?? '').replace('col', ''), 10) - 1;
    if (!legal.includes(col)) {
      col = Object.keys(probs).length
        ? Number(Object.entries(probs).sort((x, y) => y[1] - x[1])[0][0])
        : fallbackMove(board);
    }
    return {
      col, probs,
      threat: a.threat?.noul != null ? Number(a.threat.noul) : null,
      eval: a.eval?.score != null ? Number(a.eval.score) : null,
      confidence: a.move?.confidence != null ? Number(a.move.confidence) : null,
      ms: Math.round(performance.now() - t0),
      source: 'nimble',
    };
  } catch (err) {
    console.warn('[Nimble] fallback:', err);
    await new Promise((r) => setTimeout(r, 350));
    return { col: fallbackMove(board), probs: {}, threat: null, eval: null, confidence: null,
      ms: Math.round(performance.now() - t0), source: 'fallback', error: String(err.message || err) };
  }
}
