/* Padel Socials — TV display. Read-only: checks the database every 2 seconds and redraws when something changed.
 *
 * Which event a TV shows:
 *   1. an event named in the address (tv/?s=event-id) always wins;
 *   2. otherwise the event this TV was paired with from the admin page (scan the QR, or type the TV code);
 *   3. otherwise, if the club has exactly one event, that one;
 *   4. otherwise the pairing screen with a QR code.
 */
(function () {
  'use strict';
  var E = window.Engine, S = window.Store;
  var root = document.getElementById('tv'), statusEl = document.getElementById('status'), codeEl = document.getElementById('tvcode'), fsBtn = document.getElementById('fs');
  var POLL_MS = 2000, MONTH_ROWS = 10;
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var CROWN = '\uD83D\uDC51';   // beside the winning team: after the name on the left side, before it on the right side
  var MEDALS = ['\uD83E\uDD47', '\uD83E\uDD48', '\uD83E\uDD49'];   // gold, silver, bronze
  var fixed = new URLSearchParams(location.search).get('s');

  var st = { id: tvId(), mode: 'boot', series: {}, seriesId: null, seriesName: '', rev: null, ping: 0, session: null, pending: {},
    month: null, monthKey: null, busy: false, lastOk: 0, lastRound: 0, shown: false, ticks: 0, pendingSince: 0, pairShown: '' };

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
  function name(id) { var t = st.session.teams[id]; return t ? t.name : ''; }

  // Every TV keeps a short code of its own, shown in the bottom corner and inside the pairing QR.
  function tvId() {
    var id = S.pref('tvId');
    if (!id || !/^[A-HJ-NP-Z2-9]{4}$/.test(id)) {
      var abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
      id = '';
      for (var i = 0; i < 4; i++) id += abc.charAt(Math.floor(Math.random() * abc.length));
      S.pref('tvId', id);
    }
    return id;
  }

  // A QR code as a crisp, scalable drawing.
  function qrSvg(text) {
    try {
      var q = window.qrcode(0, 'L');
      q.addData(text); q.make();
      var n = q.getModuleCount(), quiet = 3, size = n + quiet * 2, d = '';
      for (var r = 0; r < n; r++) for (var c = 0; c < n; c++) if (q.isDark(r, c)) d += 'M' + (c + quiet) + ' ' + (r + quiet) + 'h1v1h-1z';
      var ns = 'http://www.w3.org/2000/svg';
      var svg = document.createElementNS(ns, 'svg');
      svg.setAttribute('viewBox', '0 0 ' + size + ' ' + size);
      svg.setAttribute('shape-rendering', 'crispEdges');
      svg.setAttribute('role', 'img');
      svg.setAttribute('aria-label', 'QR code');
      var bg = document.createElementNS(ns, 'rect');
      bg.setAttribute('width', size); bg.setAttribute('height', size); bg.setAttribute('fill', '#ffffff');
      var path = document.createElementNS(ns, 'path');
      path.setAttribute('d', d); path.setAttribute('fill', '#000000');
      svg.appendChild(bg); svg.appendChild(path);
      svg.setAttribute('data-qr', text);
      return svg;
    } catch (e) { return null; }
  }

  // ---------------------------------------------------------------- data
  function start() {
    if (!S.configured) { root.replaceChildren(message('Not set up yet', 'No database address is set in config.js.')); return; }
    if (codeEl) codeEl.textContent = 'TV ' + st.id;
    setInterval(tick, POLL_MS);
    decide();
  }
  // Work out what this screen should show.
  function decide() {
    if (st.busy) return;
    st.busy = true;
    S.get('pub/series').then(function (list) {
      st.series = list || {};
      st.lastOk = Date.now();
      return fixed ? null : S.get('pub/screens/' + st.id);
    }).then(function (scr) {
      st.busy = false;
      var ids = Object.keys(st.series);
      var want = fixed && st.series[fixed] ? fixed : (scr && scr.seriesId && st.series[scr.seriesId] ? scr.seriesId : (ids.length === 1 ? ids[0] : null));
      if (want) { if (want !== st.seriesId || st.mode !== 'show') show(want); }
      else pairing(ids.length);
    }).catch(function () {
      st.busy = false;
      if (st.mode === 'boot') root.replaceChildren(message('Connecting…', 'Waiting for the internet connection.'));
    });
  }
  function tick() {
    if (document.hidden) return;
    st.ticks++;
    if (st.mode === 'show') { poll(); if (!fixed && st.ticks % 3 === 0) checkPairing(); }
    else decide();
    status();
  }
  // Has someone pointed this TV at a different event from the admin page?
  function checkPairing() {
    S.get('pub/screens/' + st.id).then(function (scr) {
      if (!scr || !scr.seriesId || scr.seriesId === st.seriesId) return;
      if (st.series[scr.seriesId]) return show(scr.seriesId);
      return S.get('pub/series').then(function (list) { st.series = list || {}; if (st.series[scr.seriesId]) show(scr.seriesId); });
    }).catch(function () { /* tried again on a later tick */ });
  }
  function show(id) {
    st.mode = 'show'; st.seriesId = id; st.seriesName = (st.series[id] || {}).name || '';
    st.rev = null; st.ping = 0; st.session = null; st.pending = {}; st.shown = false; st.lastRound = 0; st.pendingSince = 0; st.pairShown = '';
    barTitle();
    root.replaceChildren(message(st.seriesName, 'Loading…'));
    poll();
  }
  function pairing(count) {
    st.mode = 'pair'; st.seriesId = null; st.seriesName = ''; st.session = null;
    barTitle();
    var key = st.id + ':' + count;
    if (st.pairShown === key) return;            // already on screen: do not redraw every two seconds
    st.pairShown = key;
    var qr = qrSvg(S.link('admin', { tv: st.id }));
    root.replaceChildren(h('div', 'tvpair', [
      qr ? h('div', 'qrbox', qr) : null,
      h('div', 'txt', [
        h('h1', null, 'Choose what this screen shows'),
        h('p', null, count ? 'Scan this code with the club iPad, tablet or phone and pick your social.' : 'Scan this code with the club iPad, tablet or phone to create your social.'),
        h('p', 'or', 'Or open Events on the iPad and add this TV by its code:'),
        h('div', 'code', st.id)
      ])
    ]));
  }
  function poll() {
    if (st.busy || document.hidden || st.mode !== 'show') return;
    st.busy = true;
    var id = st.seriesId;
    S.get('pub/live/' + id).then(function (live) {
      st.lastOk = Date.now();
      if (id !== st.seriesId) return null;
      if (!live || !live.sessionId) {
        if (st.session || !st.shown) { st.session = null; st.rev = null; st.pending = {}; st.shown = true; return loadMonth(E.localDate(new Date()).slice(0, 7)).then(draw); }
        return null;
      }
      var ping = live.ping || 0;
      var needSession = live.rev !== st.rev || !st.session || !st.shown;
      if (!needSession && ping === st.ping) return null;
      var getSession = needSession ? S.get('pub/sessions/' + id + '/' + live.sessionId).then(E.normalize) : Promise.resolve(st.session);
      return getSession.then(function (s) {
        if (!s || id !== st.seriesId) return null;
        var cur = E.currentRound(s);
        var getScores = s.status === 'live' && cur ? S.get('pub/scores/' + id + '/' + s.id + '/r' + cur.n).catch(function () { return null; }) : Promise.resolve(null);
        return getScores.then(function (entries) {
          return loadMonth(s.month).then(function () {
            if (id !== st.seriesId) return;
            st.session = s; st.rev = live.rev; st.ping = ping; st.pending = entries || {}; st.shown = true;
            draw();
          });
        });
      });
    }).catch(function () { /* shown as "reconnecting" by the status line */ })
      .then(function () { st.busy = false; status(); });
  }
  function loadMonth(monthKey) {
    return S.get('pub/results/' + st.seriesId + '/' + monthKey).then(function (m) { st.month = m || {}; st.monthKey = monthKey; });
  }
  function status() {
    var late = st.lastOk && Date.now() - st.lastOk > 10000;
    var waiting = st.pendingSince && Date.now() - st.pendingSince > 8000;
    statusEl.textContent = late ? 'Reconnecting…' : waiting ? 'Scores are in. Open the organizer’s iPad to continue.' : '';
  }

  // ---------------------------------------------------------------- drawing
  function message(title, text) { return h('div', 'tvpick', [h('h1', null, title), h('p', null, text)]); }

  function draw() {
    var s = st.session, left;
    if (!s || s.discarded) left = bigLeft('Tonight', st.seriesName, h('div', 'tvempty', 'The next night has not been set up yet.'));
    else if (s.status === 'setup') left = setupLeft(s);
    else if (s.status === 'ended') left = endedLeft(s);
    else left = liveLeft(s);
    if (!s || s.status !== 'live') st.pendingSince = 0;
    root.replaceChildren(h('div', 'tvroot', [left, rightSide(s)]));
    fit();
  }
  function head(title, flash) {
    // the event name lives in the top banner; this line carries the round and the set length (the clock is bottom left)
    var s = st.session, sets = s && !s.discarded && s.status !== 'ended' ? 'Sets to ' + (s.setTo || 4) : '';
    barTitle();
    return h('div', 'tvhead', [h('div', 'round' + (flash ? ' flash' : ''), title), h('div', 'event', sets)]);
  }
  // Bottom left corner: "Thursday, November 18th" and a clock with seconds, so a glance shows the page is running.
  function dateText(d) { return DAYS[d.getDay()] + ', ' + MONTHS[d.getMonth()] + ' ' + ordinal(d.getDate()); }
  function timeText(d) {
    var hh = d.getHours(), mm = d.getMinutes(), ss = d.getSeconds();
    return ((hh + 11) % 12 + 1) + ':' + (mm < 10 ? '0' : '') + mm + ':' + (ss < 10 ? '0' : '') + ss + (hh < 12 ? ' AM' : ' PM');
  }
  function showDate() {
    var d = new Date(), day = document.getElementById('daytext'), time = document.getElementById('timetext');
    if (day && day.textContent !== dateText(d)) day.textContent = dateText(d);
    if (time) time.textContent = timeText(d);
  }
  function barTitle() { var b = document.getElementById('bartitle'); if (b) b.textContent = st.seriesName || ''; }
  function bigLeft(title, sub, body) { return h('div', 'tvleft', [head(title, false), h('div', 'tvbig', body), h('div')]); }

  function setupLeft(s) {
    var teams = E.activeTeams(s);
    return h('div', 'tvleft', [head('Tonight', false),
      h('div', 'tvbig', teams.length ? [h('div', 'ttl', teams.length + ' teams checked in'), h('div', 'teams', teams.map(function (t) { return h('div', null, t.name); }))]
        : h('div', 'ttl', 'Starting soon')),
      s.courts.length ? h('div', 'tvsit', [h('div', 'lab', 'Courts'), h('div', 'names', s.courts.join(' · ') + '   (court ' + s.courts[s.courts.length - 1] + ' is King’s Court)')]) : h('div')]);
  }
  function liveLeft(s) {
    var r = E.currentRound(s);
    if (!r) return bigLeft('Tonight', '', h('div', 'ttl', 'Starting soon'));
    var flash = r.n !== st.lastRound;
    st.lastRound = r.n;
    var top = r.top !== undefined && r.top !== null ? r.top : s.courts.length - 1;
    // scores sent from phones that the organizer's device has not applied yet: shown at once, in green
    var sent = {};
    E.pendingPlayerScores(s, r.n, st.pending).forEach(function (p) { sent[p.idx] = p; });
    var anySent = false;
    var courts = r.courts.map(function (c, i) {
      var done = !!c.w && !c.void, p = !done && !c.void ? sent[i] : null;
      if (p) anySent = true;
      var sa = done ? c.sa : p ? p.sa : null, sb = done ? c.sb : p ? p.sb : null, w = done ? c.w : p ? p.w : null;
      var has = done || !!p;
      // green behind the names once the score is in, so it is easy to see which courts are still missing
      return h('div', 'tvcourt' + (c.level === top ? ' king' : '') + (has ? ' done' : ''), [
        h('div', 'cn', [h('span', null, c.level === top ? 'King’s Court' : 'Court'), h('b', null, String(c.court))]),
        h('div', 'tm a' + (has && w === 'b' ? ' lost' : ''), name(c.a) + (has && w === 'a' ? ' ' + CROWN : '')),
        c.void ? h('div', 'mid', 'no match') : has ? h('div', 'mid score', sa + ' – ' + sb) : h('div', 'mid', 'vs'),
        h('div', 'tm b' + (has && w === 'a' ? ' lost' : ''), (has && w === 'b' ? CROWN + ' ' : '') + name(c.b))
      ]);
    });
    st.pendingSince = anySent ? (st.pendingSince || Date.now()) : 0;
    var waiting = E.activeTeams(s).filter(function (t) { return r.sitting.indexOf(t.id) < 0 && !r.courts.some(function (c) { return c.a === t.id || c.b === t.id; }); });
    // keep each team's name on one line, let the list wrap between teams
    var keep = function (txt) { return txt.replace(/ /g, ' '); };
    var names = r.sitting.map(function (id) { return keep(name(id)); }).concat(waiting.map(function (t) { return keep(t.name + ' (next round)'); })).join('  ·  ');
    // players scan this to enter their own court's score from their phone
    var qr = qrSvg(S.link('player', { s: st.seriesId }));
    return h('div', 'tvleft', [head('Round ' + r.n, flash), h('div', 'tvcourts', courts),
      h('div', 'tvbottom', [
        names ? h('div', 'tvsit', [h('div', 'lab', 'Sitting out this round'), h('div', 'names', names)]) : h('div', 'tvsit', [h('div', 'lab', 'Everyone is playing'), h('div', 'names', '')]),
        qr ? h('div', 'tvqr', [h('div', 'cap', ['Enter your score', h('small', null, 'Scan with your phone')]), qr]) : null
      ])]);
  }
  function endedLeft(s) {
    var rows = E.leaderboard(s).slice(0, 5);
    return h('div', 'tvleft', [head('Final standings', false),
      h('div', 'tvbig', h('div', 'podium', rows.map(function (r) { return h('div', null, [h('span', null, ordinal(r.rank)), h('span', 'nm', r.name), h('span', 'num', r.points + ' pts')]); }))),
      h('div', 'tvsit', [h('div', 'lab', 'Thank you'), h('div', 'names', 'See you next week.')])]);
  }
  function ordinal(n) { var v = n % 100, s = ['th', 'st', 'nd', 'rd']; return n + (s[(v - 20) % 10] || s[v] || s[0]); }

  function rightSide(s) {
    var tonight = s && !s.discarded ? E.leaderboard(s) : [];
    var monthDocs = {};
    Object.keys(st.month || {}).forEach(function (k) { monthDocs[k] = st.month[k]; });
    if (s && !s.discarded && s.status !== 'setup' && s.month === st.monthKey) monthDocs[s.id] = E.resultsDoc(s); // tonight, up to the second
    var month = E.monthlyBoard(monthDocs);
    var nights = Object.keys(monthDocs).filter(function (k) { return monthDocs[k] && monthDocs[k].entries && Object.keys(monthDocs[k].entries).length; }).length;
    var mName = MONTHS[Number((st.monthKey || '2000-01').slice(5, 7)) - 1];
    var unit = s && s.scoring === 'player' ? 'players' : 'teams';
    return h('div', 'tvright', [
      board('Tonight', tonight.length ? tonight.length + ' ' + unit : '', tonight, tonight.length, 'Waiting for teams'),
      board(mName, nights ? nights + (nights === 1 ? ' night' : ' nights') : '', month.slice(0, MONTH_ROWS), Math.min(month.length, MONTH_ROWS), 'No results yet this month')
    ]);
  }
  function board(title, sub, rows, count, empty) {
    var two = rows.length > 16;
    var list = h('div', 'tvrows' + (two ? ' two' : ''), rows.map(function (r) {
      // gold, silver and bronze for places 1 to 3 once there are points; teams level on points share a medal
      var medal = r.points > 0 && r.rank <= 3 ? MEDALS[r.rank - 1] : '';
      return h('div', 'tvrow' + (r.rank === 1 && r.points > 0 ? ' lead' : ''), [h('span', 'md' + (medal && r.rank === 1 ? ' gold' : ''), medal), h('span', 'rk', String(r.rank)), h('span', 'nm', r.name), h('span', 'pt', String(r.points))]);
    }));
    if (two) list.style.gridTemplateRows = 'repeat(' + Math.ceil(rows.length / 2) + ', minmax(0, 1fr))';
    list.setAttribute('data-per', String(two ? Math.ceil(rows.length / 2) : Math.max(rows.length, 1)));
    var box = h('div', 'tvboard', [h('h2', null, [title, h('small', null, sub)]), rows.length ? list : h('div', 'tvempty', empty)]);
    box.style.flexGrow = String(Math.max(two ? Math.ceil(count / 2) : count, 4) + 1.6);
    return box;
  }
  // Size the text to the space each row actually has, whatever the number of teams or courts.
  function fit() {
    var vh = window.innerHeight / 100;
    Array.prototype.forEach.call(document.querySelectorAll('.tvrows'), function (list) {
      var per = Number(list.getAttribute('data-per')) || 1;
      var rowH = list.clientHeight / per;
      list.style.fontSize = Math.max(10, Math.min(rowH * 0.66, 4.8 * vh)) + 'px';
    });
    Array.prototype.forEach.call(document.querySelectorAll('.tvcourt'), function (c) {
      var hgt = c.clientHeight;
      var tm = Math.min(hgt * 0.46, 5.6 * vh);
      Array.prototype.forEach.call(c.querySelectorAll('.tm'), function (t) {
        var size = tm, guard = 0;
        t.style.fontSize = size + 'px';
        while ((t.scrollHeight > hgt * 0.94 || t.scrollWidth > t.clientWidth + 1) && size > 14 && guard++ < 24) { size *= 0.92; t.style.fontSize = size + 'px'; }
      });
      var b = c.querySelector('.cn b'); if (b) b.style.fontSize = Math.min(hgt * 0.62, 8.4 * vh) + 'px';
      var m = c.querySelector('.mid.score'); if (m) m.style.fontSize = Math.min(hgt * 0.5, 6.4 * vh) + 'px';
    });
  }

  // ---------------------------------------------------------------- full screen, keep-awake, clock
  var canFull = !!(document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen);
  function isFull() { return !!(document.fullscreenElement || document.webkitFullscreenElement); }
  function toggleFull() {
    var el = document.documentElement;
    try {
      if (isFull()) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
      else {
        var p = (el.requestFullscreen || el.webkitRequestFullscreen).call(el);
        if (p && p.catch) p.catch(function () { /* the browser refused: its own full-screen option still works */ });
      }
    } catch (e) { /* not supported in this browser */ }
  }
  // The button stays visible (it never fades) until the page is in full screen. While it is showing, the
  // layout leaves a strip free at the bottom so the button never covers the leaderboard.
  function fullChanged() {
    fsBtn.hidden = isFull() || !canFull;
    document.body.classList.toggle('hasbtn', !fsBtn.hidden);
    setTimeout(fit, 150);
  }
  fsBtn.addEventListener('click', toggleFull);
  document.addEventListener('fullscreenchange', fullChanged);
  document.addEventListener('webkitfullscreenchange', fullChanged);
  document.addEventListener('keydown', function (e) { if ((e.key === 'f' || e.key === 'F') && !e.metaKey && !e.ctrlKey) toggleFull(); });
  document.addEventListener('visibilitychange', function () { if (!document.hidden) tick(); });
  window.addEventListener('resize', fit);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(fit);
  setInterval(showDate, 1000);
  showDate();

  window.Awake.start();      // screen stays on for as long as this page is open
  fullChanged();
  start();
})();
