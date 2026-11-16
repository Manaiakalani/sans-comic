/* Layout rules for the comic engine. No browser, and no sprite sheets. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { runInThisContext } from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

globalThis.window = globalThis;
globalThis.document = {
  createElement() {
    return { getContext: () => ctx };
  },
};
const ctx = {
  font: '',
  measureText(text) {
    const size = Number((String(this.font).match(/(\d+(?:\.\d+)?)px/) || [, 16])[1]);
    return { width: [...String(text)].length * size * 0.5 };
  },
};
globalThis.Image = class Image {
  set src(value) { this._src = value; }
  get src() { return this._src; }
  addEventListener() {}
};

runInThisContext(readFileSync(join(root, 'manifest.js'), 'utf8'), { filename: 'manifest.js' });
runInThisContext(readFileSync(join(root, 'engine.js'), 'utf8'), { filename: 'engine.js' });

const { FP } = globalThis;
const strip = { cast: ['anna', 'dan', 'xeno'], caps: false, font: 'classic', sides: true, lines: [] };
const line = (id, who, text) => ({ id, who, text, kind: 'auto' });

test('LOL laughs', () => {
  const read = FP.readLine({ who: 'dan', text: 'You type it and it draws it. LOL', kind: 'auto' }, strip);
  assert.equal(read.emo, FP.E.LAUGH);
  assert.equal(read.kind, 'say');
});

test('CAPS shout', () => {
  const read = FP.readLine({ who: 'dan', text: 'WAIT. WHO INVITED THE ALIEN?!', kind: 'auto' }, strip);
  assert.equal(read.kind, 'shout');
  assert.equal(read.emo, FP.E.SHOUT);
});

test('parentheses think', () => {
  const read = FP.readLine({ who: 'xeno', text: '(I crossed forty light years for this?)', kind: 'auto' }, strip);
  assert.equal(read.kind, 'think');
  assert.equal(read.text, 'I crossed forty light years for this?');
});

test('tildes whisper', () => {
  const read = FP.readLine({ who: 'anna', text: '~do not tell anyone~', kind: 'auto' }, strip);
  assert.equal(read.kind, 'whisper');
  assert.equal(read.text, 'do not tell anyone');
});

test('a name in the cast points at that character', () => {
  const read = FP.readLine({ who: 'anna', text: 'Dan, look at this', kind: 'auto' }, strip);
  assert.equal(read.mention, 'dan');
  assert.equal(read.gest, FP.E.POINT_YOU);
});

test('a leading Name: is the speaker, and a name later in the line still points', () => {
  const ids = ['anna', 'dan', 'xeno', 'tongtyed'];
  assert.equal(FP.namedLine('Dan, look at this', ids), null);
  assert.equal(FP.namedLine('hello Dan', ids), null);
  assert.equal(FP.namedLine('Hi: there', ids), null);
  assert.deepEqual(FP.namedLine('  xeno: hi there  ', ids), { id: 'xeno', text: 'hi there' });
  assert.deepEqual(FP.namedLine('Tongue-Tyed: hush', ids), { id: 'tongtyed', text: 'hush' });
  const named = FP.namedLine('Anna: Dan, look at this', ids);
  assert.deepEqual(named, { id: 'anna', text: 'Dan, look at this' });
  const read = FP.readLine({ who: named.id, text: named.text, kind: 'auto' }, strip);
  assert.equal(read.mention, 'dan');
  assert.equal(read.gest, FP.E.POINT_YOU);
  assert.equal(FP.namedLine('Jordan: hello', ['anna', 'dan']), null);
});

test('the same speaker starts the next panel', () => {
  const panels = FP.layoutStrip({
    ...strip,
    lines: [
      line('a', 'anna', 'Hello there'),
      line('b', 'dan', 'Good to see you'),
      line('c', 'anna', 'Shall we begin'),
    ],
  }, null);
  assert.deepEqual(panels[0].lines.map(item => item.id), ['a', 'b']);
  assert.deepEqual(panels[1].lines.map(item => item.id), ['c']);
});

test('sheet columns follow panels per row, and auto matches the PNG', () => {
  assert.equal(FP.sheetCols({ perRow: 3 }, 5), 3);
  assert.equal(FP.sheetCols({ perRow: 4 }, 2), 2);
  assert.equal(FP.sheetCols({ perRow: 2 }, 5), 2);
  assert.equal(FP.sheetCols({}, 1), 1);
  assert.equal(FP.sheetCols({}, 3), 3);
  assert.equal(FP.sheetCols({}, 4), 2);
  assert.equal(FP.sheetCols({ perRow: 'auto' }, 6), 3);
});

test('a pasted chat accepts a name on its own line', () => {
  const colon = line => {
    const m = String(line).match(/^([^:]{1,28}?)\s*:\s+(.+)$/);
    return m ? [m[1].trim(), m[2]] : null;
  };
  assert.deepEqual(FP.chatRows('Sam: hi there\nRiley: I am at practice', colon), [
    ['Sam', 'hi there'],
    ['Riley', 'I am at practice'],
  ]);
  assert.deepEqual(FP.chatRows('Sam\nhi, are you free tonight?\nRiley\nI am at practice until 8\nSam\nLOL same as every Thursday', colon), [
    ['Sam', 'hi, are you free tonight?'],
    ['Riley', 'I am at practice until 8'],
    ['Sam', 'LOL same as every Thursday'],
  ]);
  assert.deepEqual(FP.chatRows('Sam\nhi there\nstill me', colon), [
    ['Sam', 'hi there'],
    ['Sam', 'still me'],
  ]);
  assert.deepEqual(FP.chatRows('Hello there friend, this is just a note.', colon), [
    ['', 'Hello there friend, this is just a note.'],
  ]);
});

test('an action is its own panel', () => {
  const panels = FP.layoutStrip({
    ...strip,
    lines: [
      line('a', 'anna', 'Hello there'),
      line('b', 'dan', 'Good to see you'),
      line('c', 'anna', '*backs away*'),
    ],
  }, null);
  assert.equal(panels.length, 2);
  assert.equal(panels[1].lines[0].id, 'c');
  assert.equal(panels[1].caption.lines.join(' '), 'Anna backs away');
});
