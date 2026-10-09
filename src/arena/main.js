import Phaser from 'phaser';
import { checkOllama } from '../nimble.js';
import { decide, TACTICS } from './brain.js';

const W = 1000, H = 640, PANEL = 270;
const KILLS_TO_WIN = 5, BULLET_SPEED = 620, DAMAGE = 12;
const DECISION_GAP = 250; // min. odstęp między zapytaniami do modelu (ms)
const C = { bg: 0x0f1420, wall: 0x2b3a55, human: 0xf2c94c, bot: 0xeb5757, health: 0x6fcf97, power: 0x56ccf2, grid: 0x161d2e };
// przeszkody: [środek x, środek y, szer., wys.]
const OBSTACLES = [
  [260, 150, 150, 26], [740, 150, 150, 26], [260, 490, 150, 26], [740, 490, 150, 26],
  [500, 320, 46, 130], [170, 320, 26, 100], [830, 320, 26, 100], [500, 70, 26, 60], [500, 570, 26, 60],
];
const V = Phaser.Math.Vector2;

class ArenaScene extends Phaser.Scene {
  constructor() { super('arena'); }

  create() {
    this.gen = (this.gen || 0) + 1;
    this.makeTextures();
    this.physics.world.setBounds(0, 0, W, H);

    const g = this.add.graphics().lineStyle(1, C.grid);
    for (let x = 0; x <= W; x += 40) g.lineBetween(x, 0, x, H);
    for (let y = 0; y <= H; y += 40) g.lineBetween(0, y, W, y);

    this.walls = this.physics.add.staticGroup();
    this.wallRects = OBSTACLES.map(([x, y, w, h]) => {
      const r = this.add.rectangle(x, y, w, h, C.wall).setStrokeStyle(2, 0x3d5278);
      this.walls.add(r);
      return new Phaser.Geom.Rectangle(x - w / 2, y - h / 2, w, h);
    });

    this.human = this.makeShip(80, H / 2, C.human, true);
    this.bot = this.makeShip(W - 80, H / 2, C.bot, false);
    this.bot.sprite.rotation = Math.PI;
    this.bullets = this.physics.add.group();
    this.pickups = { health: null, power: null };

    for (const s of [this.human, this.bot]) {
      this.physics.add.collider(s.sprite, this.walls);
      this.physics.add.overlap(this.bullets, s.sprite, (a, b) => this.onHit(a.isBullet ? a : b, s));
    }
    this.physics.add.collider(this.human.sprite, this.bot.sprite);
    this.physics.add.collider(this.bullets, this.walls, (a, b) => {
      const bl = a.isBullet ? a : b; this.sparks.explode(6, bl.x, bl.y); bl.destroy();
    });

    this.sparks = this.add.particles(0, 0, 'spark', { speed: { min: 60, max: 260 }, lifespan: 350, scale: { start: 1.2, end: 0 }, emitting: false });
    this.boom = this.add.particles(0, 0, 'spark', { speed: { min: 80, max: 420 }, lifespan: 800, scale: { start: 2.5, end: 0 }, tint: [0xffffff, 0xf2994a, 0xeb5757], emitting: false });

    this.keys = this.input.keyboard.addKeys('W,A,S,D,SPACE,R');
    this.input.mouse?.disableContextMenu();
    this.keys.R.on('down', () => this.scene.restart());
    this.input.on('pointerdown', () => { if (this.matchOver) this.scene.restart(); });

    this.score = { human: 0, bot: 0 };
    this.brain = { tactic: 'attack', aggression: 0.5, thinking: false, last: 0, count: 0, offline: false, ready: false, cover: null, coverAt: 0 };
    this.log = { taken: [], dealt: [] }; // z perspektywy bota
    this.roundOver = false; this.matchOver = false;

    this.buildHud();
    this.time.addEvent({ delay: 7000, loop: true, callback: () => this.spawnPickup('health') });
    this.time.addEvent({ delay: 13000, loop: true, callback: () => this.spawnPickup('power') });
    this.time.delayedCall(2500, () => this.spawnPickup('health'));

    const gen = this.gen;
    checkOllama().then(({ ok, reason, model }) => {
      if (gen !== this.gen) return;
      this.brain.offline = !ok;
      this.brain.ready = true;
      this.ollamaText.setText(ok ? `● Ollama OK · ${model}` : `● ${reason}\n  → bot gra heurystyką`).setColor(ok ? '#6fcf97' : '#f2994a');
    });
    this.flash('Pierwszy do 5 fragów. Walcz!');
  }

