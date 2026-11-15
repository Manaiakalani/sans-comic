/* Sans Comic interface: the strip view, the composer, the pickers and the sheets.
   The comic is a pure function of the script in `state`; every edit re-lays the strip through the engine. */
(() => {
'use strict';
const FP = window.FP, { CH, ART, E, MOOD, GLABEL, TONES, HANDS, INK, FONT, P, FLOOR } = FP;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const el = (tag, props = {}, kids = []) => { const n = Object.assign(document.createElement(tag), props); kids.forEach(k => n.append(k)); return n; };
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const bus = new EventTarget();
const emit = (type, detail) => bus.dispatchEvent(new CustomEvent(type, { detail }));

/* ================= storage ================= */
const KEY = 'sans-comic-v1', KEY_LIB = 'sans-comic-lib-v1';
// strips saved while the app was still called Funny Pages are picked up once, then kept under the new keys
const stored = (key, old) => { const v = localStorage.getItem(key); return v != null ? v : localStorage.getItem(old); };
const clone = o => JSON.parse(JSON.stringify(o));
const sample = () => ({
  id: 'first', title: 'First strip', cast: ['anna', 'dan', 'xeno'], speaker: 'anna', bg: 'tone-yellow', caps: false, turns: true,
  lines: [
    { id: 'a1', who: 'anna', text: 'Hi! Is this thing on?', kind: 'auto' },
    { id: 'a2', who: 'dan', text: 'You type it and it draws it. LOL', kind: 'auto' },
    { id: 'a3', who: 'xeno', text: '(I crossed forty light years for this?)', kind: 'auto' },
    { id: 'a4', who: 'anna', text: "I'm keeping it :)", kind: 'auto' },
    { id: 'a5', who: 'dan', text: 'WAIT. WHO INVITED THE ALIEN?!', kind: 'auto' },
  ],
});
const validStrip = s => s && typeof s === 'object' && Array.isArray(s.lines) && Array.isArray(s.cast) && s.cast.length && s.cast.every(c => CH[c]);
let state = sample(), lib = [], fullWarned = false, saveT = 0;
try { const s = JSON.parse(stored(KEY, 'funny-pages-v1')); if (validStrip(s)) state = Object.assign(sample(), s); } catch (e) { /* storage unavailable */ }
try { const l = JSON.parse(stored(KEY_LIB, 'funny-pages-lib-v1')); if (Array.isArray(l)) lib = l.filter(validStrip); } catch (e) { /* storage unavailable */ }
if (!state.id) state.id = FP.uid();
state.lines = state.lines.filter(l => l && CH[l.who] && typeof l.text === 'string');
// every strip with lines in it lives in the library; the one on screen is kept there as you write
function save() {
  state.updated = Date.now();
  const i = lib.findIndex(x => x.id === state.id);
  if (state.lines.length) { i >= 0 ? lib[i] = clone(state) : lib.unshift(clone(state)); } else if (i >= 0) lib.splice(i, 1);
  clearTimeout(saveT); saveT = setTimeout(flush, 250);   // batch writes, so typing doesn't rewrite the library on every key
}
function flush() {
  clearTimeout(saveT);
  try { localStorage.setItem(KEY, JSON.stringify(state)); localStorage.setItem(KEY_LIB, JSON.stringify(lib)); }
  catch (e) { if (!fullWarned && e && /quota/i.test(e.name + e.message)) { fullWarned = true; toast('This browser is out of room for saved comics. Delete an old one to keep saving.'); } }
}
addEventListener('pagehide', flush);
document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); });

/* ================= edits (one place, so undo, redo and shared rooms see every change) ================= */
const MAX_CAST = 6;
const redoStack = [];
function addLines(lines, { local = true } = {}) {
  for (const l of lines) if (!state.lines.some(x => x.id === l.id)) state.lines.push(l);
  if (!local) state.lines.sort((a, b) => (a.t || 0) - (b.t || 0) || (a.id < b.id ? -1 : 1));   // lines from a room arrive in any order
  lines.forEach(l => { if (CH[l.who] && !state.cast.includes(l.who) && state.cast.length < MAX_CAST) state.cast.push(l.who); });
  save(); renderCast(); render();
  if (local) emit('lines-added', lines);
}
function removeLine(id, { local = true } = {}) {
  const i = state.lines.findIndex(l => l.id === id); if (i < 0) return null;
  const [gone] = state.lines.splice(i, 1);
  save(); render();
  if (local) emit('line-removed', gone);
  return gone;
}
function updateLine(id, patch, { local = true } = {}) {
  const l = state.lines.find(x => x.id === id); if (!l) return;
  Object.assign(l, patch); save(); schedule();
  if (local) emit('line-updated', l);
}
function undo() {
  const mine = [...state.lines].reverse().find(l => !room.active || l.mine);
  if (!mine) return toast(room.active ? 'Nothing of yours to undo.' : 'Nothing to undo.');
  redoStack.push(removeLine(mine.id)); toast('Removed the last line. Redo puts it back.');
}
function redo() {
  const l = redoStack.pop(); if (!l) return toast('Nothing to redo.');
  addLines([l]);
}

