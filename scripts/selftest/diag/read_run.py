# Summary of a deep cloud run: the job logs fetched into one folder (fetch_run.sh), the shards' reports added up.
# python read_run.py <folder> [disagreements to list] [width]
import re, glob, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
D = sys.argv[1].rstrip('/').rstrip(chr(92)) + '/'
nbad = int(sys.argv[2]) if len(sys.argv) > 2 else 60
width = int(sys.argv[3]) if len(sys.argv) > 3 else 420
TOTAL = 0
shards, tot = {}, dict(sc=0, checked=0, agree=0, bad=0, outside=0, err=0, crafts=0, full=0, cut=0, riv=0, cheaper=0)
bad, cheaper, errors, outside, classes = [], [], [], {}, {}
detours, futile, fatal = {}, [], 0
det_head, fut_head = [], []
for f in sorted(glob.glob(D + 'job-*.log')):
    lines = [re.sub(r'^[^\t]*\t[^\t]*\t\S+ ?', '', l.rstrip('\n')) for l in open(f, encoding='utf-8', errors='replace')]
    cur, mode = None, None
    for l in lines:
        if 'FATAL ERROR' in l: fatal += 1
        m = re.match(r'## Craft network sweep, shard (\d+) of (\d+)', l)
        if m: cur = int(m.group(1)); shards[cur] = 1; TOTAL = max(TOTAL, int(m.group(2))); mode = None; continue
        if cur is None: continue
        m = re.match(r'(\d+) scenarios in [\d.]+ min .*?: (\d+) checked against the simulator, (\d+) agree, (\d+) do not, (\d+) outside the network, (\d+) errors', l)
        if m:
            for k, v in zip(['sc', 'checked', 'agree', 'bad', 'outside', 'err'], map(int, m.groups())): tot[k] += v
            continue
        m = re.match(r'Crafts played: ([\d,]+) in all; (\d+) scenarios with all [\d,]+, (\d+) cut short', l)
        if m: tot['crafts'] += int(m.group(1).replace(',', '')); tot['full'] += int(m.group(2)); tot['cut'] += int(m.group(3)); continue
        m = re.match(r'Old routes simulated on (\d+) scenarios: clearly cheaper than the network\'s route on (\d+)', l)
        if m: tot['riv'] += int(m.group(1)); tot['cheaper'] += int(m.group(2)); continue
        m = re.match(r'\| ([A-Za-z ]+) \| (\d+) \| (\d+) \| (\d+) \| (\d+) \| (\d+) \|', l)
        if m and m.group(1).strip() != 'Class':
            c = classes.setdefault(m.group(1).strip(), [0, 0, 0, 0, 0])
            for i in range(5): c[i] += int(m.group(i + 2))
            continue
        if l.startswith('Outside the network:'):
            for name, n in re.findall(r'([^,(]+) \((\d+)\)', l[len('Outside the network:'):]): outside[name.strip()] = outside.get(name.strip(), 0) + int(n)
            continue
        if l.startswith('### Promise and play disagree'): mode = 'bad'; continue
        if l.startswith('### An old route is cheaper'): mode = 'cheap'; continue
        if l.startswith('### Errors'): mode = 'err'; continue
        if l.startswith('### Detours'): mode = 'det'; continue
        if l.startswith('### Items given up as futile'): mode = 'fut'; continue
        if l.startswith('## ') or l.startswith('##['): mode = None
        if mode == 'det' and re.match(r'\d+ scenarios took another step', l): det_head.append(l)
        if mode == 'fut' and re.match(r'\d+ scenarios \(', l): fut_head.append(l)
        if l.startswith('- '):
            if mode == 'bad': bad.append(l[2:])
            elif mode == 'cheap': cheaper.append(l[2:])
            elif mode == 'err': errors.append(l[2:])
            elif mode == 'det':
                m = re.match(r'- ([\d,]+)x (.*)$', l)
                if m: detours[m.group(2)] = detours.get(m.group(2), 0) + int(m.group(1).replace(',', ''))
            elif mode == 'fut': futile.append(l[2:])
print('shards reported:', len(shards), 'of', TOTAL, '; missing:', sorted(set(range(1, TOTAL + 1)) - set(shards)), '| processes that died of memory:', fatal)
print(tot)
print('classes (scenarios, agree, do not, outside, errors):')
for c, v in sorted(classes.items()): print('  ', c.ljust(18), v)
print('outside:', outside)
def ratio(l):
    m = re.search(r'\(x([\d.]+)\)', l)
    return float(m.group(1)) if m else 1.0
bad.sort(key=lambda l: -abs(ratio(l) - 1))
far = [l for l in bad if abs(ratio(l) - 1) > 0.15]
print('\nDISAGREE', len(bad), '| cost off by more than 15%:', len(far))
for l in bad[:nbad]: print('  ' + l[:width])
print('\nDETOURS: scenarios', sum(int(re.match(r'(\d+)', h).group(1)) for h in det_head), '| uses', sum(detours.values()))
for k, v in sorted(detours.items(), key=lambda x: -x[1])[:10]: print('  %dx %s' % (v, k[:200]))
print('\nFUTILE: scenarios', sum(int(re.match(r'(\d+)', h).group(1)) for h in fut_head))
for h in fut_head[:3]: print('  ' + h[:200])
for l in futile[:14]: print('  ' + l[:260])
print('\nCHEAPER OLD ROUTE', len(cheaper))
for l in cheaper[:10]: print('  ' + l[:300])
print('\nERRORS', len(errors))
for l in errors[:10]: print('  ' + l[:400])
