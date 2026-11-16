/* Sans Comic exports: PNG, animated GIF, PDF, project file, script, single panels, and opening project files. */
(() => {
'use strict';
const FP = window.FP, app = FP.app, { $, el } = app;
const GIFENC = 'vendor/gifenc.esm.js';
const JSPDF = 'vendor/jspdf.umd.min.js';
let pngBlob = null, previewUrl = null;

const loadScript = src => new Promise((res, rej) => { const s = el('script', { src, async: true }); s.onload = res; s.onerror = () => rej(new Error('load')); document.head.append(s); });
const nextFrame = () => new Promise(r => setTimeout(r, 0));
const blobOf = (cv, type = 'image/png', q) => new Promise(r => cv.toBlob(r, type, q));
function realPanels() { return FP.layoutStrip(app.state, null); }
/* Make sure every drawing and backdrop the strip uses has arrived before drawing it into a file. */
async function ready(panels) {
  const waits = [];
  const wait = rec => { if (!rec.ready) waits.push(new Promise(r => { rec.img.addEventListener('load', r, { once: true }); rec.img.addEventListener('error', r, { once: true }); })); };
  new Set(panels.flatMap(p => p.ids)).forEach(id => wait(FP.atlas(id)));
  for (const p of panels) {
    if (p.bg === 'custom' && p.style.customBg) wait(FP.loadImage('u:' + p.style.customBgKey, p.style.customBg));
    else if (FP.ART.bgs.some(b => b.id === p.bg)) wait(FP.loadImage('b:' + p.bg, `art/bg-${p.bg}.jpg`));
  }
  await Promise.all(waits);
}
async function saveFile(filename, data, label) {
  const saver = app.saver;
  if (!saver) { app.toast('Saving files is not available here.'); return false; }
  try { await saver.save({ filename, data }); app.toast(`${label} saved.`); return true; }
  catch (err) { if (!err || err.code !== 'declined') app.toast('That file could not be saved here.'); return false; }
}
function setBusy(btn, text) { if (!btn._label) btn._label = btn.textContent; btn.disabled = !!text; btn.textContent = text || btn._label; }
function showPreview(blob) { if (previewUrl) URL.revokeObjectURL(previewUrl); previewUrl = URL.createObjectURL(blob); $('#export-img').src = previewUrl; }

/* ---------- the export sheet ---------- */
app.ACTS.export = async () => {
  const panels = realPanels();
  if (!panels.length) return app.toast('Draw a panel first.');
  await ready(panels);
  pngBlob = await blobOf(FP.renderSheet(app.state, panels));
  showPreview(pngBlob);
  const shareBtn = $('#png-share');
  if (shareBtn) shareBtn.hidden = !canSharePng(pngBlob);
  const can = !!app.saver;
  app.$$('#dlg-export [data-needs-save]').forEach(b => { b.hidden = !can; });
  $('#gif-go').textContent = can ? 'Save GIF' : 'Make GIF';
  $('#export-note').textContent = can ? '' : 'Saving files is not available here. Press and hold the picture, or right-click it, to keep it.';
  app.open('#dlg-export');
};
const shareName = () => app.fileName() + '.png';
function canSharePng(blob) {
  try {
    if (!blob || !navigator.share || !navigator.canShare) return false;
    return navigator.canShare({ files: [new File([blob], shareName(), { type: 'image/png' })] });
  } catch (e) { return false; }
}
$('#png-share').addEventListener('click', async () => {
  if (!pngBlob) return;
  const file = new File([pngBlob], shareName(), { type: 'image/png' });
  const title = (app.state.title || '').trim() || 'Sans Comic';
  try { await navigator.share({ files: [file], title }); }
  catch (err) { if (!err || err.name !== 'AbortError') app.toast('Sharing is blocked here. Press and hold the picture instead.'); }
});
$('#png-save').addEventListener('click', () => pngBlob && saveFile(app.fileName() + '.png', pngBlob, 'Image'));
$('#png-copy').addEventListener('click', async () => {
  try { await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngBlob })]); app.toast('Image copied.'); }
  catch (e) { app.toast('Copying pictures is blocked here. Press and hold the picture instead.'); }
});

