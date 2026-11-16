/* Sans Comic engine: reads the words, picks the poses, lays out panels and draws them.
   Every function takes the strip it works on, so the editor, the reader, exports, saved-comic
   thumbnails and shared rooms all draw through the same code.
   Characters and backdrops: Jim Woodring for Microsoft Comic Chat (MIT, (c) Microsoft Corporation). */
(() => {
'use strict';
const ART = window.FP_ART, AS = ART.scale;
const CH = Object.fromEntries(ART.chars.map((c, i) => [c.id, Object.assign(c, { idx: i })]));
const NAME_TO_ID = Object.fromEntries(ART.chars.map(c => [c.name.toLowerCase(), c.id]));

const E = { HAPPY: 1, COY: 2, BORED: 3, SCARED: 4, SAD: 5, ANGRY: 6, SHOUT: 7, LAUGH: 8, NEUTRAL: 9, WAVE: 10, POINT_YOU: 11, POINT_ME: 12, BOTH: 13, SHRUG: 14, LEAVE: 15, WALK: 16, ARRIVE: 17 };
const MOOD = { 1: 'Happy', 2: 'Coy', 3: 'Bored', 4: 'Scared', 5: 'Sad', 6: 'Angry', 7: 'Shout', 8: 'Laugh' };
const GLABEL = { 10: 'Wave', 11: 'Point', 12: 'Me', 13: 'Both', 14: 'Shrug', 15: 'Leave', 16: 'Walk', 17: 'Arrive' };
const TONES = { 'tone-yellow': ['Yellow', '#ffd43b', '#f0a800'], 'tone-blue': ['Blue', '#a9dcef', '#4aa9cf'], 'tone-pink': ['Pink', '#ffc2d1', '#f2708f'], 'tone-mint': ['Mint', '#bdebd0', '#57b98a'] };
const INK = '#111417';
const FONT = '"Comic Neue", "Comic Sans MS", "Chalkboard SE", cursive';
const HANDS = {
  classic: ['Classic', FONT, 700, 1],
  hand: ['Hand', '"Patrick Hand", "Comic Neue", cursive', 400, 1.1],
  brush: ['Brush', '"Caveat Brush", "Comic Neue", cursive', 400, 1.2],
  type: ['Typewriter', '"Special Elite", "Courier New", monospace', 400, 0.86],
};
const P = 1000, M = 30, FLOOR = 968;
const SLOTS = { 1: [500], 2: [265, 735], 3: [185, 500, 815], 4: [140, 380, 620, 860] };
const MAXH = { 1: 610, 2: 590, 3: 520, 4: 430 };

/* Slash commands, as in Comic Chat's /gestures and Comic Chatter's /fx. g: gesture, e: mood, k: balloon. */
const COMMANDS = [
  ['wave', { g: E.WAVE }, 'Wave'], ['point', { g: E.POINT_YOU }, 'Point at them'], ['pointself', { g: E.POINT_ME }, 'Point at yourself'],
  ['doublepoint', { g: E.BOTH }, 'Point both ways'], ['shrug', { g: E.SHRUG }, 'Shrug'], ['walk', { g: E.WALK }, 'Walk past'],
  ['walkup', { g: E.ARRIVE }, 'Walk up'], ['walkaway', { g: E.LEAVE }, 'Walk away'],
  ['happy', { e: E.HAPPY }, 'Happy face'], ['laugh', { e: E.LAUGH }, 'Laughing face'], ['coy', { e: E.COY }, 'Coy face'],
  ['bored', { e: E.BORED }, 'Bored face'], ['sad', { e: E.SAD }, 'Sad face'], ['scared', { e: E.SCARED }, 'Scared face'],
  ['angry', { e: E.ANGRY }, 'Angry face'],
  ['shout', { k: 'shout' }, 'Shout balloon'], ['think', { k: 'think' }, 'Thought cloud'], ['whisper', { k: 'whisper' }, 'Whisper'],
  ['me', { k: 'action' }, 'Narrate an action'], ['fx', { k: 'fx' }, 'Sound effect, like /fx BOOM'],
  ['roll', { app: true }, 'Roll dice, like /roll 2d6'], ['flip', { app: true }, 'Flip a coin'],
];
const CMD = Object.fromEntries(COMMANDS.map(([name, v]) => [name, v]));

/* ---------------- small helpers ---------------- */
const uid = () => Math.random().toString(36).slice(2, 9);
function hash(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/* ---------------- art loading ---------------- */
const images = {}, artListeners = new Set();
let epoch = 0;
function loadImage(key, src) {
  if (images[key]) return images[key];
  const rec = images[key] = { img: new Image(), ready: false };
  rec.img.decoding = 'async';
  rec.img.onload = () => { rec.ready = true; epoch++; artListeners.forEach(fn => fn()); };
  rec.img.src = src;
  return rec;
}
const atlas = id => loadImage('c:' + id, `art/${id}.png`);
const backdropImage = id => loadImage('b:' + id, `art/bg-${id}.jpg`);
const whenArtLoads = fn => { artListeners.add(fn); return () => artListeners.delete(fn); };
const whenReady = ids => Promise.all(ids.map(id => { const r = atlas(id); return r.ready ? null : new Promise(res => { r.img.addEventListener('load', res, { once: true }); r.img.addEventListener('error', res, { once: true }); }); }));

/* ---------------- reading the words ---------------- */
const nameRe = {};
const nameMatcher = id => nameRe[id] || (nameRe[id] = new RegExp(`(^|[^\\p{L}\\p{N}])@?${escapeRe(CH[id].name)}(?![\\p{L}\\p{N}])`, 'iu'));
function mentionIn(text, who, strip) {   // naming someone in the cast points at them and brings them into the panel
  if (!text) return null;
  const ids = new Set([...(strip.cast || []), ...strip.lines.map(l => l.who)]);
  ids.delete(who);
  for (const id of ids) if (CH[id] && nameMatcher(id).test(text)) return id;
  return null;
}
// A leading "Name:" is the speaker. A name later in the line is only a mention, so "Dan, look" does not become Dan talking.
function namedLine(text, ids) {
  const m = String(text || '').match(/^\s*([^:\n]{1,40}?)\s*:\s*([\s\S]*)$/);
  if (!m) return null;
  const key = m[1].trim().toLowerCase();
  if (!key) return null;
  const id = (ids || []).find(cid => CH[cid] && (cid === key || CH[cid].name.toLowerCase() === key));
  return id ? { id, text: m[2].trim() } : null;
}
function readLine(line, strip) {
  let text = (line.text || '').trim(), kind = line.kind || 'auto', m, cmdEmo = null, cmdGest = null, cmdKind = null;
  while ((m = text.match(/^\/([a-z]+)(?:\s+|$)/i)) && CMD[m[1].toLowerCase()] && !CMD[m[1].toLowerCase()].app) {
    const c = CMD[m[1].toLowerCase()];
    if (c.g) cmdGest = c.g; if (c.e) cmdEmo = c.e; if (c.k) cmdKind = c.k;
    text = text.slice(m[0].length);
  }
  if (kind === 'auto' && cmdKind) kind = cmdKind;
  if (kind === 'auto') {
    if ((m = text.match(/^\((.+)\)$/s))) { kind = 'think'; text = m[1]; }
    else if ((m = text.match(/^\*(.+)\*$/s))) { kind = 'action'; text = m[1]; }
    else if ((m = text.match(/^~(.+)~$/s))) { kind = 'whisper'; text = m[1]; }
    else if (/^psst\b/i.test(text)) kind = 'whisper';
    else kind = 'say';
  }
  const letters = text.replace(/[^\p{L}]/gu, '');
  const allCaps = letters.length > 1 && letters === letters.toUpperCase() && letters !== letters.toLowerCase();
  if (kind === 'say' && (allCaps || /!!/.test(text))) kind = 'shout';
  if (!text.trim()) kind = 'none';                       // a bare /wave: pose without a balloon
  const low = text.toLowerCase();
  let emo = E.NEUTRAL, inten = 0.6;
  if (/\b(rotfl|rofl|lmao)\b|🤣/.test(low)) { emo = E.LAUGH; inten = 1; }
  else if (/\b(lol|ha(ha)+|he(he)+)\b|😂|😆/.test(low)) { emo = E.LAUGH; inten = 0.6; }
  else if (kind === 'shout' || kind === 'fx' || /!!!/.test(text)) { emo = E.SHOUT; inten = 1; }
  else if (/>:\(|😠|😡|🤬|\b(ugh|grr+|furious|i hate)\b/.test(low)) { emo = E.ANGRY; inten = 0.8; }
  else if (/;-?\)|😉|😏/.test(low)) { emo = E.COY; inten = 0.7; }
  else if (/:-?\)|:-?d\b|😀|😃|😄|🙂|😊|❤|\b(yay|hooray|awesome|wonderful|thank you|thanks)\b/.test(low)) { emo = E.HAPPY; inten = 0.7; }
  else if (/:'?-?\(|😢|😭|☹|🙁|\b(sorry|sigh|miss you|so sad)\b/.test(low)) { emo = E.SAD; inten = 0.7; }
  else if (/😱|😨|😬|\b(yikes|eek|oh no|uh oh|scared|terrified)\b/.test(low)) { emo = E.SCARED; inten = 0.8; }
  else if (/🙄|😴|\b(meh|yawn|whatever|boring|bored|zzz+)\b/.test(low)) { emo = E.BORED; inten = 0.7; }
  const mention = strip ? mentionIn(text, line.who, strip) : null;
  let gest = 0;
  if (/^(hi|hello|hey|bye|goodbye|welcome|howdy)(?![\p{L}\p{N}])/iu.test(text)) gest = E.WAVE;
  else if (/🤷|\b(dunno|i don'?t know|no idea|who knows)\b/.test(low)) gest = E.SHRUG;
  else if (mention || /^you(?![\p{L}\p{N}])/iu.test(text) || /\b(are|will|did|aren't|don't|can|would|do) you\b/.test(low)) gest = E.POINT_YOU;
  else if (/^i(?![\p{L}\p{N}])/iu.test(text) || /\b(i'm|i will|i'll|i am|i've)\b/.test(low)) gest = E.POINT_ME;
  if (cmdEmo) { emo = cmdEmo; inten = 0.8; }
  if (cmdGest) gest = cmdGest;
  if (line.emo) { emo = line.emo.e; inten = line.emo.i; }
  if (line.gest != null && line.gest !== 'auto') gest = line.gest;
  return { kind, text, emo, inten, gest, mention, img: line.emo && line.emo.img != null ? line.emo.img : null, body: line.body != null ? line.body : null };
}

/* ---------------- poses ---------------- */
function pickRec(recs, code, inten, r) {
  const hits = recs.filter(x => x[1] === code);
  if (!hits.length) return null;
  if (code === E.NEUTRAL || code >= 10) return hits[Math.floor(r() * hits.length)];
  return hits.reduce((best, x) => Math.abs(x[2] / 255 - inten) < Math.abs(best[2] / 255 - inten) ? x : best);
}
function pickPose(ch, emo, inten, gest, seed, img, body) {
  const r = rng(seed), exact = recs => img != null && recs.find(x => x[0] === img && x[1] === emo);
  if (ch.b.length) {
    const b = (gest && pickRec(ch.b, gest, 1, r)) || exact(ch.b) || pickRec(ch.b, emo, inten, r) || pickRec(ch.b, E.NEUTRAL, 0, r) || ch.b[0];
    return { b };
  }
  const f = exact(ch.f) || pickRec(ch.f, emo, inten, r) || (emo === E.LAUGH && pickRec(ch.f, E.HAPPY, 1, r)) || (emo === E.SHOUT && pickRec(ch.f, E.ANGRY, 1, r)) || pickRec(ch.f, E.NEUTRAL, 0, r) || ch.f[0];
  const t = (body != null && ch.t.find(x => x[0] === body)) || (gest && pickRec(ch.t, gest, 1, r)) || pickRec(ch.t, emo, inten, r) || pickRec(ch.t, E.NEUTRAL, 0, r) || ch.t[0];
  return { f, t };
}
function poseBox(ch, pose) {
  // place the parts, then measure the inked area so every character stands on its feet at the same height
  let parts, faceX, head = null;
  if (pose.b) { parts = [{ i: pose.b[0], x: 0, y: 0 }]; faceX = pose.b[3]; }
  else {
    const f = pose.f, t = pose.t;
    const torso = { i: t[0], x: 0, y: 0 }; head = { i: f[0], x: t[3] + f[5] - f[3], y: t[4] + f[6] - f[4] };
    parts = (ch.flags & 4) ? [torso, head] : [head, torso]; faceX = f[7] + head.x;
  }
  let l = 1e9, t = 1e9, r = -1e9, b = -1e9;
  for (const p of parts) { const bb = ch.bb[p.i]; p.im = ch.im[p.i]; l = Math.min(l, p.x + bb[0] / AS); t = Math.min(t, p.y + bb[1] / AS); r = Math.max(r, p.x + (bb[0] + bb[2]) / AS); b = Math.max(b, p.y + (bb[1] + bb[3]) / AS); }
  for (const p of parts) { p.x -= l; p.y -= t; }
  const box = { W: r - l, H: b - t, faceX: Math.min(Math.max(faceX - l, 0), r - l), headTop: 0, parts };
  if (head) { const bb = ch.bb[head.i]; box.headTop = head.y + bb[1] / AS; box.headH = bb[3] / AS; box.head = head; box.neck = [head.x + pose.f[3], head.y + pose.f[4]]; }
  return box;
}
const standH = {};
const standingHeight = ch => standH[ch.id] || (standH[ch.id] = poseBox(ch, pickPose(ch, E.NEUTRAL, 0, 0, 1)).H);
function moodsOf(ch) {
  const recs = ch.f.length ? ch.f : ch.b, out = {};
  for (const r of recs) if (r[1] >= 1 && r[1] <= 8) { const v = out[r[1]] || (out[r[1]] = []); if (!v.some(q => q[0] === r[0])) v.push(r); }
  Object.values(out).forEach(v => v.sort((p, q) => p[2] - q[2]));
  return out;
}
const gesturesOf = ch => [...new Set((ch.f.length ? ch.t : ch.b).map(r => r[1]).filter(c => c >= 10))].sort((p, q) => p - q);

function drawFigure(ctx, fig) {
  const rec = atlas(fig.ch.id);
  if (!rec.ready) return;
  const box = fig.box, s = fig.s;
  ctx.save();
  ctx.translate(fig.x, fig.feet);
  ctx.scale((fig.flip ? -s : s) * (fig.sx || 1), s * (fig.sy || 1));
  for (const p of box.parts) {
    const nod = p === box.head && (fig.headRot || fig.headDy);
    if (nod) { const nx = box.neck[0] - box.W / 2, ny = box.neck[1] - box.H; ctx.save(); ctx.translate(nx, ny + (fig.headDy || 0)); ctx.rotate(fig.headRot || 0); ctx.translate(-nx, -ny); }
    ctx.drawImage(rec.img, p.im[0], p.im[1], p.im[2], p.im[3], p.x - box.W / 2, p.y - box.H, p.im[2] / AS, p.im[3] / AS);
    if (nod) ctx.restore();
  }
  ctx.restore();
}

/* ---------------- lettering ---------------- */
const mctx = document.createElement('canvas').getContext('2d');
const handOf = strip => HANDS[strip.font] || HANDS.classic;
function fontOf(kind, F, strip) {
  const h = handOf(strip), k = kind === 'fx' ? 1.6 : kind === 'shout' ? 1.14 : kind === 'whisper' ? 0.84 : kind === 'action' ? 0.86 : 1;
  const italic = kind === 'whisper' || kind === 'think' || kind === 'action';
  return `${italic ? 'italic ' : ''}${kind === 'fx' ? 800 : h[2]} ${Math.round(F * h[3] * k)}px ${kind === 'fx' ? FONT : h[1]}`;
}
const sizeOf = font => parseFloat(font.match(/(\d+)px/)[1]);
const wrapCache = new Map();
function wrap(text, font, maxW) {
  const key = font + '|' + maxW + '|' + text;
  const hit = wrapCache.get(key); if (hit) return hit;
  mctx.font = font;
  const widthOf = s => mctx.measureText(s).width;
  const fit = limit => {
    const out = []; let cur = '';
    for (let w of text.split(/\s+/).filter(Boolean)) {
      while (widthOf(w) > limit && w.length > 1) {          // break a word that is longer than the line
        let n = w.length; while (n > 1 && widthOf((cur ? cur + ' ' : '') + w.slice(0, n)) > limit) n--;
        if (cur && n <= 1) { out.push(cur); cur = ''; continue; }
        out.push((cur ? cur + ' ' : '') + w.slice(0, n)); cur = ''; w = w.slice(n);
      }
      const t = cur ? cur + ' ' + w : w;
      if (widthOf(t) <= limit || !cur) cur = t; else { out.push(cur); cur = w; }
    }
    if (cur) out.push(cur);
    return out;
  };
  let lines = fit(maxW);
  if (lines.length > 1) {                                    // balance: narrowest width that keeps the line count
    let lo = Math.max(...text.split(/\s+/).map(widthOf).map(w => Math.min(w, maxW))), hi = maxW;
    for (let i = 0; i < 7; i++) { const mid = (lo + hi) / 2; if (fit(mid).length <= lines.length) hi = mid; else lo = mid; }
    lines = fit(hi);
  }
  const out = { lines, w: Math.max(1, ...lines.map(widthOf)) };
  if (wrapCache.size > 2000) wrapCache.clear();
  wrapCache.set(key, out);
  return out;
}

/* ---------------- panel layout (a panel is a 1000 x 1000 square) ---------------- */
const styleKey = s => JSON.stringify([s.caps, s.font, s.sides !== false, s.cast]);
function buildPanel(lines, prevWho, F, S, sides) {
  const seed = hash(lines[0].id), r = rng(seed);
  const read = lines.map(l => Object.assign({ line: l }, readLine(l, S)));
  const order = []; read.forEach(x => { if (!order.includes(x.line.who)) order.push(x.line.who); });
  const lastMention = read.map(x => x.mention).filter(Boolean).pop();
  let closeup = false, listener = null;
  if (lastMention && !order.includes(lastMention) && order.length < 4) listener = lastMention;   // naming someone brings them in
  else if (order.length === 1 && !lastMention) {
    const roll = r(), solo = CH[order[0]];
    if (roll < 0.34 && solo.f.length && read.every(x => x.kind !== 'action' && x.kind !== 'none')) closeup = true;
    else if (roll < 0.8 && prevWho && prevWho !== order[0]) listener = prevWho;
  }
  let ids = order.slice();
  if (listener) r() < 0.5 ? ids.push(listener) : ids.unshift(listener);
  const keep = S.sides !== false, rank = id => sides.rank[id] == null ? 99 : sides.rank[id];
  if (keep) ids.sort((p, q) => rank(p) - rank(q));   // everyone keeps the side they first appeared on
  const n = ids.length, soloLeft = keep ? rank(ids[0]) < sides.count / 2 : r() < 0.5, slots = n === 1 && !closeup ? [soloLeft ? 410 : 590] : SLOTS[n];
  const maxW = closeup ? 600 : n === 1 ? 640 : n === 2 ? 400 : 330;

  // narration box
  const acts = read.filter(x => x.kind === 'action');
  let caption = null, y0 = M;
  if (acts.length) {
    const font = fontOf('action', F, S), text = acts.map(x => `${CH[x.line.who].name} ${x.text}`).join(' ');
    const w = wrap(S.caps ? text.toUpperCase() : text, font, P - 2 * M - 44), lh = sizeOf(font) * 1.2;
    caption = { font, lines: w.lines, lh, x: M - 4, y: M - 4, w: w.w + 44, h: w.lines.length * lh + 26 };
    y0 = caption.y + caption.h + 16;
  }

  // balloons, in reading order: each sits over its speaker, later ones lower
  const balloons = [];
  for (const x of read) {
    if (x.kind === 'action' || x.kind === 'none') continue;
    const font = fontOf(x.kind, F, S), lh = sizeOf(font) * 1.16;
    const txt = S.caps || x.kind === 'shout' || x.kind === 'fx' ? x.text.toUpperCase() : x.text;
    const w = wrap(txt, font, x.kind === 'fx' ? Math.min(maxW, 520) : maxW), th = w.lines.length * lh;
    const k = 1.24, extra = x.kind === 'shout' || x.kind === 'fx' ? 36 : x.kind === 'think' ? 20 : 0;
    const a = w.w / 2 * k + 16, b = th / 2 * k + 12;
    const bw = 2 * (a + extra), bh = 2 * (b + extra);
    const cx = slots[ids.indexOf(x.line.who)];
    const bx = Math.min(Math.max(cx - bw / 2, M), P - M - bw);
    let by = y0;
    for (const o of balloons) {
      if (bx < o.x + o.w + 10 && o.x < bx + bw + 10) by = Math.max(by, o.y + o.h + 10);
      by = Math.max(by, o.y + 46);
    }
    balloons.push({ kind: x.kind, who: x.line.who, lines: w.lines, font, lh, x: bx, y: by, w: bw, h: bh, a, b, cx: bx + bw / 2, cy: by + bh / 2, seed: hash(x.line.id), draft: x.line.id === 'draft', tilt: (rng(hash(x.line.id) ^ 77)() - 0.5) * (x.kind === 'fx' ? 0.16 : 0.04) });
  }
  const bottom = Math.max(y0, ...balloons.map(o => o.y + o.h));

  // figures: one shared height, as tall as the balloons above each of them allow
  const guess = MAXH[n] * 0.2;
  let H = closeup ? 0 : MAXH[n];
  const clear = ids.map((id, i) => {
    let c = y0;
    for (const o of balloons) if (o.x < slots[i] + guess && slots[i] - guess < o.x + o.w) c = Math.max(c, o.y + o.h);
    return c;
  });
  if (!closeup) clear.forEach(c => { H = Math.min(H, FLOOR - c - 44); });
  const ok = closeup ? bottom <= 500 : H >= 350 && bottom <= 600;

  const figures = ids.map((id, i) => {
    const ch = CH[id], mine = read.filter(x => x.line.who === id).pop();
    const pose = mine ? pickPose(ch, mine.emo, mine.inten, mine.gest, hash(mine.line.id), mine.img, mine.body) : pickPose(ch, E.NEUTRAL, 0, 0, seed + i);
    const box = poseBox(ch, pose);
    let s = H / standingHeight(ch), feet = FLOOR;
    if (closeup) { s = Math.min(2.6, (P - clear[i] - 40) / ((box.headH || 120) * 1.55)); feet = clear[i] + 46 + (box.H - box.headTop) * s; }
    // face whoever you are talking to; otherwise face the middle of the panel
    const target = mine && mine.mention && ids.includes(mine.mention) ? ids.indexOf(mine.mention) : -1;
    const flip = target >= 0 ? slots[target] < slots[i] : n === 1 ? slots[0] > 500 : i >= n / 2;
    const fx = (box.faceX - box.W / 2) * (flip ? -1 : 1) * s;
    return { ch, box, s, x: slots[i], feet, flip, headX: slots[i] + fx, headY: feet - (box.H - box.headTop) * s };
  });
  for (const o of balloons) { const f = figures[ids.indexOf(o.who)]; o.tx = f.headX; o.ty = f.headY; }
  const bg = (lines.find(l => l.bg) || {}).bg || S.bg;
  return { ok, lines, ids, figures, balloons, caption, closeup, bg, style: S, last: order[order.length - 1], draft: lines.some(l => l.id === 'draft') };
}

const layoutCache = new Map();
function cachedPanel(lines, prevWho, F, S, sides) {
  const key = JSON.stringify([lines.map(l => [l.id, l.who, l.text, l.kind, l.emo, l.gest, l.body, l.bg]), prevWho, F, styleKey(S), lines.map(l => sides.rank[l.who]), sides.count, prevWho && sides.rank[prevWho], sides.who]);
  let p = layoutCache.get(key);
  if (!p) { p = buildPanel(lines, prevWho, F, S, sides); if (layoutCache.size > 800) layoutCache.clear(); layoutCache.set(key, p); }
  return Object.assign({}, p, { style: S, bg: (lines.find(l => l.bg) || {}).bg || S.bg });
}
const SIZES = [46, 40, 34, 29];
function layoutStrip(S, extra) {
  const all = extra ? S.lines.concat(extra) : S.lines;
  const sides = { rank: {}, count: 0 };
  for (const l of all) if (!(l.who in sides.rank)) sides.rank[l.who] = sides.count++;
  sides.who = Object.keys(sides.rank).sort().join();
  const panels = []; let cur = [], prevWho = null;
  const close = () => {
    if (!cur.length) return;
    let p; for (const F of SIZES) { p = cachedPanel(cur, prevWho, F, S, sides); if (p.ok) break; }
    panels.push(p); prevWho = p.last; cur = [];
  };
  for (const line of all) {
    if (!line.text || !line.text.trim() || !CH[line.who]) continue;
    if (cur.length) {
      const kind = readLine(line, S).kind;
      const who = new Set(cur.map(l => l.who)), spoke = new Set(cur.filter(l => { const k = readLine(l, S).kind; return k !== 'action' && k !== 'none'; }).map(l => l.who));
      const fresh = spoke.has(line.who) || cur.length >= 4 || who.size >= 4 || kind === 'action' || (line.bg || null) !== (cur[0].bg || null) || !cachedPanel(cur.concat(line), prevWho, SIZES[0], S, sides).ok;
      if (fresh) close();
    }
    cur.push(line);
  }
  close();
  return panels;
}

/* ---------------- drawing ---------------- */
function superPath(ctx, cx, cy, a, b, n = 3.2) {
  ctx.beginPath();
  for (let i = 0; i <= 72; i++) {
    const t = i / 72 * Math.PI * 2, c = Math.cos(t), s = Math.sin(t);
    const x = cx + a * Math.sign(c) * Math.abs(c) ** (2 / n), y = cy + b * Math.sign(s) * Math.abs(s) ** (2 / n);
    i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  }
  ctx.closePath();
}
function edgeY(o, x, n = 3.2) { const d = Math.min(0.999, Math.abs((x - o.cx) / o.a)); return o.cy + o.b * (1 - d ** n) ** (1 / n); }

function drawBalloon(ctx, o) {
  const r = rng(o.seed), paths = [];
  const baseX = Math.min(Math.max(o.cx + (o.tx - o.cx) * 0.55, o.cx - o.a * 0.55), o.cx + o.a * 0.55);
  const baseY = edgeY(o, baseX) - 12;
  let tipX = o.tx + (baseX - o.tx) * 0.12, tipY = o.ty - 16;
  if (tipY < baseY + 34) tipY = baseY + 34;
  if (tipY > baseY + 330) { tipY = baseY + 330; tipX = baseX + (o.tx - baseX) * 0.5; }
  const hw = 15, bend = (tipX - baseX) * 0.25;
  const tilted = fn => () => { ctx.save(); ctx.translate(o.cx, o.cy); ctx.rotate(o.tilt || 0); ctx.translate(-o.cx, -o.cy); fn(); ctx.restore(); };

  if (o.kind === 'think') {
    const circ = [], count = Math.max(10, Math.round((o.a + o.b) / 26));
    for (let i = 0; i < count; i++) {
      const t = (i + 0.5 * r()) / count * Math.PI * 2, c = Math.cos(t), s = Math.sin(t), n = 2.6;
      circ.push([o.cx + o.a * Math.sign(c) * Math.abs(c) ** (2 / n), o.cy + o.b * Math.sign(s) * Math.abs(s) ** (2 / n), 24 + r() * 12]);
    }
    paths.push(tilted(() => { ctx.beginPath(); for (const [x, y, rad] of circ) { ctx.moveTo(x + rad, y); ctx.arc(x, y, rad, 0, Math.PI * 2); } }));
    paths.push(tilted(() => superPath(ctx, o.cx, o.cy, o.a, o.b, 2.6)));
    const steps = [[0.3, 15], [0.6, 10], [0.86, 6]];
    paths.push(() => { ctx.beginPath(); for (const [t, rad] of steps) { const x = baseX + (tipX - baseX) * t, y = baseY + 26 + (tipY - baseY - 26) * t; ctx.moveTo(x + rad, y); ctx.arc(x, y, rad, 0, Math.PI * 2); } });
  } else if (o.kind === 'shout' || o.kind === 'fx') {
    const pts = [], count = Math.max(16, Math.round((o.a + o.b) / 15) * 2);
    for (let i = 0; i < count; i++) {
      const t = i / count * Math.PI * 2, c = Math.cos(t), s = Math.sin(t), n = 3;
      const x = o.a * Math.sign(c) * Math.abs(c) ** (2 / n), y = o.b * Math.sign(s) * Math.abs(s) ** (2 / n), len = Math.hypot(x, y);
      const push = i % 2 ? 2 : (o.kind === 'fx' ? 34 : 22) + r() * 14;
      pts.push([o.cx + x * (1 + push / len), o.cy + y * (1 + push / len)]);
    }
    paths.push(tilted(() => { ctx.beginPath(); pts.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.closePath(); }));
    if (o.kind === 'shout') paths.push(() => { ctx.beginPath(); ctx.moveTo(baseX - 22, baseY); ctx.lineTo(tipX, tipY); ctx.lineTo(baseX + 22, baseY); ctx.closePath(); });
  } else {
    paths.push(tilted(() => superPath(ctx, o.cx, o.cy, o.a, o.b)));
    paths.push(() => {
      ctx.beginPath(); ctx.moveTo(baseX - hw, baseY);
      ctx.quadraticCurveTo(baseX - hw * 0.4 + bend, baseY + (tipY - baseY) * 0.6, tipX, tipY);
      ctx.quadraticCurveTo(baseX + hw * 0.9 + bend, baseY + (tipY - baseY) * 0.55, baseX + hw, baseY);
      ctx.closePath();
    });
  }
  // outline every shape, then fill them all: the fills hide the inner strokes and leave one joined outline
  ctx.save();
  ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.strokeStyle = o.draft ? '#1b7ea6' : INK; ctx.fillStyle = o.kind === 'fx' ? '#ffd43b' : '#fff';
  ctx.lineWidth = o.kind === 'shout' || o.kind === 'fx' ? 13 : 10;
  if (o.kind === 'whisper') ctx.setLineDash([16, 13]);
  for (const p of paths) { p(); ctx.stroke(); }
  ctx.setLineDash([]);
  for (const p of paths) { p(); ctx.fill(); }
  ctx.fillStyle = o.kind === 'whisper' ? '#39434b' : INK; ctx.font = o.font; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const top = o.cy - (o.lines.length - 1) * o.lh / 2;
  ctx.translate(o.cx, o.cy); ctx.rotate(o.tilt || 0); ctx.translate(-o.cx, -o.cy);
  if (o.kind === 'fx') { ctx.strokeStyle = '#fff'; ctx.lineWidth = 8; ctx.lineJoin = 'round'; o.lines.forEach((t, i) => ctx.strokeText(t, o.cx, top + i * o.lh)); }
  o.lines.forEach((t, i) => ctx.fillText(t, o.cx, top + i * o.lh + o.lh * 0.04));
  ctx.restore();
}

function floorBand(ctx, alpha) { ctx.fillStyle = `rgba(255,255,255,${alpha})`; ctx.fillRect(0, FLOOR - 26, P, P); ctx.fillStyle = INK; ctx.fillRect(0, FLOOR - 28, P, 5); }
function drawBackdrop(ctx, id, S) {
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, P, P);
  if (TONES[id]) {
    const [, base, dot] = TONES[id];
    ctx.fillStyle = base; ctx.fillRect(0, 0, P, P);
    ctx.fillStyle = dot;
    const step = 30;
    for (let row = 0, y = -step; y < P + step; y += step * 0.5, row++) {
      const rad = Math.max(0, (y / P - 0.18)) * 11.5;
      if (rad < 0.6) continue;
      ctx.beginPath();
      for (let x = (row % 2 ? step / 2 : 0) - step; x < P + step; x += step) { ctx.moveTo(x + rad, y); ctx.arc(x, y, rad, 0, Math.PI * 2); }
      ctx.fill();
    }
    floorBand(ctx, 0.55);
  } else if (id === 'color') {
    ctx.fillStyle = (S && S.bgColor) || '#bfe3f5'; ctx.fillRect(0, 0, P, P); floorBand(ctx, 0.45);
  } else if (id === 'custom') {
    if (S && S.customBg) { const rec = loadImage('u:' + S.customBgKey, S.customBg); if (rec.ready) ctx.drawImage(rec.img, 0, 0, P, P); }
  } else if (id !== 'paper') {
    const rec = backdropImage(id);
    if (rec.ready) ctx.drawImage(rec.img, 0, 0, P, P);
  }
}
function roughFrame(ctx, seed) {   // a hand-ruled border: wobbly, gone over twice, with a paper margin outside it
  const r = rng(seed), pts = [], q = 20, step = 72;
  const edge = (x0, y0, x1, y1) => { const n = Math.round(Math.hypot(x1 - x0, y1 - y0) / step); for (let i = 0; i < n; i++) pts.push([x0 + (x1 - x0) * i / n + (r() - 0.5) * 9, y0 + (y1 - y0) * i / n + (r() - 0.5) * 9]); };
  edge(q, q, P - q, q); edge(P - q, q, P - q, P - q); edge(P - q, P - q, q, P - q); edge(q, P - q, q, q);
  const trace = (dx, dy) => { pts.forEach(([x, y], i) => i ? ctx.lineTo(x + dx, y + dy) : ctx.moveTo(x + dx, y + dy)); ctx.closePath(); };
  ctx.beginPath(); ctx.rect(0, 0, P, P); trace(0, 0); ctx.fillStyle = '#fff'; ctx.fill('evenodd');
  ctx.strokeStyle = INK; ctx.lineJoin = 'round';
  ctx.lineWidth = 9; ctx.beginPath(); trace(0, 0); ctx.stroke();
  ctx.lineWidth = 3.5; ctx.beginPath(); trace(4, -3); ctx.stroke();
}
function nameTag(ctx, fig) {
  const name = fig.ch.name; ctx.font = `700 38px ${FONT}`;
  const w = ctx.measureText(name).width + 34, h = 52, x = Math.min(Math.max(fig.x - w / 2, 14), P - 14 - w), y = P - h - 22;
  ctx.fillStyle = '#fff'; ctx.strokeStyle = INK; ctx.lineWidth = 5;
  ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x, y, w, h, h / 2) : ctx.rect(x, y, w, h); ctx.fill(); ctx.stroke();
  ctx.fillStyle = INK; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(name, x + w / 2, y + h / 2 + 2);
}
/* opts.balloons: how many balloons to show (the reader and GIFs reveal them one at a time). */
function drawPanel(ctx, panel, px, opts = {}) {
  const S = panel.style, show = opts.balloons == null ? Infinity : opts.balloons;
  ctx.save();
  ctx.scale(px / P, px / P);
  ctx.beginPath(); ctx.rect(0, 0, P, P); ctx.clip();
  ctx.imageSmoothingQuality = 'high';
  drawBackdrop(ctx, panel.bg, S);
  const speaking = new Set(panel.balloons.map(o => o.who));
  panel.figures.filter(f => !speaking.has(f.ch.id)).forEach(f => drawFigure(ctx, f));
  panel.figures.filter(f => speaking.has(f.ch.id)).forEach(f => drawFigure(ctx, f));
  if (S.tags) panel.figures.forEach(f => nameTag(ctx, f));
  if (panel.caption && show > 0) {
    const c = panel.caption;
    ctx.fillStyle = '#ffd43b'; ctx.strokeStyle = INK; ctx.lineWidth = 6;
    ctx.fillRect(c.x, c.y, c.w, c.h); ctx.strokeRect(c.x, c.y, c.w, c.h);
    ctx.fillStyle = INK; ctx.font = c.font; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    c.lines.forEach((t, i) => ctx.fillText(t, c.x + 22, c.y + 13 + c.lh * (i + 0.5)));
  }
  panel.balloons.slice(0, Math.max(0, show - (panel.caption ? 1 : 0))).forEach(o => drawBalloon(ctx, o));
  const frame = S.frame || 'plain';
  if (frame === 'plain') { ctx.strokeStyle = INK; ctx.lineWidth = 14; ctx.strokeRect(0, 0, P, P); }
  else if (frame === 'rough') roughFrame(ctx, hash(panel.lines[0].id));
  ctx.restore();
}
const beatsOf = panel => panel.balloons.length + (panel.caption ? 1 : 0);   // how many reveals a panel has

/* One whole strip as an image: title, panels in rows, credit line. */
function renderSheet(S, panels, size = 720) {
  const n = panels.length, cols = +S.perRow > 1 ? Math.min(+S.perRow, n) : n <= 3 ? n : n === 4 ? 2 : 3, rows = Math.ceil(n / cols), gap = 22, m = 44;
  const title = (S.title || '').trim(), head = title ? 84 : 0, foot = 46;
  const cv = document.createElement('canvas');
  cv.width = m * 2 + cols * size + (cols - 1) * gap; cv.height = m + head + rows * size + (rows - 1) * gap + foot + 14;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.fillStyle = INK; ctx.textBaseline = 'alphabetic';
  if (head) { ctx.font = '800 50px "Bricolage Grotesque", system-ui, sans-serif'; ctx.fillText(title, m, m + 46, cv.width - 2 * m); }
  panels.forEach((p, i) => { ctx.save(); ctx.translate(m + (i % cols) * (size + gap), m + head + Math.floor(i / cols) * (size + gap)); drawPanel(ctx, p, size); ctx.restore(); });
  ctx.font = '400 19px "Bricolage Grotesque", system-ui, sans-serif'; ctx.fillStyle = '#55646f';
  ctx.fillText('Characters by Jim Woodring, from Microsoft Comic Chat', m, cv.height - 26, cv.width - 2 * m);
  return cv;
}
/* The strip as plain text, for the script export and screen readers. */
function scriptOf(S) {
  const out = [];
  if ((S.title || '').trim()) out.push(S.title.trim(), '');
  for (const l of S.lines) {
    if (!l.text || !l.text.trim() || !CH[l.who]) continue;
    const x = readLine(l, S), name = CH[l.who].name;
    if (x.kind === 'none') out.push(`(${name} ${GLABEL[x.gest] ? GLABEL[x.gest].toLowerCase() + 's' : 'appears'})`);
    else if (x.kind === 'action') out.push(`* ${name} ${x.text}`);
    else if (x.kind === 'think') out.push(`${name} (thinking): ${x.text}`);
    else if (x.kind === 'whisper') out.push(`${name} (whispering): ${x.text}`);
    else if (x.kind === 'fx') out.push(`[${x.text.toUpperCase()}]`);
    else out.push(`${name}: ${x.text}`);
  }
  return out.join('\n');
}

window.FP = {
  ART, CH, AS, E, MOOD, GLABEL, TONES, HANDS, INK, FONT, P, FLOOR, COMMANDS, CMD, NAME_TO_ID,
  uid, hash, rng, get epoch() { return epoch; },
  loadImage, atlas, whenArtLoads, whenReady,
  readLine, namedLine, pickPose, poseBox, standingHeight, moodsOf, gesturesOf, drawFigure,
  fontOf, handOf, layoutStrip, drawPanel, drawBalloon, drawBackdrop, beatsOf, renderSheet, scriptOf,
};
})();
