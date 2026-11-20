/*
 * Padel Socials — "Intro to padel": a short slide deck for explaining the game to people who have never played.
 * Shown on a club TV (tv.js: the main menu's "Intro to padel"; the remote's arrows change the slide) and reused
 * by the phone page docs/learn/ (the drawings and the facts).
 *
 * The facts, and where they come from (checked November 2026):
 *   - 191 countries, 40 million+ players, 91,200+ courts: FIP World Padel Report 2026 (padelfip.com, October 2026)
 *   - fastest-growing sport in the US: SFIA 2026 mid-year participation report (padel +14.5%); 1,073,000 Americans
 *     played in 2025 (SFIA / USPA); about 1,000 courts in 31 states (USPA, April 2026)
 *   - 1969 Acapulco (Enrique Corcuera), 1974 Marbella (Alfonso de Hohenlohe), 1975 Argentina: FIP, LTA Padel
 *   - rules: FIP Regulations of the Padel Game (serve, walls, scoring); golden point is the usual club format
 */
(function (root) {
  'use strict';
  function h(tag, cls, kids) {
    var el = document.createElement(tag);
    if (cls) el.className = cls;
    var add = function (c) {
      if (c === null || c === undefined || c === false) return;
      if (Array.isArray(c)) { c.forEach(add); return; }
      el.appendChild(typeof c === 'object' ? c : document.createTextNode(String(c)));
    };
    add(kids);
    return el;
  }
  function svg(markup, cls) { var d = h('div', cls || 'in-art'); d.innerHTML = markup; return d; }

  // ---------------------------------------------------------------- drawings
  var BLUE = '#12508f', DEEP = '#0a2f57', LINE = '#ffffff', GOLD = '#f4b63f', GLASS = '#9fd3ff', MESH = '#7f93aa';
  // The court from above. marks: extra SVG drawn on top (arrows, balls). Glass is pale blue, the fence grey.
  function court(marks, opts) {
    opts = opts || {};
    var W = 400, H = 200, x = 20, y = 20;                     // the court is 20 m by 10 m; 20 px to a metre
    var out = '<svg viewBox="0 0 ' + (W + 40) + ' ' + (H + 40) + '" aria-hidden="true">';
    out += '<rect x="' + x + '" y="' + y + '" width="' + W + '" height="' + H + '" rx="2" fill="' + BLUE + '"/>';
    // service lines 6.95 m from the net, centre line between them
    out += '<g stroke="' + LINE + '" stroke-width="2.4" fill="none"><line x1="' + (x + 61) + '" y1="' + y + '" x2="' + (x + 61) + '" y2="' + (y + H) + '"/><line x1="' + (x + W - 61) + '" y1="' + y + '" x2="' + (x + W - 61) + '" y2="' + (y + H) + '"/>' +
      '<line x1="' + (x + 61) + '" y1="' + (y + H / 2) + '" x2="' + (x + W - 61) + '" y2="' + (y + H / 2) + '"/></g>';
    // walls: glass at both ends and the first 4 m of each side, fence along the middle of the sides
    out += '<g fill="none" stroke-linecap="round"><path d="M' + (x + 80) + ' ' + y + 'H' + x + 'V' + (y + H) + 'H' + (x + 80) + '" stroke="' + GLASS + '" stroke-width="6"/><path d="M' + (x + W - 80) + ' ' + y + 'H' + (x + W) + 'V' + (y + H) + 'H' + (x + W - 80) + '" stroke="' + GLASS + '" stroke-width="6"/>' +
      '<path d="M' + (x + 80) + ' ' + y + 'H' + (x + W - 80) + 'M' + (x + 80) + ' ' + (y + H) + 'H' + (x + W - 80) + '" stroke="' + MESH + '" stroke-width="5" stroke-dasharray="3 5"/></g>';
    // the net
    out += '<line x1="' + (x + W / 2) + '" y1="' + (y - 6) + '" x2="' + (x + W / 2) + '" y2="' + (y + H + 6) + '" stroke="' + LINE + '" stroke-width="4"/><line x1="' + (x + W / 2) + '" y1="' + (y - 6) + '" x2="' + (x + W / 2) + '" y2="' + (y + H + 6) + '" stroke="' + DEEP + '" stroke-width="1.2" stroke-dasharray="2 3"/>';
    if (opts.players !== false) {
      [[x + 100, y + 55], [x + 100, y + 145], [x + W - 100, y + 55], [x + W - 100, y + 145]].forEach(function (p, i) {
        out += '<circle cx="' + p[0] + '" cy="' + p[1] + '" r="9" fill="' + (i < 2 ? GOLD : '#ffffff') + '" stroke="' + DEEP + '" stroke-width="2"/>';
      });
    }
    out += (marks || '') + '</svg>';
    return out;
  }
  function ball(cx, cy, r) {
    return '<g transform="translate(' + cx + ' ' + cy + ')"><circle r="' + r + '" fill="#d9ef2b" stroke="#8fa800" stroke-width="' + (r * 0.12).toFixed(1) + '"/>' +
      '<path d="M' + (-r * 0.95) + ' ' + (-r * 0.3) + 'Q0 ' + (r * 0.25) + ' ' + (r * 0.95) + ' ' + (-r * 0.3) + '" fill="none" stroke="#ffffff" stroke-width="' + (r * 0.16).toFixed(1) + '"/></g>';
  }
  // A padel racket: solid face with holes, short handle, wrist strap.
  function racket() {
    var holes = '';
    for (var row = 0; row < 6; row++) for (var col = 0; col < 5; col++) {
      var cx = 100 + (col - 2) * 21 + (row % 2 ? 10 : 0), cy = 62 + row * 21, dx = (cx - 100) / 74, dy = (cy - 110) / 88;
      if (dx * dx + dy * dy < 0.62) holes += '<circle cx="' + cx + '" cy="' + cy + '" r="5" fill="' + DEEP + '"/>';
    }
    return '<svg viewBox="0 0 200 360" aria-hidden="true">' +
      '<path d="M88 300c-6 22 2 48 22 48" fill="none" stroke="#f3ead6" stroke-width="5" stroke-linecap="round"/>' +                 // wrist strap
      '<rect x="86" y="206" width="28" height="110" rx="10" fill="#1c2c40" stroke="#f3ead6" stroke-width="3"/>' +
      '<path d="M100 14c-52 0-80 42-80 92 0 46 30 80 62 104h36c32-24 62-58 62-104 0-50-28-92-80-92z" fill="' + GOLD + '" stroke="#f3ead6" stroke-width="6"/>' +
      '<path d="M100 30c-42 0-64 34-64 76 0 38 24 66 50 88h28c26-22 50-50 50-88 0-42-22-76-64-76z" fill="#f7c861"/>' + holes + '</svg>';
  }
  var ARROW = '<defs><marker id="in-arw" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="' + GOLD + '"/></marker>' +
    '<marker id="in-arw-r" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#ff6b5c"/></marker></defs>';
  function path(d, bad) { return '<path d="' + d + '" fill="none" stroke="' + (bad ? '#ff6b5c' : GOLD) + '" stroke-width="4" stroke-dasharray="9 6" stroke-linecap="round" marker-end="url(#' + (bad ? 'in-arw-r' : 'in-arw') + ')"/>'; }
  function bounce(x, y, bad) { return '<circle cx="' + x + '" cy="' + y + '" r="7" fill="none" stroke="' + (bad ? '#ff6b5c' : GOLD) + '" stroke-width="3"/>'; }

  function dot(x, y, mine) { return '<circle cx="' + x + '" cy="' + y + '" r="9" fill="' + (mine ? GOLD : '#ffffff') + '" stroke="' + DEEP + '" stroke-width="2"/>'; }
  function tag(x, y, t, bad) { return '<g transform="translate(' + x + ' ' + y + ')"><circle r="11" fill="' + (bad ? '#ff6b5c' : GOLD) + '"/><text y="5" text-anchor="middle" font-size="15" font-weight="700" font-family="Barlow Condensed, Arial Narrow, sans-serif" fill="' + DEEP + '">' + t + '</text></g>'; }
  // The serve: the server stands behind the service line and sends the ball into the box diagonally across.
  function Intro_serveMarks() {
    return ARROW + '<rect x="220" y="20" width="139" height="100" fill="' + GOLD + '" opacity=".25"/>' +
      dot(52, 168, true) + dot(190, 70, true) + dot(398, 66, false) + dot(290, 168, false) +
      ball(68, 156, 7) + path('M78 150 L318 74') + bounce(330, 70);
  }
  // The walls: (good) the ball lands on the floor, comes off the glass and is played back; (bad) a shot that
  // reaches the other side's glass before the floor.
  function Intro_wallMarks() {
    return {
      good: ARROW + dot(385, 150, false) + path('M150 150 L322 104') + bounce(332, 101) + path('M342 98 L410 82') + path('M410 90 L380 132') + tag(332, 76, '1') + tag(398, 58, '2'),
      bad: ARROW + dot(385, 150, false) + path('M150 80 L408 104', true) + '<g stroke="#ff6b5c" stroke-width="7" stroke-linecap="round"><line x1="398" y1="90" x2="424" y2="120"/><line x1="424" y1="90" x2="398" y2="120"/></g>'
    };
  }

  // ---------------------------------------------------------------- the slides
  function head(kicker, title) { return h('div', 'in-head', [h('div', 'in-kick', kicker), h('h1', null, title)]); }
  function points(list) { return h('ul', 'in-points', list.map(function (t) { return h('li', null, Array.isArray(t) ? [h('b', null, t[0]), ' ', t[1]] : t); })); }
  function split(left, right, cls) { return h('div', 'in-split' + (cls ? ' ' + cls : ''), [h('div', 'in-l', left), h('div', 'in-r', right)]); }

  var SLIDES = [
    { id: 'welcome', build: function (o) {
      var p = h('img', 'in-logo'), w = h('img', 'in-word');
      p.src = o.asset('logo-p.png'); p.alt = ''; w.src = o.asset('conquer-wordmark-white.png'); w.alt = 'Conquer Padel Club';
      return h('div', 'in-slide in-welcome', [p, w, h('div', 'in-hello', 'Welcome to padel'), h('div', 'in-sub', 'Everything you need to know before your first game')]);
    } },
    { id: 'world', build: function () {
      var stat = function (n, t, s) { return h('div', 'in-stat', [h('b', null, n), h('span', null, t), s ? h('small', null, s) : null]); };
      return h('div', 'in-slide', [head('What is padel?', 'The fastest-growing sport in the world'),
        h('div', 'in-stats', [
          stat('190+', 'countries play padel', null),
          stat('40M+', 'players worldwide', null),
          stat('#1', 'fastest-growing sport in the US', 'since 2026')
        ]),
        h('p', 'in-line', 'A mix of tennis and squash, played in doubles on a small court with glass walls. Easy to start, hard to stop.'),
        h('div', 'in-src', 'International Padel Federation, World Padel Report 2026 · SFIA 2026 participation report')]);
    } },
    { id: 'origin', build: function () {
      var stop = function (year, place, text) { return h('div', 'in-stop', [h('b', null, year), h('span', null, place), h('p', null, text)]); };
      return h('div', 'in-slide', [head('Where it comes from', 'Born in Mexico, raised in Spain'),
        h('div', 'in-time', [
          stop('1969', 'Acapulco, Mexico', 'Enrique Corcuera builds the first court at his home, with walls around it.'),
          stop('1974', 'Marbella, Spain', 'A friend takes the idea to Spain. Europe falls in love with it.'),
          stop('1975', 'Argentina', 'It crosses back over the ocean and spreads through Latin America.'),
          stop('Today', 'Everywhere', 'More than 91,000 courts worldwide, and over 1,000 in the United States.')
        ])]);
    } },
    { id: 'court', build: function () {
      var legend = h('div', 'in-legend', [h('span', 'g', 'Glass wall'), h('span', 'm', 'Wire fence'), h('span', 'n', 'Net')]);
      return h('div', 'in-slide', [head('The basics · 1', 'The court'),
        split([svg(court('')), legend], points([
          ['66 × 33 feet.', 'About a third of a tennis court.'],
          ['Walls all around.', 'Glass at the ends and corners, wire fence along the sides.'],
          ['Always doubles.', 'Two against two. Everyone is in every point.'],
          ['A net in the middle,', 'a little lower than in tennis.']
        ]), 'wideart')]);
    } },
    { id: 'gear', build: function () {
      return h('div', 'in-slide', [head('The basics · 2', 'The racket and the ball'),
        split([h('div', 'in-gear', [svg(racket(), 'in-art in-racket'), svg('<svg viewBox="0 0 100 100" aria-hidden="true">' + ball(50, 50, 40) + '</svg>', 'in-art in-ball')])], points([
          ['No strings.', 'A solid racket with holes: short, light and easy to control.'],
          ['Strap on your wrist.', 'Always. It is a rule, and it keeps everyone safe.'],
          ['The ball', 'looks like a tennis ball, with a little less bounce.'],
          ['Court shoes,', 'comfortable clothes, and you are ready.']
        ]))]);
    } },
    { id: 'serve', build: function () {
      var marks = Intro_serveMarks();
      return h('div', 'in-slide', [head('The basics · 3', 'The serve'),
        split([svg(court(marks, { players: false }))], h('ol', 'in-steps', [
          h('li', null, [h('b', null, 'Underhand.'), ' Let the ball bounce, then hit it at or below your waist.']),
          h('li', null, [h('b', null, 'Diagonal.'), ' Stand behind the service line and send it into the box across from you.']),
          h('li', null, [h('b', null, 'Two tries.'), ' Miss the first serve and you get a second one.']),
          h('li', null, [h('b', null, 'Glass is fine.'), ' After it bounces in the box it may touch the glass, not the fence.'])
        ]), 'wideart')]);
    } },
    { id: 'walls', build: function () {
      var marks2 = Intro_wallMarks(), good = marks2.good, bad = marks2.bad;
      var card = function (cls, mark, title, text, art) { return h('div', 'in-wall ' + cls, [svg(art), h('div', 'in-walltxt', [h('b', null, [h('i', null, mark), ' ', title]), h('p', null, text)])]); };
      return h('div', 'in-slide', [head('The basics · 4', 'The walls are your friends'),
        h('div', 'in-walls', [
          card('ok', '✓', 'Floor first, then the wall: play on', 'The ball bounces on your side and comes off the glass. Take your time and hit it back.', court(good, { players: false })),
          card('no', '✗', 'Wall first: out', 'Your shot has to land on their floor before it touches their glass or fence.', court(bad, { players: false }))
        ]),
        h('p', 'in-line', 'You can also hit the ball into your own glass to send it back over the net.')]);
    } },
    { id: 'rally', build: function () {
      return h('div', 'in-slide', [head('The basics · 5', 'Winning the point'),
        split(h('div', 'in-lose', [h('h2', null, 'You lose the point when…'), points([
          'the ball bounces twice on your side',
          'you hit it into the net, or out',
          'it hits their wall or fence before their floor',
          'the ball touches you or your partner',
          'you touch the net'
        ])]), h('div', 'in-yes', [h('h2', null, 'Good to know'), points([
          ['One bounce,', 'or none: volleys are welcome.'],
          ['Not on the return:', 'the serve has to bounce first.'],
          ['Balls off the glass', 'are still alive. Keep playing!']
        ])]))]);
    } },
    { id: 'score', build: function () {
      return h('div', 'in-slide', [head('The basics · 6', 'Keeping score'),
        h('div', 'in-score', ['15', '30', '40', 'Game'].map(function (t, i) { return [i ? h('i', null, '›') : null, h('b', i === 3 ? 'g' : null, t)]; })),
        h('div', 'in-cols', [
          h('div', 'in-col', [h('b', null, 'Just like tennis'), h('p', null, 'Six games win a set. A match is the best of three sets.')]),
          h('div', 'in-col gold', [h('b', null, 'Golden point'), h('p', null, 'At 40–40, one point decides the game. The receivers choose which side takes the serve.')]),
          h('div', 'in-col', [h('b', null, 'At our socials'), h('p', null, 'Short sets, new opponents every round, and every game you win is a point on the leaderboard.')])
        ])]);
    } },
    { id: 'tips', build: function () {
      var tip = function (n, title, text) { return h('div', 'in-tip', [h('i', null, n), h('div', null, [h('b', null, title), h('p', null, text)])]); };
      return h('div', 'in-slide', [head('Your first game', 'Five tips to start well'),
        h('div', 'in-tips', [
          tip('1', 'Let it come off the glass', 'There is more time than you think. Turn, wait, and hit it after the wall.'),
          tip('2', 'Soft beats hard', 'Hard shots bounce back to your opponents. A high lob is your best friend.'),
          tip('3', 'Take the net together', 'Points are won up front. Move forward as a pair, and back as a pair.'),
          tip('4', 'Talk to your partner', '“Mine!”, “Yours!”, “Out!” It is a team game.'),
          tip('5', 'Have fun', 'Everyone was a beginner once. ¡Vamos!')
        ])]);
    } },
    { id: 'go', build: function (o) {
      return h('div', 'in-slide in-go', [head('Ready?', 'Grab a racket. Let’s play!'),
        h('div', 'in-gorow', [
          o.qr ? h('div', 'in-qr', o.qr) : null,
          h('div', 'in-gotxt', [h('b', null, 'Scan to keep learning'), h('p', null, 'The rules, first-game tips and answers to the questions every new player asks, on your phone.'),
            h('p', 'in-ask', 'Questions? Ask anyone on the Conquer team.')])
        ])]);
    } }
  ];

  root.Intro = {
    count: SLIDES.length,
    ids: SLIDES.map(function (s) { return s.id; }),
    // The slide at position i (0-based). opts: { asset(name) -> address of a picture, qr: an element for the last slide }
    build: function (i, opts) {
      var s = SLIDES[Math.max(0, Math.min(SLIDES.length - 1, i))], el = s.build(opts || { asset: function (n) { return n; } });
      el.setAttribute('data-slide', s.id);
      return el;
    },
    art: { court: court, racket: racket, ball: ball, serve: function () { return court(Intro_serveMarks(), { players: false }); },
      wallGood: function () { return court(Intro_wallMarks().good, { players: false }); }, wallBad: function () { return court(Intro_wallMarks().bad, { players: false }); } }
  };
})(typeof self !== 'undefined' ? self : this);