  // ---------- tekstury generowane w kodzie ----------
  makeTextures() {
    if (this.textures.exists('ship')) return;
    const g = this.make.graphics({ add: false });
    g.fillStyle(0xffffff).fillTriangle(38, 20, 4, 4, 4, 36).fillStyle(0x000000, 0.25).fillTriangle(38, 20, 14, 14, 14, 26);
    g.generateTexture('ship', 40, 40).clear();
    g.fillStyle(0xffffff).fillCircle(4, 4, 4).generateTexture('bullet', 8, 8).clear();
    g.fillStyle(0xffffff).fillRect(0, 0, 4, 4).generateTexture('spark', 4, 4).clear();
    g.fillStyle(C.health).fillRoundedRect(0, 0, 26, 26, 6).fillStyle(0xffffff).fillRect(10, 4, 6, 18).fillRect(4, 10, 18, 6);
    g.generateTexture('health', 26, 26).clear();
    g.fillStyle(C.power).fillTriangle(13, 0, 26, 13, 13, 26).fillTriangle(13, 0, 0, 13, 13, 26).fillStyle(0xffffff).fillCircle(13, 13, 4);
    g.generateTexture('power', 26, 26).destroy();
  }

  makeShip(x, y, color, isHuman) {
    const sprite = this.physics.add.image(x, y, 'ship').setTint(color).setCollideWorldBounds(true);
    sprite.body.setCircle(15, 5, 5);
    sprite.isShip = true;
    const label = this.add.text(x, y - 34, '', { fontSize: '12px', fontStyle: 'bold', color: '#fff', backgroundColor: '#00000088', padding: { x: 4, y: 2 } }).setOrigin(0.5);
    return { sprite, label, color, isHuman, hp: 100, lastShot: 0, rapidUntil: 0, dashReadyAt: 0, dashUntil: 0, dashDir: new V(), spawn: new V(x, y), dead: false };
  }

  // ---------- HUD ----------
  buildHud() {
    const hpBar = (x, color, alignRight) => {
      this.add.rectangle(x, 14, 200, 12, 0x000000, 0.5).setOrigin(alignRight ? 1 : 0, 0);
      return this.add.rectangle(x, 14, 200, 12, color).setOrigin(alignRight ? 1 : 0, 0);
    };
    this.human.bar = hpBar(14, C.human, false);
    this.bot.bar = hpBar(W - 14, C.bot, true);
    this.scoreText = this.add.text(W / 2, 12, '', { fontSize: '22px', fontStyle: 'bold', color: '#fff' }).setOrigin(0.5, 0);
    this.center = this.add.text(W / 2, H / 2 - 120, '', { fontSize: '30px', fontStyle: 'bold', color: '#fff', stroke: '#000', strokeThickness: 5, align: 'center' }).setOrigin(0.5).setDepth(10);

    const px = W + 18, st = { fontSize: '14px', color: '#cbd5e1' };
    this.add.rectangle(W, 0, PANEL, H, 0x0b0f19).setOrigin(0);
    this.add.text(px, 16, 'Mózg Nimble', { fontSize: '22px', fontStyle: 'bold', color: '#fff' });
    this.ollamaText = this.add.text(px, 46, 'Sprawdzam Ollama…', { fontSize: '12px', color: '#94a3b8' });
    this.add.text(px, 86, 'Aktualna taktyka', st);
    this.tacticText = this.add.text(px, 104, '–', { fontSize: '26px', fontStyle: 'bold', color: '#eb5757' });
    this.rows = Object.entries(TACTICS).map(([key, t], i) => {
      const y = 150 + i * 30;
      this.add.text(px, y, t.pl, { ...st, fontSize: '13px' });
      this.add.rectangle(px + 80, y + 2, 150, 12, 0x1e293b).setOrigin(0);
      const bar = this.add.rectangle(px + 80, y + 2, 0, 12, 0x64748b).setOrigin(0);
      const pct = this.add.text(px + 234, y, '', { fontSize: '11px', color: '#94a3b8' }).setOrigin(1, 0);
      return { key, bar, pct };
    });
    this.add.text(px, 370, 'Agresja', st);
    this.add.rectangle(px, 392, 230, 12, 0x1e293b).setOrigin(0);
    this.aggrBar = this.add.rectangle(px, 392, 115, 12, C.bot).setOrigin(0);
    this.statsText = this.add.text(px, 420, '', { ...st, fontSize: '13px', lineSpacing: 4 });
    this.add.text(px, H - 90, 'WASD — ruch\nMysz — celowanie, LPM — strzał\nSpacja — dash\nR — restart', { fontSize: '12px', color: '#64748b', lineSpacing: 3 });
  }

