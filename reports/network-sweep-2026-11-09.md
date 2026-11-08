# Craft network: the eighteenth deep run (read 9 Nov 2026)

Run [38997650636](https://github.com/katxjhuun/poe2-craft-assistant/actions/runs/38997650636), commit a490d4e (the
network code of 82a3425): deep, **19 runners** with four processes each (the free limit used to the full), 315
minutes, the drawn scenarios **from round 13**: new scenarios, not the ones the seventeenth run played. Replays below
use the run's own prices.

## What came back

75 of the 76 processes wrote a report; none ran out of memory, no scenario ended in an error.

| | seventeenth run (82a3425) | this run (same code, new scenarios) |
|---|---|---|
| Scenarios | 897 | 908 |
| Checked against the simulator | 848 | 859 |
| Agree | 821 (96.8%) | 845 (98.4%) |
| Do not agree | 27 | 14 |
| of those: cost off by more than 15% | 4 | 5 |
| Not solved within ten minutes | 16 | 7 |
| Old routes clearly cheaper | 0 of 94 | 0 of 60 |
| Crafts played | 55.1 million | 50.4 million |

## What did not agree, and why

- **Grand Regalia and Austere Garb with Serle's Triumph (seven targets): x0.08 and x0.21; 98,713 and 94,923 of
  100,000 crafts left the network.** Greater Essence of the Infinite gives Strength, Dexterity or Intelligence, each
  as likely (the game's EssenceMods outcomes). The network took any modifier but the one it was used for as a crafted
  modifier nobody asked for; where it was Dexterity and Dexterity a target, the item was no node at all. Now every
  modifier such an essence can give is what it is: another target is that target, crafted (`essOuts`). Grand Regalia
  replayed with the run's prices: 26,153 promised, 25,867 +- 421 played (x0.99), no craft leaves the network.
- **Three that promise too much**: Dusk Amulet, three targets on a rare with catalyst quality raised (x0.61);
  Blacksteel Crest Shield, three targets on a rare (x0.78); Aegis Quarterstaff, six targets from a white base (x0.77,
  as in the run before). Open.
- **Steps the game refuses**: magic essences on an item that already has a modifier of their type (Greater Essence of
  the Body 173,650 times, of the Infinite 153,176, Enhancement 146,013, Insulation 104,783). With the sub-worker that
  hunts such gaps.

## Changed since this run's code

- 174c5ef: a fractured modifier is never a twin; items never given up keep the fast levels network.
- 385a830 and 2048635: the edges in flat typed arrays (3.5 KB a node instead of 8.5, same results), the followed
  network up to 300,000 states.
- This report's commit: essences with several modifiers.

## The next run

Run [42532075834](https://github.com/katxjhuun/poe2-craft-assistant/actions/runs/42532075834), started 8 Nov 2026
22:48 UTC on commit 7ca329a (the changes above but the essence fix), 19 runners, from round 0.
