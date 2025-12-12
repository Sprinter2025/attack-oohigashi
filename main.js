// main.js (FULL COPY-PASTE)  --- Mobile lightweight ver (particle sprite) ---
// - iOS Safari bottom bar safe: use visualViewport for sizing
// - Tap hitbox bigger on mobile
// - Performance: cap DPR to 2, reduce particles/floaters, thinner strokes on mobile
// - Particles: sprite + pool (no GC burst)
// - Floaters: pool (no GC burst)
// - Input: queue taps, process max 1 per frame
// - DOM: score update once per frame
// - Background: pale gray
// - Sounds: audio pool + throttle

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

const elScore = document.getElementById("score");
const elTime = document.getElementById("time");
const elBest = document.getElementById("best");
const overlay = document.getElementById("overlay");
const titleEl = document.getElementById("title");
const resultEl = document.getElementById("result");
const btn = document.getElementById("btn");

const BEST_KEY = "facebop_best_v4";

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function rand(a, b) { return a + Math.random() * (b - a); }

// ---- Mobile detect & viewport size ----
const IS_MOBILE = matchMedia("(pointer: coarse)").matches;

function getViewportSize() {
  const vv = window.visualViewport;
  const w = vv ? vv.width : window.innerWidth;
  const h = vv ? vv.height : window.innerHeight;
  return { w, h };
}

