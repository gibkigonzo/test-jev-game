import Phaser from 'phaser';
import { ROWS, COLS, EMPTY, HUMAN, AI, createBoard, drop, findWin, isFull, legalColumns } from './rules.js';
import { nimbleMove, checkOllama, MODEL } from './nimble.js';

const CELL = 80, BX = 40, BY = 150, W = BX * 2 + CELL * COLS + 260, H = BY + CELL * ROWS + 70;
const COLORS = { board: 0x1f4fd1, bg: 0x0f1420, human: 0xf2c94c, ai: 0xeb5757, hole: 0x0f1420 };
const PANEL_X = BX * 2 + CELL * COLS;

class GameScene extends Phaser.Scene {
  constructor() { super('game'); }

  create() {
    this.board = createBoard();
    this.turn = HUMAN;
    this.over = false;
    this.discs = this.add.container();
    this.score = this.score || { human: 0, ai: 0, draw: 0 };

    this.add.text(BX, 20, 'Człowiek vs Nimble', { fontSize: '30px', fontStyle: 'bold', color: '#fff' });
    this.status = this.add.text(BX, 62, '', { fontSize: '18px', color: '#cbd5e1' });
    this.ollamaInfo = this.add.text(BX, 90, 'Sprawdzam Ollama…', { fontSize: '14px', color: '#94a3b8' });

    // słupki prawdopodobieństw modelu nad kolumnami
    this.probBars = [...Array(COLS).keys()].map((c) => {
      const x = BX + c * CELL + CELL / 2;
      const bar = this.add.rectangle(x, BY - 8, CELL - 20, 0, COLORS.ai, 0.85).setOrigin(0.5, 1);
      const label = this.add.text(x, BY - 12, '', { fontSize: '12px', color: '#fff' }).setOrigin(0.5, 1);
      return { bar, label };
    });

    // plansza z dziurami (maska)
    const g = this.add.graphics();
    g.fillStyle(COLORS.board).fillRoundedRect(BX - 10, BY - 10, CELL * COLS + 20, CELL * ROWS + 20, 16);
    g.fillStyle(COLORS.hole);
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++)
      g.fillCircle(BX + c * CELL + CELL / 2, BY + r * CELL + CELL / 2, CELL * 0.4);
    this.children.bringToTop(this.discs);

    this.ghost = this.add.circle(0, BY - 40, CELL * 0.38, COLORS.human, 0.5).setVisible(false);

    this.input.on('pointermove', (p) => {
      const c = this.colAt(p.x);
      const show = !this.over && this.turn === HUMAN && c !== null && legalColumns(this.board).includes(c);
      this.ghost.setVisible(show);
      if (show) this.ghost.setPosition(BX + c * CELL + CELL / 2, BY - 40);
    });
    this.input.on('pointerdown', (p) => {
      if (this.over) return this.scene.restart();
      const c = this.colAt(p.x);
      if (this.turn === HUMAN && c !== null) this.play(c, HUMAN);
    });
    this.input.keyboard.on('keydown', (e) => {
      const n = parseInt(e.key, 10);
      if (n >= 1 && n <= COLS && this.turn === HUMAN && !this.over) this.play(n - 1, HUMAN);
      if (e.key === 'r' || e.key === 'R') this.scene.restart();
    });