/* ================= strip view ================= */
const stripEl = $('#strip'), scroller = $('#scroller'), textEl = $('#text'), castEl = $('#cast'), stageCv = $('#preview'), stageBtn = $('#btn-tray');
const draft = { emo: null, gest: 'auto', kind: 'auto', body: null };
let panels = [], pending = false, lastCount = -1, lastDraft = -1;
const visible = new Set();
const io = new IntersectionObserver(entries => {      // draw only the panels that are on screen, or about to be
  for (const en of entries) { en.isIntersecting ? visible.add(en.target) : visible.delete(en.target); if (en.isIntersecting) paintPanelButton(en.target); }
}, { root: scroller, rootMargin: '600px 0px' });
function paintPanelButton(b) {
  const cv = b.firstChild; if (!b._panel || cv._sig === b._sig) return;
  if (cv.width !== b._px) { cv.width = b._px; cv.height = b._px; }
  FP.drawPanel(cv.getContext('2d'), b._panel, b._px); cv._sig = b._sig;
}
function schedule() { if (!pending) { pending = true; requestAnimationFrame(() => { pending = false; render(); }); } }
function draftLine() { return { id: 'draft', who: state.speaker, text: textEl.value, kind: draft.kind, emo: draft.emo, gest: draft.gest, body: draft.body }; }
function render() {
  const typed = textEl.value.trim(), partial = /^\/[a-z]*$/i.test(typed);   // a half-typed /command isn't a line yet
  panels = FP.layoutStrip(state, typed && !partial ? draftLine() : null);   // the line being typed shows up as a draft panel
  new Set(panels.flatMap(p => p.ids)).forEach(FP.atlas);
  while (stripEl.children.length > panels.length) { io.unobserve(stripEl.lastChild); visible.delete(stripEl.lastChild); stripEl.lastChild.remove(); }
  const dpr = window.devicePixelRatio || 1;
  panels.forEach((p, i) => {
    let b = stripEl.children[i];
    if (!b) {
      b = el('button', { className: 'panel', type: 'button' }, [el('canvas')]);
      if (lastCount >= 0 && i >= lastCount) b.classList.add('new');
      b.addEventListener('animationend', () => b.classList.remove('new'));
      b.addEventListener('click', () => openPanel([...stripEl.children].indexOf(b)));
      stripEl.append(b); io.observe(b);
    }
    b.classList.toggle('draft', p.draft);
    b.setAttribute('aria-label', (p.draft ? 'Draft panel ' : 'Edit panel ') + (i + 1) + ': ' + p.lines.map(l => `${CH[l.who].name}: ${l.text}`).join(' / '));
    b._panel = p; b._px = Math.min(1400, Math.round((b.clientWidth || 320) * dpr));
    b._sig = JSON.stringify([p.lines.map(l => [l.id, l.who, l.text, l.kind, l.emo, l.gest, l.body, l.bg]), p.ids, p.bg, state.caps, state.font, state.frame, state.sides, state.tags, state.bgColor, state.customBgKey, b._px, FP.epoch]);
    if (visible.has(b) || p.draft || i >= panels.length - 2) paintPanelButton(b);
  });
  const di = panels.findIndex(p => p.draft);
  if (di >= 0 && di !== lastDraft) stripEl.children[di].scrollIntoView({ block: 'nearest', behavior: reduced() ? 'auto' : 'smooth' });
  lastDraft = di; lastCount = panels.length;
  $('#empty').hidden = panels.length > 0;
  $$('[data-act="undo"]').forEach(b => { b.disabled = !state.lines.length; });
  $$('canvas.th').forEach(c => { if (!c._done) paintThumb(c); });
  if ($('#dlg-lib').open) $$('#lib canvas').forEach(paintLibThumb);
  drawPreview();
  emit('rendered', panels);
}
FP.whenArtLoads(() => { schedule(); if (aud.id) audPaint(performance.now()); });   // the audition repaints as soon as its drawings arrive
new ResizeObserver(schedule).observe(stripEl);

/* ================= stage: the speaker, live ================= */
const VERB = { 1: 'smiling', 2: 'coy', 3: 'bored', 4: 'scared', 5: 'sad', 6: 'angry', 7: 'shouting', 8: 'laughing' };
const GVERB = { 10: 'waving', 11: 'pointing', 12: 'pointing at self', 13: 'pointing both ways', 14: 'shrugging', 15: 'walking off', 16: 'walking', 17: 'walking up' };
function paintStage(cv, ch, pose, o) {
  const r = cv.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
  if (!r.width) return false;
  const W = Math.max(40, Math.round(r.width * dpr)), H = Math.max(40, Math.round(r.height * dpr));
  if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
  const ctx = cv.getContext('2d'), box = FP.poseBox(ch, pose), bust = r.height < 150 && !!box.headH, k = Math.max(W, H) / P;
  ctx.save(); ctx.translate((W - P * k) / 2, H - P * k); ctx.scale(k, k); FP.drawBackdrop(ctx, state.bg, state); ctx.restore();
  const fig = { ch, box, flip: false };
  if (bust) { fig.s = Math.min(W, H) * 0.92 / (box.headH * 1.4); fig.feet = H * 0.07 + (box.H - box.headTop) * fig.s; fig.x = W / 2 - (box.faceX - box.W / 2) * fig.s * 0.6; }
  else { fig.s = Math.min(H * 0.8 / FP.standingHeight(ch), W * 0.9 / box.W, H * 0.88 / box.H); fig.feet = H - (P - FLOOR) * k; fig.x = W / 2; }
  let moving = false;
  if (!reduced()) {
    const t = (o.now - o.pop) / 320, u = (o.now - o.talk) / 460;
    if (t >= 0 && t < 1) { const w = Math.sin(t * Math.PI * 2) * (1 - t); fig.sy = 1 + 0.1 * w; fig.sx = 1 - 0.07 * w; moving = true; }   // squash and stretch on a new pose
    if (u >= 0 && u < 1 && box.head) { fig.headDy = -Math.abs(Math.sin(u * Math.PI * 2)) * 3.5; fig.headRot = Math.sin(u * Math.PI * 2) * 0.045; moving = true; }  // head bobs while you type
  }
  FP.drawFigure(ctx, fig);
  return moving;
}
const anim = { pop: -1e9, talk: -1e9, raf: 0, key: '' };
function stageTick(now) {
  const ch = CH[state.speaker], x = FP.readLine(draftLine(), state), pose = FP.pickPose(ch, x.emo, x.inten, x.gest, 7, x.img, x.body);
  const key = ch.id + ':' + (pose.b ? pose.b[0] : pose.f[0] + '/' + pose.t[0]);
  if (key !== anim.key) { if (anim.key) anim.pop = now; anim.key = key; }
  const said = [x.emo !== E.NEUTRAL && VERB[x.emo], x.gest && GVERB[x.gest]].filter(Boolean);
  $('#mood').textContent = said.length ? (stageCv.clientHeight < 150 ? said[0] : said.join(' + ')) : (draft.emo ? 'neutral' : draft.gest === 0 ? 'standing' : 'auto');
  if (paintStage(stageCv, ch, pose, { now, pop: anim.pop, talk: anim.talk })) anim.raf = requestAnimationFrame(stageTick);
}
function drawPreview() { cancelAnimationFrame(anim.raf); stageTick(performance.now()); }
new ResizeObserver(drawPreview).observe(stageBtn);

