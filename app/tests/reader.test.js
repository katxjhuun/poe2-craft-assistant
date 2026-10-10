// The reader over the whole knowledge base: every base, every modifier it can carry, both copy formats
// (scripts/selftest/reader_check.js). About 20 seconds.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { spawnSync } = require('child_process');

test('the reader names every modifier of every base, in Alt+Ctrl+C and in Ctrl+C text', () => {
  const r = spawnSync(process.execPath, [path.join(__dirname, '..', '..', 'scripts', 'selftest', 'reader_check.js')], { encoding: 'utf8', maxBuffer: 1 << 26 });
  const out = r.stdout || '';
  const line = (label) => out.split('\n').find((l) => l.startsWith(label + ':')) || '';
  const num = (l, word) => +((new RegExp(word + ' (\\d+)').exec(l) || [])[1] || NaN);
  assert.match(out, /headers not read: 0/, out.slice(0, 2000));
  for (const label of ['Alt+Ctrl+C', 'Ctrl+C', 'Alt+Ctrl+C, rune gone', 'Ctrl+C, rune gone']) {
    assert.strictEqual(num(line(label), 'wrong'), 0, label + ': ' + out.slice(0, 3000));
    assert.ok(num(line(label), 'exact') > 20000, label + ': ' + line(label));
  }
  // Alt+Ctrl+C carries side, tier and marks: nearly nothing is left to ask
  assert.ok(num(line('Alt+Ctrl+C'), 'listed\\)') <= 20, line('Alt+Ctrl+C'));
  assert.strictEqual(r.status, 0, out.slice(0, 3000));
});