  flash(msg, ms = 1400) {
    this.center.setText(msg).setAlpha(1);
    this.tweens.killTweensOf(this.center);
    if (ms) this.tweens.add({ targets: this.center, alpha: 0, delay: ms, duration: 400 });
  }

  showBrain(d) {
    this.tacticText.setText(TACTICS[d.tactic].pl);
    for (const r of this.rows) {
      const p = d.probs[r.key];
      r.bar.width = (p ?? 0) * 150;
      r.bar.fillColor = r.key === d.tactic ? C.bot : 0x64748b;
      r.pct.setText(p != null ? `${Math.round(p * 100)}%` : '');
    }
    this.tweens.add({ targets: this.aggrBar, width: Math.max(2, d.aggression * 230), duration: 200 });
    this.statsText.setText([
      `Źródło: ${d.source === 'nimble' ? 'model' : 'heurystyka'}`,
      `Czas decyzji: ${d.ms} ms`,
      `Pewność: ${d.confidence != null ? Math.round(d.confidence * 100) + '%' : '–'}`,
      `Decyzji: ${this.brain.count}`,
      d.error ? `Błąd: ${d.error}` : '',
    ].join('\n'));
  }

  // ---------- geometria ----------
  los(a, b) {
    const line = new Phaser.Geom.Line(a.x, a.y, b.x, b.y);
    return !this.wallRects.some((r) => Phaser.Geom.Intersects.LineToRectangle(line, r));
  }

  findCover(from, threat) {
    let best = null, bestD = Infinity;
    for (const r of this.wallRects) {
      const pts = [[r.centerX, r.y - 26], [r.centerX, r.bottom + 26], [r.x - 26, r.centerY], [r.right + 26, r.centerY]];
      for (const [x, y] of pts) {
        if (x < 25 || y < 25 || x > W - 25 || y > H - 25) continue;
        const p = new V(x, y);
        if (this.los(p, threat)) continue;
        const d = p.distance(from);
        if (d < bestD) { bestD = d; best = p; }
      }
    }
    return best;
  }

  freePoint() {
    for (let i = 0; i < 50; i++) {
      const p = new V(Phaser.Math.Between(60, W - 60), Phaser.Math.Between(60, H - 60));
      const blocked = this.wallRects.some((r) => Phaser.Geom.Rectangle.Contains(Phaser.Geom.Rectangle.Inflate(Phaser.Geom.Rectangle.Clone(r), 30, 30), p.x, p.y));
      if (!blocked && p.distance(this.human.sprite) > 120 && p.distance(this.bot.sprite) > 120) return p;
    }
    return new V(W / 2, 40);
  }

