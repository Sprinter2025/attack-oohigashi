// main.js (FULL COPY-PASTE)
// - First start: 7s intro freeze
// - Retry: 3s intro freeze
// - Big center countdown on screen during intro
// - Sounds:
//   - Normal hit:  hit01.mp3
//   - Bonus hit:   hit02.mp3 (5 combo bonus, fever start)
//   - Countdown:   count.mp3 (play once when introLeft <= 3.0)

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

function fitCanvas() {
  const dpr = Math.max(1, Math.floor(window.devicePixelRatio || 1));
  const w = Math.floor(window.innerWidth * dpr);
  const h = Math.floor(window.innerHeight * dpr);
  canvas.width = w;
  canvas.height = h;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.scale(dpr, dpr);
}
window.addEventListener("resize", fitCanvas);
fitCanvas();

const assets = {
  face: new Image(),
  faceHit: new Image(),
  hit01: null,   // normal hit
  hit02: null,   // bonus hit
  count: null,   // countdown (3..2..1..GO in one file)
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

function initAudio() {
  // BGM: ちょい控えめ（好みで調整OK）
  if (!assets.bgm) assets.bgm = safeAudio("./assets/bgm.mp3", true, 0.18);

  // SE
  if (!assets.hit01) assets.hit01 = safeAudio("./assets/hit01.mp3", false, 0.75);
  if (!assets.hit02) assets.hit02 = safeAudio("./assets/hit02.mp3", false, 0.85);

  // Countdown
  if (!assets.count) assets.count = safeAudio("./assets/count.mp3", false, 0.75);
}

function playAudio(a) {
  if (!a) return;
  a.currentTime = 0;
  a.play().catch(() => {});
}

function playHitNormal() { playAudio(assets.hit01); }
function playHitBonus()  { playAudio(assets.hit02); }
function playCount()     { playAudio(assets.count); }

function startBGM() {
  if (!assets.bgm) return;
  assets.bgm.play().catch(() => {});
}

let best = Number(localStorage.getItem(BEST_KEY) || 0);
elBest.textContent = best.toString();

// ★ここが要望
const INTRO_FIRST_SECONDS = 7.0;
const INTRO_RETRY_SECONDS = 3.0;

// ★GOを見せる余韻（この秒数だけ待ってから play に遷移）
const GO_HOLD_SECONDS = 1.0;

const GAME_SECONDS = 30.0;

// 速度の上限（暴走防止）
function speedLimit() {
  const s = Math.min(window.innerWidth, window.innerHeight);
  return clamp(s * 0.85, 520, 900); // px/s
}

const state = {
  running: false,
  lastT: 0,

  // phase: "intro" -> "play"
  phase: "intro",
  introLeft: INTRO_FIRST_SECONDS,
  introTotal: INTRO_FIRST_SECONDS,

  // ★カウントダウン音を一度だけ鳴らす用
  countPlayed: false,

  // ★GO表示の余韻（>0 の間は intro のまま固定表示）
  goHold: 0,

  score: 0,
  timeLeft: GAME_SECONDS,

  particles: [],
  floaters: [],

  shake: 0,

  combo: 0,
  comboTimer: 0,
  comboWindow: 1.0, // 1秒以内でコンボ継続
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

let hasStartedOnce = false; // ★初回/リトライ判定

function addFloater(text, x, y, opts = {}) {
  const {
    size = 26,
    life = 0.7,
    rise = 140,
    wobble = 10,
    weight = 1000,
  } = opts;

  state.floaters.push({
    text,
    x0: x,
    y0: y,
    t: 0,
    life,
    rise,
    wobble,
    size,
    weight,
  });
}

function startFever(seconds = 7.0) {
  state.fever = true;
  state.feverTimer = seconds;
  state.scoreMul = 2;

  // ★FEVER開始はボーナス扱いで hit02 を鳴らす
  playHitBonus();

  addFloater("FEVER x2!!", state.face.x, state.face.y - state.face.r - 12, {
    size: 40,
    life: 1.0,
    rise: 90,
    wobble: 20,
    weight: 1200
  });

  state.shake = Math.max(state.shake, 0.28);
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

  // ★リセット時に「count再生済み」を戻す
  state.countPlayed = false;

  // ★GO余韻もリセット
  state.goHold = 0;

  state.score = 0;
  state.timeLeft = GAME_SECONDS;

  state.particles = [];
  state.floaters = [];
  state.shake = 0;

  state.combo = 0;
  state.comboTimer = 0;
  stopFever();

  const w = window.innerWidth;
  const h = window.innerHeight;

  state.face.r = Math.min(w, h) * 0.10;
  state.face.x = rand(state.face.r, w - state.face.r);
  state.face.y = rand(state.face.r + 90, h - state.face.r);

  // intro後に動き出す速度
  const baseVx = rand(220, 340) * (Math.random() < 0.5 ? -1 : 1);
  const baseVy = rand(180, 300) * (Math.random() < 0.5 ? -1 : 1);
  state.face.baseVx = baseVx;
  state.face.baseVy = baseVy;

  // intro中は不動
  state.face.vx = 0;
  state.face.vy = 0;

  state.face.hitTimer = 0;
  state.face.scalePop = 0;

  elScore.textContent = "0";
  elTime.textContent = GAME_SECONDS.toFixed(1);

}

function spawnParticles(x, y, n = 18) {
  for (let i = 0; i < n; i++) {
    const a = rand(0, Math.PI * 2);
    const sp = rand(140, 620);
    state.particles.push({
      x, y,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp,
      life: rand(0.22, 0.55),
      t: 0
    });
  }
}

function pointInFace(px, py) {
  const dx = px - state.face.x;
  const dy = py - state.face.y;
  return (dx * dx + dy * dy) <= (state.face.r * state.face.r);
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
    size: 34, life: 1.0, rise: 50, wobble: 8, weight: 1200
  });

  hasStartedOnce = true;
  requestAnimationFrame(loop);
}