/* Animated GIF: each panel appears, then its balloons pop in one at a time. */
$('#gif-go').addEventListener('click', async e => {
  const btn = e.currentTarget, panels = realPanels();
  if (!panels.length) return;
  setBusy(btn, 'Loading…');
  let enc;
  try { enc = await import(GIFENC); } catch (err) { setBusy(btn); return app.toast('The GIF maker could not load. Check the connection and try again.'); }
  await ready(panels);
  const { GIFEncoder, quantize, applyPalette } = enc, S = 480, cv = el('canvas', { width: S, height: S }), ctx = cv.getContext('2d', { willReadFrequently: true });
  const gif = GIFEncoder(), total = panels.reduce((n, p) => n + FP.beatsOf(p) + 1, 0);
  let done = 0;
  for (const p of panels) {
    const beats = FP.beatsOf(p);
    for (let k = 0; k <= beats; k++) {
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, S, S);
      FP.drawPanel(ctx, p, S, { balloons: k });
      const { data } = ctx.getImageData(0, 0, S, S), palette = quantize(data, 256), index = applyPalette(data, palette);
      const words = k && p.balloons[k - (p.caption ? 1 : 0) - 1] ? p.balloons[k - (p.caption ? 1 : 0) - 1].lines.join(' ').length : 0;
      gif.writeFrame(index, S, S, { palette, delay: k === 0 ? 600 : k === beats ? 1500 + words * 35 : 900 + words * 35 });
      setBusy(btn, `Making… ${Math.round(++done / total * 100)}%`);
      await nextFrame();
    }
  }
  gif.finish();
  const blob = new Blob([gif.bytes()], { type: 'image/gif' });
  setBusy(btn);
  if (app.saver) saveFile(app.fileName() + '.gif', blob, 'GIF');
  else { showPreview(blob); app.toast('Your GIF is in the preview. Press and hold it to keep it.'); }
});

/* PDF: pages to print, the same columns as the PNG, the title on the first page. */
$('#pdf-go').addEventListener('click', async e => {
  const btn = e.currentTarget, panels = realPanels();
  if (!panels.length) return;
  setBusy(btn, 'Loading…');
  try { if (!window.jspdf) await loadScript(JSPDF); } catch (err) { setBusy(btn); return app.toast('The PDF maker could not load. Check the connection and try again.'); }
  await ready(panels);
  const letter = /^en-(US|CA)|^es-(MX|US)/i.test(navigator.language || '');
  const doc = new window.jspdf.jsPDF({ unit: 'pt', format: letter ? 'letter' : 'a4' });
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), m = 40, gap = 16;
  const cols = FP.sheetCols(app.state, panels.length), size = (W - 2 * m - (cols - 1) * gap) / cols;
  const title = (app.state.title || '').trim(), cv = el('canvas', { width: 900, height: 900 }), ctx = cv.getContext('2d');
  let y = m;
  if (title) { doc.setFont('helvetica', 'bold'); doc.setFontSize(22); doc.text(title, m, m + 18); y += 40; }
  const foot = () => { doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(90); doc.text('Characters by Jim Woodring, from Microsoft Comic Chat', m, H - 20); doc.setTextColor(0); };
  for (let i = 0; i < panels.length; i++) {
    const col = i % cols;
    if (col === 0 && i > 0) y += size + gap;
    if (col === 0 && y + size > H - m) { foot(); doc.addPage(); y = m; }
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 900, 900); FP.drawPanel(ctx, panels[i], 900);
    doc.addImage(cv.toDataURL('image/jpeg', 0.9), 'JPEG', m + col * (size + gap), y, size, size);
    setBusy(btn, `Making… ${Math.round((i + 1) / panels.length * 100)}%`);
    await nextFrame();
  }
  foot();
  const blob = doc.output('blob');
  setBusy(btn);
  saveFile(app.fileName() + '.pdf', blob, 'PDF');
});

/* Project file: everything needed to reopen and keep editing, here or on another device.
   A backup is the same kind of file, with every strip in My comics. */
