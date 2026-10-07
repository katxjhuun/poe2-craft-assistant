// node app/build.js -> app/dist/index.html (+ data/). Inlines engine, samples and the Fontin font.
const fs = require('fs');
const path = require('path');
const here = __dirname;
const dist = path.join(here, 'dist');
fs.mkdirSync(path.join(dist, 'data'), { recursive: true });

let html = fs.readFileSync(path.join(here, 'index.src.html'), 'utf8');
const font = fs.readFileSync(path.join(here, 'data', 'Fontin-SmallCaps.otf')).toString('base64');
html = html.replace('/*__FONTIN_SC__*/', () => 'data:font/otf;base64,' + font);
html = html.replace('/*__ENGINE__*/', () => fs.readFileSync(path.join(here, 'engine.js'), 'utf8'));
html = html.replace('/*__PLANNER__*/', () => fs.readFileSync(path.join(here, 'planner.js'), 'utf8'));
html = html.replace('/*__NETWORK__*/', () => fs.readFileSync(path.join(here, 'network.js'), 'utf8'));
html = html.replace('/*__GUIDE__*/', () => fs.readFileSync(path.join(here, 'guide.js'), 'utf8'));
html = html.replace('/*__VALUE__*/', () => fs.readFileSync(path.join(here, 'value.js'), 'utf8'));
html = html.replace('/*__PRICECHECK__*/', () => fs.readFileSync(path.join(here, 'pricecheck.js'), 'utf8'));
html = html.replace('/*__SAMPLES__*/', () => fs.readFileSync(path.join(here, 'samples.js'), 'utf8'));
fs.writeFileSync(path.join(dist, 'index.html'), html);

// Minified knowledge base and the icon pack.
const kb = JSON.parse(fs.readFileSync(path.join(here, '..', 'poe2_kb_0.5.5.json'), 'utf8'));
fs.writeFileSync(path.join(dist, 'data', 'poe2_kb_0.5.5.json'), JSON.stringify(kb));
fs.copyFileSync(path.join(here, 'data', 'icons.json'), path.join(dist, 'data', 'icons.json'));
fs.copyFileSync(path.join(here, 'data', 'recipes_0.5.5.json'), path.join(dist, 'data', 'recipes_0.5.5.json'));
// Self-test results (scripts/selftest/run.js), shown in Recipes & guides.
if (fs.existsSync(path.join(here, 'data', 'insights_0.5.5.json'))) fs.writeFileSync(path.join(dist, 'data', 'insights_0.5.5.json'), JSON.stringify(JSON.parse(fs.readFileSync(path.join(here, 'data', 'insights_0.5.5.json'), 'utf8'))));
if (fs.existsSync(path.join(here, 'data', 'weights_0.5.5.json'))) fs.copyFileSync(path.join(here, 'data', 'weights_0.5.5.json'), path.join(dist, 'data', 'weights_0.5.5.json'));
// Fallback price snapshot for views without the database (latest scripts/fetch_prices.py output).
const outDir = path.join(here, '..', '.kb_cache', 'out');
if (fs.existsSync(path.join(outDir, 'meta.json'))) {
  const snap = { meta: JSON.parse(fs.readFileSync(path.join(outDir, 'meta.json'), 'utf8')), leagues: {} };
  for (const d of snap.meta.docs || snap.meta.leagues.map((l) => l.slug)) snap.leagues[d] = JSON.parse(fs.readFileSync(path.join(outDir, 'league-' + d + '.json'), 'utf8'));
  fs.writeFileSync(path.join(dist, 'data', 'prices-snapshot.json'), JSON.stringify(snap));
}
// Data for the cloud price job, which runs scripts/fetch_prices.py from the GitHub copy of this project without the
// local .kb_cache: the base item names and classes it maps currency ids with, and the ids of the icons the page has.
const cache = path.join(here, '..', '.kb_cache');
const toolData = path.join(here, '..', 'scripts', 'data');
fs.mkdirSync(toolData, { recursive: true });
if (fs.existsSync(path.join(cache, 'poe2_base_items.json'))) {
  const base = JSON.parse(fs.readFileSync(path.join(cache, 'poe2_base_items.json'), 'utf8'));
  const slim = {};
  for (const [id, b] of Object.entries(base)) if (b && b.name) slim[id] = { name: b.name, item_class: b.item_class };
  fs.writeFileSync(path.join(toolData, 'poe2_base_items.min.json'), JSON.stringify(slim));
}
if (fs.existsSync(path.join(cache, 'icons'))) {
  const ids = fs.readdirSync(path.join(cache, 'icons')).filter((f) => f.endsWith('.png')).map((f) => f.slice(0, -4)).sort();
  fs.writeFileSync(path.join(toolData, 'icon_ids.json'), JSON.stringify(ids));
}
console.log('built', (html.length / 1024).toFixed(0) + ' KB page');
