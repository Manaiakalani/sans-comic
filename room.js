/* Sans Comic: draw together. Everyone in a room writes into one strip, each as their own character,
   the way Comic Chat rooms worked. Rooms keep nothing: the strip lives in each person's browser,
   and someone already in the room hands it to anyone who joins late. */
(() => {
'use strict';
const FP = window.FP, app = FP.app, { $, el } = app;
const WORDS = ['otter', 'plum', 'comet', 'kazoo', 'mango', 'pickle', 'rocket', 'tulip', 'walrus', 'banjo', 'noodle', 'cactus', 'lemon', 'yeti', 'biscuit', 'gecko', 'jelly', 'maple', 'pepper', 'waffle', 'turnip', 'marble', 'puffin', 'sprout'];
const KINDS = new Set(['auto', 'say', 'think', 'whisper', 'shout', 'action', 'fx']);
const R = { api: null, room: null, name: null, me: null, peers: [], offs: [] };
const btn = $('#btn-room'), live = $('#live');

const makeCode = () => { const w = () => WORDS[Math.floor(Math.random() * WORDS.length)]; return `${w()}-${w()}-${10 + Math.floor(Math.random() * 90)}`; };
const roomName = code => 'fp-' + code;
const cleanCode = s => String(s || '').toLowerCase().trim().replace(/^fp-/, '').replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').slice(0, 40);

/* What arrives from other people is untrusted: keep only well-formed lines. */
function cleanLine(l) {
  if (!l || typeof l !== 'object' || typeof l.text !== 'string' || !FP.CH[l.who] || typeof l.id !== 'string') return null;
  const out = { id: l.id.slice(0, 24), who: l.who, text: l.text.slice(0, 300), kind: KINDS.has(l.kind) ? l.kind : 'auto', t: Number(l.t) || Date.now() };
  if (l.emo && Number.isInteger(l.emo.e) && l.emo.e >= 1 && l.emo.e <= 9) out.emo = { e: l.emo.e, i: Math.min(1, Math.max(0, Number(l.emo.i) || 0)), img: Number.isInteger(l.emo.img) ? l.emo.img : undefined };
  if (Number.isInteger(l.gest)) out.gest = l.gest;
  if (Number.isInteger(l.body)) out.body = l.body;
  if (typeof l.bg === 'string' && l.bg.length < 24 && l.bg !== 'custom') out.bg = l.bg;
  return out;
}
const outgoing = l => { const o = Object.assign({}, l); delete o.mine; if (o.bg === 'custom') delete o.bg; return o; };
const send = (topic, data) => R.room ? R.room.emit(topic, data).catch(err => { if (err && err.code === 'not_permitted') setWatching(true); }) : Promise.resolve();

/* Hand the strip so far to people who join late, in small pieces (each message is at most 4 KB). */
function sendStrip() {
  const s = app.state, chunks = []; let cur = [];
  for (const l of s.lines) { cur.push(outgoing(l)); if (JSON.stringify(cur).length > 2800) { chunks.push(cur); cur = []; } }
  if (cur.length || !chunks.length) chunks.push(cur);
  chunks.forEach((lines, i) => setTimeout(() => send('sync', { title: (s.title || '').slice(0, 80), lines, part: i }), i * 120));
}
// the person who has been here longest answers, so one join doesn't set off a reply from everyone
const amAnswerer = () => { const others = R.peers.filter(p => p.kind === 'viewer' && Object.keys(p.presence || {}).length); return others.length && others.reduce((a, b) => (a.presence.since || 9e15) <= (b.presence.since || 9e15) ? a : b).sameTab; };

function setWatching(on) {
  app.room.watching = on;
  $('#room-watch').hidden = !on;
  app.textEl.placeholder = on ? 'Watching: you can read along but not write' : 'Say something…';
}
function renderPeople() {
  const people = R.peers.filter(p => p.kind === 'viewer');
  const typing = people.filter(p => !p.sameTab && p.presence.typing && FP.CH[p.presence.char]).map(p => FP.CH[p.presence.char].name);
  $('#typing').textContent = typing.length ? `${typing.join(', ')} ${typing.length > 1 ? 'are' : 'is'} typing…` : '';
  live.replaceChildren(el('span', { className: 'dot' }), ...people.slice(0, 4).filter(p => FP.CH[p.presence.char]).map(p => el('span', { className: 'face', style: app.faceStyle(p.presence.char), title: FP.CH[p.presence.char].name })), el('span', { textContent: `${people.length || 1} here` }));
  live.hidden = !R.room; document.body.classList.toggle('in-room', !!R.room);
  $('#room-people').replaceChildren(...people.map(p => {
    const id = FP.CH[p.presence.char] ? p.presence.char : null;
    return el('li', {}, [id ? el('span', { className: 'face', style: app.faceStyle(id) }) : el('span', { className: 'face blank' }), el('span', { textContent: (id ? FP.CH[id].name : 'Choosing a character') + (p.sameTab ? ' (you)' : p.isMe ? ' (your other tab)' : '') }), p.guest ? el('small', { textContent: 'guest' }) : '']);
  }));
}
function renderSheet() {
  const inRoom = !!R.room;
  $('#room-out').hidden = inRoom; $('#room-in').hidden = !inRoom;
  if (inRoom) { $('#room-code').textContent = R.name.replace(/^fp-/, ''); renderPeople(); }
}

async function join(name, { starting }) {
  if (R.room) await leave({ quiet: true });
  $('#room-error').textContent = '';
  let r;
  try { r = await R.api.join(name); }
  catch (err) { $('#room-error').textContent = err && err.code === 'not_permitted' ? 'Rooms are not available to you on this comic.' : 'Could not reach that room. Check the code and your connection, then try again.'; return; }
  // set up the strip first: switching strips while in a room would otherwise read as leaving it
  if (!starting && app.state.room !== name) app.newStrip({ quiet: true, title: 'Room ' + name.replace(/^fp-/, '') });
  app.state.room = name; app.save();
  R.room = r; R.name = name; app.room.active = true; setWatching(false);
  r.presence({ char: app.state.speaker, typing: false, since: Date.now() });
  R.offs = [
    r.onPeers(ch => { R.peers = ch.peers; renderPeople(); if (ch.joined.some(p => !p.sameTab && !p.isMe) && amAnswerer()) sendStrip(); }),
    r.on('line', m => { if (m.sameTab) return; const l = cleanLine(m.data && m.data.line); if (l) app.addLines([l], { local: false }); }),
    r.on('del', m => { if (!m.sameTab && m.data && typeof m.data.id === 'string') app.removeLine(m.data.id, { local: false }); }),
    r.on('edit', m => { if (m.sameTab) return; const l = cleanLine(m.data && m.data.line); if (l) app.updateLine(l.id, { who: l.who, text: l.text, bg: l.bg }, { local: false }); }),
    r.on('sync', m => {
      if (m.sameTab || !m.data || !Array.isArray(m.data.lines)) return;
      const lines = m.data.lines.map(cleanLine).filter(Boolean); if (lines.length) app.addLines(lines, { local: false });
      if (!(app.state.title || '').trim() || /^Room /.test(app.state.title)) { if (m.data.title) { app.state.title = String(m.data.title).slice(0, 80); $('#title').value = $('#title-m').value = app.state.title; app.save(); } }
    }),
    r.on('ask', m => { if (!m.sameTab && amAnswerer()) sendStrip(); }),
  ];
  if (!starting) send('ask', {});
  else send('ask', {}).then(() => {});   // also checks that this viewer may write here
  renderSheet(); renderPeople();
  app.toast(starting ? 'Room open. Share the code so others can join.' : 'Joined. The strip so far is on its way.');
}
async function leave({ quiet } = {}) {
  R.offs.forEach(off => { try { off(); } catch (e) { /* already gone */ } }); R.offs = [];
  if (R.room) { try { await R.room.leave(); } catch (e) { /* already left */ } }
  R.room = null; R.name = null; R.peers = []; app.room.active = false; setWatching(false);
  if (app.state.room) { delete app.state.room; app.save(); }
  $('#typing').textContent = ''; live.hidden = true; document.body.classList.remove('in-room'); renderSheet();
  if (!quiet) app.toast('You left the room. The strip stays in My comics.');
}

/* local edits go out to the room */
app.on('lines-added', lines => { if (R.room) lines.forEach(l => send('line', { line: outgoing(l) })); });
app.on('line-removed', l => { if (R.room) send('del', { id: l.id }); });
app.on('line-updated', l => { if (R.room) send('edit', { line: outgoing(l) }); });
app.on('speaker', id => { if (R.room) R.room.presence({ char: id }); });
let typingT = 0;
app.on('typing', on => { if (!R.room) return; clearTimeout(typingT); R.room.presence({ typing: on }); if (on) typingT = setTimeout(() => R.room && R.room.presence({ typing: false }), 6000); });
app.on('strip-changed', () => { if (R.room && app.state.room !== R.name) leave({ quiet: true }); });

/* the sheet */
app.ACTS.room = () => { renderSheet(); app.open('#dlg-room'); if (!R.room) $('#room-join-code').value = ''; };
live.addEventListener('click', app.ACTS.room);
$('#room-start').addEventListener('click', () => join(roomName(makeCode()), { starting: true }));
$('#room-join').addEventListener('submit', e => {
  e.preventDefault();
  const code = cleanCode($('#room-join-code').value);
  if (!/^[a-z0-9][a-z0-9-]{2,40}$/.test(code)) { $('#room-error').textContent = 'Type the room code you were given, like otter-plum-42.'; return; }
  join(roomName(code), { starting: false });
});
$('#room-copy').addEventListener('click', async () => { try { await navigator.clipboard.writeText(R.name.replace(/^fp-/, '')); app.toast('Code copied.'); } catch (e) { app.toast('Copying is blocked here. Read the code out instead.'); } });
$('#room-leave').addEventListener('click', () => { leave(); app.close('#dlg-room'); });

/* light up only where this page can reach a room */
if (window.claude && window.claude.use) {
  window.claude.use('room').then(api => {
    if (!api) return;
    R.api = api; btn.hidden = false; app.$$('[data-act="room"]').forEach(b => { b.hidden = false; });
    if (app.state.room) join(app.state.room, { starting: true });   // back in the room you were in before a reload
  }).catch(() => {});
}
})();
