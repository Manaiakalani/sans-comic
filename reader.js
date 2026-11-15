/* Sans Comic reader: one panel at a time, balloons popping in, swipe or arrow keys, or press Play. */
(() => {
'use strict';
const FP = window.FP, app = FP.app, { $ } = app;
const dlg = $('#dlg-read'), cv = $('#read-cv'), playBtn = $('#read-play');
const R = { panels: [], i: 0, beat: 0, timer: 0, playing: false };
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

function segmentCap() {
  const probe = $('#seg-probe');
  const w = probe ? probe.getBoundingClientRect().width : 0;
  return w > 80 ? w : Infinity;
}
function size() {
  const stage = $('.reader-stage').getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
  const css = Math.max(160, Math.min(stage.width - 8, stage.height - 8, segmentCap() - 24));
  cv.style.width = cv.style.height = css + 'px';
  const px = Math.round(css * dpr);
  if (cv.width !== px) { cv.width = px; cv.height = px; }
}
function draw() {
  const p = R.panels[R.i]; if (!p) return;
  FP.drawPanel(cv.getContext('2d'), p, cv.width, { balloons: R.beat });
  $('#read-count').textContent = `${R.i + 1} of ${R.panels.length}`;
  $('#read-prev').disabled = R.i === 0; $('#read-next').disabled = R.i === R.panels.length - 1 && R.beat >= FP.beatsOf(p);
  cv.setAttribute('aria-label', `Panel ${R.i + 1}: ` + p.lines.map(l => `${FP.CH[l.who].name}: ${l.text}`).join(' / '));
}
const wordsIn = p => p.balloons.reduce((n, o) => n + o.lines.join(' ').length, 0) + (p.caption ? p.caption.lines.join(' ').length : 0);
function step() {   // reveal the next balloon; when the panel is complete, wait for the reader (or move on when playing)
  clearTimeout(R.timer);
  const p = R.panels[R.i];
  if (R.beat < FP.beatsOf(p)) { R.beat++; draw(); R.timer = setTimeout(step, 650); return; }
  if (R.playing) {
    if (R.i < R.panels.length - 1) R.timer = setTimeout(() => go(R.i + 1), 1400 + wordsIn(p) * 28);
    else setPlaying(false);
  }
}
function go(i) {
  clearTimeout(R.timer);
  R.i = Math.max(0, Math.min(R.panels.length - 1, i));
  R.beat = reduced() ? FP.beatsOf(R.panels[R.i]) : 0;
  draw(); R.timer = setTimeout(step, reduced() ? 0 : 350);
}
function setPlaying(on) { R.playing = on; playBtn.textContent = on ? 'Pause' : 'Play'; playBtn.setAttribute('aria-pressed', String(on)); if (on) step(); else clearTimeout(R.timer); }
function next() { const p = R.panels[R.i]; if (R.beat < FP.beatsOf(p)) { R.beat = FP.beatsOf(p); draw(); } else if (R.i < R.panels.length - 1) go(R.i + 1); }
function openReader(start = 0) {
  R.panels = FP.layoutStrip(app.state, null);
  if (!R.panels.length) return app.toast('Draw a panel first, then read it here.');
  $('#read-title').textContent = (app.state.title || '').trim() || 'Untitled strip';
  app.open('#dlg-read'); size(); setPlaying(false); go(start);
}
app.ACTS.read = () => openReader(0);
app.on('read', i => openReader(i));
FP.whenArtLoads(() => { if (dlg.open) draw(); });
$('#read-prev').addEventListener('click', () => go(R.i - 1));
$('#read-next').addEventListener('click', next);
playBtn.addEventListener('click', () => setPlaying(!R.playing));
cv.addEventListener('click', next);
dlg.addEventListener('keydown', e => {
  if (e.key === 'ArrowRight' || e.key === 'PageDown') { e.preventDefault(); next(); }
  else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); go(R.i - 1); }
  else if (e.key === ' ' && e.target.tagName !== 'BUTTON') { e.preventDefault(); setPlaying(!R.playing); }
  else if (e.key === 'Home') go(0); else if (e.key === 'End') go(R.panels.length - 1);
});
let touch = null;
cv.addEventListener('pointerdown', e => { touch = { x: e.clientX, y: e.clientY }; });
cv.addEventListener('pointerup', e => {
  if (!touch) return; const dx = e.clientX - touch.x, dy = e.clientY - touch.y; touch = null;
  if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) { e.stopPropagation(); dx < 0 ? go(R.i + 1) : go(R.i - 1); cv._swiped = true; }
});
cv.addEventListener('click', e => { if (cv._swiped) { cv._swiped = false; e.stopImmediatePropagation(); } }, true);
dlg.addEventListener('close', () => { clearTimeout(R.timer); R.playing = false; });
new ResizeObserver(() => { if (dlg.open) { size(); draw(); } }).observe($('.reader-stage'));
})();