/* ================= pickers built from the character's own drawings ================= */
const AS = FP.AS, frames = {};
function frameOf(ch, kind) {   // every head (or body) of a character shares one frame, so thumbnails line up
  const key = ch.id + kind; if (frames[key]) return frames[key];
  if (kind === 'f') {           // heads: centre on where the drawing's weight is, so necks and stray marks can't pull the face off-centre
    const mid = fn => { const v = ch.f.map(fn).sort((p, q) => p - q); return v[v.length >> 1]; };
    const cx = mid(r => ch.cm[r[0]][0] / AS - r[3]), cy = mid(r => ch.cm[r[0]][1] / AS - r[4]), side = mid(r => ch.cm[r[0]][2] / AS) * 3.1;
    return frames[key] = [cx - side / 2, cy - side / 2, side];
  }
  let l = 1e9, t = 1e9, r = -1e9, b = -1e9;
  for (const rec of ch[kind]) { const bb = ch.bb[rec[0]]; l = Math.min(l, bb[0] / AS - rec[3]); t = Math.min(t, bb[1] / AS - rec[4]); r = Math.max(r, (bb[0] + bb[2]) / AS - rec[3]); b = Math.max(b, (bb[1] + bb[3]) / AS - rec[4]); }
  const side = Math.max(r - l, b - t);
  return frames[key] = [(l + r - side) / 2, (t + b - side) / 2, side];
}
function paintThumb(cv) {
  const ctx = cv.getContext('2d'), N = cv.width, sp = cv._spec;
  ctx.clearRect(0, 0, N, N);
  if (sp.kind) {
    ctx.save(); ctx.scale(N / 400, N / 400);
    if (sp.kind === 'action') {
      ctx.fillStyle = '#ffd43b'; ctx.strokeStyle = INK; ctx.lineWidth = 12; ctx.fillRect(40, 110, 320, 150); ctx.strokeRect(40, 110, 320, 150);
      ctx.fillStyle = INK; for (const y of [160, 210]) ctx.fillRect(80, y - 8, y === 160 ? 240 : 170, 16);
    } else if (sp.kind !== 'none') FP.drawBalloon(ctx, { kind: sp.kind, lines: [sp.kind === 'shout' || sp.kind === 'fx' ? 'AA' : 'Aa'], font: `${sp.kind === 'say' || sp.kind === 'shout' || sp.kind === 'fx' ? '' : 'italic '}700 96px ${FONT}`, lh: 100, cx: 200, cy: 150, a: sp.kind === 'shout' || sp.kind === 'fx' ? 110 : 150, b: sp.kind === 'shout' || sp.kind === 'fx' ? 70 : 95, tx: 150, ty: 395, seed: 5, tilt: 0 });
    ctx.restore(); cv._done = true; return;
  }
  const rec = FP.atlas(sp.ch.id);
  if (!rec.ready) { cv._done = false; return; }
  const im = sp.ch.im[sp.i], bb = sp.ch.bb[sp.i];
  ctx.imageSmoothingQuality = 'high';
  if (sp.reg) {
    const fr = frameOf(sp.ch, sp.reg), k = (N - 8) / fr[2];
    ctx.drawImage(rec.img, im[0], im[1], im[2], im[3], 4 + (-sp.a[0] - fr[0]) * k, 4 + (-sp.a[1] - fr[1]) * k, im[2] / AS * k, im[3] / AS * k);
  } else {
    const sw = bb[2], sh = sp.top ? Math.min(bb[3], bb[2] * 1.1) : bb[3], k = Math.min((N - 8) / sw, (N - 8) / sh);
    ctx.drawImage(rec.img, im[0] + bb[0], im[1] + bb[1], sw, sh, (N - sw * k) / 2, sp.top ? 4 : (N - sh * k) / 2, sw * k, sh * k);
  }
  cv._done = true;
}
const faceSpec = (ch, rec) => ch.f.length ? { ch, i: rec[0], reg: 'f', a: [rec[3], rec[4]] } : { ch, i: rec[0], top: true };
const bodySpec = (ch, rec) => ch.f.length ? { ch, i: rec[0], reg: 't', a: [rec[3], rec[4]] } : { ch, i: rec[0] };
const poseFace = (ch, p) => faceSpec(ch, p.b || p.f), poseBody = (ch, p) => bodySpec(ch, p.b || p.t);
const autoRead = () => FP.readLine(Object.assign(draftLine(), { emo: null, gest: 'auto', kind: 'auto', body: null }), state);
function pick(label, spec, checked, onPick, badge) {
  const cv = el('canvas', { className: 'th', width: 96, height: 96 }); cv._spec = spec; paintThumb(cv);
  const b = el('button', { type: 'button', className: 'pick' + (label === 'Auto' ? ' auto' : '') }, [cv, el('span', { textContent: label })]);
  b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', String(!!checked)); b.dataset.k = label;
  if (badge) b.append(el('i', { className: 'badge', textContent: badge }));
  b.addEventListener('click', () => { onPick(); const host = b.parentElement.id; renderPickers(); drawPreview(); schedule(); const again = $(`#${host} [data-k="${label}"]`); if (again) again.focus(); });
  return b;
}
const TABS = [['moods', 'Mood'], ['gestures', 'Gesture'], ['kinds', 'Balloon']]; let tab = 'moods', autoThumbs = [];
const KIND_NAMES = { say: 'Say', think: 'Think', whisper: 'Whisper', shout: 'Shout', action: 'Narrate', fx: 'Sound FX' };
function renderPickers() {
  const ch = CH[state.speaker], x = autoRead(), auto = FP.pickPose(ch, x.emo, x.inten, x.gest, 7), still = FP.pickPose(ch, E.NEUTRAL, 0, 0, 7);
  const moods = FP.moodsOf(ch), cur = draft.emo;
  const m = [pick('Auto', poseFace(ch, auto), !cur, () => { draft.emo = null; }),
             pick('Neutral', poseFace(ch, still), cur && cur.e === E.NEUTRAL, () => { draft.emo = { e: E.NEUTRAL, i: 0 }; })];
  for (const e of [1, 8, 2, 3, 5, 4, 6, 7]) {
    const v = moods[e]; if (!v) continue;
    const on = !!cur && cur.e === e, at = on ? Math.max(0, v.findIndex(r => r[0] === cur.img)) : v.length - 1;
    m.push(pick(MOOD[e], faceSpec(ch, v[at]), on, () => { const n = on ? (at + 1) % v.length : v.length - 1; draft.emo = { e, i: v[n][2] / 255, img: v[n][0] }; }, on && v.length > 1 ? `${at + 1}/${v.length}` : ''));
  }
  $('#moods').replaceChildren(...m);
  // Still steps through every standing pose the character has, the way a mood steps through its faces
  const stills = ch.f.length ? ch.t.filter(r => r[1] === E.NEUTRAL).filter((r, k, all) => all.findIndex(q => q[0] === r[0]) === k) : [];
  const stillOn = draft.gest === 0, sAt = stillOn && stills.length ? Math.max(0, stills.findIndex(r => r[0] === draft.body)) : 0;
  const g = [pick('Auto', poseBody(ch, auto), draft.gest === 'auto', () => { draft.gest = 'auto'; draft.body = null; }),
             pick('Still', stills.length ? bodySpec(ch, stills[sAt]) : poseBody(ch, still), stillOn, () => {
               draft.gest = 0; draft.body = stills.length ? stills[stillOn ? (sAt + 1) % stills.length : 0][0] : null;
             }, stillOn && stills.length > 1 ? `${sAt + 1}/${stills.length}` : '')];
  for (const code of FP.gesturesOf(ch)) { const rec = (ch.f.length ? ch.t : ch.b).find(r => r[1] === code); g.push(pick(GLABEL[code] || 'Pose', bodySpec(ch, rec), draft.gest === code, () => { draft.gest = code; draft.body = null; })); }
  $('#gestures').replaceChildren(...g);
  $('#kinds').replaceChildren(pick('Auto', { kind: x.kind }, draft.kind === 'auto', () => { draft.kind = 'auto'; }), ...Object.entries(KIND_NAMES).map(([val, label]) => pick(label, { kind: val }, draft.kind === val, () => { draft.kind = val; })));
  autoThumbs = ['#moods', '#gestures', '#kinds'].map(q => $(q + ' .pick.auto canvas'));
  const value = [cur ? (cur.e === E.NEUTRAL ? 'Neutral' : MOOD[cur.e]) : 'Auto', draft.gest === 'auto' ? 'Auto' : draft.gest === 0 ? 'Still' : GLABEL[draft.gest] || 'Pose', draft.kind === 'auto' ? 'Auto' : KIND_NAMES[draft.kind]];
  $('#tabs').replaceChildren(...TABS.map(([id, label], n) => {
    const chosen = el('em', { textContent: value[n] }); chosen.classList.toggle('set', value[n] !== 'Auto');
    const b = el('button', { type: 'button', className: 'tab' }, [label, chosen]);
    b.setAttribute('role', 'tab'); b.setAttribute('aria-selected', String(tab === id)); b.setAttribute('aria-controls', id);
    b.addEventListener('click', () => { tab = id; renderPickers(); $('#tabs [aria-selected="true"]').focus(); });
    $('#' + id).classList.toggle('off', tab !== id);
    return b;
  }));
}
function syncAuto() {   // while typing, the Auto chips show what the words are choosing
  const ch = CH[state.speaker], x = autoRead(), auto = FP.pickPose(ch, x.emo, x.inten, x.gest, 7);
  const specs = [poseFace(ch, auto), poseBody(ch, auto), { kind: x.kind }];
  autoThumbs.forEach((cv, n) => { if (cv && (cv._spec.i !== specs[n].i || cv._spec.kind !== specs[n].kind)) { cv._spec = specs[n]; paintThumb(cv); } });
}
function resetDraft() { draft.emo = null; draft.gest = 'auto'; draft.kind = 'auto'; draft.body = null; renderPickers(); }
const tray = $('#tray');
// arrow keys walk the choices in a row and the tabs; a sideways swipe changes tab on a phone
tray.addEventListener('keydown', e => {
  const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
  const here = e.target.closest('.pick, .tab'); if (!step || !here) return;
  e.preventDefault();
  const host = here.parentElement.id, all = [...here.parentElement.children], n = (all.indexOf(here) + step + all.length) % all.length;
  all[n].click(); const now = $('#' + host).children[n]; if (now) now.focus();
});
let swipe = null;
$('.pickstack').addEventListener('pointerdown', e => { if (e.pointerType !== 'mouse') swipe = { x: e.clientX, y: e.clientY }; });
$('.pickstack').addEventListener('pointerup', e => {
  if (!swipe) return; const dx = e.clientX - swipe.x, dy = e.clientY - swipe.y; swipe = null;
  if (Math.abs(dx) > 60 && Math.abs(dx) > 2 * Math.abs(dy)) { const i = TABS.findIndex(t => t[0] === tab); tab = TABS[(i + (dx < 0 ? 1 : TABS.length - 1)) % TABS.length][0]; renderPickers(); }
});
function setTray(openIt) { tray.hidden = !openIt; stageBtn.setAttribute('aria-expanded', String(openIt)); drawPreview(); }
stageBtn.addEventListener('click', () => setTray(tray.hidden));

