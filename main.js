// main.js (FULL COPY-PASTE) --- Mobile ultra-light ver (WebAudio + low-GC) ---
// - iOS Safari bottom bar safe: use visualViewport for sizing
// - Tap hitbox bigger on mobile
// - Performance: cap DPR to 2
// - Particles: pre-rendered sprite + MAX_PARTICLES cap (fast)
// - Floaters/Particles: in-place compaction (NO Array.filter allocations)
// - Sounds: WebAudio (AudioBuffer) + throttle (fix tap-stutter)
// - IMPORTANT: WAIT for audio decode BEFORE starting the game (prevents mid-reset)
// - Combo spec:
//   - comboが10の倍数ごとに +5pt（フィーバー中はx2）
//   - comboが50達成ごとにFEVER突入（50,100,150...で再突入=タイマ更新）
// - Variable particles: combo / feverで粒子数を増やす
// - FEVER演出：
//   - 画面オーバーレイ（脈動）
//   - FEVER突入フラッシュ + リング
//   - 敵画像を虹色（hue-rotate）で変色（主にFEVER中）
// - Ranking fixes:
//   - START画面は右上RANKボタンでモーダル表示（閲覧のみ）
//   - RESULT画面は「結果BOX」+「ランキングBOX」の2箱縦並び
//   - 1ゲーム1回だけ送信（多重送信防止）
//   - ランキングBOXはスクロール、RETRYは常に押せる
//   - ★RESULT時は「更新」ボタンを消す（被り/誤操作防止）
// - Finish hold:
//   - タイムアップ直後に FINISH!! を表示して 2秒待ってから結果画面へ（誤タップ防止）
// - RESULT scroll fix:
//   - RESULTでは overlay/startPanel を上寄せ + 縦スクロール可能にする（画面外も操作OK）
//   - canvas がスクロール操作を奪わないよう touchAction を設定

window.addEventListener("error", (e) => {
  alert("JS ERROR: " + (e?.message || e));
});
window.addEventListener("unhandledrejection", (e) => {
  alert("PROMISE ERROR: " + (e?.reason?.message || e?.reason || e));
});

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d", { alpha: false });

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

const RANK_LIMIT = 100;

// ---- Mobile detect & viewport size ----
const IS_MOBILE = matchMedia("(pointer: coarse)").matches;

const API_BASE = "https://rank-api.atack-rank.workers.dev";