const projectOf = () => { const s = app.clone(app.state); delete s.room; s.lines.forEach(l => { delete l.mine; }); return JSON.stringify({ app: 'sans-comic', version: 1, strip: s }, null, 1); };
function cleanProjectStrip(raw, { keepId = false } = {}) {
  const strip = raw && raw.strip ? raw.strip : raw;
  if (!app.validStrip(strip)) return null;
  const next = app.clone(strip);
  next.lines = next.lines.filter(l => l && FP.CH[l.who] && typeof l.text === 'string').map(l => Object.assign(l, { id: String(l.id || FP.uid()).slice(0, 24), text: String(l.text).slice(0, 300) }));
  next.lines.forEach(l => { delete l.mine; });
  delete next.room;
  if (!next.lines.length) return null;
  if (keepId && next.id) next.id = String(next.id).slice(0, 40);
  else next.id = FP.uid();
  return next;
}
$('#project-save').addEventListener('click', () => saveFile(app.fileName() + '.json', projectOf(), 'Project file'));
$('#lib-backup').addEventListener('click', async () => {
  app.save(); app.flush();
  const strips = app.lib.map(s => { const c = app.clone(s); delete c.room; (c.lines || []).forEach(l => { delete l.mine; }); return c; });
  if (!strips.length) return app.toast('Write a line first. Nothing is saved yet.');
  const ok = await saveFile('sans-comic-backup.json', JSON.stringify({ app: 'sans-comic', version: 1, strips }, null, 1), 'Backup');
  if (!ok) return;
  try { localStorage.setItem('sans-comic-backup', String(Date.now())); } catch (e) { /* storage unavailable */ }
  const hint = $('#lib-hint'); if (hint) hint.hidden = true;
});
$('#script-copy').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(FP.scriptOf(app.state)); app.toast('Script copied.'); }
  catch (e) { app.toast('Copying is blocked here.'); }
});
$('#script-save').addEventListener('click', () => saveFile(app.fileName() + '.txt', FP.scriptOf(app.state), 'Script'));

/* One panel on its own, from the panel editor. */
app.on('save-panel', async panel => {
  await ready([panel]);
  const cv = el('canvas', { width: 1200, height: 1200 }); FP.drawPanel(cv.getContext('2d'), panel, 1200);
  const blob = await blobOf(cv), n = app.panels.indexOf(panel) + 1;
  if (app.saver) saveFile(`${app.fileName()}-panel-${n || 1}.png`, blob, 'Panel');
  else { pngBlob = blob; showPreview(blob); app.$$('#dlg-export [data-needs-save]').forEach(b => { b.hidden = true; }); $('#export-note').textContent = 'Press and hold the picture, or right-click it, to keep it.'; app.close('#dlg-panel'); app.open('#dlg-export'); }
});

/* Open a project file saved earlier. */
app.ACTS.openfile = () => $('#project-file').click();
$('#project-file').addEventListener('change', async e => {
  const file = e.target.files[0]; e.target.value = '';
  if (!file) return;
  let data;
  try { data = JSON.parse(await file.text()); } catch (err) { return app.toast('That file is not a Sans Comic project.'); }
  if (data && Array.isArray(data.strips)) {
    const strips = data.strips.map(raw => cleanProjectStrip(raw, { keepId: true })).filter(Boolean);
    if (!strips.length) return app.toast('That backup has no comics this version can open.');
    for (const strip of strips) {
      const i = app.lib.findIndex(x => x.id === strip.id);
      if (i >= 0) app.lib[i] = strip; else app.lib.unshift(strip);
    }
    const newest = strips.slice().sort((a, b) => (b.updated || 0) - (a.updated || 0))[0];
    app.setStrip(newest);
    app.toast(`Opened ${strips.length} comic${strips.length === 1 ? '' : 's'} from the backup.`);
    if ($('#dlg-lib').open) { app.close('#dlg-lib'); }
    return;
  }
  const strip = cleanProjectStrip(data);
  if (!strip) return app.toast('That file is not a Sans Comic project, or it uses characters this version lacks.');
  app.setStrip(strip);
  app.toast(`Opened “${strip.title || 'Untitled strip'}”. It is in My comics too.`);
});
})();
