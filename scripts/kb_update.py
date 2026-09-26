#!/usr/bin/env python3
"""PoE2 Craft Assistant - knowledge base update pipeline (master prompt 4.3).

    poe2_kb_build.py -> candidate JSON -> difference report -> tests -> approval

  python scripts/kb_update.py build [--fresh]   build a candidate from the game data exports (downloads the sources
                                                that are not cached; --fresh downloads them again, for a new patch)
                                                and add the jewel data (augment_jewels.py) to it
  python scripts/kb_update.py check [FILE]      compare FILE (default: the candidate) with the knowledge base in use,
                                                run the page's tests and a quick self-test against it, write a report
  python scripts/kb_update.py approve [FILE]    back up the knowledge base in use, put FILE in its place and rebuild
                                                the page (the artifact still needs a publish)

The candidate lives in .kb_cache/candidate/; nothing replaces poe2_kb_0.5.5.json before `approve`.
Check the licenses of the source repositories before using a new export (see poe2_kb_build.py).
"""
import glob, json, os, shutil, subprocess, sys, time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CURRENT = os.path.join(ROOT, 'poe2_kb_0.5.5.json')
CACHE = os.path.join(ROOT, '.kb_cache')
CAND_DIR = os.path.join(CACHE, 'candidate')
CANDIDATE = os.path.join(CAND_DIR, 'poe2_kb_candidate.json')
REPORTS = os.path.join(ROOT, 'reports')
SOURCES = ['poe2_mods.json', 'poe2_base_items.json', 'poe2_version.txt', 'poe2_keywords.json', 'poe1_base_items.json', 'items.ndjson', 'stats.ndjson']


def run(cmd, env=None, cwd=ROOT):
    """Run a command, return (exit code, combined output)."""
    e = dict(os.environ, **(env or {}))
    p = subprocess.run(cmd, cwd=cwd, env=e, capture_output=True, text=True, encoding='utf-8', errors='replace')
    return p.returncode, (p.stdout or '') + (p.stderr or '')


def build(fresh):
    os.makedirs(CAND_DIR, exist_ok=True)
    if fresh:
        for name in SOURCES:
            p = os.path.join(CACHE, name)
            if os.path.exists(p):
                os.remove(p)
    missing = [n for n in SOURCES if not os.path.exists(os.path.join(CACHE, n))]
    if missing:
        print('downloading:', ', '.join(missing))
    code, out = run([sys.executable, 'poe2_kb_build.py', CANDIDATE], env={'KB_CACHE': CACHE})
    print(out.strip()[-2000:])
    if code:
        print('build failed'); return code
    code, out = run([sys.executable, os.path.join('scripts', 'augment_jewels.py')], env={'POE2_KB': CANDIDATE})
    print(out.strip()[-1500:])
    if code:
        print('jewel augmentation failed (the candidate has no jewel data)'); return code
    print(f'candidate: {CANDIDATE}\nnext: python scripts/kb_update.py check')
    return 0