async function submitScore(name, score) {
  const r = await fetch(`${API_BASE}/submit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, score }),
  });
  return r.json();
}

async function fetchTop(limit = 1) {
  const r = await fetch(`${API_BASE}/top?limit=${limit}`);
  return r.json();
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"
  }[c]));
}

// =========================
// Ranking UI (INLINE + MODAL 分離：ID重複なし)
// =========================
function createRankBox(kind /* "inline" | "modal" */) {
  const box = document.createElement("div");
  box.className = `rankBox rankBox-${kind}`;
  box.style.width = "min(86vw, 420px)";
  box.style.padding = "10px 12px";
  box.style.borderRadius = "14px";
  box.style.background = "rgba(255,255,255,0.08)";
  box.style.boxShadow = "0 10px 28px rgba(0,0,0,0.25)";
  box.style.backdropFilter = "blur(6px)";
  box.style.boxSizing = "border-box";
  box.style.color = "rgba(255,255,255,0.95)";

  const title = document.createElement("div");
  title.textContent = "RANKING";
  title.style.fontWeight = "900";
  title.style.letterSpacing = "0.08em";
  title.style.textAlign = "center";
  title.style.marginBottom = "8px";
  title.style.color = "rgba(255,255,255,0.95)";
  box.appendChild(title);

  const row = document.createElement("div");
  row.className = "rankRow";
  row.style.display = "grid";
  row.style.gap = "8px";
  row.style.alignItems = "center";
  box.appendChild(row);

  const input = document.createElement("input");
  input.className = "rankName";
  input.type = "text";
  input.maxLength = 16;
  input.placeholder = "ユーザ名（16文字まで）";
  input.value = localStorage.getItem("rank_name") || "";
  input.style.width = "100%";
  input.style.padding = "10px 12px";
  input.style.borderRadius = "12px";
  input.style.border = "1px solid rgba(255,255,255,0.18)";
  input.style.background = "rgba(0,0,0,0.25)";
  input.style.color = "rgba(255,255,255,0.95)";
  input.style.outline = "none";
  input.style.minWidth = "0";
  input.style.boxSizing = "border-box";
  row.appendChild(input);

  // ★ iOSでキーボード表示時に画面が暴れるのを抑える
  input.addEventListener("focus", () => { lockOverlayToVisualViewport(); }, { passive: true });
  input.addEventListener("blur",  () => { lockOverlayToVisualViewport(); }, { passive: true });

  // ★ズーム抑制＆入力補助OFF
  input.style.fontSize = "16px";
  input.inputMode = "text";
  input.autocapitalize = "none";
  input.autocorrect = "off";
  input.spellcheck = false;

  const send = document.createElement("button");
  send.className = "rankSend";
  send.textContent = "送信";
  send.style.padding = "10px 12px";
  send.style.borderRadius = "12px";
  send.style.border = "1px solid rgba(255,255,255,0.20)";
  send.style.background = "rgba(255,255,255,0.12)";
  send.style.color = "rgba(255,255,255,0.95)";
  send.style.fontWeight = "800";
  send.style.cursor = "pointer";
  row.appendChild(send);

  const refreshBtn = document.createElement("button");
  refreshBtn.className = "rankRefresh";
  refreshBtn.textContent = "更新";
  refreshBtn.style.padding = "10px 12px";
  refreshBtn.style.borderRadius = "12px";
  refreshBtn.style.border = "1px solid rgba(255,255,255,0.20)";
  refreshBtn.style.background = "rgba(255,255,255,0.12)";
  refreshBtn.style.color = "rgba(255,255,255,0.95)";
  refreshBtn.style.fontWeight = "800";
  refreshBtn.style.cursor = "pointer";
  row.appendChild(refreshBtn);

  const msg = document.createElement("div");
  msg.className = "rankMsg";
  msg.style.opacity = "0.9";
  msg.style.fontSize = "12px";
  msg.style.marginTop = "6px";
  msg.style.textAlign = "center";
  msg.textContent = "ランキング取得中…";
  box.appendChild(msg);

  const list = document.createElement("div");
  list.className = "rankList";
  list.style.marginTop = "8px";
  list.style.display = "grid";
  list.style.gap = "6px";

  list.style.maxHeight = (kind === "modal") ? "52vh" : "26vh";
  list.style.overflowY = "auto";
  list.style.overflowX = "hidden";
  list.style.webkitOverflowScrolling = "touch";
  list.style.touchAction = "pan-y";
  box.appendChild(list);

  return box;
}

function getRankEls(box) {
  return {
    row: box.querySelector(".rankRow"),
    input: box.querySelector(".rankName"),
    send: box.querySelector(".rankSend"),
    refresh: box.querySelector(".rankRefresh"),
    msg: box.querySelector(".rankMsg"),
    list: box.querySelector(".rankList"),
  };
}

// ★送信モードでは「更新」を消し、縦並びにして被り回避
function setRankingModeOnBox(box, mode /* "view" | "submit" */) {
  const { row, input, send, refresh, msg } = getRankEls(box);
  if (!row || !input || !send || !refresh || !msg) return;

  if (mode === "view") {
    // STARTモーダル閲覧
    row.style.display = "grid";
    row.style.gridTemplateColumns = "minmax(0, 1fr) auto";
    row.style.gap = "8px";

    input.style.display = "none";
    send.style.display = "none";
    refresh.style.display = "inline-block";
    refresh.textContent = "更新";
    msg.textContent = "ランキング表示（更新できます）";
    return;
  }

  // RESULT送信
  row.style.display = "grid";
  row.style.gridTemplateColumns = "1fr";
  row.style.gap = "8px";

  input.style.display = "block";
  input.style.width = "100%";

  // ★更新ボタンはRESULTでは使わない（被り/誤操作防止）
  refresh.style.display = "none";

  // 送信ボタンは幅100%
  send.style.display = "block";
  send.style.width = "100%";

  input.disabled = false;

  if (state.rankSubmitted) {
    send.disabled = true;
    send.textContent = "送信済み";
    input.disabled = true;
    msg.textContent = "送信済み！（この回は1回だけ）";
  } else {
    send.disabled = false;
    send.textContent = "送信";
    msg.textContent = "送信してランキングに参加しよう！";
  }
}

async function refreshRankingOnBox(box, limit = 20) {
  const { msg, list } = getRankEls(box);
  try {
    if (msg) msg.textContent = "ランキング更新中…";
    const data = await fetchTop(limit);
    const top = (data && data.top) ? data.top : [];

    if (list) {
      list.innerHTML = top.map((r, i) => {
        const name = escapeHtml(r.name);
        const score = Number(r.score) | 0;
        return `<div style="color:rgba(255,255,255,0.95);display:flex;justify-content:space-between;gap:10px;
             padding:8px 10px;border-radius:12px;
             background:rgba(0,0,0,0.22);border:1px solid rgba(255,255,255,0.10);">
          <div style="font-weight:800;">${i + 1}. ${name}</div>
          <div style="font-weight:900;">${score}</div>
        </div>`;
      }).join("");
    }

    if (msg) {
      if (state.rankSubmitted) msg.textContent = "送信済み！（この回は1回だけ）";
      else msg.textContent = "ランキング表示中";
    }
  } catch (e) {
    console.error(e);
    if (msg) msg.textContent = "ランキング取得に失敗（通信/URLを確認）";
  }
}

async function submitMyScoreOnBox(box, finalScore) {
  const { input, msg, send } = getRankEls(box);

  if (state.rankSubmitting) { if (msg) msg.textContent = "送信中…"; return; }
  if (state.rankSubmitted)  { if (msg) msg.textContent = "送信済み！"; return; }

  const name = (input ? input.value : "").trim();
  if (!name) { if (msg) msg.textContent = "名前を入力してね"; return; }

  localStorage.setItem("rank_name", name);

  try {
    state.rankSubmitting = true;
    if (send) send.disabled = true;
    if (msg) msg.textContent = "送信中…";

    const res = await submitScore(name, finalScore);
    if (!res || res.ok !== true) {
      if (msg) msg.textContent = "送信失敗：" + (res && res.error ? res.error : "unknown");
      if (send) send.disabled = false;
      return;
    }

    state.rankSubmitted = true;

    if (send) { send.disabled = true; send.textContent = "送信済み"; }
    if (input) input.disabled = true;
    if (msg) msg.textContent = "送信OK！ランキング更新中…";

    await refreshRankingOnBox(box, RANK_LIMIT);

    if (msg) msg.textContent = "送信済み！（この回は1回だけ）";
  } catch (e) {
    console.error(e);
    if (msg) msg.textContent = "送信に失敗（通信/URLを確認）";
    if (send && !state.rankSubmitted) send.disabled = false;
  } finally {
    state.rankSubmitting = false;
  }
}

// ---- INLINE Rank box on RESULT ----
let rankInlineBox = null;
function ensureRankInlineBox(parent) {
  if (rankInlineBox && rankInlineBox.isConnected) return rankInlineBox;
  rankInlineBox = createRankBox("inline");
  parent.appendChild(rankInlineBox);

  const { refresh, send } = getRankEls(rankInlineBox);
  if (refresh) refresh.onclick = () => refreshRankingOnBox(rankInlineBox, 20);
  if (send) send.onclick = () => submitMyScoreOnBox(rankInlineBox, state.score);

  return rankInlineBox;
}

// ---- MODAL Rank box (STARTから閲覧) ----
let rankModal = null;
let rankModalBox = null;

function ensureRankModal() {
  if (rankModal) return rankModal;

  const back = document.createElement("div");
  back.id = "rankModal";
  back.style.position = "absolute";
  back.style.inset = "0";
  back.style.display = "none";
  back.style.alignItems = "center";
  back.style.justifyContent = "center";
  back.style.background = "rgba(0,0,0,0.55)";
  back.style.zIndex = "30";
  back.style.padding = "18px";
  back.style.boxSizing = "border-box";

  const panel = document.createElement("div");
  panel.style.width = "min(92vw, 460px)";
  panel.style.borderRadius = "16px";
  panel.style.background = "rgba(20,22,26,0.92)";
  panel.style.border = "1px solid rgba(255,255,255,0.10)";
  panel.style.boxShadow = "0 14px 40px rgba(0,0,0,0.45)";
  panel.style.backdropFilter = "blur(10px)";
  panel.style.padding = "12px";
  panel.style.position = "relative";
  panel.style.boxSizing = "border-box";
  back.appendChild(panel);

  const close = document.createElement("button");
  close.textContent = "×";
  close.style.position = "absolute";
  close.style.top = "10px";
  close.style.right = "12px";
  close.style.width = "40px";
  close.style.height = "40px";
  close.style.borderRadius = "12px";
  close.style.border = "1px solid rgba(255,255,255,0.25)";
  close.style.background = "rgba(32,34,38,1)";
  close.style.color = "rgba(255,255,255,0.95)";
  close.style.fontSize = "22px";
  close.style.fontWeight = "900";
  close.style.cursor = "pointer";
  close.style.boxShadow = "0 6px 16px rgba(0,0,0,0.45)";
  close.style.zIndex = "9999";
  close.style.pointerEvents = "auto";
  close.onclick = () => closeRankModal();
  panel.appendChild(close);

  rankModalBox = createRankBox("modal");
  panel.appendChild(rankModalBox);

  const { refresh, send } = getRankEls(rankModalBox);
  if (refresh) refresh.onclick = () => refreshRankingOnBox(rankModalBox, 20);
  if (send) send.onclick = () => submitMyScoreOnBox(rankModalBox, state.score);

  back.addEventListener("pointerdown", (e) => {
    if (e.target === back) closeRankModal();
  }, { passive: true });

  overlay.style.position = "relative";
  overlay.appendChild(back);

  rankModal = back;
  return rankModal;
}

function openRankModal(mode /* "view" | "submit" */) {
  ensureRankModal();
  setRankingModeOnBox(rankModalBox, mode);
  rankModal.style.display = "flex";
  refreshRankingOnBox(rankModalBox, RANK_LIMIT);
}

function closeRankModal() {
  if (!rankModal) return;
  rankModal.style.display = "none";
}

// ---- viewport sizing ----
function getViewportSize() {
  const vv = window.visualViewport;
  const w = vv ? vv.width : window.innerWidth;
  const h = vv ? vv.height : window.innerHeight;
  return { w, h };
}

// --- keyboard / visualViewport fix (iOS Safari) ---
function lockOverlayToVisualViewport() {
  const vv = window.visualViewport;
  if (!vv) return;

  overlay.style.position = "fixed";
  overlay.style.left = vv.offsetLeft + "px";
  overlay.style.top = vv.offsetTop + "px";
  overlay.style.width = vv.width + "px";
  overlay.style.height = vv.height + "px";
}

function fitCanvas() {
  const { w, h } = getViewportSize();
  const dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
  canvas.style.width = w + "px";
  canvas.style.height = h + "px";
  canvas.width = Math.floor(w * dpr);
  canvas.height = Math.floor(h * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

// ★ resize/scroll はここに統合（重複を削除、挙動は同じ）
function onViewportChanged() {
  fitCanvas();
  lockOverlayToVisualViewport();
}
window.addEventListener("resize", onViewportChanged, { passive: true });
window.visualViewport?.addEventListener("resize", onViewportChanged, { passive: true });
window.visualViewport?.addEventListener("scroll", onViewportChanged, { passive: true });

onViewportChanged();

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

// ---- Rainbow fallback for mobile (when ctx.filter doesn't work) ----
const HAS_CTX_FILTER = ("filter" in ctx);
const RAINBOW_STEP_DEG = 12;
const rainbowCache = new Map();

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r,g,b), min = Math.min(r,g,b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  const d = max - min;
  if (d !== 0) {
    s = d / (1 - Math.abs(2*l - 1));
    switch (max) {
      case r: h = ((g - b) / d) % 6; break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, s, l];
}

function hslToRgb(h, s, l) {
  const c = (1 - Math.abs(2*l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c/2;
  let r1=0,g1=0,b1=0;
  if (0<=h && h<60) [r1,g1,b1]=[c,x,0];
  else if (60<=h && h<120) [r1,g1,b1]=[x,c,0];
  else if (120<=h && h<180) [r1,g1,b1]=[0,c,x];
  else if (180<=h && h<240) [r1,g1,b1]=[0,x,c];
  else if (240<=h && h<300) [r1,g1,b1]=[x,0,c];
  else [r1,g1,b1]=[c,0,x];
  return [
    Math.round((r1+m)*255),
    Math.round((g1+m)*255),
    Math.round((b1+m)*255)
  ];
}

function getRainbowCanvas(img, hueDeg, sizePx) {
  if (!img || !img.complete || sizePx <= 0) return null;

  const qHue = (Math.floor(hueDeg / RAINBOW_STEP_DEG) * RAINBOW_STEP_DEG) % 360;
  const key = `${img.src}|${qHue}|${sizePx}`;
  const cached = rainbowCache.get(key);
  if (cached) return cached;

  const c = document.createElement("canvas");
  c.width = sizePx;
  c.height = sizePx;
  const g = c.getContext("2d", { willReadFrequently: true });

  g.clearRect(0, 0, sizePx, sizePx);
  g.drawImage(img, 0, 0, sizePx, sizePx);

  const im = g.getImageData(0, 0, sizePx, sizePx);
  const d = im.data;
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i+3];
    if (a === 0) continue;
    const [h, s, l] = rgbToHsl(d[i], d[i+1], d[i+2]);
    const nh = (h + qHue) % 360;
    const [rr, gg, bb] = hslToRgb(nh, s, l);
    d[i] = rr; d[i+1] = gg; d[i+2] = bb;
  }
  g.putImageData(im, 0, 0);

  if (rainbowCache.size > 80) rainbowCache.clear();
  rainbowCache.set(key, c);
  return c;
}

// ---- image assets ----
const assets = {
  face: new Image(),
  faceHit: new Image(),
};
assets.face.src = "./assets/face.png";
assets.faceHit.src = "./assets/face_hit.png";

// ---- WebAudio (fast, tap-safe) ----
let audioCtx = null;
let gainBgm = null;
let gainSe = null;
let buffers = { hit01: null, hit02: null, count: null, finish: null, bgm: null };
let bgmSource = null;

let audioReadyPromise = null;
let isStarting = false;

function setButtonLoading(on) {
  if (on) {
    btn.disabled = true;
    btn.textContent = "LOADING...";
    resultEl.textContent = "音声を読み込み中…";
  } else {
    btn.disabled = false;
  }
}

function audioIsReady() {
  return !!(audioCtx && buffers.hit01 && buffers.hit02 && buffers.count && buffers.finish && buffers.bgm);
}

async function ensureAudio() {
  if (audioIsReady()) return;
  if (audioReadyPromise) return audioReadyPromise;

  audioReadyPromise = (async () => {
    try {
      if (audioCtx) { try { audioCtx.close(); } catch (_) {} }
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();

      gainBgm = audioCtx.createGain();
      gainSe = audioCtx.createGain();
      gainBgm.gain.value = 0.18;
      gainSe.gain.value = 0.85;
      gainBgm.connect(audioCtx.destination);
      gainSe.connect(audioCtx.destination);

      async function loadBuf(url) {
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) throw new Error(`fetch failed ${res.status}: ${url}`);
        const arr = await res.arrayBuffer();
        try {
          return await audioCtx.decodeAudioData(arr);
        } catch (_) {
          throw new Error(`decodeAudioData failed: ${url}`);
        }
      }

      const [b1, b2, b3, b4, b5] = await Promise.all([
        loadBuf("./assets/hit01.mp3"),
        loadBuf("./assets/hit02.mp3"),
        loadBuf("./assets/count.mp3"),
        loadBuf("./assets/bgm.mp3"),
        loadBuf("./assets/finish.mp3"),
      ]);

      buffers.hit01 = b1;
      buffers.hit02 = b2;
      buffers.count = b3;
      buffers.bgm = b4;
      buffers.finish = b5;

    } catch (e) {
      audioReadyPromise = null;
      if (audioCtx) { try { audioCtx.close(); } catch (_) {} }
      audioCtx = null;
      gainBgm = null;
      gainSe = null;
      buffers = { hit01: null, hit02: null, count: null, finish: null, bgm: null };
      bgmSource = null;
      throw e;
    }
  })();

  return audioReadyPromise;
}

function startBGM() {
  if (!audioCtx || !buffers.bgm) return;
  if (bgmSource) return;
  bgmSource = audioCtx.createBufferSource();
  bgmSource.buffer = buffers.bgm;
  bgmSource.loop = true;
  bgmSource.connect(gainBgm);
  bgmSource.start(0);
}

let lastSeTime = 0;
function playSE(buf, volMul = 1.0) {
  if (!audioCtx || !buf) return;

  const now = performance.now();
  if (IS_MOBILE && now - lastSeTime < 70) return;
  lastSeTime = now;

  const src = audioCtx.createBufferSource();
  src.buffer = buf;

  const g = audioCtx.createGain();
  g.gain.value = volMul;
  src.connect(g);
  g.connect(gainSe);

  src.start(0);
}

function playHitNormal() { playSE(buffers.hit01, 0.95); }
function playHitBonus()  { playSE(buffers.hit02, 1.00); }
function playCount()     { playSE(buffers.count, 0.95); }
function playFinish()    { playSE(buffers.finish, 1.00); }

// ---- result packs (from result_data.js) ----
function pickResultPack(score) {
  const packs = window.RESULT_PACKS;
  if (!Array.isArray(packs) || packs.length === 0) return null;

  for (let i = 0; i < packs.length; i++) {
    const p = packs[i];
    const minOk = (score >= (p.min ?? -Infinity));
    const maxOk = (p.max == null) ? true : (score <= p.max);
    if (minOk && maxOk) return p;
  }
  return packs[packs.length - 1] || null;
}

const resultImgCache = new Map();

async function preloadResultImages() {
  const packs = window.RESULT_PACKS;
  if (!Array.isArray(packs)) return;

  const urls = new Set();
  for (const p of packs) if (p && p.img) urls.add(p.img);

  const tasks = [];
  urls.forEach((url) => {
    if (resultImgCache.has(url)) return;
    const im = new Image();
    im.src = url;
    resultImgCache.set(url, im);

    if (im.decode) tasks.push(im.decode().catch(() => {}));
    else {
      tasks.push(new Promise((r) => {
        im.onload = () => r();
        im.onerror = () => r();
      }));
    }
  });

  await Promise.all(tasks);
}

(function waitAndPreload() {
  let tries = 0;
  const timer = setInterval(() => {
    tries++;
    if (Array.isArray(window.RESULT_PACKS) || tries > 50) {
      clearInterval(timer);
      preloadResultImages().catch(() => {});
    }
  }, 100);
})();

function pickRandom(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return "";
  return arr[(Math.random() * arr.length) | 0];
}

function renderResultWithPack(score) {
  const pack = pickResultPack(score);

  const wrap = document.createElement("div");
  wrap.style.display = "grid";
  wrap.style.gap = "10px";
  wrap.style.justifyItems = "center";

  const needsImg = !!(pack && pack.img);
  if (needsImg) wrap.style.visibility = "hidden";

  if (pack && pack.img) {
    const img = document.createElement("img");
    const cached = resultImgCache.get(pack.img);
    img.src = cached ? cached.src : pack.img;

    img.alt = "result";
    img.style.width = "min(72vw, 360px)";
    img.style.height = "auto";
    img.style.borderRadius = "14px";
    img.style.boxShadow = "0 10px 30px rgba(0,0,0,0.35)";
    img.loading = "eager";
    img.decoding = "sync";

    const show = () => { wrap.style.visibility = "visible"; };
    if (img.complete) show();
    else {
      img.addEventListener("load", show, { once: true });
      img.addEventListener("error", show, { once: true });
    }

    wrap.appendChild(img);
  } else {
    wrap.style.visibility = "visible";
  }

  const comment = document.createElement("div");
  comment.textContent = pack ? pickRandom(pack.comments) : "";
  comment.style.fontWeight = "800";
  comment.style.fontSize = "18px";
  comment.style.textAlign = "center";
  comment.style.lineHeight = "1.3";
  wrap.appendChild(comment);

  const scoreLine = document.createElement("div");
  scoreLine.textContent = `Score: ${score} / Best: ${best}`;
  scoreLine.style.opacity = "0.95";
  scoreLine.style.fontWeight = "700";
  wrap.appendChild(scoreLine);

  return wrap;
}

// ---- best ----
let best = Number(localStorage.getItem(BEST_KEY) || 0);
elBest.textContent = best.toString();

// ---- timing ----
const INTRO_FIRST_SECONDS = 7.0;
const INTRO_RETRY_SECONDS = 3.0;
const GO_HOLD_SECONDS = 1.0;
const GAME_SECONDS = 30.0;

// ---- combo/fever spec ----
const COMBO_BONUS_EVERY = 10;
const COMBO_BONUS_PTS = 5;
const FEVER_EVERY = 50;
const FEVER_SECONDS = 7.0;

function speedLimit() {
  const { w, h } = getViewportSize();
  const s = Math.min(w, h);
  const base = clamp(s * 0.85, 520, 900);
  return IS_MOBILE ? base * 0.625 : base;
}

const state = {
  running: false,
  lastT: 0,

  phase: "intro",
  introLeft: INTRO_FIRST_SECONDS,
  introTotal: INTRO_FIRST_SECONDS,
  countPlayed: false,
  goHold: 0,

  finishHold: 0,
  finishTextTimer: 0,

  score: 0,
  timeLeft: GAME_SECONDS,

  particles: [],
  floaters: [],

  shake: 0,

  combo: 0,
  comboTimer: 0,
  comboWindow: 1.0,
  fever: false,
  feverTimer: 0,
  scoreMul: 1,

  feverFlash: 0,
  feverBurst: 0,
  hueTime: 0,

  rankSubmitted: false,
  rankSubmitting: false,

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

// ---- floaters ----
const MAX_FLOATERS = IS_MOBILE ? 18 : 60;

function addFloater(text, x, y, opts = {}) {
  const {
    size = 26,
    life = IS_MOBILE ? 0.55 : 0.7,
    rise = IS_MOBILE ? 110 : 140,
    wobble = IS_MOBILE ? 8 : 10,
    weight = 900,
  } = opts;

  if (state.floaters.length >= MAX_FLOATERS) return;

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

function startFever(seconds = FEVER_SECONDS) {
  state.fever = true;
  state.feverTimer = seconds;
  state.scoreMul = 2;

  state.feverFlash = 0.18;
  state.feverBurst = 1.0;

  playHitBonus();

  addFloater("FEVER x2!!", state.face.x, state.face.y - state.face.r - 12, {
    size: IS_MOBILE ? 34 : 40,
    life: 1.0,
    rise: IS_MOBILE ? 70 : 90,
    wobble: 20,
    weight: 1000
  });

  state.shake = Math.max(state.shake, IS_MOBILE ? 0.22 : 0.28);
}

function stopFever() {
  state.fever = false;
  state.feverTimer = 0;
  state.scoreMul = 1;
}

function setOverlayCenteredLayout() {
  overlay.style.display = "flex";
  overlay.style.flexDirection = "column";
  overlay.style.alignItems = "center";
  overlay.style.justifyContent = "center";
  overlay.style.padding = "18px";
  overlay.style.boxSizing = "border-box";
}

function resetGameForIntro(introSeconds) {
  state.phase = "intro";
  state.introTotal = introSeconds;
  state.introLeft = introSeconds;
  state.countPlayed = false;
  state.goHold = 0;

  state.finishHold = 0;
  state.finishTextTimer = 0;

  state.score = 0;
  state.timeLeft = GAME_SECONDS;

  state.particles.length = 0;
  state.floaters.length = 0;

  state.shake = 0;

  state.combo = 0;
  state.comboTimer = 0;
  stopFever();

  state.feverFlash = 0;
  state.feverBurst = 0;
  state.hueTime = 0;

  state.rankSubmitted = false;
  state.rankSubmitting = false;

  // ★STARTでは中央寄せ＆スクロール無効に戻す
  overlay.style.justifyContent = "center";
  overlay.style.overflowY = "hidden";

  const { w, h } = getViewportSize();

  state.face.r = Math.min(w, h) * 0.10;
  state.face.x = rand(state.face.r, w - state.face.r);
  state.face.y = rand(state.face.r + 90, h - state.face.r);

  const spMul = IS_MOBILE ? 0.625 : 1.0;

  const baseVx = rand(220, 340) * spMul * (Math.random() < 0.5 ? -1 : 1);
  const baseVy = rand(180, 300) * spMul * (Math.random() < 0.5 ? -1 : 1);
  state.face.baseVx = baseVx;
  state.face.baseVy = baseVy;

  state.face.vx = 0;
  state.face.vy = 0;
  state.face.hitTimer = 0;
  state.face.scalePop = 0;

  setRankCornerButtonVisible(true);

  elScore.textContent = "0";
  elTime.textContent = GAME_SECONDS.toFixed(1);
}

// ---- particles ----
const MAX_PARTICLES = IS_MOBILE ? 60 : 220;

function spawnParticles(x, y, n = 18) {
  if (state.particles.length >= MAX_PARTICLES) return;

  const nn = IS_MOBILE ? Math.max(4, Math.floor(n * 0.35)) : n;

  for (let i = 0; i < nn; i++) {
    if (state.particles.length >= MAX_PARTICLES) break;

    const a = rand(0, Math.PI * 2);
    const sp = rand(140, 620) * (IS_MOBILE ? 0.8 : 1.0);
    state.particles.push({
      x, y,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp,
      life: rand(0.18, 0.42),
      t: 0
    });
  }
}

function pointInFace(px, py) {
  const dx = px - state.face.x;
  const dy = py - state.face.y;
  const pad = IS_MOBILE ? 1.40 : 1.15;
  const rr = state.face.r * pad;
  return (dx * dx + dy * dy) <= (rr * rr);
}

function endGame() {
  overlay.style.display = "flex";

  // ★ RESULTでは上寄せにしてスクロールできるようにする（重要）
  overlay.style.justifyContent = "flex-start";
  overlay.style.alignItems = "center";
  overlay.style.overflowY = "auto";
  overlay.style.webkitOverflowScrolling = "touch";
  overlay.style.touchAction = "pan-y";

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

  // RESULTでは右上RANKボタンを消す（下にランキングがあるため）
  setRankCornerButtonVisible(false);

  // RESULT画面：2箱縦並び（結果BOX + ランキングBOX）
  resultEl.textContent = "";
  resultEl.style.display = "grid";
  resultEl.style.gap = "12px";
  resultEl.style.justifyItems = "center";
  resultEl.style.width = "min(86vw, 420px)";
  resultEl.style.boxSizing = "border-box";

  // 1) 結果BOX
  const resultWrap = renderResultWithPack(state.score);
  resultWrap.style.width = "100%";
  resultWrap.style.padding = "10px 12px";
  resultWrap.style.borderRadius = "14px";
  resultWrap.style.background = "rgba(255,255,255,0.08)";
  resultWrap.style.boxShadow = "0 10px 28px rgba(0,0,0,0.25)";
  resultWrap.style.backdropFilter = "blur(6px)";
  resultWrap.style.boxSizing = "border-box";
  resultEl.appendChild(resultWrap);

  // 2) ランキングBOX（送信モード）
  const box = ensureRankInlineBox(resultEl);
  setRankingModeOnBox(box, "submit");

  const { send } = getRankEls(box);
  if (send) send.onclick = () => submitMyScoreOnBox(box, state.score);

  refreshRankingOnBox(box, RANK_LIMIT);

  btn.textContent = "RETRY";

  // RETRY最前面
  btn.style.position = "relative";
  btn.style.zIndex = "10";
}

async function startGame() {
  if (isStarting) return;
  isStarting = true;
  setButtonLoading(true);

  try {
    await ensureAudio();
    if (audioCtx && audioCtx.state === "suspended") {
      try { await audioCtx.resume(); } catch (_) {}
    }
    startBGM();

    const introSeconds = hasStartedOnce ? INTRO_RETRY_SECONDS : INTRO_FIRST_SECONDS;
    resetGameForIntro(introSeconds);

    state.running = true;
    overlay.classList.add("hidden");
    overlay.style.display = "none";
    state.lastT = performance.now();

    addFloater("GET READY...", state.face.x, state.face.y - state.face.r - 10, {
      size: IS_MOBILE ? 30 : 34,
      life: 1.0,
      rise: 50,
      wobble: 8,
      weight: 900
    });

    hasStartedOnce = true;
    requestAnimationFrame(loop);

  } catch (e) {
    console.error(e);
    overlay.classList.remove("hidden");
    titleEl.textContent = "AUDIO ERROR";
    resultEl.textContent = String(e?.message || "音声の読み込みに失敗（assetsパス/サーバ起動を確認）");
    btn.textContent = "RETRY";
  } finally {
    setButtonLoading(false);
    isStarting = false;
  }
}

btn.addEventListener("click", startGame);

// ---- pointer ----
function getPointerPos(e) {
  const rect = canvas.getBoundingClientRect();
  const x = (e.clientX - rect.left);
  const y = (e.clientY - rect.top);
  return { x, y };
}

function particleCountForHit() {
  let n = 18;
  n = clamp(18 + state.combo * 0.6, 18, 34);
  if (state.fever) n = Math.floor(n * 1.6);
  if (state.combo > 0 && (state.combo % COMBO_BONUS_EVERY === 0)) n += 10;
  return n;
}

canvas.addEventListener("pointerdown", (e) => {
  if (!state.running) return;
  if (state.phase !== "play") return;

  const { x, y } = getPointerPos(e);

  if (pointInFace(x, y)) {
    if (state.comboTimer > 0) state.combo += 1;
    else state.combo = 1;
    state.comboTimer = state.comboWindow;

    const add = 1 * state.scoreMul;
    state.score += add;

    addFloater(`+${add}`, state.face.x, state.face.y - state.face.r * 0.15, {
      size: IS_MOBILE ? 24 : 28, life: 0.60, rise: 120, wobble: 8, weight: 900
    });

    playHitNormal();

    if (state.combo % COMBO_BONUS_EVERY === 0) {
      const bonus = COMBO_BONUS_PTS * state.scoreMul;
      state.score += bonus;

      addFloater(`+${bonus} BONUS!!`, state.face.x, state.face.y, {
        size: IS_MOBILE ? 34 : 44, life: 0.95, rise: 150, wobble: 18, weight: 1000
      });

      playHitBonus();
      state.shake = Math.max(state.shake, IS_MOBILE ? 0.26 : 0.33);
    }

    if (state.combo % FEVER_EVERY === 0) {
      startFever(FEVER_SECONDS);
    }

    elScore.textContent = String(state.score);

    state.face.hitTimer = 0.18;
    state.face.scalePop = 0.20;

    state.shake = Math.max(
      state.shake,
      (state.fever ? (IS_MOBILE ? 0.16 : 0.20) : (IS_MOBILE ? 0.13 : 0.16)) + Math.min(0.22, state.combo * 0.012)
    );

    spawnParticles(state.face.x, state.face.y, particleCountForHit());

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
}, { passive: true });

// ---- update helpers: in-place compaction ----
function updateParticles(dt) {
  const arr = state.particles;
  let w = 0;
  for (let i = 0; i < arr.length; i++) {
    const p = arr[i];
    p.t += dt;
    if (p.t >= p.life) continue;

    p.x += p.vx * dt;
    p.y += p.vy * dt;
    const damp = Math.pow(0.06, dt);
    p.vx *= damp;
    p.vy *= damp;

    arr[w++] = p;
  }
  arr.length = w;
}

function updateFloaters(dt) {
  const arr = state.floaters;
  let w = 0;
  for (let i = 0; i < arr.length; i++) {
    const ft = arr[i];
    ft.t += dt;
    if (ft.t >= ft.life) continue;
    arr[w++] = ft;
  }
  arr.length = w;
}

function update(dt) {
  state.hueTime += dt;

  if (state.feverFlash > 0) state.feverFlash = Math.max(0, state.feverFlash - dt);
  if (state.feverBurst > 0) state.feverBurst = Math.max(0, state.feverBurst - dt * 2.6);

  if (state.phase === "intro") {
    if (state.goHold > 0) {
      state.goHold = Math.max(0, state.goHold - dt);
      elTime.textContent = GAME_SECONDS.toFixed(1);

      updateFloaters(dt);
      updateParticles(dt);

      if (state.goHold <= 0) {
        state.phase = "play";
        state.timeLeft = GAME_SECONDS;
        elTime.textContent = state.timeLeft.toFixed(1);
        state.face.vx = state.face.baseVx;
        state.face.vy = state.face.baseVy;
      }
      return;
    }

    state.introLeft = Math.max(0, Math.min(state.introTotal, state.introLeft - dt));
    elTime.textContent = GAME_SECONDS.toFixed(1);

    if (!state.countPlayed && state.introLeft <= 3.0) {
      playCount();
      state.countPlayed = true;
    }

    updateFloaters(dt);
    updateParticles(dt);

    if (state.introLeft <= 0) {
      state.goHold = GO_HOLD_SECONDS;
      elTime.textContent = GAME_SECONDS.toFixed(1);

      addFloater("GO!!", state.face.x, state.face.y - state.face.r - 10, {
        size: IS_MOBILE ? 46 : 52, life: GO_HOLD_SECONDS, rise: 140, wobble: 16, weight: 1000
      });

      state.shake = Math.max(state.shake, IS_MOBILE ? 0.18 : 0.22);
    }
    return;
  }

  // ---- FINISH hold (2s) ----
  if (state.phase === "finish") {
    state.finishHold = Math.max(0, state.finishHold - dt);
    state.finishTextTimer = Math.max(0, state.finishTextTimer - dt);

    updateParticles(dt);
    updateFloaters(dt);

    if (state.finishHold <= 0) {
      endGame();
    }
    return;
  }

  state.timeLeft -= dt;
  if (state.timeLeft <= 0) {
    state.timeLeft = 0;
    elTime.textContent = "0.0";

    state.phase = "finish";
    state.finishHold = 2.0;
    state.finishTextTimer = 1.2;
    state.shake = Math.max(state.shake, IS_MOBILE ? 0.18 : 0.22);

    playFinish();
    const { w, h } = getViewportSize();
    addFloater("FINISH!!", w / 2, h / 2, {
      size: IS_MOBILE ? 56 : 72,
      life: 1.2,
      rise: 0,
      wobble: 0,
      weight: 1000
    });

    return;
  }
  elTime.textContent = state.timeLeft.toFixed(1);

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

  updateParticles(dt);
  updateFloaters(dt);

  if (state.comboTimer > 0) {
    state.comboTimer = Math.max(0, state.comboTimer - dt);
    if (state.comboTimer === 0) state.combo = 0;
  }

  if (state.fever) {
    state.feverTimer -= dt;
    if (state.feverTimer <= 0) stopFever();
  }
}

// ---- intro countdown drawing ----
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
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.fillText("GET READY", w / 2 + 2, h / 2 - 110 + 2);
  ctx.fillStyle = "rgba(255,255,255,0.98)";
  ctx.fillText("GET READY", w / 2, h / 2 - 110);

  if (waiting) { ctx.restore(); return; }

  const text = isGo ? "GO!" : String(n);

  ctx.font = `${Math.floor((IS_MOBILE ? 100 : 120) * pulse)}px system-ui, sans-serif`;
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.fillText(text, w / 2 + 3, h / 2 + 3);
  ctx.fillStyle = "rgba(255,255,255,0.98)";
  ctx.fillText(text, w / 2, h / 2);

  ctx.restore();
}

// ---- draw ----
const BG_COLOR = "#0b0f1a";
const HUD_COLOR = "rgba(255,255,255,0.96)";

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
  ctx.fillStyle = BG_COLOR;
  ctx.fillRect(0, 0, w, h);

  if (state.fever) {
    const pulse = 0.06 + 0.03 * Math.sin(state.hueTime * 6.0);
    ctx.globalAlpha = pulse;
    ctx.fillStyle = "rgba(180,220,255,1)";
    ctx.fillRect(0, 0, w, h);
    ctx.globalAlpha = 1;
  }

  if (dotSprite) {
    for (let i = 0; i < state.particles.length; i++) {
      const p = state.particles[i];
      const a = 1 - (p.t / p.life);
      ctx.globalAlpha = a;
      const r = (IS_MOBILE ? 8 : 10) * a + 2;
      ctx.drawImage(dotSprite, p.x - r, p.y - r, r * 2, r * 2);
    }
    ctx.globalAlpha = 1;
  }

  for (let i = 0; i < state.floaters.length; i++) {
    const ft = state.floaters[i];
    const pp = ft.t / ft.life;
    const ease = 1 - Math.pow(1 - pp, 3);
    const yy = ft.y0 - ft.rise * ease;
    const xx = ft.x0 + Math.sin(pp * Math.PI * 2) * ft.wobble;
    const alpha = 1 - pp;

    ctx.globalAlpha = alpha;
    ctx.font = `${ft.weight} ${ft.size}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillText(ft.text, xx + 2, yy + 2);

    ctx.fillStyle = "rgba(255,255,255,0.98)";
    ctx.fillText(ft.text, xx, yy);
  }
  ctx.globalAlpha = 1;

  const f = state.face;
  const img = (f.hitTimer > 0 ? assets.faceHit : assets.face);

  const pop = (f.scalePop > 0) ? (1 + 0.18 * (f.scalePop / 0.20)) : 1;
  const size = (f.r * 2) * pop;

  ctx.globalAlpha = 0.32;
  ctx.beginPath();
  ctx.ellipse(f.x, f.y + f.r * 0.78, f.r * 0.95, f.r * 0.35, 0, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255,255,255,0.35)";
  ctx.fill();
  ctx.globalAlpha = 1;

  const hueDeg = (state.hueTime * 220 + (f.x + f.y) * 0.15) % 360;
  const hueStrength = state.fever ? 1.0 : 0.0;

  ctx.save();
  ctx.beginPath();
  ctx.arc(f.x, f.y, (f.r * pop), 0, Math.PI * 2);
  ctx.clip();

  const useRainbow = (hueStrength > 0);

  if (useRainbow && HAS_CTX_FILTER) {
    const sat = state.fever ? 2.2 : 1.2;
    const con = state.fever ? 1.12 : 1.02;
    ctx.filter = `hue-rotate(${hueDeg}deg) saturate(${sat}) contrast(${con})`;
    ctx.drawImage(img, f.x - size / 2, f.y - size / 2, size, size);
    ctx.filter = "none";
  } else if (useRainbow && !HAS_CTX_FILTER) {
    const sp = Math.max(32, (size | 0));
    const rc = getRainbowCanvas(img, hueDeg, sp);
    if (rc) ctx.drawImage(rc, f.x - size / 2, f.y - size / 2, size, size);
    else ctx.drawImage(img, f.x - size / 2, f.y - size / 2, size, size);
  } else {
    ctx.drawImage(img, f.x - size / 2, f.y - size / 2, size, size);
  }

  ctx.filter = "none";
  ctx.restore();

  ctx.lineWidth = 4;
  ctx.strokeStyle = "rgba(255,255,255,0.22)";
  ctx.beginPath();
  ctx.arc(f.x, f.y, (f.r * pop), 0, Math.PI * 2);
  ctx.stroke();

  if (state.phase === "intro") drawIntroCountdown();

  if (state.feverFlash > 0 || state.feverBurst > 0) {
    const aFlash = Math.min(1, state.feverFlash / 0.18);
    if (aFlash > 0) {
      ctx.save();
      ctx.globalAlpha = 0.28 * aFlash;
      ctx.fillStyle = "rgba(255,255,255,1)";
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
    }

    const b = state.feverBurst;
    if (b > 0) {
      const cx = f.x, cy = f.y;
      const r0 = f.r * 0.8;
      const r1 = r0 + (1 - b) * (Math.min(w, h) * 0.55);

      ctx.save();
      ctx.globalAlpha = 0.55 * b;
      ctx.lineWidth = 6;
      ctx.strokeStyle = "rgba(255,255,255,0.9)";
      ctx.beginPath();
      ctx.arc(cx, cy, r1, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
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

  function drawHudText(text, x, y, font) {
    ctx.font = font;
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillText(text, x + 2, y + 2);
    ctx.fillStyle = HUD_COLOR;
    ctx.fillText(text, x, y);
  }

  if (state.phase === "play") {
    if (state.combo >= 2) {
      drawHudText(`COMBO: ${state.combo}`, hudX, hudY, `900 20px system-ui, sans-serif`);
    }
    if (state.fever) {
      const tt = Math.max(0, state.feverTimer).toFixed(1);
      drawHudText(`FEVER x2  ${tt}s`, hudX, hudY + lineH, `900 22px system-ui, sans-serif`);
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

// ★overlay を必ず最前面に出す
canvas.style.position = "fixed";
canvas.style.inset = "0";
canvas.style.zIndex = "1";
canvas.style.touchAction = "none"; // canvasがスクロールを奪わない

overlay.style.position = "fixed";
overlay.style.inset = "0";
overlay.style.zIndex = "50";
overlay.style.pointerEvents = "auto";

// ---- initial overlay ----
overlay.classList.remove("hidden");
titleEl.textContent = "Atack Oohigashi!!";
resultEl.textContent = "STARTを押してね";
btn.textContent = "START";

// ★ START / RETRY ボタンをタップしやすく（挙動は不変）
btn.style.minWidth = "140px";
btn.style.padding = "14px 22px";
btn.style.fontSize = "16px";
btn.style.fontWeight = "800";
btn.style.borderRadius = "12px";
btn.style.border = "1px solid rgba(255,255,255,0.25)";
btn.style.background = "rgba(255,255,255,0.95)";
btn.style.color = "#000";
btn.style.cursor = "pointer";

// モバイルはさらに大きく
if (IS_MOBILE) {
  btn.style.minWidth = "180px";
  btn.style.padding = "16px 26px";
  btn.style.fontSize = "18px";
}

// ★overlay は「画面中央寄せ」
setOverlayCenteredLayout();

// ★START箱（パネル）を作って、中に title/result/button をまとめる
(function ensureStartPanel() {
  let panel = document.getElementById("startPanel");
  if (!panel) {
    panel = document.createElement("div");
    panel.id = "startPanel";
    panel.style.width = "min(92vw, 520px)";
    panel.style.borderRadius = "18px";
    panel.style.background = "rgba(20,22,26,0.88)";
    panel.style.border = "1px solid rgba(255,255,255,0.10)";
    panel.style.boxShadow = "0 14px 44px rgba(0,0,0,0.45)";
    panel.style.backdropFilter = "blur(10px)";
    panel.style.padding = "18px 18px 16px";
    panel.style.boxSizing = "border-box";
    panel.style.display = "grid";
    panel.style.gap = "10px";
    panel.style.justifyItems = "center";
    panel.style.position = "relative";
    panel.style.color = "rgba(255,255,255,0.95)";

    // panel自体をスクロール可能にする（RESULTで中身がはみ出してもOK）
    panel.style.maxHeight = "min(86vh, 760px)";
    panel.style.overflowY = "auto";
    panel.style.webkitOverflowScrolling = "touch";
    panel.style.touchAction = "pan-y";

    while (overlay.firstChild) overlay.removeChild(overlay.firstChild);
    overlay.appendChild(panel);
  }

  panel.appendChild(titleEl);
  panel.appendChild(resultEl);
  panel.appendChild(btn);

  resultEl.style.width = "100%";
  resultEl.style.maxHeight = "";
  resultEl.style.overflow = "";
  resultEl.style.paddingBottom = "";

  btn.style.marginTop = "6px";
  btn.style.position = "relative";
  btn.style.zIndex = "5";

  // 表示統一（値は元と同じ）
  panel.style.textAlign = "center";
  panel.style.justifyItems = "center";
  [titleEl, resultEl].forEach(el => {
    if (!el) return;
    el.style.width = "100%";
    el.style.textAlign = "center";
    el.style.marginLeft = "0";
    el.style.marginRight = "0";
  });
  if (btn) btn.style.alignSelf = "center";

  // overlay の位置・サイズは onViewportChanged 経由で常に同期
  lockOverlayToVisualViewport();
})();

// ★モーダルは先に作っておく
ensureRankModal();

// ★「START箱の右上」に RANKボタン
(function ensureRankButtonOnPanel() {
  if (document.getElementById("rankOpenBtn")) return;
  const panel = document.getElementById("startPanel");
  if (!panel) return;

  const b = document.createElement("button");
  b.id = "rankOpenBtn";
  b.textContent = "RANK";
  b.style.position = "absolute";
  b.style.top = "14px";
  b.style.right = "14px";
  b.style.padding = "8px 10px";
  b.style.borderRadius = "12px";
  b.style.border = "1px solid rgba(255,255,255,0.18)";
  b.style.background = "rgba(255,255,255,0.10)";
  b.style.color = "rgba(255,255,255,0.95)";
  b.style.fontWeight = "900";
  b.style.letterSpacing = "0.06em";
  b.style.cursor = "pointer";
  b.style.zIndex = "10";

  b.onclick = () => {
    const mode = (btn.textContent === "RETRY") ? "submit" : "view";
    openRankModal(mode);
  };

  panel.appendChild(b);
})();

function setRankCornerButtonVisible(visible) {
  const b = document.getElementById("rankOpenBtn");
  if (!b) return;
  b.style.display = visible ? "inline-block" : "none";
}
