# Conquer Padel Socials

A small web app for running padel socials: the iPad runs the night, the club TVs show it.

- **iPad (admin):** `https://enriquegraciap.github.io/conquer-socials/`
- **TV (display only):** `https://enriquegraciap.github.io/conquer-socials/tv/`

No App Store, no install. On the iPad open the address in Safari and use Share → Add to Home Screen.
On a TV open the address in the TV's browser and press **Full screen**.

## How a night works

1. **Events** – one event per weekly social and club (for example "Lehi Date Night"). Each has its own monthly leaderboard.
2. **Setup** – tap the courts from the bottom court up to King's Court, add the teams (two names each, or tap a
   team under "Played before"), choose a random or seeded round 1, press **Start night**.
3. **Each round** – tap a court, tap the two scores, Save. When the last court is scored the next round appears on
   the iPad and on the TVs by itself.
4. **Changing courts** – each night has its own courts (the picker starts from last night's). During a night,
   "Change courts" lets you swap court numbers or use more or fewer courts. Unscored matches move to the new
   numbers at once when the count is the same; otherwise the new courts start with the next round. Teams keep
   their distance from King's Court.
5. **Late arrivals / no-shows** – add or remove a team at any time. A late team joins the next round on the bottom
   court. If a team leaves mid-round, a team that was sitting out takes its place.
6. **Mistyped score** – open "Earlier rounds" and tap the score. Points are always corrected. If the winner changes
   and nobody has played the next round yet, that round is redone.
7. **End night** – results are saved to the month. "Discard this night" removes a test run from the month.

## The format: King's Court, fixed partners, with sit-outs

- Winners move up a court, losers move down. Winners on King's Court stay; losers on the bottom court stay.
- More teams than places: the teams that have sat out the least sit next, and nobody sits twice in a row.
- A team coming back from a sit-out returns to the court it left, or one higher if it won its last match.
- When a returning team takes a place that two other teams also earned, a team that just lost gives way
  (it may drop two courts, or stay put). A team that just won is never moved down.
- Sets are played to 4 games or to 6 games (chosen per night, changeable mid-night). Scores above the set
  length cannot be entered.
- Scoring: every game won is a point (lose 2–4 = 2 points). Points belong to the couple.

The rules live in `docs/engine.js` (see `RULES` at the top and `placeCost`). `scoring: 'player'` is already
supported for future formats where points belong to each player.

## Files

| Path | What it is |
| --- | --- |
| `docs/index.html`, `docs/admin.js` | iPad admin page |
| `docs/tv/index.html`, `docs/tv.js` | TV display page |
| `docs/engine.js` | rotation, sit-outs, scoring, leaderboards (no browser code; shared with the tests) |
| `docs/store.js` | reads and writes the Firebase Realtime Database |
| `docs/awake.js` | keeps the iPad and TV screens on while the page is open |
| `docs/config.js` | the database address |
| `database.rules.json` | database rules: anyone can read, only a device with the admin key can write |
| `test/` | `npm test` (rotation and scoring), `npm run simulate` (prints a night), `npm run e2e` (browser test) |
| `tools/mock-server.js` | local stand-in for the database, used by the browser test |

## Data (Firebase Realtime Database)

```
pub/series/{event}                      name, format, scoring
pub/live/{event}                        which night is on, and a counter the TVs watch
pub/sessions/{event}/{night}            the full night: teams, rounds, scores
pub/results/{event}/{YYYY-MM}/{night}   totals per night; the monthly table is the sum of these
```

The admin key is **not** in this repository. It is set in the Firebase rules (replace `YOUR-ADMIN-KEY` in
`database.rules.json` when pasting them into the Firebase console) and typed once on each admin device.

## Later

- **More formats:** add a generator next to `generateRound` and switch on `session.format`.
- **Player list from PlayByPoint:** a Make scenario can write the teams for the night into
  `pub/sessions/{event}/{night}/teams` about 20 minutes before the start, using the same admin key.
