# Conquer Padel Socials

A small web app for running padel socials: the iPad runs the night, the club TVs show it.

- **iPad (admin):** `https://enriquegraciap.github.io/conquer-socials/`
- **TV (display only):** `https://enriquegraciap.github.io/conquer-socials/tv/`

No App Store, no install. On the iPad open the address in Safari and use Share → Add to Home Screen.
On a TV open the address in the TV's browser and press **Full screen**.

Players' phones: `https://go.playcnqr.com/socials?v=p` (the TV shows it as a QR code during a round). That page on
the club's site shows this app inside it (one line: `<script src=".../conquer-socials/wrap.js"></script>`), so
players see the club's address. `publicURL` in `docs/config.js` sets it; staff pages keep using the direct address,
where each device remembers its admin key.

**Flyers:** `https://enriquegraciap.github.io/conquer-socials/flyers/` is where staff add photos. There are two
slideshows, each a new flyer every 15 seconds: **Club flyers** (the everyday set, which also shows the monthly
leaderboards) and **Special event flyers** (`flyers/?set=special`, only that event's flyers).

**Each social's flyer:** on the iPad, Events → **Flyer** next to the social. Upload the wide (landscape) flyer and,
if you have one, the tall (portrait) one. Then:
- phones show the flyer for a few seconds when a player scans the TV's QR code;
- the TV's top banner takes its colours from the flyer, with a pattern you pick (hearts, confetti, stripes, ...);
- between rounds the TV turns to the wide flyer for about six seconds: the new round's number makes an entrance,
  a padel ball with a face rolls in with a pun, and a racket bats it away (the puns are the `PUNS` list in `docs/tv.js`).

**TV main menu:** whenever the TV page is not in full screen, a **Main menu** button sits beside **Full screen**
(on a TV remote: Back leaves full screen, then choose Main menu). The menu lists every social and the club flyers.
With one social and nothing chosen, the TV shows that social by itself.

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
7. **Scores from phones** – during a round the TV shows a QR code. A player scans it, picks their team once, and
   sees only their own court; either team can send that court's score. The court turns green on the TV. The
   organizer's device (admin page open) applies the score, and the last one starts the next round.
8. **Several socials, several TVs** – a TV with no social shows a QR code and a four-character code. Scan it from
   the admin page, or add the code under Events → TVs, and choose which social that screen shows.
9. **End night** – results are saved to the month. "Discard this night" removes a test run from the month.

## The format: King's Court, fixed partners, with sit-outs

- Winners move up a court, losers move down. Winners on King's Court stay; losers on the bottom court stay.
- More teams than places: the teams that have sat out the least sit next, and nobody sits twice in a row.
- A team coming back from a sit-out returns to the court it left, or one higher if it won its last match.
- When a returning team takes a place that two other teams also earned, a team that just lost gives way
  (it may drop two courts, or stay put). A team that just won is never moved down.
- Sets are played to 4 games or to 6 games (chosen per night, changeable mid-night). Scores above the set
  length cannot be entered.
- Scoring: every game won is a point (lose 2–4 = 2 points). Points belong to the couple.

The rules live in `docs/engine.js` (see `RULES` at the top and `placeCost`).

## The format: Individual King's Court

Chosen when an event is created (Events → name → Format). Everything above applies, per player instead of per
couple, with these differences:

- Everyone signs up alone. Four players per court; anyone over a multiple of four sits out, in turn.
- After every round the pairs split. The two winners move up a court and face each other, each with a new
  partner; the two losers move down and split the same way. On King's Court the winners stay (and split); on
  the bottom court the losers stay (and split).
- New partners are the players who have partnered least so far that night.
- Every game won is a point for both players of the pair. Leaderboards are per player.

**The sign under the courts:** a still line that changes every 10 seconds. With nobody sitting out it goes through
the club's next three events: name, day and time, spots left (`pub/promo/{club}/items`: name, date, start, end,
count, cap; written every day at noon by a scenario in the club's Make account that reads PlayByPoint). With players
sitting out it shows their names for the first 30 seconds of a round, then the three events and the names again
for 10 seconds, repeating.

**WPR Social ratings:** shown in brackets after each name on the TV leaderboards, `(NR)` when there is none.
They live in `pub/ratings/{player}` and can be typed on the iPad (tap a team or player, Edit).
A scheduled Claude task keeps them up to date on Monday, Wednesday and Friday mornings: it adds any new player
names to the "WPR requests" tab of the ratings exchange sheet, and copies the WPR Social rating of every row marked
`done` into the app (`docs/tools/wpr-sync.js` does the matching and the writing; the admin key is passed to it at
run time and is not in this repository).

**Speak the names:** on the iPad's team list, press **Speak the names**, say the couples (or players), check the
list that comes back and add them all at once. The recording (a short WAV made in the browser, `docs/voice.js`)
goes to a scenario in the club's Make account, which asks Gemini to write the names down. `voiceURL` in
`docs/config.js` is that scenario's address; the Gemini key lives in Make (Conquer Secrets, `gemini_key`), not here.

**Monthly leaderboards:** every event's table restarts each calendar month. The club flyers slideshow includes a
slide with the month's top three of every social, counted from the nights that have ended.

## The format: Wheel of Fortune

Players sign up alone. While they check in, the TV shows one wheel with every name. When the organizer presses
**Spin the wheel**, two wheels fill the TV, half the players on each; the names that stop under the two pointers
are partners. How the day runs is decided by how many players are on the list at that moment:

| Players | Teams | What is played |
|---|---|---|
| 4 | 2 | One set to 6, then the wheel spins again (three spins give everyone each partner once) |
| 5 | 2, one player sits | Two sets to 6 with the same teams, then a new spin and someone else sits. The organizer can tap who sits first (an ambassador, say); otherwise whoever has sat least |
| 6 / 7 | 3 (with 7, one sits) | Each team plays the other two, sets to 4, one team resting each round; then a new spin |
| 8 / 9 | 4 | Same partner all day: 3 pool rounds to 4, semifinals (1st v 4th, 2nd v 3rd) to 4, then the final and a bronze medal match (the losing semifinalists) to 6 |
| 10 / 11 | 5 | 5 pool rounds to 4 (one team rests each round), then 4th v 5th, semifinals (winner v 1st, 2nd v 3rd), then the final and a bronze medal match, all to 4 |
| 12 and more | 6+ | 5 pool rounds to 4, then medal matches to 6: 1st v 2nd, 3rd v 4th, 5th v 6th, and so on |

- With an odd number from 9 up, one team has three players who take turns resting.
- Pool ranking: matches won, then games won, then fewest games lost, then the match between the two.
- More matches than courts: the extra match shows as "Next on court N" and is played when that court is free.
- Points are per player: every game a pair wins is a point for both, play-offs included. Daily and monthly
  leaderboards are per player.
- A player added after a spin waits for the next spin, unless a pair has lost a player: then she takes that place.
- After a spin the TV stays on the two wheels and the list of pairs until the organizer presses **Show the courts on
  the TV** (the first score entered moves it on as well). A TV switched on meanwhile shows the pairs too.
- The wheel can be spun again at any time between rounds (new teams, the block starts over; points stay).
  **Restart night** goes back to the list of players.

Rules live in `docs/engine.js` (`wheelPlan`, `wheelSpin`, `wheelRound`); tests in `test/wheel.test.js` and `test/e2e-wheel.js`.

## A social's own colours on the whole TV screen

Events → **Flyer** → *Whole TV screen* → **Flyer's colours** turns the whole TV screen for that social into tones of the
flyer's main colour (`look.theme = 'flyer'`; tones are worked out in `docs/look.js`, `Look.theme`). Yellow lettering,
the white "Enter your score" box and the green of a court whose score is in stay as they are. **Club colours** goes back.

## Files

| Path | What it is |
| --- | --- |
| `docs/index.html`, `docs/admin.js` | iPad admin page |
| `docs/tv/index.html`, `docs/tv.js` | TV display page |
| `docs/p/index.html`, `docs/player.js` | players' phone page for sending in their court's score |
| `docs/flyers/index.html`, `docs/flyers.js` | club flyers page: add, reorder and remove the photos the TVs show |
| `docs/qr.js` | QR code generator (MIT licence, Kazuhiko Arase) |
| `docs/engine.js` | rotation, sit-outs, scoring, leaderboards (no browser code; shared with the tests) |
| `docs/store.js` | reads and writes the Firebase Realtime Database |
| `docs/look.js` | reads a flyer's colours and draws the TV banner pattern from them |
| `docs/awake.js` | keeps the iPad and TV screens on while the page is open |
| `docs/voice.js` | records the organizer's voice for "Speak the names" and turns it into a small WAV file |
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
pub/scores/{event}/{night}/r{n}/c{i}    a score sent from a phone (open to write, numbers 0-6 only)
pub/screens/{tvCode}                    what a TV was last told to show from the admin page (a social, or the flyers)
pub/flyers/club/index/{id}              one line per flyer: name, order, small preview; pub/flyers/club/rev changes with the set
pub/flyers/club/data/{id}               the flyer itself, resized to fit 1920 x 1080
pub/series/{event}/look                 the social's flyer colours, banner pattern and small previews
pub/eventflyers/{event}/wide, /phone    the social's flyer for the TV (between rounds) and for phones
```

The admin key is **not** in this repository. It is set in the Firebase rules (replace `YOUR-ADMIN-KEY` in
`database.rules.json` when pasting them into the Firebase console) and typed once on each admin device.

## Later

- **More formats:** add a generator next to `generateRound` and switch on `session.format`.
- **Player list from PlayByPoint:** a Make scenario can write the teams for the night into
  `pub/sessions/{event}/{night}/teams` about 20 minutes before the start, using the same admin key.