function fitCanvas() {
  const { w, h } = getViewportSize();
  const dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1)); // cap
  canvas.style.width = w + "px";
  canvas.style.height = h + "px";
  canvas.width = Math.floor(w * dpr);
  canvas.height = Math.floor(h * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener("resize", fitCanvas);
window.visualViewport?.addEventListener("resize", fitCanvas);
fitCanvas();

// ---- particle sprite (fast) ----
let dotSprite = null;
function makeDotSprite() {
  const c = document.createElement("canvas");
  c.width = 32;
  c.height = 32;
  const g = c.getContext("2d");

  const cx = 16, cy = 16;
  const grad = g.createRadialGradient(cx, cy, 0, cx, cy, 16);
  grad.addColorStop(0.0, "rgba(255,255,255,1.0)");
  grad.addColorStop(0.5, "rgba(255,255,255,0.65)");
  grad.addColorStop(1.0, "rgba(255,255,255,0.0)");

  g.fillStyle = grad;
  g.beginPath();
  g.arc(cx, cy, 16, 0, Math.PI * 2);
  g.fill();

  dotSprite = c;
}
makeDotSprite();

const assets = {
  face: new Image(),
  faceHit: new Image(),
  hit01: null,
  hit02: null,
  count: null,
  bgm: null,
};

assets.face.src = "./assets/face.png";
assets.faceHit.src = "./assets/face_hit.png"; // 無ければ face.png をコピーでOK

function safeAudio(src, loop = false, volume = 0.6) {
  const a = new Audio(src);
  a.loop = loop;
  a.volume = volume;
  a.preload = "auto";
  return a;
}

// ---- audio pool (rapid taps friendly) ----
function makeAudioPool(src, size = 6, volume = 0.7) {
  const list = [];
  for (let i = 0; i < size; i++) {
    const a = new Audio(src);
    a.loop = false;
    a.volume = volume;
    a.preload = "auto";
    list.push(a);
  }
  return { list, i: 0 };
}

function initAudio() {
  if (!assets.bgm) assets.bgm = safeAudio("./assets/bgm.mp3", true, 0.18);
  if (!assets.hit01) assets.hit01 = makeAudioPool("./assets/hit01.mp3", IS_MOBILE ? 4 : 8, 0.75);
  if (!assets.hit02) assets.hit02 = makeAudioPool("./assets/hit02.mp3", IS_MOBILE ? 3 : 6, 0.85);
  if (!assets.count) assets.count = makeAudioPool("./assets/count.mp3", 2, 0.75);
}

let lastSeTime = 0;
function playPool(pool) {
  if (!pool) return;
  const now = performance.now();
  if (IS_MOBILE && now - lastSeTime < 80) return;
  lastSeTime = now;

  const a = pool.list[pool.i];
  pool.i = (pool.i + 1) % pool.list.length;

  try { a.pause(); } catch {}
  try { a.currentTime = 0; } catch {}
  a.play().catch(() => {});
}

function playHitNormal() { playPool(assets.hit01); }
function playHitBonus()  { playPool(assets.hit02); }
function playCount()     { playPool(assets.count); }

function startBGM() {
  if (!assets.bgm) return;
  assets.bgm.play().catch(() => {});
}

let best = Number(localStorage.getItem(BEST_KEY) || 0);
elBest.textContent = best.toString();

// ★ここが要望
const INTRO_FIRST_SECONDS = 7.0;
const INTRO_RETRY_SECONDS = 3.0;
const GO_HOLD_SECONDS = 1.0;
const GAME_SECONDS = 30.0;

// 速度の上限（暴走防止）
function speedLimit() {
  const { w, h } = getViewportSize();
  const s = Math.min(w, h);
  return clamp(s * 0.85, 520, 900);
}

const state = {
  running: false,
  lastT: 0,

  phase: "intro",
  introLeft: INTRO_FIRST_SECONDS,
  introTotal: INTRO_FIRST_SECONDS,

  countPlayed: false,
  goHold: 0,

  score: 0,
  timeLeft: GAME_SECONDS,

  // pooled
  particles: [],
  floaters: [],

  shake: 0,

  combo: 0,
  comboTimer: 0,
  comboWindow: 1.0,
  fever: false,
  feverTimer: 0,
  scoreMul: 1,

  face: {
    x: 120,
    y: 220,
    r: 64,
    vx: 0,
    vy: 0,
    baseVx: 0,
    baseVy: 0,
    hitTimer: 0,
    scalePop: 0,
  }
};

let hasStartedOnce = false;

// ---- DOM update throttle (score) ----
let scoreDirty = true;
function markScoreDirty() { scoreDirty = true; }

// ---- rapid hit detector (for effect throttle) ----
let lastHitPerf = 0;
function isRapidHit() {
  const now = performance.now();
  const rapid = (now - lastHitPerf) < 70;
  lastHitPerf = now;
  return rapid;
}

// ============================
// Input queue: pointerdown only enqueues
// ============================
const tapQ = {
  x: new Float32Array(32),
  y: new Float32Array(32),
  head: 0,
  tail: 0,
  mask: 31,
  push(px, py) {
    const next = (this.tail + 1) & this.mask;
    if (next === this.head) return; // full: drop
    this.x[this.tail] = px;
    this.y[this.tail] = py;
    this.tail = next;
  },
  pop() {
    if (this.head === this.tail) return null;
    const px = this.x[this.head];
    const py = this.y[this.head];
    this.head = (this.head + 1) & this.mask;
    return { x: px, y: py };
  },
  clear() { this.head = this.tail = 0; }
};

function getPointerPos(e) {
  const rect = canvas.getBoundingClientRect();
  const x = (e.clientX - rect.left);
  const y = (e.clientY - rect.top);
  return { x, y };
}

canvas.addEventListener("pointerdown", (e) => {
  if (!state.running) return;
  if (state.phase !== "play") return;
  const { x, y } = getPointerPos(e);
  tapQ.push(x, y);
});

// ============================
// Pools (no GC burst on rapid taps)
// ============================
const MAX_PARTICLES = IS_MOBILE ? 64 : 220;
const MAX_FLOATERS  = IS_MOBILE ? 18 : 40;

function initPools() {
  state.particles.length = 0;
  for (let i = 0; i < MAX_PARTICLES; i++) {
    state.particles.push({ alive: false, x:0, y:0, vx:0, vy:0, life:0, t:0 });
  }
  state.floaters.length = 0;
  for (let i = 0; i < MAX_FLOATERS; i++) {
    state.floaters.push({
      alive: false,
      text: "",
      x0: 0, y0: 0,
      t: 0, life: 0,
      rise: 0, wobble: 0,
      size: 0, weight: 0
    });
  }
}

function allocParticle() {
  for (let i = 0; i < state.particles.length; i++) {
    const p = state.particles[i];
    if (!p.alive) return p;
  }
  return null;
}
function allocFloater() {
  for (let i = 0; i < state.floaters.length; i++) {
    const f = state.floaters[i];
    if (!f.alive) return f;
  }
  return null;
}

function addFloater(text, x, y, opts = {}) {
  const {
    size = 26,
    life = IS_MOBILE ? 0.55 : 0.7,
    rise = IS_MOBILE ? 110 : 140,
    wobble = IS_MOBILE ? 8 : 10,
    weight = 1000,
  } = opts;

  const ft = allocFloater();
  if (!ft) return;

  ft.alive = true;
  ft.text = text;
  ft.x0 = x;
  ft.y0 = y;
  ft.t = 0;
  ft.life = life;
  ft.rise = rise;
  ft.wobble = wobble;
  ft.size = size;
  ft.weight = weight;
}

function spawnParticles(x, y, n = 18, rapid = false) {
  const nn = IS_MOBILE ? Math.max(3, Math.floor(n * 0.35)) : n;
  const outN = rapid ? Math.min(6, nn) : nn;

  for (let i = 0; i < outN; i++) {
    const p = allocParticle();
    if (!p) break;

    const a = rand(0, Math.PI * 2);
    const sp = rapid ? rand(120, 360) : rand(140, 620);

    p.alive = true;
    p.x = x; p.y = y;
    p.vx = Math.cos(a) * sp;
    p.vy = Math.sin(a) * sp;
    p.life = rapid ? rand(0.14, 0.26) : rand(0.18, 0.42);
    p.t = 0;
  }
}

function pointInFace(px, py) {
  const dx = px - state.face.x;
  const dy = py - state.face.y;
  const pad = IS_MOBILE ? 1.40 : 1.15;
  const rr = (state.face.r * pad);
  return (dx * dx + dy * dy) <= (rr * rr);
}

function startFever(seconds = 7.0) {
  state.fever = true;
  state.feverTimer = seconds;
  state.scoreMul = 2;

  playHitBonus();

  addFloater("FEVER x2!!", state.face.x, state.face.y - state.face.r - 12, {
    size: IS_MOBILE ? 34 : 40,
    life: 1.0,
    rise: IS_MOBILE ? 70 : 90,
    wobble: 20,
    weight: 1200
  });

  state.shake = Math.max(state.shake, IS_MOBILE ? 0.22 : 0.28);
}

function stopFever() {
  state.fever = false;
  state.feverTimer = 0;
  state.scoreMul = 1;
}

function resetGameForIntro(introSeconds) {
  state.phase = "intro";
  state.introTotal = introSeconds;
  state.introLeft = introSeconds;

  state.countPlayed = false;
  state.goHold = 0;

  state.score = 0;
  state.timeLeft = GAME_SECONDS;

  initPools();
  tapQ.clear();

  state.shake = 0;
  state.combo = 0;
  state.comboTimer = 0;
  stopFever();

  const { w, h } = getViewportSize();
  state.face.r = Math.min(w, h) * 0.10;
  state.face.x = rand(state.face.r, w - state.face.r);
  state.face.y = rand(state.face.r + 90, h - state.face.r);

  const baseVx = rand(220, 340) * (Math.random() < 0.5 ? -1 : 1);
  const baseVy = rand(180, 300) * (Math.random() < 0.5 ? -1 : 1);
  state.face.baseVx = baseVx;
  state.face.baseVy = baseVy;

  state.face.vx = 0;
  state.face.vy = 0;

  state.face.hitTimer = 0;
  state.face.scalePop = 0;

  elScore.textContent = "0";
  elTime.textContent = GAME_SECONDS.toFixed(1);
  scoreDirty = false;
}

function endGame() {
  state.running = false;
  overlay.classList.remove("hidden");

  if (state.score > best) {
    best = state.score;
    localStorage.setItem(BEST_KEY, String(best));
    elBest.textContent = String(best);
    titleEl.textContent = "NEW BEST!";
  } else {
    titleEl.textContent = "RESULT";
  }
  resultEl.textContent = `Score: ${state.score} / Best: ${best}`;
  btn.textContent = "RETRY";
}

function startGame() {
  initAudio();
  startBGM();

  const introSeconds = hasStartedOnce ? INTRO_RETRY_SECONDS : INTRO_FIRST_SECONDS;
  resetGameForIntro(introSeconds);

  state.running = true;
  overlay.classList.add("hidden");
  state.lastT = performance.now();

  addFloater("GET READY...", state.face.x, state.face.y - state.face.r - 10, {
    size: IS_MOBILE ? 30 : 34,
    life: 1.0,
    rise: 50,
    wobble: 8,
    weight: 1200
  });

  hasStartedOnce = true;
  requestAnimationFrame(loop);
}

btn.addEventListener("click", startGame);

// ============================
// Tap processing (max 1 per frame)
// ============================
function processOneTap() {
  const tap = tapQ.pop();
  if (!tap) return;

  const { x, y } = tap;

  if (pointInFace(x, y)) {
    const rapid = isRapidHit();

    // combo
    if (state.comboTimer > 0) state.combo += 1;
    else state.combo = 1;
    state.comboTimer = state.comboWindow;

    // score
    const add = 1 * state.scoreMul;
    state.score += add;
    markScoreDirty();

    // floaters: strong throttle on rapid
    if (!rapid) {
      addFloater(`+${add}`, state.face.x, state.face.y - state.face.r * 0.15, {
        size: IS_MOBILE ? 26 : 30, life: 0.65, rise: 130, wobble: 10, weight: 1200
      });
    } else if ((state.combo % 3) === 0) { // rapid: 3回に1回だけ
      addFloater(`+${add}`, state.face.x, state.face.y - state.face.r * 0.10, {
        size: IS_MOBILE ? 22 : 26, life: 0.40, rise: 70, wobble: 6, weight: 1100
      });
    }

    // desktop only extra text (and not rapid)
    if (!IS_MOBILE && !rapid) {
      const words = ["SPLASH!!", "BOON!!", "ﾍﾞﾁｬ!!"];
      const w = words[(Math.random() * words.length) | 0];
      addFloater(w, state.face.x, state.face.y - state.face.r - 10, {
        size: 38, life: 0.80, rise: 120, wobble: 18, weight: 1200
      });
    }

    if (state.combo >= 3 && !IS_MOBILE && !rapid) {
      addFloater(`${state.combo} COMBO!!`, state.face.x, state.face.y + state.face.r + 8, {
        size: 30 + Math.min(20, state.combo * 2),
        life: 0.60, rise: 70, wobble: 12, weight: 1200
      });
    }

    // sound
    playHitNormal();

    // 5 combo bonus
    if (state.combo === 5) {
      const bonus = 10 * state.scoreMul;
      state.score += bonus;
      markScoreDirty();

      if (!rapid) {
        addFloater(`+${bonus} BONUS!!`, state.face.x, state.face.y, {
          size: IS_MOBILE ? 36 : 44, life: 1.00, rise: 160, wobble: 22, weight: 1300
        });
      }
      playHitBonus();
      state.shake = Math.max(state.shake, IS_MOBILE ? 0.28 : 0.35);
    }

    // 10 combo fever
    if (state.combo === 10 && !state.fever) {
      startFever(3.0);
    }

    state.face.hitTimer = 0.18;
    state.face.scalePop = 0.20;

    state.shake = Math.max(
      state.shake,
      (state.fever ? (IS_MOBILE ? 0.18 : 0.22) : (IS_MOBILE ? 0.15 : 0.18)) + Math.min(0.22, state.combo * 0.012)
    );

    // particles (rapid: fewer)
    spawnParticles(state.face.x, state.face.y, 26, rapid);

    // speed growth: lower on rapid
    const mult = rapid ? rand(0.995, 1.02) : rand(0.97, 1.05);
    state.face.vx *= mult;
    state.face.vy *= mult;

    const vmax = speedLimit();
    state.face.vx = clamp(state.face.vx, -vmax, vmax);
    state.face.vy = clamp(state.face.vy, -vmax, vmax);

  } else {
    state.comboTimer = 0;
    state.combo = 0;
    state.timeLeft = Math.max(0, state.timeLeft - 0.25);
  }
}

function update(dt) {
  // intro
  if (state.phase === "intro") {
    if (state.goHold > 0) {
      state.goHold = Math.max(0, state.goHold - dt);
      elTime.textContent = GAME_SECONDS.toFixed(1);

      // update floaters
      for (const ft of state.floaters) {
        if (!ft.alive) continue;
        ft.t += dt;
        if (ft.t >= ft.life) ft.alive = false;
      }

      // update particles
      for (const p of state.particles) {
        if (!p.alive) continue;
        p.t += dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vx *= Math.pow(0.06, dt);
        p.vy *= Math.pow(0.06, dt);
        if (p.t >= p.life) p.alive = false;
      }

      if (state.goHold <= 0) {
        state.phase = "play";
        state.timeLeft = GAME_SECONDS;
        elTime.textContent = state.timeLeft.toFixed(1);

        state.face.vx = state.face.baseVx;
        state.face.vy = state.face.baseVy;
      }
      return;
    }

    state.introLeft = Math.max(0, state.introLeft - dt);
    elTime.textContent = GAME_SECONDS.toFixed(1);

    if (!state.countPlayed && state.introLeft <= 3.0) {
      playCount();
      state.countPlayed = true;
    }

    for (const ft of state.floaters) {
      if (!ft.alive) continue;
      ft.t += dt;
      if (ft.t >= ft.life) ft.alive = false;
    }

    for (const p of state.particles) {
      if (!p.alive) continue;
      p.t += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= Math.pow(0.06, dt);
      p.vy *= Math.pow(0.06, dt);
      if (p.t >= p.life) p.alive = false;
    }

    if (state.introLeft <= 0) {
      state.goHold = GO_HOLD_SECONDS;
      elTime.textContent = GAME_SECONDS.toFixed(1);

      addFloater("GO!!", state.face.x, state.face.y - state.face.r - 10, {
        size: IS_MOBILE ? 46 : 52, life: GO_HOLD_SECONDS, rise: 140, wobble: 16, weight: 1300
      });

      state.shake = Math.max(state.shake, IS_MOBILE ? 0.18 : 0.22);
    }
    return;
  }

  // play
  state.timeLeft -= dt;
  if (state.timeLeft <= 0) {
    state.timeLeft = 0;
    elTime.textContent = "0.0";
    endGame();
    return;
  }
  elTime.textContent = state.timeLeft.toFixed(1);

  // process at most 1 tap per frame
  processOneTap();

  const f = state.face;
  f.x += f.vx * dt;
  f.y += f.vy * dt;

  const { w, h } = getViewportSize();
  const topMargin = 56;
  if (f.x - f.r < 0) { f.x = f.r; f.vx *= -1; }
  if (f.x + f.r > w) { f.x = w - f.r; f.vx *= -1; }
  if (f.y - f.r < topMargin) { f.y = topMargin + f.r; f.vy *= -1; }
  if (f.y + f.r > h) { f.y = h - f.r; f.vy *= -1; }

  f.hitTimer = Math.max(0, f.hitTimer - dt);
  f.scalePop = Math.max(0, f.scalePop - dt);
  state.shake = Math.max(0, state.shake - dt);

  for (const p of state.particles) {
    if (!p.alive) continue;
    p.t += dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vx *= Math.pow(0.06, dt);
    p.vy *= Math.pow(0.06, dt);
    if (p.t >= p.life) p.alive = false;
  }

  for (const ft of state.floaters) {
    if (!ft.alive) continue;
    ft.t += dt;
    if (ft.t >= ft.life) ft.alive = false;
  }

  if (state.comboTimer > 0) {
    state.comboTimer = Math.max(0, state.comboTimer - dt);
    if (state.comboTimer === 0) state.combo = 0;
  }

  if (state.fever) {
    state.feverTimer -= dt;
    if (state.feverTimer <= 0) stopFever();
  }
}

function drawIntroCountdown() {
  const { w, h } = getViewportSize();
  const left = state.introLeft;

  const waiting = (left > 5.0);
  const n = Math.max(0, Math.min(5, Math.ceil(left)));
  const isGo = (left <= 0.0);

  const p = (state.introTotal > 0) ? (left / state.introTotal) : 0;
  const pulse = 1 + 0.08 * Math.sin((1 - p) * Math.PI * 6);

  ctx.save();
  ctx.globalAlpha = 0.95;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  ctx.font = `900 24px system-ui, sans-serif`;
  if (!IS_MOBILE) {
    ctx.lineWidth = 8;
    ctx.strokeStyle = "rgba(0,0,0,0.18)";
    ctx.strokeText("GET READY", w / 2, h / 2 - 110);
  }
  ctx.fillStyle = "rgba(30,30,30,0.90)";
  ctx.fillText("GET READY", w / 2, h / 2 - 110);

  if (waiting) { ctx.restore(); return; }

  const text = isGo ? "GO!" : String(n);

  ctx.font = `${Math.floor((IS_MOBILE ? 100 : 120) * pulse)}px system-ui, sans-serif`;
  if (!IS_MOBILE) {
    ctx.lineWidth = 14;
    ctx.strokeStyle = "rgba(0,0,0,0.18)";
    ctx.strokeText(text, w / 2, h / 2);
  }
  ctx.fillStyle = "rgba(30,30,30,0.90)";
  ctx.fillText(text, w / 2, h / 2);

  ctx.restore();
}

function draw() {
  const { w, h } = getViewportSize();

  let ox = 0, oy = 0;
  if (state.shake > 0) {
    const base = state.fever ? 14 : 10;
    const s = state.shake * base;
    ox = rand(-s, s);
    oy = rand(-s, s);
  }

  ctx.save();
  ctx.translate(ox, oy);

  ctx.clearRect(-20, -20, w + 40, h + 40);

  // ---- Background (pale gray) ----
  ctx.fillStyle = "#e9edf2";
  ctx.fillRect(0, 0, w, h);

  // ---- particles: sprite draw ----
  if (dotSprite) {
    for (const p of state.particles) {
      if (!p.alive) continue;
      const a = 1 - (p.t / p.life);
      ctx.globalAlpha = a;

      const r = (IS_MOBILE ? 7 : 9) * a + 2;
      ctx.drawImage(dotSprite, p.x - r, p.y - r, r * 2, r * 2);
    }
    ctx.globalAlpha = 1;
  }

  // ---- floaters (mobile: no stroke) ----
  for (const ft of state.floaters) {
    if (!ft.alive) continue;

    const p = ft.t / ft.life;
    const ease = 1 - Math.pow(1 - p, 3);
    const yy = ft.y0 - ft.rise * ease;
    const xx = ft.x0 + Math.sin(p * Math.PI * 2) * ft.wobble;
    const alpha = 1 - p;

    ctx.globalAlpha = alpha;
    ctx.font = `${ft.weight} ${ft.size}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    if (!IS_MOBILE) {
      ctx.lineWidth = 8;
      ctx.strokeStyle = "rgba(0,0,0,0.18)";
      ctx.strokeText(ft.text, xx, yy);
    }

    ctx.fillStyle = "rgba(30,30,30,0.90)";
    ctx.fillText(ft.text, xx, yy);
  }
  ctx.globalAlpha = 1;

  const f = state.face;
  const img = (f.hitTimer > 0 ? assets.faceHit : assets.face);

  const pop = (f.scalePop > 0) ? (1 + 0.18 * (f.scalePop / 0.20)) : 1;
  const size = (f.r * 2) * pop;

  // shadow
  ctx.globalAlpha = 0.12;
  ctx.beginPath();
  ctx.ellipse(f.x, f.y + f.r * 0.78, f.r * 0.95, f.r * 0.35, 0, 0, Math.PI * 2);
  ctx.fillStyle = "#000000";
  ctx.fill();
  ctx.globalAlpha = 1;

  // face
  ctx.save();
  ctx.beginPath();
  ctx.arc(f.x, f.y, (f.r * pop), 0, Math.PI * 2);
  ctx.clip();
  ctx.drawImage(img, f.x - size / 2, f.y - size / 2, size, size);
  ctx.restore();

  ctx.lineWidth = 4;
  ctx.strokeStyle = "rgba(0,0,0,0.10)";
  ctx.beginPath();
  ctx.arc(f.x, f.y, (f.r * pop), 0, Math.PI * 2);
  ctx.stroke();

  if (state.phase === "intro") {
    drawIntroCountdown();
  }

  ctx.restore();

  // HUD
  ctx.save();
  ctx.globalAlpha = 0.95;
  ctx.textAlign = "right";
  ctx.textBaseline = "top";

  const pad = 14;
  const hudX = w - pad;
  const hudY = 60;
  const lineH = 28;

  const comboFont = `900 20px system-ui, sans-serif`;
  const feverFont = `900 22px system-ui, sans-serif`;

  function drawHudText(text, x, y, font) {
    ctx.font = font;
    if (!IS_MOBILE) {
      ctx.lineWidth = 6;
      ctx.strokeStyle = "rgba(0,0,0,0.18)";
      ctx.strokeText(text, x, y);
    }
    ctx.fillStyle = "rgba(30,30,30,0.90)";
    ctx.fillText(text, x, y);
  }

  if (state.phase === "play") {
    if (state.combo >= 2) drawHudText(`COMBO: ${state.combo}`, hudX, hudY, comboFont);
    if (state.fever) {
      const t = Math.max(0, state.feverTimer).toFixed(1);
      drawHudText(`FEVER x2  ${t}s`, hudX, hudY + lineH, feverFont);
    }
  }

  ctx.restore();

  // DOM update once per frame
  if (scoreDirty) {
    elScore.textContent = String(state.score);
    scoreDirty = false;
  }
}

function loop(t) {
  if (!state.running) return;
  const dt = clamp((t - state.lastT) / 1000, 0, 0.033);
  state.lastT = t;

  update(dt);
  if (state.running) {
    draw();
    requestAnimationFrame(loop);
  }
}

// initial overlay
overlay.classList.remove("hidden");
titleEl.textContent = "Atack Oohigashi!!";
resultEl.textContent = "STARTを押してね";
btn.textContent = "START";
