// ui_layout.js (FULL COPY-PASTE)
// - viewport sizing / overlay fix / startPanel / RANKボタン / 見た目調整

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

// ★ resize/scroll はここに統合（重複削除、挙動同じ）
function onViewportChanged() {
  fitCanvas();
  lockOverlayToVisualViewport();
}
window.addEventListener("resize", onViewportChanged, { passive: true });
window.visualViewport?.addEventListener("resize", onViewportChanged, { passive: true });
window.visualViewport?.addEventListener("scroll", onViewportChanged, { passive: true });

onViewportChanged();

function setOverlayCenteredLayout() {
  overlay.style.display = "flex";
  overlay.style.flexDirection = "column";
  overlay.style.alignItems = "center";
  overlay.style.justifyContent = "center";
  overlay.style.padding = "18px";
  overlay.style.boxSizing = "border-box";
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
titleEl.textContent = "Attack Oohigashi!!";
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
if (IS_MOBILE) {
  btn.style.minWidth = "180px";
  btn.style.padding = "16px 26px";
  btn.style.fontSize = "18px";
}

// ★overlay は中央寄せ
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

  lockOverlayToVisualViewport();
})();

function setRankCornerButtonVisible(visible) {
  const b = document.getElementById("rankOpenBtn");
  if (!b) return;
  b.style.display = visible ? "inline-block" : "none";
}

// ★「START箱の右上」に RANKボタン（ranking.js の openRankModal を使うので、クリック動作は後で有効化される）
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

  // openRankModal は ranking.js が読み込まれた後に使える
  b.onclick = () => {
    const mode = (btn.textContent === "RETRY") ? "submit" : "view";
    if (typeof openRankModal === "function") openRankModal(mode);
  };

  panel.appendChild(b);
})();
