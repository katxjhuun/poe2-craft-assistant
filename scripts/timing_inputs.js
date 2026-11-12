/* Inputs for measuring the answer time in the page (definition of done, measure 3: 10 seconds in the browser).
 * Writes app/dist/data/timing-inputs.json: goals of the list as the page's worker gets them (item, targets, prices).
 *   node scripts/timing_inputs.js "<goal id>" ...
 * In the built page: fetch it and post each to a worker made of the page's own scripts (see reports/gate-*.md).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const L = require('./selftest/lib.js');
const SW = require('./selftest/network_sweep.js');
const goals = require('../app/data/targets_0.5.5.json').goals;
const { priceByName } = L.load();
const out = [];
for (const id of process.argv.slice(2)) {
  const g = goals.find((x) => x.id === id);
  if (!g) { console.log('not in the list:', id); continue; }
  const sc = SW.scenario(g.base, g.n);
  out.push({ id, input: { item: sc.item, targets: sc.targets, locks: {}, baseCost: 1, restart: sc.restart, itemCost: sc.itemCost, weights: L.weightsFor(sc.base), essences: SW.table(sc.base).essences, quality: sc.qualityMode } });
}
fs.writeFileSync(path.join(__dirname, '..', 'app', 'dist', 'data', 'timing-inputs.json'), JSON.stringify({ prices: priceByName, goals: out }));
console.log(out.length, 'goals');