/* segmented controls used across the sheets */
const segPaints = [];
function seg(host, options, get, set, deco) {
  const paint = () => host.replaceChildren(...options.map(([val, label]) => {
    const b = el('button', { type: 'button', textContent: label });
    b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', String(get() === val));
    if (deco) deco(b, val);
    b.addEventListener('click', () => { set(val); paint(); });
    return b;
  }));
  paint(); segPaints.push(paint); return paint;
}

/* ================= cast chips and the composer ================= */
const faceStyle = id => { const i = CH[id].idx; return `background-position:${(i % 8) / 7 * 100}% ${Math.floor(i / 8) / 3 * 100}%`; };
function setSpeaker(id) { if (!state.cast.includes(id)) return; state.speaker = id; save(); renderCast(); resetDraft(); drawPreview(); schedule(); emit('speaker', id); }
function renderCast() {
  if (!state.cast.includes(state.speaker)) state.speaker = state.cast[0];
  castEl.replaceChildren(...state.cast.map((id, n) => {
    const b = el('button', { className: 'chip', type: 'button', title: `${CH[id].name} speaks${n < 6 ? ` (Alt+${n + 1})` : ''}` }, [el('span', { className: 'face', style: faceStyle(id) }), el('span', { className: 'nm', textContent: CH[id].name })]);
    b.setAttribute('aria-label', CH[id].name);
    if (n < 6) b.append(el('kbd', { textContent: n + 1 }));
    b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', String(id === state.speaker));
    b.addEventListener('click', () => { setSpeaker(id); textEl.focus(); });
    return b;
  }));
  state.cast.forEach(FP.atlas);
  fitCast();
}
function fitCast() { castEl.classList.remove('tight'); if (castEl.scrollWidth > castEl.clientWidth + 1) castEl.classList.add('tight'); fadeCast(); }
// a soft fade on the right says the speaker row scrolls, until you reach its end
function fadeCast() { castEl.classList.toggle('more', castEl.scrollWidth - castEl.scrollLeft - castEl.clientWidth > 4); }
castEl.addEventListener('scroll', fadeCast, { passive: true });
addEventListener('resize', fitCast);
const TIPS = ['Say something…', 'Try: LOL that is ridiculous', 'Try: (I should not have said that)', 'Try: /wave Hello down there!', 'Try: *slowly backs away*', 'Try: /fx KABOOM', 'Try: ~do not tell anyone~', 'Type / for gestures and effects'];
let tip = 0;
function autosize() { textEl.style.height = 'auto'; textEl.style.height = Math.min(132, Math.max(56, textEl.scrollHeight + 3)) + 'px'; }

