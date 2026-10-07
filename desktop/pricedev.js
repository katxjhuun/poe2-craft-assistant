// A stand-in for the desktop program, to work on the price check window without the game and without the trade site:
// it serves the built page (app/dist) and answers the program's addresses with canned data.
//
//   node app/build.js && node desktop/pricedev.js        then open http://localhost:47700/price
//
// /last gives a sample item (the page loads it as if a key press had just copied it), /trade answers every search
// with the listings of desktop/pricedev.sample.json (the trade site is never asked), /overlay prints what the page tells
// the program (its size, the card of a listed item). On /price: ?slow=1 makes every other answer say "wait 2 s" the
// way the program does when searches come too fast, ?side=right puts the card's column right of the price check.
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = +process.env.PORT || 47700;
const root = path.join(__dirname, '..', 'app', 'dist');
const sample = JSON.parse(fs.readFileSync(path.join(__dirname, 'pricedev.sample.json'), 'utf8'));
const MIME = { '.html': 'text/html; charset=utf-8', '.json': 'application/json; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.otf': 'font/otf' };
let which = 'rare', slow = false, side = 'left', calls = 0;

const send = (res, code, type, body) => { res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' }); res.end(body); };
const read = (req) => new Promise((ok) => { let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => ok(b)); });

http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://localhost');
  let p = decodeURIComponent(u.pathname);
  if (p === '/price' || p === '/') {
    if (u.searchParams.get('item')) which = u.searchParams.get('item');
    slow = u.searchParams.get('slow') === '1';
    side = u.searchParams.get('side') === 'right' ? 'right' : 'left';
    p = '/index.html';
  }
  if (p === '/bridge') return send(res, 200, MIME['.json'], JSON.stringify({ bridge: true, hotkey: 'Alt+E', game: 'Path of Exile 2', price: { width: 455, peek: 380, side } }));
  if (p === '/events') { res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' }); res.write(': connected\n\n'); return; }
  if (p === '/last') return send(res, 200, MIME['.json'], JSON.stringify({ text: (sample.items[which] || sample.items.rare).join('\n'), source: 'hotkey', at: Date.now() }));
  if (p === '/trade' && req.method === 'POST') {
    const body = await read(req);
    calls++;
    console.log('trade search', calls, body.length + ' bytes');
    if (slow && calls % 2 === 1) return send(res, 200, MIME['.json'], JSON.stringify({ ok: false, message: 'Too soon after the last search: wait 2 s (the trade site\'s rate limit).', wait: 2, login: false }));
    // fewer lines in use: cheaper listings, as on the trade site (so the page has a difference to measure)
    let lines = 0;
    try { lines = JSON.parse(body).query.stats.reduce((n, g) => n + g.filters.filter((f) => !f.disabled).length, 0); } catch (e) { lines = 0; }
    const k = 0.4 + 0.15 * lines;
    const answer = sample.answers[which] || sample.answers.rare;
    return setTimeout(() => send(res, 200, MIME['.json'], JSON.stringify(Object.assign({}, answer, { listings: answer.listings.map((l) => Object.assign({}, l, { amount: Math.max(1, Math.round(l.amount * k)) })) }))), 350);
  }
  if (p === '/overlay' && req.method === 'POST') { console.log('overlay', await read(req)); return send(res, 200, 'text/plain', 'ok'); }
  if (p === '/lasttrade') return send(res, 200, MIME['.json'], '{}');
  const file = path.join(root, p);
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return send(res, 404, 'text/plain', 'not found');
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
}).listen(PORT, 'localhost', () => console.log('price check stand-in on http://localhost:' + PORT + '/price'));
