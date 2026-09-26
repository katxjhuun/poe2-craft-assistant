"""python -m unittest discover -s scripts/tests"""
import json, os, sys, tempfile, unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
import build_price_package as bp  # noqa: E402


class PricePackage(unittest.TestCase):
    def test_version_follows_the_update_time_without_leading_zeros(self):
        self.assertEqual(bp.version_of('2026-09-26T12:03:28Z'), '1.20260926.120328')
        self.assertEqual(bp.version_of('2026-09-27T00:05:02Z'), '1.20260927.502')    # semver: no leading zeros
        self.assertEqual(bp.version_of('2026-09-26T00:00:00Z'), '1.20260926.0')

    def test_package_holds_every_document_as_data(self):
        with tempfile.TemporaryDirectory() as tmp:
            out, pkg = os.path.join(tmp, 'out'), os.path.join(tmp, 'pkg')
            os.makedirs(out)
            meta = {'updatedAt': '2026-09-26T12:03:28Z', 'docs': ['forbidden-rites', 'official-forbidden-rites'],
                    'leagues': [{'name': 'Forbidden Rites', 'slug': 'forbidden-rites', 'officialDoc': 'official-forbidden-rites'}]}
            json.dump(meta, open(os.path.join(out, 'meta.json'), 'w'))
            for d in meta['docs']:
                json.dump({'league': 'Forbidden Rites', 'items': {'CurrencyRerollRare': ['Chaos Orb', 'Currency', 64.4]}, 'doc': d},
                          open(os.path.join(out, f'league-{d}.json'), 'w'))
            version = bp.build_package(out, pkg)
            self.assertEqual(version, '1.20260926.120328')
            js = open(os.path.join(pkg, 'prices.js'), encoding='utf-8').read()
            prefix = 'globalThis.POE2_PRICE_FEED = '
            body = js.split(prefix, 1)[1].rstrip().rstrip(';')
            feed = json.loads(body)                                             # the script is one data assignment
            self.assertEqual(feed['meta'], meta)
            self.assertEqual(sorted(feed['leagues']), sorted(meta['docs']))
            self.assertEqual(feed, json.load(open(os.path.join(pkg, 'prices.json'), encoding='utf-8')))
            package = json.load(open(os.path.join(pkg, 'package.json'), encoding='utf-8'))
            self.assertEqual((package['name'], package['version'], package['main']), (bp.NAME, version, 'prices.js'))
            self.assertIn('prices.js', package['files'])

    def test_package_carries_the_game_data_version(self):
        with tempfile.TemporaryDirectory() as tmp:
            out, pkg = os.path.join(tmp, 'out'), os.path.join(tmp, 'pkg')
            os.makedirs(out)
            json.dump({'updatedAt': '2026-09-26T12:03:28Z', 'docs': ['forbidden-rites'], 'leagues': [{'name': 'Forbidden Rites', 'slug': 'forbidden-rites'}]},
                      open(os.path.join(out, 'meta.json'), 'w'))
            json.dump({'items': {}}, open(os.path.join(out, 'league-forbidden-rites.json'), 'w'))
            bp.build_package(out, pkg, '4.5.6.0')
            feed = json.load(open(os.path.join(pkg, 'prices.json'), encoding='utf-8'))
            self.assertEqual(feed['meta']['gameData'], {'version': '4.5.6.0', 'source': bp.GAME_VERSION_SOURCE})

    def test_game_data_version_reads_only_a_version(self):
        class Reply:
            def __init__(self, body): self.body = body
            def __enter__(self): return self
            def __exit__(self, *a): return False
            def read(self, n=-1): return self.body[:n] if n > 0 else self.body

        def serve(body):
            def urlopen(req, timeout=None):
                if isinstance(body, Exception):
                    raise body
                return Reply(body)
            return urlopen

        real = bp.urllib.request.urlopen
        try:
            bp.urllib.request.urlopen = serve(b'4.5.5.2\n')
            self.assertEqual(bp.game_data_version(), '4.5.5.2')
            bp.urllib.request.urlopen = serve(b'<!DOCTYPE html><title>404</title>')     # an error page is not a version
            self.assertIsNone(bp.game_data_version())
            bp.urllib.request.urlopen = serve(bp.urllib.error.URLError('offline'))
            self.assertIsNone(bp.game_data_version())
        finally:
            bp.urllib.request.urlopen = real


if __name__ == '__main__':
    unittest.main()
