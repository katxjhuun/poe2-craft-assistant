"""Price layer tests (master prompt 10.4) against a fixed Currency Exchange response.

Run: python -m unittest discover -s scripts/tests
"""
import io, json, os, sys, tempfile, time, unittest, urllib.error
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
import fetch_prices as fp  # noqa: E402

EX, DIV, CHAOS = fp.EX, fp.DIV, fp.CHAOS
OMEN = 'Metadata/Items/Currency/OmenOfTesting'
LEAGUE = 'Test League'


def market(a, b, va, vb, ra=None, rb=None, league=LEAGUE):
    ra = ra or {a: va, b: vb}
    return {'league': league, 'market_id': f'{a}|{b}', 'market_pair': [a, b], 'volume_traded': {a: va, b: vb},
            'lowest_stock': {a: 1, b: 1}, 'highest_stock': {a: 9, b: 9}, 'lowest_ratio': ra, 'highest_ratio': rb or ra}


def hour(hid, markets):
    return {'next_change_id': hid + 3600, 'markets': markets}


class PriceLayer(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        root = self.tmp.name
        self.patches = [
            mock.patch.object(fp, 'CX_DIR', os.path.join(root, 'cx')),
            mock.patch.object(fp, 'OUT_DIR', os.path.join(root, 'out')),
            mock.patch.object(fp, 'ICON_DIR', os.path.join(root, 'icons')),
            mock.patch.object(fp, 'BASE_ITEMS', os.path.join(root, 'base_items.json')),
            mock.patch.object(fp, 'MIN_ITEMS', 1),
        ]
        for p in self.patches:
            p.start()
        for d in (fp.CX_DIR, fp.OUT_DIR, fp.ICON_DIR):
            os.makedirs(d, exist_ok=True)
        base = {
            EX: {'name': 'Exalted Orb', 'item_class': 'StackableCurrency'},
            DIV: {'name': 'Divine Orb', 'item_class': 'StackableCurrency'},
            CHAOS: {'name': 'Chaos Orb', 'item_class': 'StackableCurrency'},
            OMEN: {'name': 'Omen of Testing', 'item_class': 'Omen'},
        }
        json.dump(base, open(fp.BASE_ITEMS, 'w'))
        self.h0 = (int(time.time()) // 3600 - 5) * 3600
        # three hours: 1 div = 500 ex, 1 chaos = 60 ex, omen traded only against divine at 0.1 div
        for i in range(3):
            json.dump(hour(self.h0 + i * 3600, [
                market(DIV, EX, 10, 5000, ra={DIV: 1, EX: 480}, rb={DIV: 1, EX: 520}),
                market(CHAOS, EX, 100, 6000),
                market(OMEN, DIV, 20, 2),
            ]), open(os.path.join(fp.CX_DIR, f'{self.h0 + i * 3600}.json'), 'w'))

    def tearDown(self):
        for p in self.patches:
            p.stop()
        self.tmp.cleanup()

    def league_doc(self):
        fp.build()
        return json.load(open(os.path.join(fp.OUT_DIR, 'league-test-league.json')))

    def test_names_prices_and_cross_rate(self):
        doc = self.league_doc()
        items = doc['items']
        self.assertEqual(items['CurrencyModValues'][0], 'Divine Orb')           # metadata id -> name
        self.assertAlmostEqual(items['CurrencyModValues'][2], 500, delta=0.5)   # volume-weighted, in Exalted
        self.assertAlmostEqual(items['CurrencyRerollRare'][2], 60, delta=0.1)
        self.assertAlmostEqual(items['OmenOfTesting'][2], 50, delta=0.1)        # 0.1 div x 500 ex (cross rate)
        self.assertEqual(items['OmenOfTesting'][1], 'Omens')
        self.assertEqual(items['CurrencyAddModToRare'][2], 1)
        self.assertAlmostEqual(doc['divine'], 500, delta=0.5)
        self.assertEqual(doc['fields'], fp.FIELDS)

    def test_meta_lists_leagues(self):
        fp.build()
        meta = json.load(open(os.path.join(fp.OUT_DIR, 'meta.json')))
        self.assertEqual([l['name'] for l in meta['leagues']], [LEAGUE])
        self.assertEqual(meta['hours'], 3)

    def test_missing_hours_are_fetched_newest_first_and_a_stalled_hour_is_retried(self):
        now_hour = int(time.time()) // 3600 * 3600
        cached = {self.h0 + i * 3600 for i in range(3)}
        calls = []

        def fake_fetch(hid):
            calls.append(hid)
            if hid == now_hour - 3600:
                return {'next_change_id': hid, 'markets': []}     # the newest hour is not published yet
            if hid == now_hour - 2 * 3600 and calls.count(hid) == 1:
                return None                                        # stalled on the first try
            return hour(hid, [market(DIV, EX, 10, 5000)])
        with mock.patch.object(fp, 'fetch', fake_fetch), mock.patch.object(fp.time, 'sleep', lambda s: None):
            got = fp.update_cache()
        window = [now_hour - k * 3600 for k in range(1, fp.HOURS + 1)]
        first_pass = [h for h in window if h not in cached]
        self.assertFalse(cached & set(calls))                          # cached hours are not fetched again
        self.assertEqual(calls[:len(first_pass)], first_pass)          # newest first, over the whole window
        self.assertEqual(calls[len(first_pass):], [now_hour - 2 * 3600])  # the stalled hour gets one more try
        self.assertEqual(got, len(first_pass) - 1)                      # everything but the unpublished hour
        self.assertFalse(os.path.exists(os.path.join(fp.CX_DIR, f'{now_hour - 3600}.json')))

    def test_rate_limit_waits_and_client_errors_are_not_retried(self):
        body = json.dumps(hour(self.h0, [])).encode()
        seq = [urllib.error.HTTPError('u', 429, 'slow down', {'Retry-After': '1'}, None), io.BytesIO(body)]

        class Resp(io.BytesIO):
            def __enter__(self): return self
            def __exit__(self, *a): return False

        def urlopen(req, timeout=0):
            x = seq.pop(0)
            if isinstance(x, Exception):
                raise x
            return Resp(x.getvalue())
        with mock.patch('urllib.request.urlopen', urlopen), mock.patch('time.sleep') as sleep:
            data = fp.fetch(self.h0)
        self.assertEqual(data['next_change_id'], self.h0 + 3600)
        sleep.assert_any_call(1)

        n = {'c': 0}

        def not_found(req, timeout=0):
            n['c'] += 1
            raise urllib.error.HTTPError('u', 404, 'nope', {}, None)
        with mock.patch('urllib.request.urlopen', not_found):
            with self.assertRaises(urllib.error.HTTPError):
                fp.fetch(self.h0)
        self.assertEqual(n['c'], 1, '4xx must not be retried')


    def test_rate_limit_headers_are_obeyed(self):
        near = {'X-Rate-Limit-Rules': 'ip', 'X-Rate-Limit-Ip': '10:60:120,30:300:600', 'X-Rate-Limit-Ip-State': '9:60:0,4:300:0'}
        self.assertEqual(fp.rate_wait(near), 60)                 # one hit from the 60 s window limit
        restricted = {'X-Rate-Limit-Rules': 'ip,account', 'X-Rate-Limit-Ip': '10:60:120', 'X-Rate-Limit-Ip-State': '1:60:0',
                      'X-Rate-Limit-Account': '5:10:30', 'X-Rate-Limit-Account-State': '5:10:25'}
        self.assertEqual(fp.rate_wait(restricted), 25)           # an active restriction is waited out
        self.assertEqual(fp.rate_wait({'X-Rate-Limit-Rules': 'ip', 'X-Rate-Limit-Ip': '10:60:120', 'X-Rate-Limit-Ip-State': '2:60:0'}), 0)
        self.assertEqual(fp.rate_wait({}), 0)

        body = json.dumps(hour(self.h0, [])).encode()

        class Resp(io.BytesIO):
            headers = near
            def __enter__(self): return self
            def __exit__(self, *a): return False
        with mock.patch('urllib.request.urlopen', lambda req, timeout=0: Resp(body)), mock.patch('time.sleep') as sleep:
            fp.fetch(self.h0)
        sleep.assert_called_with(60)


    def test_bridge_currencies_use_their_own_exalted_market(self):
        # Found by cross-checking with poe2db: a busy Divine<->Chaos market bridged through a thin Chaos<->Exalted
        # market pulled the Divine price 20% off its own Divine<->Exalted market.
        for i in range(3):
            json.dump(hour(self.h0 + i * 3600, [
                market(DIV, EX, 10, 5000),                  # 500 ex per divine, direct
                market(CHAOS, EX, 100, 6000),               # 60 ex per chaos
                market(DIV, CHAOS, 1000, 6667),             # 6.67 chaos per divine -> 400 ex through chaos
                market(OMEN, DIV, 20, 2),
            ]), open(os.path.join(fp.CX_DIR, f'{self.h0 + i * 3600}.json'), 'w'))
        doc = self.league_doc()
        self.assertAlmostEqual(doc['items']['CurrencyModValues'][2], 500, delta=0.5)
        self.assertAlmostEqual(doc['divine'], 500, delta=0.5)
        self.assertAlmostEqual(doc['items']['OmenOfTesting'][2], 50, delta=0.1)  # converted at the same 500


    # poe2db economy page rows (format checked on 2026-09-26)
    P2_PAGE = (
        '<tr><td>562 <a href="Economy_exalted"><img class="size32" src="x/CurrencyAddModToRare.png"/>Exalted Orb</a> '
        '<i class="fa-solid fa-left-right text-muted"></i> 1 <a href="Economy_divine"><img class="size32" src="x/CurrencyModValues.png"/>Divine Orb</a></td>'
        '<td><div class="text-end">2,885 <a href="Economy_divine"><img src="d.png"/></a></div></td></tr>'
        '<tr><td>2.18 <a href="Economy_annul"><img class="size32" src="x/AnnullOrb.png"/>Orb of Annulment</a> '
        '<i class="fa-solid fa-left-right text-muted"></i> 1 <a href="Economy_divine"><img class="size32" src="x/CurrencyModValues.png"/>Divine Orb</a></td>'
        '<td><div class="text-end">7,591 <a href="Economy_divine"><img src="d.png"/></a></div></td></tr>'
        '<tr><td>1 <a href="Economy_divine"><img class="size32" src="x/CurrencyModValues.png"/>Divine Orb</a> '
        '<i class="fa-solid fa-left-right text-muted"></i> 1 <a href="Economy_omen"><img class="size32" src="x/Omen.png"/>Omen of Testing</a></td>'
        '<td><div class="text-end">5 <a href="Economy_divine"><img src="d.png"/></a></div></td></tr>')

    def test_poe2db_rows_crosscheck_and_fallback(self):
        m = fp.poe2db_divine_markets(self.P2_PAGE)
        self.assertAlmostEqual(1 / m['Exalted Orb'][0], 562, delta=0.01)          # 562 ex <-> 1 div
        self.assertAlmostEqual(m['Orb of Annulment'][0], 1 / 2.18, delta=1e-6)       # 2.18 annul <-> 1 div
        self.assertEqual(m['Omen of Testing'], (1.0, 5.0))                           # divine on the left side
        doc = {'divine': 562, 'items': {'a': ['Orb of Annulment', 'Currency', 562 / 2.18 * 1.2, 0, 0, 0, 0, 0],
                                        'o': ['Omen of Testing', 'Omens', 562, 0, 0, 0, 0, 0]}}
        c = fp.crosscheck(doc, m)
        self.assertEqual((c['items'], c['thin']), (1, 1))                            # the omen market is thin (5 div)
        self.assertAlmostEqual(c['median_deviation'], 0.2, delta=1e-6)
        base = {EX: {'name': 'Exalted Orb', 'item_class': 'StackableCurrency'}, DIV: {'name': 'Divine Orb', 'item_class': 'StackableCurrency'},
                'Metadata/Items/Currency/AnnullOrb': {'name': 'Orb of Annulment', 'item_class': 'StackableCurrency'}}
        d = fp.poe2db_doc(m, base, set(), self.h0)
        self.assertTrue(d['unofficial'])
        self.assertEqual(d['league'], fp.POE2DB_LEAGUE)
        self.assertAlmostEqual(d['divine'], 562, delta=0.5)
        self.assertAlmostEqual(d['items']['AnnullOrb'][2], 562 / 2.18, delta=0.1)
        self.assertNotIn('OmenOfTesting', d['items'])                                # not in the base list: skipped


    def test_ee2_feed_becomes_a_league_doc_in_exalted(self):
        ov = {'core': {'rates': {'exalted': 500, 'chaos': 8}, 'primary': 'divine'},
              'itemOverviews': [
                  {'type': 'Currency', 'lines': [
                      {'name': 'Chaos Orb', 'primaryValue': 0.125, 'volumePrimaryValue': 1000, 'sparkline': {'totalChange': 10, 'data': [0, 5, None, 20, 10]}},
                      {'name': 'Divine Orb', 'primaryValue': 1, 'volumePrimaryValue': 1000}]},
                  {'type': 'UniqueAccessories', 'lines': [{'name': 'Mageblood', 'variant': 'Utility Belt', 'primaryValue': 450}]}]}
        official = {'league': LEAGUE, 'slug': 'test-league', 'items': {
            'CurrencyRerollRare': ['Chaos Orb', 'Currency', 60, 55, 65, 100, 0, 1],
            'OmenOfTesting': ['Omen of Testing', 'Omens', 50, 45, 55, 20, 0, 0]}}
        base = {EX: {'name': 'Exalted Orb', 'item_class': 'StackableCurrency'}, DIV: {'name': 'Divine Orb', 'item_class': 'StackableCurrency'},
                CHAOS: {'name': 'Chaos Orb', 'item_class': 'StackableCurrency'}}
        doc = fp.ee2_doc(ov, official, base, set(), self.h0 + 100)
        self.assertEqual(doc['divine'], 500)
        self.assertAlmostEqual(doc['chaos'], 62.5)                             # 500 ex per divine / 8 chaos per divine
        self.assertAlmostEqual(doc['items']['CurrencyRerollRare'][2], 62.5)    # 0.125 div in exalted
        self.assertEqual(doc['items']['CurrencyRerollRare'][5], 100)           # volume: the official 24h units, not the feed's hourly figure
        self.assertEqual(doc['items']['CurrencyModValues'][5], 0)              # the official digest saw no trade
        self.assertEqual(doc['items']['CurrencyRerollRare'][8], 'n')
        self.assertEqual(doc['items']['OmenOfTesting'][8], 'o')                # the feed lacks it: filled from the official doc
        self.assertEqual(doc['uniques']['Mageblood (Utility Belt)'][0], 225000)
        self.assertIsNone(doc['uniques']['Mageblood (Utility Belt)'][3])       # no volume for uniques
        self.assertTrue(doc['unofficial'])
        self.assertEqual(doc['rangeDays'], 7)
        lo, hi, chg = fp.spark_range(110, {'totalChange': 10, 'data': [0, 5, 20, 10]})
        self.assertAlmostEqual(lo, 100)                                        # 7 days ago
        self.assertAlmostEqual(hi, 120)
        self.assertAlmostEqual(chg, round((1.10 / 1.20 - 1) * 100, 1))

    def test_feed_agreement_spots_a_wrong_divine_rate(self):
        official = {'divine': 100, 'items': {f'I{i}': [f'Item {i}', 'Currency', 10, 9, 11, 500, 0, 0] for i in range(40)}}
        official['items']['Thin'] = ['Thin', 'Currency', 10, 9, 11, 1, 0, 0]               # 10 ex traded: left out
        same = {'items': {k: r[:8] + ['n'] for k, r in official['items'].items()}}
        double = {'items': {k: [r[0], r[1], r[2] * 2] + r[3:8] + ['n'] for k, r in official['items'].items()}}
        double['items']['Filled'] = ['Filled', 'Currency', 10, 9, 11, 500, 0, 0, 'o']      # copied from the official doc: left out
        self.assertEqual(fp.feed_agreement(same, official), (1.0, 40))
        ratio, n = fp.feed_agreement(double, official)
        self.assertEqual((ratio, n), (2.0, 40))
        self.assertFalse(fp.EE2_AGREE[0] <= ratio <= fp.EE2_AGREE[1])


if __name__ == '__main__':
    unittest.main()