/* slash commands: type / to see the gestures this character has, plus dice, coins and sound effects */
const slashEl = $('#slash'); let slashItems = [], slashAt = 0;
function slashOptions(prefix) {
  const ch = CH[state.speaker], gs = new Set(FP.gesturesOf(ch)), moods = FP.moodsOf(ch);
  return FP.COMMANDS.filter(([name, c]) => name.startsWith(prefix) && (!c.g || gs.has(c.g)) && (!c.e || moods[c.e]));
}
function renderSlash() {
  const m = textEl.value.match(/^\/([a-z]*)$/i);
  slashItems = m ? slashOptions(m[1].toLowerCase()) : [];
  slashEl.hidden = !slashItems.length;
  textEl.setAttribute('aria-expanded', String(!!slashItems.length));
  if (!slashItems.length) return;
  slashAt = Math.min(slashAt, slashItems.length - 1);
  slashEl.replaceChildren(...slashItems.map(([name, , desc], i) => {
    const b = el('button', { type: 'button', id: 'slash-' + name }, [el('b', { textContent: '/' + name }), el('span', { textContent: desc })]);
    b.setAttribute('role', 'option'); b.setAttribute('aria-selected', String(i === slashAt));
    b.addEventListener('pointerdown', e => e.preventDefault());
    b.addEventListener('click', () => chooseSlash(i));
    return b;
  }));
  textEl.setAttribute('aria-activedescendant', 'slash-' + slashItems[slashAt][0]);
  slashEl.children[slashAt].scrollIntoView({ block: 'nearest' });
}
function chooseSlash(i) { textEl.value = '/' + slashItems[i][0] + ' '; slashItems = []; slashEl.hidden = true; textEl.focus(); textEl.dispatchEvent(new Event('input')); }
const DIE = /^\/roll(?:\s+(\d{0,2})d(\d{1,3})(?:\s*\+\s*(\d{1,3}))?)?\s*$/i;
function expandAppCommand(text) {   // dice and coins are rolled once, when the line is drawn, so the result never changes
  let m;
  if ((m = text.match(DIE))) {
    const n = Math.min(12, Math.max(1, +m[1] || 1)), sides = Math.min(100, Math.max(2, +m[2] || 6)), plus = +m[3] || 0;
    const rolls = Array.from({ length: n }, () => 1 + Math.floor(Math.random() * sides)), total = rolls.reduce((a, b) => a + b, 0) + plus;
    return `*rolls ${n}d${sides}${plus ? '+' + plus : ''}: ${rolls.length > 1 || plus ? rolls.join(' + ') + (plus ? ' + ' + plus : '') + ' = ' : ''}${total}*`;
  }
  if (/^\/flip\s*$/i.test(text)) return `*flips a coin: ${Math.random() < 0.5 ? 'heads' : 'tails'}*`;
  if (/^\/roll\b/i.test(text)) { toast('Write dice like /roll 2d6 or /roll d20+3.'); return null; }
  return text;
}
textEl.addEventListener('input', () => { autosize(); anim.talk = performance.now(); renderSlash(); syncAuto(); drawPreview(); schedule(); emit('typing', !!textEl.value.trim()); });
textEl.addEventListener('blur', () => { slashEl.hidden = true; });
textEl.addEventListener('keydown', e => {
  if (!slashEl.hidden && slashItems.length) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); slashAt = (slashAt + (e.key === 'ArrowDown' ? 1 : slashItems.length - 1)) % slashItems.length; renderSlash(); return; }
    if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) { e.preventDefault(); chooseSlash(slashAt); return; }
    if (e.key === 'Escape') { e.preventDefault(); slashEl.hidden = true; return; }
  }
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); $('#composer').requestSubmit(); }
  else if ((e.ctrlKey || e.metaKey) && !textEl.value && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) { e.preventDefault(); redo(); }
  else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !textEl.value) { e.preventDefault(); undo(); }
});
document.addEventListener('keydown', e => {
  if (e.altKey && /^Digit[1-6]$/.test(e.code) && !document.querySelector('dialog[open]')) { const id = state.cast[+e.code.slice(5) - 1]; if (id) { e.preventDefault(); setSpeaker(id); textEl.focus(); } }
});
$('#composer').addEventListener('submit', e => {
  e.preventDefault();
  if (room.watching) return toast('You are watching this room. Ask its owner for edit access to join in.');
  const typed = textEl.value.trim();
  if (!typed) { textEl.focus(); return; }
  const text = expandAppCommand(typed); if (text == null) return;
  const line = { id: FP.uid(), who: state.speaker, text, kind: draft.kind, emo: draft.emo, gest: draft.gest === 'auto' ? null : draft.gest, body: draft.body, t: Date.now(), mine: true };
  redoStack.length = 0;
  advanceSpeaker();
  textEl.value = ''; textEl.placeholder = TIPS[++tip % TIPS.length]; autosize(); slashEl.hidden = true;
  resetDraft(); lastDraft = -1; addLines([line]); emit('typing', false);
  stageBtn.classList.remove('sent'); void stageBtn.offsetWidth; stageBtn.classList.add('sent');
  requestAnimationFrame(() => scroller.scrollTo({ top: scroller.scrollHeight, behavior: reduced() ? 'auto' : 'smooth' }));
  textEl.focus();
});
function advanceSpeaker() {
  if (!state.turns || state.cast.length < 2 || room.active) return;
  const i = state.cast.indexOf(state.speaker);
  state.speaker = state.cast[(i < 0 ? 0 : i + 1) % state.cast.length];
}
const setTurns = v => { state.turns = v; $('#turns').checked = $('#turns-m').checked = v; save(); };
$('#turns').checked = $('#turns-m').checked = !!state.turns;
$('#turns').addEventListener('change', e => setTurns(e.target.checked));
$('#turns-m').addEventListener('change', e => setTurns(e.target.checked));
$('#title').value = state.title || '';
const setTitle = v => { state.title = v; $('#title').value = v; $('#title-m').value = v; save(); emit('title', v); };
$('#title').addEventListener('input', e => setTitle(e.target.value));
$('#title-m').addEventListener('input', e => setTitle(e.target.value));
$('#title-m').value = state.title || '';

/* ================= sheets ================= */
const toastEl = $('#toast'); let toastT;
function toast(msg) { toastEl.textContent = msg; toastEl.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => toastEl.classList.remove('show'), 2800); }
const open = id => { const d = $(id); if (!d.open) d.showModal(); };
const close = id => { const d = $(id); if (d.open) d.close(); };
$$('dialog').forEach(d => d.addEventListener('click', e => { if (e.target === d) d.close(); }));
// every button with data-act runs the same action, wherever it sits (header on desktop, the More sheet on a phone)
const ACTS = {};
document.addEventListener('click', e => { const b = e.target.closest('[data-act]'); if (b && ACTS[b.dataset.act]) { if (b.closest('#dlg-more')) close('#dlg-more'); ACTS[b.dataset.act](b); } });