def check(path):
    if not os.path.exists(path):
        print(f'no candidate at {path}; run build first'); return 2
    os.makedirs(REPORTS, exist_ok=True)
    stamp = time.strftime('%Y-%m-%d-%H%M')
    diff_md = os.path.join(REPORTS, f'kb-update-{stamp}-diff.md')
    diff_js = os.path.join(REPORTS, f'kb-update-{stamp}-diff.json')
    code, out = run([sys.executable, os.path.join('scripts', 'kb_diff.py'), CURRENT, path, '--out', diff_md, '--json', diff_js])
    print(out.strip())
    tests = sorted(glob.glob(os.path.join(ROOT, 'app', 'tests', '*.test.js')))
    t_code, t_out = run(['node', '--test'] + tests, env={'POE2_KB': os.path.abspath(path)})
    summary = [l for l in t_out.splitlines() if l.startswith('ℹ ') or l.startswith('✖')]
    s_code, s_out = run(['node', os.path.join('scripts', 'selftest', 'run.js'), '--quick'], env={'POE2_KB': os.path.abspath(path)})
    s_sum = [l for l in s_out.splitlines() if 'RULES AND PARSER' in l or l.strip().startswith(('crash', 'slots', 'groups', 'effect', 'parse-', 'frequencies')) or 'FAIL' in l]
    # poe2db weights mapped onto the candidate's mod ids (cached pages, no download)
    cand_w = os.path.join(CAND_DIR, 'weights_candidate.json')
    w_code, w_out = run([sys.executable, os.path.join('scripts', 'build_weights.py'), '--offline'], env={'POE2_KB': os.path.abspath(path), 'POE2_WEIGHTS_OUT': cand_w})
    cur_meta = json.load(open(os.path.join(ROOT, 'app', 'data', 'weights_0.5.5.json'), encoding='utf-8'))['meta']
    new_meta = json.load(open(cand_w, encoding='utf-8'))['meta'] if w_code == 0 and os.path.exists(cand_w) else None
    weights_line = (f"poe2db weights: {cur_meta['matched']} mods matched, {cur_meta['unmatched']} unmatched now; "
                    + (f"{new_meta['matched']} matched, {new_meta['unmatched']} unmatched with the candidate" if new_meta else 'could not be built for the candidate'))
    print(weights_line)
    diff = json.load(open(diff_js, encoding='utf-8'))
    review = [s['title'] for s in diff['sections'] if s['review']]
    ok = t_code == 0 and s_code == 0 and not any('FAIL' in l for l in s_sum)
    rep = os.path.join(REPORTS, f'kb-update-{stamp}.md')
    with open(rep, 'w', encoding='utf-8') as f:
        f.write('\n'.join([
            f'# Knowledge base update check ({stamp})', '',
            f'- Candidate: `{path}`', f"- In use: `{CURRENT}`",
            f"- Game data: {diff['meta']['old_version']} -> {diff['meta']['new_version']}", '',
            f"## Verdict: {'ready to approve' if ok and not review else 'ready to approve after the review below' if ok else 'NOT ready: tests or self-test failed'}", '',
            f"Needs a look in the difference report: {', '.join(review) if review else 'nothing'} (`{os.path.basename(diff_md)}`)", '',
            f'{weights_line}.', '',
            '## Page tests', '```', *(summary or ['(no output)']), '```', '',
            '## Quick self-test', '```', *(s_sum or ['(no output)']), '```', '',
            'Approve with: `python scripts/kb_update.py approve`' + ('' if path == CANDIDATE else f' "{path}"'),
            'Tests are written for patch 0.5.5; after a big patch some may fail because the game changed. Update those tests on purpose, never to make a wrong result pass.',
        ]))
    print(f"\npage tests: {'passed' if t_code == 0 else 'FAILED'}; quick self-test: {'passed' if s_code == 0 and not any('FAIL' in l for l in s_sum) else 'FAILED'}")
    print(f'report: {rep}')
    return 0 if ok else 1


def approve(path):
    if not os.path.exists(path):
        print(f'no candidate at {path}'); return 2
    backup = os.path.join(CACHE, f"poe2_kb_backup_{time.strftime('%Y-%m-%d-%H%M')}.json")
    shutil.copyfile(CURRENT, backup)
    shutil.copyfile(path, CURRENT)
    shutil.copyfile(os.path.join(ROOT, 'app', 'data', 'weights_0.5.5.json'), backup.replace('poe2_kb_backup', 'weights_backup'))
    w_code, w_out = run([sys.executable, os.path.join('scripts', 'build_weights.py'), '--offline'])
    print(w_out.strip()[-600:])
    code, out = run(['node', os.path.join('app', 'build.js')])
    print(out.strip())
    print(f'knowledge base replaced and poe2db weights remapped from the cached pages (backups: {backup}).'
          ' For a new patch, fetch fresh poe2db pages with python scripts/build_weights.py. Then publish the artifact.')
    return code or w_code


def main(argv):
    if len(argv) < 2 or argv[1] not in ('build', 'check', 'approve'):
        print(__doc__); return 2
    cmd = argv[1]
    if cmd == 'build':
        return build('--fresh' in argv)
    path = argv[2] if len(argv) > 2 else CANDIDATE
    return check(path) if cmd == 'check' else approve(path)


if __name__ == '__main__':
    sys.exit(main(sys.argv))
