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