// casting: every character auditions through its own poses
const aud = { id: null, seq: [], at: 0, pop: -1e9, raf: 0, timer: 0 };
function audPaint(now) { cancelAnimationFrame(aud.raf); if (aud.id && paintStage($('#audition'), CH[aud.id], aud.seq[aud.at].pose, { now, pop: aud.pop, talk: -1e9 })) aud.raf = requestAnimationFrame(audPaint); }
function audition(id) {
  const ch = CH[id], moods = FP.moodsOf(ch), gs = FP.gesturesOf(ch);
  aud.id = id; aud.at = 0; aud.pop = performance.now();
  aud.seq = [{ label: 'Hello.', pose: FP.pickPose(ch, E.NEUTRAL, 0, 0, 7) },
    ...[1, 8, 2, 3, 5, 4, 6, 7].filter(e => moods[e]).map(e => ({ label: MOOD[e], pose: FP.pickPose(ch, e, 1, 0, 7) })),
    ...gs.map(c => ({ label: GLABEL[c] || 'Pose', pose: FP.pickPose(ch, E.NEUTRAL, 0, c, 7) }))];
  const nm = Object.keys(moods).length;
  $('#aud-name').textContent = ch.name;
  $('#aud-stats').textContent = aud.seq.length === 1 ? 'One pose, no expressions.' : `${nm} mood${nm === 1 ? '' : 's'}, ${gs.length} gesture${gs.length === 1 ? '' : 's'}.`;
  $('#aud-mood').textContent = aud.seq[0].label;
  $('#aud-toggle').textContent = state.cast.includes(id) ? 'Remove from cast' : 'Add to cast';
  $$('#gallery button').forEach(b => b.classList.toggle('focus', b.dataset.id === id));
  FP.atlas(id); audPaint(performance.now());
}
function toggleCast(id) {
  if (state.cast.includes(id)) { if (state.cast.length === 1) return toast('Keep at least one character.'); state.cast = state.cast.filter(x => x !== id); }
  else { if (state.cast.length >= MAX_CAST) return toast('Six is the limit. Remove someone first.'); state.cast.push(id); state.speaker = id; emit('speaker', id); }
  save(); renderGallery(); renderCast(); resetDraft(); drawPreview(); schedule(); audition(id);
}
function renderGallery() {
  $('#gallery').replaceChildren(...ART.chars.map(c => {
    const n = state.cast.indexOf(c.id), poses = c.f.length + c.t.length + c.b.length;
    const b = el('button', { type: 'button' }, [el('span', { className: 'face', style: faceStyle(c.id) }), c.name, el('small', { textContent: poses === 1 ? 'one pose' : n >= 0 ? 'in the cast' : ' ' })]);
    b.dataset.id = c.id; b.setAttribute('aria-pressed', String(n >= 0));
    if (n >= 0) b.append(el('i', { className: 'badge', textContent: n + 1 }));
    b.addEventListener('click', () => toggleCast(c.id));
    b.addEventListener('pointerenter', e => { if (e.pointerType === 'mouse') audition(c.id); });
    b.addEventListener('focus', () => audition(c.id));
    return b;
  }));
}
$('#aud-toggle').addEventListener('click', () => aud.id && toggleCast(aud.id));
$('#btn-cast').addEventListener('click', () => {
  renderGallery(); open('#dlg-cast'); audition(state.speaker);
  clearInterval(aud.timer);
  aud.timer = setInterval(() => { if (aud.seq.length < 2) return; aud.at = (aud.at + 1) % aud.seq.length; aud.pop = performance.now(); $('#aud-mood').textContent = aud.seq[aud.at].label; audPaint(aud.pop); }, 1150);
});
$('#dlg-cast').addEventListener('close', () => { clearInterval(aud.timer); cancelAnimationFrame(aud.raf); aud.id = null; });

// look: panel backdrops, page background, drawing style
const backdropChoices = () => [...Object.entries(TONES).map(([id, t]) => [id, t[0]]), ['paper', 'Paper'], ['color', 'Solid colour'], ...(state.customBg ? [['custom', 'Your photo']] : []), ...ART.bgs.map(b => [b.id, b.name])];
function renderLook() {
  $('#bgs').replaceChildren(...backdropChoices().map(([id, name]) => {
    const drawn = TONES[id] || id === 'paper' || id === 'color';
    const thumb = drawn ? el('canvas', { width: 160, height: 160 }) : el('img', { src: id === 'custom' ? state.customBg : `art/bg-${id}.jpg`, alt: '', loading: 'lazy' });
    if (drawn) { const c = thumb.getContext('2d'); c.scale(0.16, 0.16); FP.drawBackdrop(c, id, state); }
    const b = el('button', { type: 'button' }, [thumb, name]);
    b.setAttribute('aria-pressed', String(state.bg === id));
    b.addEventListener('click', () => { state.bg = id; save(); renderLook(); render(); emit('style'); });
    return b;
  }));
  $('#bg-color').value = state.bgColor || '#bfe3f5';
  $('#bg-upload').textContent = state.customBg ? 'Change the photo' : 'Upload a photo';
}
$('#bg-color').addEventListener('input', e => { state.bgColor = e.target.value; state.bg = 'color'; save(); renderLook(); render(); emit('style'); });
$('#bg-upload').addEventListener('click', () => $('#bg-file').click());
$('#bg-file').addEventListener('change', e => {
  const file = e.target.files[0]; e.target.value = '';
  if (!file) return;
  const url = URL.createObjectURL(file), img = new Image();
  img.onload = () => {   // crop to a square and shrink, so it fits in the browser's storage
    const c = el('canvas', { width: 800, height: 800 }), side = Math.min(img.naturalWidth, img.naturalHeight);
    c.getContext('2d').drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, 800, 800);
    state.customBg = c.toDataURL('image/jpeg', 0.82); state.customBgKey = FP.uid(); state.bg = 'custom';
    URL.revokeObjectURL(url); save(); renderLook(); render();
  };
  img.onerror = () => { URL.revokeObjectURL(url); toast('This browser cannot open that file as a picture. Try a JPEG or PNG.'); };
  img.src = url;
});
const applyCols = () => { +state.perRow > 1 ? stripEl.style.setProperty('--cols', `repeat(${+state.perRow}, minmax(0, 1fr))`) : stripEl.style.removeProperty('--cols'); schedule(); };
function loadHand() { const h = FP.handOf(state); if (document.fonts && document.fonts.load) document.fonts.load(`${h[2]} 40px ${h[1]}`).then(schedule, () => {}); }
const styled = fn => v => { fn(v); save(); render(); emit('style'); };
seg($('#hands'), Object.entries(HANDS).map(([id, h]) => [id, h[0]]), () => state.font || 'classic', styled(v => { state.font = v; loadHand(); }), (b, id) => { b.style.fontFamily = HANDS[id][1]; b.style.fontWeight = HANDS[id][2]; b.style.fontSize = '15px'; });
seg($('#caps'), [[false, 'Mixed case'], [true, 'ALL CAPS']], () => !!state.caps, styled(v => { state.caps = v; }));
seg($('#frames'), [['plain', 'Plain'], ['rough', 'Rough'], ['none', 'None']], () => state.frame || 'plain', styled(v => { state.frame = v; }));
seg($('#perrow'), [['auto', 'Auto'], [2, '2'], [3, '3'], [4, '4']], () => +state.perRow > 1 ? +state.perRow : 'auto', v => { state.perRow = v; save(); applyCols(); });
seg($('#sides'), [[true, 'Keep sides'], [false, 'Swap freely']], () => state.sides !== false, styled(v => { state.sides = v; }));
seg($('#tags'), [[false, 'Off'], [true, 'Show names']], () => !!state.tags, styled(v => { state.tags = v; }));
const LOOKS = [['look-panels', 'Panel backdrop'], ['look-page', 'Page background'], ['look-drawing', 'Drawing']]; let lookTab = 'look-panels';
function renderLookTabs() {
  $('#look-tabs').replaceChildren(...LOOKS.map(([id, label]) => {
    const b = el('button', { type: 'button', className: 'tab', textContent: label });
    b.setAttribute('role', 'tab'); b.setAttribute('aria-selected', String(lookTab === id)); b.setAttribute('aria-controls', id);
    b.addEventListener('click', () => { lookTab = id; renderLookTabs(); $('#look-tabs [aria-selected="true"]').focus(); });
    $('#' + id).classList.toggle('off', lookTab !== id);
    return b;
  }));
}
const TINTS = [['auto', 'Match theme', 'linear-gradient(135deg, #dfe8ee 50%, #12171b 50%)'], ['paper', 'Paper', '#fff'], ['yellow', 'Yellow', '#ffd43b'], ['blue', 'Blue', '#a9dcef'], ['pink', 'Pink', '#ffc2d1'], ['mint', 'Mint', '#bdebd0'], ['ink', 'Ink', '#0c0e10']];
function applyPage() { scroller.dataset.tint = state.pageTint || 'auto'; scroller.dataset.pattern = state.pagePattern || 'dots'; }
function renderTints() {
  $('#tints').replaceChildren(...TINTS.map(([id, name, fill]) => {
    const b = el('button', { type: 'button' }, [el('i', { style: 'background:' + fill }), name]);
    b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', String((state.pageTint || 'auto') === id));
    b.addEventListener('click', () => { state.pageTint = id; save(); applyPage(); renderTints(); });
    return b;
  }));
}
seg($('#patterns'), [['dots', 'Halftone'], ['grid', 'Grid'], ['stripes', 'Stripes'], ['plain', 'Plain']], () => state.pagePattern || 'dots', v => { state.pagePattern = v; save(); applyPage(); });
ACTS.look = () => { renderLook(); renderTints(); renderLookTabs(); open('#dlg-look'); };