  spawnPickup(kind) {
    if (this.pickups[kind] || this.roundOver) return;
    const p = this.freePoint();
    const s = this.physics.add.image(p.x, p.y, kind);
    s.kind = kind;
    this.tweens.add({ targets: s, scale: { from: 0, to: 1 }, duration: 300, ease: 'Back.easeOut' });
    this.tweens.add({ targets: s, angle: 360, duration: 4000, repeat: -1 });
    for (const ship of [this.human, this.bot]) this.physics.add.overlap(ship.sprite, s, () => this.collect(ship, s));
    this.pickups[kind] = s;
  }

  collect(ship, s) {
    if (!s.active || ship.dead) return;
    if (s.kind === 'health') ship.hp = Math.min(100, ship.hp + 35);
    else ship.rapidUntil = this.time.now + 6000;
    this.sparks.explode(14, s.x, s.y);
    this.pickups[s.kind] = null;
    s.destroy();
  }

  // ---------- walka ----------
  fire(ship, angle) {
    const now = this.time.now;
    const base = ship.isHuman ? 210 : 520 - 240 * this.brain.aggression;
    const interval = now < ship.rapidUntil ? base / 2 : base;
    if (now - ship.lastShot < interval || ship.dead) return;
    ship.lastShot = now;
    const sp = ship.sprite;
    const b = this.bullets.create(sp.x + Math.cos(angle) * 24, sp.y + Math.sin(angle) * 24, 'bullet');
    b.isBullet = true; b.owner = ship; b.born = now;
    b.setTint(ship.color).body.setCircle(4);
    b.setVelocity(Math.cos(angle) * BULLET_SPEED, Math.sin(angle) * BULLET_SPEED);
  }

  onHit(b, ship) {
    if (!b.active || b.owner === ship || ship.dead || this.roundOver) return;
    b.destroy();
    ship.hp -= DAMAGE;
    this.sparks.explode(10, ship.sprite.x, ship.sprite.y);
    ship.sprite.setTintFill(0xffffff);
    this.time.delayedCall(60, () => ship.sprite.setTint(ship.color));
    const now = this.time.now;
    (ship.isHuman ? this.log.dealt : this.log.taken).push({ t: now, v: DAMAGE });
    if (ship.isHuman) this.cameras.main.shake(90, 0.006);
    if (ship.hp <= 0) this.kill(ship);
  }

  kill(ship) {
    ship.dead = true; ship.hp = 0;
    this.roundOver = true;
    this.boom.explode(50, ship.sprite.x, ship.sprite.y);
    this.cameras.main.shake(300, 0.015);
    ship.sprite.setVisible(false).body.enable = false;
    const winner = ship.isHuman ? 'bot' : 'human';
    this.score[winner]++;
    if (this.score[winner] >= KILLS_TO_WIN) {
      this.matchOver = true;
      this.flash(winner === 'human' ? 'WYGRAŁEŚ MECZ!\nkliknij, by zagrać znowu' : 'NIMBLE WYGRYWA MECZ\nkliknij, by zagrać znowu', 0);
      return;
    }
    this.flash(winner === 'human' ? 'Fraga dla Ciebie!' : 'Nimble Cię trafił!');
    const gen = this.gen;
    this.time.delayedCall(1600, () => { if (gen === this.gen) this.resetRound(); });
  }

  resetRound() {
    this.bullets.clear(true, true);
    for (const s of [this.human, this.bot]) {
      s.hp = 100; s.dead = false; s.rapidUntil = 0; s.dashUntil = 0;
      s.sprite.setPosition(s.spawn.x, s.spawn.y).setVisible(true).setVelocity(0).body.enable = true;
    }
    this.bot.sprite.rotation = Math.PI;
    this.log = { taken: [], dealt: [] };
    this.roundOver = false;
    this.flash('Walcz!', 600);
  }

  dash(ship, dir) {
    const now = this.time.now;
    if (now < ship.dashReadyAt || dir.lengthSq() === 0) return;
    ship.dashReadyAt = now + 1800; ship.dashUntil = now + 160;
    ship.dashDir.copy(dir).normalize();
    this.sparks.explode(8, ship.sprite.x, ship.sprite.y);
  }