btn.addEventListener("click", startGame);

function getPointerPos(e) {
  const rect = canvas.getBoundingClientRect();
  const x = (e.clientX - rect.left);
  const y = (e.clientY - rect.top);
  return { x, y };
}

canvas.addEventListener("pointerdown", (e) => {
  if (!state.running) return;
  if (state.phase !== "play") return; // intro中は無効

  const { x, y } = getPointerPos(e);

  if (pointInFace(x, y)) {
    // combo
    if (state.comboTimer > 0) state.combo += 1;
    else state.combo = 1;
    state.comboTimer = state.comboWindow;

    // score
    const add = 1 * state.scoreMul;
    state.score += add;
    elScore.textContent = String(state.score);

    addFloater(`+${add}`, state.face.x, state.face.y - state.face.r * 0.15, {
      size: 30, life: 0.65, rise: 130, wobble: 10, weight: 1200
    });

    const words = ["SPLASH!!", "BOON!!", "ﾍﾞﾁｬ!!"];
    const w = words[(Math.random() * words.length) | 0];
    addFloater(w, state.face.x, state.face.y - state.face.r - 10, {
      size: 38, life: 0.80, rise: 120, wobble: 18, weight: 1200
    });

    if (state.combo >= 3) {
      addFloater(`${state.combo} COMBO!!`, state.face.x, state.face.y + state.face.r + 8, {
        size: 30 + Math.min(20, state.combo * 2),
        life: 0.60, rise: 70, wobble: 12, weight: 1200
      });
    }

    // ★通常ヒット音（まず鳴らす）
    playHitNormal();

    // 5連続ボーナス
    if (state.combo === 5) {
      const bonus = 10 * state.scoreMul;
      state.score += bonus;
      elScore.textContent = String(state.score);

      addFloater(`+${bonus} BONUS!!`, state.face.x, state.face.y, {
        size: 44, life: 1.00, rise: 160, wobble: 22, weight: 1300
      });

      // ★ボーナスヒット音
      playHitBonus();

      state.shake = Math.max(state.shake, 0.35);
    }

    // 10連続でFEVER開始（startFever内でhit02鳴る）
    if (state.combo === 10 && !state.fever) {
      startFever(3.0);
    }

    state.face.hitTimer = 0.18;
    state.face.scalePop = 0.20;

    state.shake = Math.max(
      state.shake,
      (state.fever ? 0.22 : 0.18) + Math.min(0.22, state.combo * 0.012)
    );

    spawnParticles(state.face.x, state.face.y, 26);

    // speed growth: lower
    const mult = rand(0.97, 1.05);
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
});

function update(dt) {
  // intro phase
  if (state.phase === "intro") {

    // GO余韻中なら、GOを固定表示して待つ
    if (state.goHold > 0) {
      state.goHold = Math.max(0, state.goHold - dt);
      elTime.textContent = GAME_SECONDS.toFixed(1);

      // update floaters
      state.floaters = state.floaters.filter(ft => {
        ft.t += dt;
        return ft.t < ft.life;
      });

      // update particles
      state.particles = state.particles.filter(p => {
        p.t += dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vx *= Math.pow(0.06, dt);
        p.vy *= Math.pow(0.06, dt);
        return p.t < p.life;
      });

      // 余韻終了で play 開始
      if (state.goHold <= 0) {
        state.phase = "play";
        state.timeLeft = GAME_SECONDS;
        elTime.textContent = state.timeLeft.toFixed(1);

        state.face.vx = state.face.baseVx;
        state.face.vy = state.face.baseVy;
      }
      return;
    }

    // 通常カウントダウン
    state.introLeft = Math.max(0, state.introLeft - dt);
    elTime.textContent = GAME_SECONDS.toFixed(1); 

    // ★3秒前になったら count.mp3 を1回だけ再生
    if (!state.countPlayed && state.introLeft <= 3.0) {
      playCount();
      state.countPlayed = true;
    }

    // update floaters
    state.floaters = state.floaters.filter(ft => {
      ft.t += dt;
      return ft.t < ft.life;
    });

    // update particles
    state.particles = state.particles.filter(p => {
      p.t += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= Math.pow(0.06, dt);
      p.vy *= Math.pow(0.06, dt);
      return p.t < p.life;
    });

    // intro finished -> show GO and hold
    if (state.introLeft <= 0) {
      state.goHold = GO_HOLD_SECONDS;
      elTime.textContent = GAME_SECONDS.toFixed(1);

      // GOフローター（表示時間はGO_HOLD_SECONDSに合わせる）
      addFloater("GO!!", state.face.x, state.face.y - state.face.r - 10, {
        size: 52, life: GO_HOLD_SECONDS, rise: 140, wobble: 16, weight: 1300
      });

      state.shake = Math.max(state.shake, 0.22);
    }

    return;
  }

  // play phase
  state.timeLeft -= dt;
  if (state.timeLeft <= 0) {
    state.timeLeft = 0;
    elTime.textContent = "0.0";
    endGame();
    return;
  }
  elTime.textContent = state.timeLeft.toFixed(1);

  const f = state.face;
  f.x += f.vx * dt;
  f.y += f.vy * dt;

  const w = window.innerWidth;
  const h = window.innerHeight;

  const topMargin = 56;
  if (f.x - f.r < 0) { f.x = f.r; f.vx *= -1; }
  if (f.x + f.r > w) { f.x = w - f.r; f.vx *= -1; }
  if (f.y - f.r < topMargin) { f.y = topMargin + f.r; f.vy *= -1; }
  if (f.y + f.r > h) { f.y = h - f.r; f.vy *= -1; }

  f.hitTimer = Math.max(0, f.hitTimer - dt);
  f.scalePop = Math.max(0, f.scalePop - dt);
  state.shake = Math.max(0, state.shake - dt);

  state.particles = state.particles.filter(p => {
    p.t += dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vx *= Math.pow(0.06, dt);
    p.vy *= Math.pow(0.06, dt);
    return p.t < p.life;
  });

  state.floaters = state.floaters.filter(ft => {
    ft.t += dt;
    return ft.t < ft.life;
  });

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
  const w = window.innerWidth;
  const h = window.innerHeight;

  const left = state.introLeft;

  // ---- ここが肝：最初の2秒(7→5)は数字を表示しない ----
  const waiting = (left > 5.0);

  // 表示用カウント：5..0 にする（7秒スタート想定）
  // left=5 → 5, left=4 → 4, ... left=0 → 0
  const n = Math.max(0, Math.min(5, Math.ceil(left)));

  // GO表示：最後の1秒はGO（0の二重表示を防ぐ）
  const isGo = (left <= 0.0);

  // パルス（見た目用）
  const p = (state.introTotal > 0) ? (left / state.introTotal) : 0;
  const pulse = 1 + 0.08 * Math.sin((1 - p) * Math.PI * 6);

  ctx.save();
  ctx.globalAlpha = 0.95;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  // 上の "GET READY" は常に出す
  ctx.font = `900 24px system-ui, sans-serif`;
  ctx.lineWidth = 8;
  ctx.strokeStyle = "rgba(0,0,0,0.65)";
  ctx.strokeText("GET READY", w / 2, h / 2 - 110);
  ctx.fillStyle = "rgba(255,255,255,0.98)";
  ctx.fillText("GET READY", w / 2, h / 2 - 110);

  // 待機中(最初の2秒)は数字を描かずに終了
  if (waiting) {
    ctx.restore();
    return;
  }

  // 5..0, GO!
  const text = isGo ? "GO!" : String(n);

  ctx.font = `${Math.floor(120 * pulse)}px system-ui, sans-serif`;
  ctx.lineWidth = 14;
  ctx.strokeStyle = "rgba(0,0,0,0.65)";
  ctx.strokeText(text, w / 2, h / 2);
  ctx.fillStyle = "rgba(255,255,255,0.98)";
  ctx.fillText(text, w / 2, h / 2);

  ctx.restore();
}


function draw() {
  const w = window.innerWidth;
  const h = window.innerHeight;

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
  ctx.fillStyle = "#0b0f1a";
  ctx.fillRect(0, 0, w, h);

  for (const p of state.particles) {
    const a = 1 - (p.t / p.life);
    ctx.globalAlpha = a;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 4 + 7 * a, 0, Math.PI * 2);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  for (const ft of state.floaters) {
    const p = ft.t / ft.life;
    const ease = 1 - Math.pow(1 - p, 3);
    const yy = ft.y0 - ft.rise * ease;
    const xx = ft.x0 + Math.sin(p * Math.PI * 2) * ft.wobble;
    const alpha = 1 - p;

    ctx.globalAlpha = alpha;
    ctx.font = `${ft.weight} ${ft.size}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    ctx.lineWidth = 8;
    ctx.strokeStyle = "rgba(0,0,0,0.60)";
    ctx.strokeText(ft.text, xx, yy);

    ctx.fillStyle = "rgba(255,255,255,0.98)";
    ctx.fillText(ft.text, xx, yy);
  }
  ctx.globalAlpha = 1;

  const f = state.face;
  const img = (f.hitTimer > 0 ? assets.faceHit : assets.face);

  const pop = (f.scalePop > 0) ? (1 + 0.18 * (f.scalePop / 0.20)) : 1;
  const size = (f.r * 2) * pop;

  ctx.globalAlpha = 0.25;
  ctx.beginPath();
  ctx.ellipse(f.x, f.y + f.r * 0.78, f.r * 0.95, f.r * 0.35, 0, 0, Math.PI * 2);
  ctx.fillStyle = "#000000";
  ctx.fill();
  ctx.globalAlpha = 1;

  ctx.save();
  ctx.beginPath();
  ctx.arc(f.x, f.y, (f.r * pop), 0, Math.PI * 2);
  ctx.clip();
  ctx.drawImage(img, f.x - size / 2, f.y - size / 2, size, size);
  ctx.restore();


  ctx.lineWidth = 4;
  ctx.strokeStyle = "rgba(255,255,255,0.22)";
  ctx.beginPath();
  ctx.arc(f.x, f.y, (f.r * pop), 0, Math.PI * 2);
  ctx.stroke();

  if (state.phase === "intro") {
    drawIntroCountdown();
  }

  ctx.restore();


  ctx.save();
  ctx.globalAlpha = 0.95;
  ctx.textAlign = "right";
  ctx.textBaseline = "top";

  const pad = 14;
  const hudX = w - pad;
  const hudY = 60;        
  const lineH = 28;      

  // ★Canvasで確実に有効なweightにする（700/800/900）
  const comboFont = `900 20px system-ui, sans-serif`;
  const feverFont = `900 22px system-ui, sans-serif`;

  function drawHudText(text, x, y, font) {
    ctx.font = font; // ★毎回必ずセット
    ctx.lineWidth = 6;
    ctx.strokeStyle = "rgba(0,0,0,0.60)";
    ctx.strokeText(text, x, y);
    ctx.fillStyle = "white";
    ctx.fillText(text, x, y);
  }

  if (state.phase === "play") {
    if (state.combo >= 2) {
      drawHudText(`COMBO: ${state.combo}`, hudX, hudY, comboFont);
    }
    if (state.fever) {
      const t = Math.max(0, state.feverTimer).toFixed(1);
      drawHudText(`FEVER x2  ${t}s`, hudX, hudY + lineH, feverFont);
    }
  }

  ctx.restore();

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
titleEl.textContent = "Face Bop";
resultEl.textContent = "STARTを押してね";
btn.textContent = "START";