// paste a chat
function importChat(raw, fresh) {
  const rows = []; let last = null;
  for (const row of raw.split(/\r?\n/)) {
    const t = row.trim(); if (!t) continue;
    const m = t.match(/^(?:\[[^\]]*\]\s*|\d{1,2}[:.]\d{2}(?:\s?[ap]m)?\s*[-\u2013]?\s*)?([^:]{1,28}?)\s*:\s+(.+)$/i);
    if (m) { last = m[1].trim(); rows.push([last, m[2]]); } else if (last) rows.push([last, t]); else rows.push(['', t]);
  }
  if (!rows.length) return 0;
  const names = [...new Set(rows.map(r => r[0]))], map = {}, taken = new Set();
  names.forEach(nm => { const id = FP.NAME_TO_ID[nm.toLowerCase()]; if (id && !taken.has(id)) { map[nm] = id; taken.add(id); } });
  const pool = [...(fresh ? [] : state.cast), 'anna', 'dan', 'margaret', 'mike', 'susan', 'lance', 'kwensa', 'hugh', 'xeno', 'tiki'].filter((c, i, a) => a.indexOf(c) === i);
  names.forEach((nm, i) => { if (!map[nm]) { const id = pool.find(c => !taken.has(c)) || pool[i % pool.length]; map[nm] = id; taken.add(id); } });
  const t0 = Date.now(), lines = rows.map(([nm, text], i) => ({ id: FP.uid(), who: map[nm], text: text.slice(0, 260), kind: 'auto', t: t0 + i, mine: true }));
  const cast = [...new Set(lines.map(l => l.who))].slice(0, MAX_CAST);
  if (fresh) { newStrip({ quiet: true }); state.cast = cast; }
  else state.cast = [...new Set([...state.cast, ...cast])].slice(0, MAX_CAST);
  state.speaker = state.cast[0];
  lastCount = fresh ? 0 : lastCount; addLines(lines);
  return lines.length;
}
ACTS.paste = () => { open('#dlg-paste'); $('#paste-text').focus(); };
$('#paste-go').addEventListener('click', () => {
  const n = importChat($('#paste-text').value, $('#paste-new').checked);
  if (!n) return toast('Paste at least one line first.');
  $('#paste-text').value = ''; close('#dlg-paste'); resetDraft();
  scroller.scrollTo({ top: 0 }); toast(`Drew ${n} line${n > 1 ? 's' : ''}.`);
});

// edit a panel: rewrite, recast, reorder, give it its own backdrop, or save it on its own
let editing = null;
function openPanel(i) {
  const p = panels[i]; if (!p) return;
  const real = p.lines.filter(l => l.id !== 'draft');
  if (!real.length) return textEl.focus();
  editing = { lines: real, index: i };
  $('#panel-title').textContent = `Panel ${i + 1}`;
  renderPanelEditor(); open('#dlg-panel');
}
function renderPanelEditor() {
  const host = $('#panel-lines'), lines = editing.lines.filter(l => state.lines.includes(l));
  if (!lines.length) return close('#dlg-panel');
  host.replaceChildren(...lines.map(line => {
    const who = el('select', { ariaLabel: 'Speaker' }, [...new Set([...state.cast, line.who])].map(id => el('option', { value: id, textContent: CH[id].name, selected: id === line.who })));
    const input = el('input', { type: 'text', value: line.text, maxLength: 260, ariaLabel: 'Line' });
    const idx = state.lines.indexOf(line);
    const up = el('button', { type: 'button', className: 'btn ghost icon-btn', textContent: '↑', title: 'Move earlier', ariaLabel: 'Move earlier', disabled: idx === 0 });
    const down = el('button', { type: 'button', className: 'btn ghost icon-btn', textContent: '↓', title: 'Move later', ariaLabel: 'Move later', disabled: idx === state.lines.length - 1 });
    const del = el('button', { type: 'button', className: 'btn danger', textContent: 'Delete' });
    who.addEventListener('change', () => updateLine(line.id, { who: who.value }));
    input.addEventListener('input', () => updateLine(line.id, { text: input.value }));
    const move = d => { const i = state.lines.indexOf(line), j = i + d; if (j < 0 || j >= state.lines.length) return; [state.lines[i], state.lines[j]] = [state.lines[j], state.lines[i]]; const ti = state.lines[i].t; state.lines[i].t = state.lines[j].t; state.lines[j].t = ti; save(); render(); renderPanelEditor(); emit('reordered'); };
    up.addEventListener('click', () => move(-1)); down.addEventListener('click', () => move(1));
    del.addEventListener('click', () => { removeLine(line.id); renderPanelEditor(); });
    return el('div', { className: 'line' }, [who, input, el('div', { className: 'line-tools' }, [up, down, del])]);
  }));
  const bgSel = $('#panel-bg'), cur = lines[0].bg || '';
  bgSel.replaceChildren(el('option', { value: '', textContent: 'Same as the strip' }), ...backdropChoices().map(([id, name]) => el('option', { value: id, textContent: name, selected: id === cur })));
}
$('#panel-bg').addEventListener('change', e => { editing.lines.forEach(l => updateLine(l.id, { bg: e.target.value || undefined })); render(); });
$('#panel-read').addEventListener('click', () => { const i = panels.findIndex(p => p.lines.includes(editing.lines[0])); close('#dlg-panel'); emit('read', Math.max(0, i)); });
$('#panel-save').addEventListener('click', () => { const p = panels.find(q => q.lines.includes(editing.lines[0])); if (p) emit('save-panel', p); });
$('#dlg-panel').addEventListener('close', () => { state.lines.filter(l => !l.text.trim()).forEach(l => removeLine(l.id)); editing = null; });