  move(ship, dir, speed) {
    if (this.time.now < ship.dashUntil) return ship.sprite.setVelocity(ship.dashDir.x * 700, ship.dashDir.y * 700);
    if (dir.lengthSq() > 0) dir.normalize().scale(speed);
    ship.sprite.setVelocity(dir.x, dir.y);
  }

  // ---------- człowiek ----------
  updateHuman() {
    const k = this.keys, dir = new V((k.D.isDown ? 1 : 0) - (k.A.isDown ? 1 : 0), (k.S.isDown ? 1 : 0) - (k.W.isDown ? 1 : 0));
    if (Phaser.Input.Keyboard.JustDown(k.SPACE)) this.dash(this.human, dir.clone());
    this.move(this.human, dir, 230);
    const p = this.input.activePointer, sp = this.human.sprite;
    sp.rotation = Phaser.Math.Angle.Between(sp.x, sp.y, p.worldX, p.worldY);
    if (p.isDown && p.worldX < W) this.fire(this.human, sp.rotation);
  }

  // ---------- bot ----------
  snapshot() {
    const b = this.bot.sprite, h = this.human.sprite, now = this.time.now;
    const recent = (arr) => arr.filter((e) => now - e.t < 3000).reduce((s, e) => s + e.v, 0);
    const toBot = new V(b.x - h.x, b.y - h.y).normalize();
    const pick = (p) => p && { distMe: Phaser.Math.Distance.BetweenPoints(p, b), distEnemy: Phaser.Math.Distance.BetweenPoints(p, h) };
    const cover = this.findCover(new V(b.x, b.y), h);
    return {
      myHp: this.bot.hp, enemyHp: this.human.hp,
      myRapid: now < this.bot.rapidUntil, enemyRapid: now < this.human.rapidUntil,
      myDash: now >= this.bot.dashReadyAt,
      dist: Phaser.Math.Distance.BetweenPoints(b, h), los: this.los(b, h),
      approaching: h.body.velocity.dot(toBot) > 60,
      coverDist: cover ? cover.distance(b) : 999,
      health: pick(this.pickups.health), power: pick(this.pickups.power),
      taken: recent(this.log.taken), dealt: recent(this.log.dealt),
      myScore: this.score.bot, enemyScore: this.score.human,
    };
  }

  think() {
    const br = this.brain, now = this.time.now;
    if (!br.ready || br.thinking || this.roundOver || now - br.last < DECISION_GAP) return;
    br.thinking = true;
    const gen = this.gen;
    decide(this.snapshot(), br.offline).then((d) => {
      if (gen !== this.gen) return;
      br.thinking = false; br.last = this.time.now; br.count++;
      br.tactic = d.tactic; br.aggression = Phaser.Math.Clamp(d.aggression, 0, 1);
      this.showBrain(d);
    });
  }

