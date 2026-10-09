// "Mózg" bota: taktyczne decyzje z modelu decyzyjnego (Ollama /v1/systemone).
// Silnik gry wykonuje taktykę płynnie w każdej klatce; model zmienia ją co ~0.1–2 s.
import { MODEL } from '../nimble.js';

const ENDPOINT = '/ollama/v1/systemone';
const FAST = !!import.meta.env?.VITE_FAST; // pomija pytanie o agresję → krótsze zapytanie

export const TACTICS = {
  attack:      { pl: 'Atak',      en: 'Push towards the enemy and fight at medium range' },
  flank_left:  { pl: 'Flanka L',  en: 'Circle around the enemy to the left while shooting' },
  flank_right: { pl: 'Flanka P',  en: 'Circle around the enemy to the right while shooting' },
  retreat:     { pl: 'Odwrót',    en: 'Back away from the enemy to gain distance' },
  take_cover:  { pl: 'Osłona',    en: 'Hide behind the nearest obstacle to break line of sight' },
  grab_health: { pl: 'Apteczka',  en: 'Run to the health pack (+35 HP)' },
  grab_power:  { pl: 'Power-up',  en: 'Run to the rapid-fire power-up (double fire rate for 6 s)' },
};

export function legalTactics(s) {
  return Object.keys(TACTICS).filter((t) =>
    (t !== 'grab_health' || s.health) && (t !== 'grab_power' || s.power));
}

const range = (d) => (d < 170 ? 'close' : d < 380 ? 'medium' : 'far');

function describe(s) {
  const pick = (p, name) => p
    ? `${name} on the map: ${Math.round(p.distMe)} px from you, ${Math.round(p.distEnemy)} px from the enemy.`
    : `No ${name} on the map.`;
  return {
    rules: 'Top-down 1v1 arena shooter. Each hit deals 12 damage, 100 HP max. First to 5 kills wins the match. Obstacles block bullets and movement.',
    you: `You are O (bot). HP ${s.myHp}/100.${s.myRapid ? ' You have rapid fire.' : ''} Dash ${s.myDash ? 'ready' : 'on cooldown'}.`,
    enemy: `Enemy X (human). HP ${s.enemyHp}/100.${s.enemyRapid ? ' Enemy has RAPID FIRE.' : ''} Enemy is ${s.approaching ? 'approaching you' : 'not approaching'}.`,
    position: `Distance ${Math.round(s.dist)} px (${range(s.dist)} range). Line of sight: ${s.los ? 'yes, you can shoot each other' : 'no, an obstacle is between you'}. Nearest cover ${Math.round(s.coverDist)} px away.`,
    pickups: `${pick(s.health, 'Health pack')} ${pick(s.power, 'Rapid-fire power-up')}`,
    recent: `Last 3 s: you took ${s.taken} damage and dealt ${s.dealt} damage. Score: you ${s.myScore}, enemy ${s.enemyScore}.`,
  };
}

function request(s) {
  const legal = legalTactics(s);
  const questions = {
    tactic: {
      type: 'choice',
      instructions: 'Which tactic should O use for the next second to win the fight? Avoid fighting at low HP, use cover and pickups well, press the attack when ahead.',
      criteria: Object.fromEntries(legal.map((t) => [t, TACTICS[t].en])),
    },
  };
  if (!FAST) questions.aggression = {
    type: 'score',
    instructions: 'How aggressively should O shoot and take risks right now?',
    criteria: ['Cautious', 'Balanced', 'Aggressive'],
  };
  return { model: MODEL, state: describe(s), questions };
}

// Heurystyka używana, gdy Ollama nie odpowiada.
export function fallbackDecision(s) {
  const legal = legalTactics(s);
  let tactic;
  if (s.myHp <= 45 && s.health && s.health.distMe < s.health.distEnemy + 80) tactic = 'grab_health';
  else if (s.myHp <= 30) tactic = 'take_cover';
  else if (s.power && s.power.distMe < s.power.distEnemy) tactic = 'grab_power';
  else if (s.myHp >= s.enemyHp + 20 || s.myRapid) tactic = 'attack';
  else if (s.enemyRapid) tactic = 'take_cover';
  else tactic = Math.random() < 0.5 ? 'flank_left' : 'flank_right';
  if (!legal.includes(tactic)) tactic = 'attack';
  return { tactic, probs: { [tactic]: 1 }, aggression: s.myHp / (s.myHp + s.enemyHp || 1), confidence: null };
}

export async function decide(s, offline) {
  const t0 = performance.now();
  if (offline) return { ...fallbackDecision(s), ms: 0, source: 'fallback' };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 4000);
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request(s)), signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const a = (await res.json()).answers ?? {};
    const legal = legalTactics(s);
    const probs = {};
    for (const [k, v] of Object.entries(a.tactic?.probabilities ?? {})) if (legal.includes(k)) probs[k] = Number(v);
    let tactic = a.tactic?.choice;
    if (!legal.includes(tactic)) tactic = Object.entries(probs).sort((x, y) => y[1] - x[1])[0]?.[0] ?? 'attack';
    return {
      tactic, probs,
      aggression: a.aggression?.score != null ? Number(a.aggression.score) : 0.5,
      confidence: a.tactic?.confidence != null ? Number(a.tactic.confidence) : null,
      ms: Math.round(performance.now() - t0), source: 'nimble',
    };
  } catch (err) {
    return { ...fallbackDecision(s), ms: Math.round(performance.now() - t0), source: 'fallback', error: String(err.message || err) };
  } finally {
    clearTimeout(timer);
  }
}