    this.buildPanel();
    this.setStatus('Twój ruch — kliknij kolumnę (lub klawisze 1–7)');
    checkOllama().then(({ ok, reason, model }) => {
      this.ollamaInfo.setText(ok ? `● Ollama OK · model: ${model}` : `● ${reason} → gram fallbackiem`)
        .setColor(ok ? '#6fcf97' : '#f2994a');
    });
  }

  buildPanel() {
    const x = PANEL_X, s = { fontSize: '15px', color: '#cbd5e1', wordWrap: { width: 230 } };
    this.add.text(x, BY - 10, 'Myśli Nimble', { fontSize: '20px', fontStyle: 'bold', color: '#fff' });
    this.pConf = this.add.text(x, BY + 25, 'Pewność ruchu: –', s);
    this.pThreat = this.add.text(x, BY + 50, 'Zagrożenie od X: –', s);
    this.pTime = this.add.text(x, BY + 75, 'Czas decyzji: –', s);
    this.add.text(x, BY + 110, 'Ocena pozycji', s);
    this.add.rectangle(x, BY + 140, 220, 16, COLORS.human).setOrigin(0, 0.5);
    this.evalBar = this.add.rectangle(x + 220, BY + 140, 110, 16, COLORS.ai).setOrigin(1, 0.5);
    this.add.text(x, BY + 152, 'Ty', { fontSize: '12px', color: '#f2c94c' });
    this.add.text(x + 220, BY + 152, 'Nimble', { fontSize: '12px', color: '#eb5757' }).setOrigin(1, 0);
    this.pSource = this.add.text(x, BY + 185, '', { ...s, fontSize: '13px', color: '#94a3b8' });
    this.scoreText = this.add.text(x, BY + CELL * ROWS - 60, '', { ...s, fontSize: '16px', color: '#fff' });
    this.add.text(x, BY + CELL * ROWS - 10, 'R — nowa gra', { fontSize: '13px', color: '#64748b' });
    this.updateScore();
  }

  colAt(x) {
    const c = Math.floor((x - BX) / CELL);
    return c >= 0 && c < COLS ? c : null;
  }

  setStatus(t) { this.status.setText(t); }
  updateScore() {
    const { human, ai, draw } = this.score;
    this.scoreText.setText(`Wynik  Ty ${human} : ${ai} Nimble\nRemisy: ${draw}`);
  }

  play(col, player) {
    if (this.over || !legalColumns(this.board).includes(col)) return;
    const row = drop(this.board, col, player);
    this.turn = null;
    this.ghost.setVisible(false);
    const x = BX + col * CELL + CELL / 2, y = BY + row * CELL + CELL / 2;
    const disc = this.add.circle(x, BY - 40, CELL * 0.38, player === HUMAN ? COLORS.human : COLORS.ai);
    this.discs.add(disc);
    this.tweens.add({
      targets: disc, y, duration: 120 + row * 60, ease: 'Bounce.easeOut',
      onComplete: () => this.afterMove(player),
    });
  }

  afterMove(player) {
    const win = findWin(this.board, player);
    if (win) return this.finish(player, win);
    if (isFull(this.board)) return this.finish(EMPTY);
    if (player === HUMAN) this.aiTurn();
    else { this.turn = HUMAN; this.setStatus('Twój ruch'); }
  }

  async aiTurn() {
    this.setStatus(`Nimble myśli…`);
    const snapshot = this.board.map((r) => [...r]);
    const d = await nimbleMove(snapshot);
    this.showThoughts(d);
    this.time.delayedCall(300, () => this.play(d.col, AI));
  }

  showThoughts(d) {
    const pct = (v) => (v == null ? '–' : `${Math.round(v * 100)}%`);
    this.probBars.forEach(({ bar, label }, c) => {
      const p = d.probs[c] ?? 0;
      this.tweens.add({ targets: bar, height: p * 90, duration: 250 });
      bar.setFillStyle(c === d.col ? COLORS.ai : 0x64748b, 0.85);
      label.setText(d.probs[c] != null ? `${Math.round(p * 100)}%` : '');
      label.y = BY - 12 - p * 90;
    });
    this.pConf.setText(`Pewność ruchu: ${pct(d.confidence)}`);
    this.pThreat.setText(`Zagrożenie od X: ${d.threat == null ? '–' : d.threat > 0.5 ? `TAK (${pct(d.threat)})` : `nie (${pct(d.threat)})`}`);
    this.pTime.setText(`Czas decyzji: ${d.ms} ms`);
    if (d.eval != null) this.tweens.add({ targets: this.evalBar, width: Math.max(2, d.eval * 220), duration: 300 });
    this.pSource.setText(d.source === 'nimble'
      ? `Ruch: kolumna ${d.col + 1} (model ${MODEL})`
      : `Ruch: kolumna ${d.col + 1} (fallback — ${d.error})`);
  }

  finish(winner, cells) {
    this.over = true;
    if (cells) cells.forEach(([r, c]) =>
      this.discs.add(this.add.circle(BX + c * CELL + CELL / 2, BY + r * CELL + CELL / 2, CELL * 0.14, 0xffffff)));
    if (winner === HUMAN) { this.score.human++; this.setStatus('Wygrałeś! Kliknij, by zagrać ponownie.'); }
    else if (winner === AI) { this.score.ai++; this.setStatus('Nimble wygrał. Kliknij, by zagrać ponownie.'); }
    else { this.score.draw++; this.setStatus('Remis. Kliknij, by zagrać ponownie.'); }
    this.updateScore();
  }
}

new Phaser.Game({
  type: Phaser.AUTO, parent: 'game', width: W, height: H, backgroundColor: COLORS.bg,
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  scene: GameScene,
});