// my comics
function refreshAll(fresh) {
  $('#title').value = $('#title-m').value = state.title || ''; $('#turns').checked = $('#turns-m').checked = !!state.turns;
  textEl.value = ''; autosize(); applyPage(); applyCols(); loadHand(); segPaints.forEach(fn => fn());
  redoStack.length = 0; renderCast(); resetDraft(); if (fresh) lastCount = 0; lastDraft = -1; render();
}
function setStrip(next, { fresh = true } = {}) { save(); flush(); state = Object.assign(sample(), clone(next)); save(); refreshAll(fresh); emit('strip-changed'); }
function newStrip({ quiet = false, title = '' } = {}) {
  save();
  if (state.lines.length && !quiet) toast('Saved to My comics. Here is a blank strip.');
  state = Object.assign(clone(state), { id: FP.uid(), title, lines: [], room: undefined });
  save(); refreshAll(); emit('strip-changed');
}
function paintLibThumb(cv) {
  const first = FP.layoutStrip(cv._strip, null)[0], ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, cv.width, cv.height);
  if (first) { first.ids.forEach(FP.atlas); FP.drawPanel(ctx, first, cv.width); }
}
function renderLib() {
  const day = t => new Date(t || Date.now()).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  const list = lib.slice().sort((p, q) => (q.updated || 0) - (p.updated || 0));
  if (!list.length) return $('#lib').replaceChildren(el('p', { className: 'lib-empty', textContent: 'Nothing saved yet. Write a line and the strip appears here.' }));
  $('#lib').replaceChildren(...list.map(strip => {
    const cv = el('canvas', { width: 300, height: 300 }); cv._strip = strip; paintLibThumb(cv);
    const now = strip.id === state.id, n = strip.lines.length;
    const openBtn = el('button', { type: 'button', className: 'open', title: 'Open this strip' }, [cv, el('strong', { textContent: strip.title || 'Untitled strip' }), el('small', { textContent: `${n} line${n === 1 ? '' : 's'}, ${now ? 'open now' : day(strip.updated)}` })]);
    openBtn.addEventListener('click', () => { if (!now) setStrip(lib.find(x => x.id === strip.id)); close('#dlg-lib'); scroller.scrollTo({ top: 0 }); });
    const del = el('button', { type: 'button', className: 'btn danger', textContent: 'Delete' });
    del.addEventListener('click', () => {
      if (del.dataset.sure !== '1') { del.dataset.sure = '1'; del.textContent = 'Delete for good?'; return; }
      lib = lib.filter(x => x.id !== strip.id);
      if (now) newStrip({ quiet: true }); else { save(); }
      renderLib();
    });
    return el('div', { className: 'libcard' + (now ? ' now' : '') }, [openBtn, del]);
  }));
}
ACTS.lib = () => { save(); renderLib(); open('#dlg-lib'); };
$('#lib-new').addEventListener('click', () => { newStrip(); close('#dlg-lib'); textEl.focus(); });
ACTS.new = () => { newStrip(); textEl.focus(); };
ACTS.undo = undo; ACTS.redo = redo;
ACTS.more = () => open('#dlg-more');

/* ================= shared rooms, exports and the reader plug in here ================= */
const room = { active: false, watching: false };
window.FP.app = {
  get state() { return state; }, get lib() { return lib; }, get panels() { return panels; }, room,
  on: (type, fn) => bus.addEventListener(type, e => fn(e.detail)),
  emit, save, flush, render, schedule, toast, open, close, el, $, $$, ACTS, faceStyle,
  addLines, removeLine, updateLine, setStrip, newStrip, renderCast, refreshAll, clone, validStrip, textEl,
  libAdd(strip) { lib.unshift(strip); save(); },
  fileName: () => ((state.title || '').trim() || 'sans-comic').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').toLowerCase() || 'sans-comic',
  saver: null,
};
if (window.claude && window.claude.use) window.claude.use('downloads').then(d => { window.FP.app.saver = d; emit('saver', d); }).catch(() => {});
else {   // on an ordinary web page (your own site, GitHub Pages) files save through a normal browser download
  window.FP.app.saver = { save({ filename, data }) {
    const blob = data instanceof Blob ? data : new Blob([data]), url = URL.createObjectURL(blob), a = el('a', { href: url, download: filename });
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000);
    return Promise.resolve({ status: 'saved' });
  } };
}

/* ================= start ================= */
renderCast(); autosize(); resetDraft(); applyCols(); applyPage(); loadHand();
setTray(innerWidth >= 840 && innerHeight >= 720);
render();
if (document.fonts && document.fonts.load) {
  const again = () => { renderPickers(); schedule(); };
  Promise.all([document.fonts.load(`700 40px ${FONT}`), document.fonts.load(`italic 700 40px ${FONT}`), document.fonts.load('800 50px "Bricolage Grotesque"')]).then(again, again);
}
// keep the composer above the on-screen keyboard on phones
if (window.visualViewport) {
  const fit = () => { document.documentElement.style.setProperty('--app-h', visualViewport.height + 'px'); if (visualViewport.offsetTop) scrollTo(0, 0); };
  visualViewport.addEventListener('resize', fit); fit();
}
})();
