/* The prices a cloud run used, read back from the log of its price job.
 *
 * The cloud sweeps take the prices of the day (.github/workflows/network.yml, job "prices"), and that job prints them
 * as lines "PRICES [[name, Exalted Orbs], ...]". A scenario of the run replayed here with other prices has another
 * promise, and sometimes another route (the copy on this computer was two weeks old on 12 Oct 2026: a Divine Orb at
 * 492 Exalted Orbs where the run had 761).
 *
 *   gh run view <run> -R katxjhuun/poe2-craft-assistant --job <id of the job "prices"> --log > prices.log
 *   node scripts/selftest/prices_from_log.js prices.log prices-of-the-run.json
 *   POE2_PRICES=prices-of-the-run.json node scripts/selftest/network_gap.js "<base>" "id:<scenario id>"
 */
'use strict';
const fs = require('fs');
const [from, to] = process.argv.slice(2);
if (!from || !to) { console.log('usage: node scripts/selftest/prices_from_log.js <log of the price job> <out.json>'); process.exit(1); }
const rows = [];
for (const line of fs.readFileSync(from, 'utf8').split(/\r?\n/)) {
  const m = /PRICES (\[\[.*\]\])\s*$/.exec(line);
  if (m) rows.push(...JSON.parse(m[1]));
}
if (!rows.length) { console.log('no PRICES lines in ' + from); process.exit(1); }
fs.writeFileSync(to, JSON.stringify(rows));
console.log(`${rows.length} prices -> ${to}`);