  updateBot() {
    const bot = this.bot, b = bot.sprite, h = this.human.sprite, now = this.time.now;
    const me = new V(b.x, b.y), enemy = new V(h.x, h.y);
    const toEnemy = enemy.clone().subtract(me), dist = toEnemy.length();
    const dirTo = (p) => (p ? new V(p.x - b.x, p.y - b.y) : null);
    let dir;
    switch (this.brain.tactic) {
      case 'attack': {
        const want = 200 - 60 * this.brain.aggression;
        dir = toEnemy.clone().normalize().scale(dist > want ? 1 : -0.6);
        dir.add(new V(-toEnemy.y, toEnemy.x).normalize().scale(Math.sin(now / 400) * 0.6));
        break;
      }
      case 'flank_left': case 'flank_right': {
        const s = this.brain.tactic === 'flank_left' ? 1 : -1;
        dir = new V(-toEnemy.y * s, toEnemy.x * s).normalize().add(toEnemy.clone().normalize().scale((dist - 260) / 200));
        break;
      }
      case 'retreat': dir = toEnemy.clone().negate(); break;
      case 'take_cover': {
        if (!this.brain.cover || now - this.brain.coverAt > 800) { this.brain.cover = this.findCover(me, enemy); this.brain.coverAt = now; }
        dir = dirTo(this.brain.cover) ?? toEnemy.clone().negate();
        if (this.brain.cover && this.brain.cover.distance(me) < 8) dir.set(0, 0);
        break;
      }
      case 'grab_health': dir = dirTo(this.pickups.health) ?? toEnemy.clone(); break;
      case 'grab_power': dir = dirTo(this.pickups.power) ?? toEnemy.clone(); break;
      default: dir = toEnemy.clone();
    }
    // omijanie przeszkód: jeśli utknął, przez chwilę jedź prostopadle
    const bl = b.body.blocked;
    if ((bl.left || bl.right || bl.up || bl.down) && now > (bot.detourUntil || 0)) {
      bot.detourUntil = now + 380; bot.detour = new V(-dir.y, dir.x).scale(Math.random() < 0.5 ? 1 : -1);
    }
    if (now < (bot.detourUntil || 0)) dir = bot.detour.clone();

    // unik: reakcja na nadlatujący pocisk
    this.bullets.getChildren().forEach((bl2) => {
      if (bl2.owner !== this.human || bl2.dodgeChecked) return;
      const rel = new V(b.x - bl2.x, b.y - bl2.y);
      if (rel.length() < 140 && rel.dot(bl2.body.velocity) > 0) {
        bl2.dodgeChecked = true;
        if (Math.random() < 0.45 - 0.2 * this.brain.aggression) this.dash(bot, new V(-bl2.body.velocity.y, bl2.body.velocity.x).scale(Math.random() < 0.5 ? 1 : -1));
      }
    });

    this.move(bot, dir, 215);

    const seeEnemy = this.los(b, h);
    if (seeEnemy && !this.human.dead) {
      const t = dist / BULLET_SPEED;
      const aimX = h.x + h.body.velocity.x * t * 0.8, aimY = h.y + h.body.velocity.y * t * 0.8;
      const spread = 0.06 + 0.14 * this.brain.aggression;
      b.rotation = Phaser.Math.Angle.RotateTo(b.rotation, Phaser.Math.Angle.Between(b.x, b.y, aimX, aimY), 0.25);
      if (dist < 360 + 260 * this.brain.aggression) this.fire(bot, b.rotation + Phaser.Math.FloatBetween(-spread, spread));
    } else if (b.body.velocity.lengthSq() > 10) {
      b.rotation = Phaser.Math.Angle.RotateTo(b.rotation, b.body.velocity.angle(), 0.2);
    }
  }

  update() {
    const now = this.time.now;
    this.bullets.getChildren().slice().forEach((bl) => {
      if (now - bl.born > 1400 || bl.x < -10 || bl.y < -10 || bl.x > W + 10 || bl.y > H + 10) bl.destroy();
    });
    for (const s of [this.human, this.bot]) {
      s.bar.width = 2 * Math.max(0, s.hp);
      s.label.setPosition(s.sprite.x, s.sprite.y - 34).setVisible(!s.dead);
      s.sprite.setAlpha(now < s.rapidUntil ? 0.75 + 0.25 * Math.sin(now / 60) : 1);
    }
    this.human.label.setText(now < this.human.rapidUntil ? 'RAPID' : 'TY');
    this.bot.label.setText(TACTICS[this.brain.tactic].pl + (this.brain.thinking ? ' …' : ''));
    this.scoreText.setText(`${this.score.human}  :  ${this.score.bot}`);
    if (this.roundOver) { this.human.sprite.setVelocity(0); this.bot.sprite.setVelocity(0); return; }
    this.updateHuman();
    this.updateBot();
    this.think();
  }
}

new Phaser.Game({
  type: Phaser.AUTO, parent: 'game', width: W + PANEL, height: H, backgroundColor: C.bg,
  physics: { default: 'arcade', arcade: { debug: false } },
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  scene: ArenaScene,
});
