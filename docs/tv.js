/* Padel Socials — TV display. Read-only: checks the database every 2 seconds and redraws when something changed. */
(function () {
  'use strict';
  var E = window.Engine, S = window.Store;
  var root = document.getElementById('tv'), statusEl = document.getElementById('status'), fsBtn = document.getElementById('fs');
  var POLL_MS = 2000, MONTH_ROWS = 10;
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  var st = { seriesId: null, seriesName: '', series: null, rev: null, sessionId: null, session: null, month: null, monthKey: null,
    busy: false, lastOk: 0, lastRound: 0, shown: false };

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

  // ---------------------------------------------------------------- data
  function start() {
    if (!S.configured) { root.replaceChildren(message('Not set up yet', 'No database address is set in config.js.')); return; }
    var want = new URLSearchParams(location.search).get('s') || S.pref('tvSeries');
    S.get('pub/series').then(function (list) {
      st.series = list || {};
      var ids = Object.keys(st.series);
      if (want && st.series[want]) return choose(want);
      if (ids.length === 1) return choose(ids[0]);
      if (!ids.length) { root.replaceChildren(message('Padel Socials', 'No event has been created yet. Create one on the iPad and this screen will pick it up.')); setTimeout(start, 5000); return; }
      picker(ids);
    }).catch(function () { root.replaceChildren(message('Connecting…', 'Waiting for the internet connection.')); setTimeout(start, 4000); });
  }
  function picker(ids) {
    var box = h('div', 'tvpick', [h('h1', null, 'Which event is on this screen?')]);
    ids.forEach(function (id, i) {
      var b = h('button', null, st.series[id].name);
      b.type = 'button';
      b.addEventListener('click', function () { choose(id); });
      box.appendChild(b);
      if (i === 0) setTimeout(function () { b.focus(); }, 50);
    });
    root.replaceChildren(box);
  }
  function choose(id) {
    st.seriesId = id; st.seriesName = (st.series[id] || {}).name || '';
    barTitle();
    S.pref('tvSeries', id);
    root.replaceChildren(message(st.seriesName, 'Loading…'));
    poll();
    setInterval(poll, POLL_MS);
  }
  function poll() {
    if (st.busy || document.hidden) return;
    st.busy = true;
    var id = st.seriesId;
    S.get('pub/live/' + id).then(function (live) {
      st.lastOk = Date.now();
      if (!live || !live.sessionId) {
        if (st.session || !st.shown) { st.session = null; st.rev = null; st.shown = true; return loadMonth(E.localDate(new Date()).slice(0, 7)).then(draw); }
        return null;
      }
      if (live.rev === st.rev && st.shown) return null;
      return S.get('pub/sessions/' + id + '/' + live.sessionId).then(function (data) {
        var s = E.normalize(data);
        if (!s) return null;
        return loadMonth(s.month).then(function () { st.session = s; st.rev = live.rev; st.shown = true; draw(); });
      });
    }).catch(function () { /* shown as "reconnecting" by the status line */ })
      .then(function () { st.busy = false; status(); });
  }
  function loadMonth(monthKey) {
    return S.get('pub/results/' + st.seriesId + '/' + monthKey).then(function (m) { st.month = m || {}; st.monthKey = monthKey; });
  }
  function status() {
    var late = Date.now() - st.lastOk > 10000;
    statusEl.textContent = late ? 'Reconnecting…' : '';
  }

  // ---------------------------------------------------------------- drawing
  function message(title, text) { return h('div', 'tvpick', [h('h1', null, title), h('p', null, text)]); }

  function draw() {
    var s = st.session, left;
    if (!s || s.discarded) left = bigLeft('Tonight', st.seriesName, h('div', 'tvempty', 'The next night has not been set up yet.'));
    else if (s.status === 'setup') left = setupLeft(s);
    else if (s.status === 'ended') left = endedLeft(s);
    else left = liveLeft(s);
    root.replaceChildren(h('div', 'tvroot', [left, rightSide(s)]));
    fit();
  }
  function head(title, flash) {
    // the event name lives in the top banner; this line carries the round, the set length and the clock
    var s = st.session, sets = s && !s.discarded && s.status !== 'ended' ? 'Sets to ' + (s.setTo || 4) : '';
    barTitle();
    return h('div', 'tvhead', [h('div', 'round' + (flash ? ' flash' : ''), title), h('div', 'event', sets), clockEl()]);
  }
  var DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  // Bottom corner: "Thursday, November 18th" and a clock with seconds, so a glance shows the page is running.
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
  function clockEl() { var c = h('div', 'clock', clockText()); c.id = 'clock'; return c; }
  function clockText() {
    var d = new Date(), hh = d.getHours(), mm = d.getMinutes();
    return ((hh + 11) % 12 + 1) + ':' + (mm < 10 ? '0' : '') + mm + (hh < 12 ? ' AM' : ' PM');
  }
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
    var courts = r.courts.map(function (c) {
      var done = !!c.w && !c.void;
      return h('div', 'tvcourt' + (c.level === top ? ' king' : ''), [
        h('div', 'cn', [h('span', null, c.level === top ? 'King’s Court' : 'Court'), h('b', null, String(c.court))]),
        h('div', 'tm a' + (done && c.w === 'b' ? ' lost' : ''), name(c.a)),
        c.void ? h('div', 'mid', 'no match') : done ? h('div', 'mid score', c.sa + ' – ' + c.sb) : h('div', 'mid', 'vs'),
        h('div', 'tm b' + (done && c.w === 'a' ? ' lost' : ''), name(c.b))
      ]);
    });
    var waiting = E.activeTeams(s).filter(function (t) { return r.sitting.indexOf(t.id) < 0 && !r.courts.some(function (c) { return c.a === t.id || c.b === t.id; }); });
    // keep each team's name on one line, let the list wrap between teams
    var keep = function (txt) { return txt.replace(/ /g, '\u00a0'); };
    var names = r.sitting.map(function (id) { return keep(name(id)); }).concat(waiting.map(function (t) { return keep(t.name + ' (next round)'); })).join('  \u00b7  ');
    return h('div', 'tvleft', [head('Round ' + r.n, flash), h('div', 'tvcourts', courts),
      names ? h('div', 'tvsit', [h('div', 'lab', 'Sitting out this round'), h('div', 'names', names)]) : h('div')]);
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
      return h('div', 'tvrow' + (r.rank === 1 && r.points > 0 ? ' lead' : ''), [h('span', 'rk', String(r.rank)), h('span', 'nm', r.name), h('span', 'pt', String(r.points))]);
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
      list.style.fontSize = Math.max(10, Math.min(rowH * 0.62, 4.4 * vh)) + 'px';
    });
    Array.prototype.forEach.call(document.querySelectorAll('.tvcourt'), function (c) {
      var hgt = c.clientHeight;
      var tm = Math.min(hgt * 0.4, 5.6 * vh);
      Array.prototype.forEach.call(c.querySelectorAll('.tm'), function (t) {
        var size = tm, guard = 0;
        t.style.fontSize = size + 'px';
        while ((t.scrollHeight > hgt * 0.94 || t.scrollWidth > t.clientWidth + 1) && size > 14 && guard++ < 24) { size *= 0.92; t.style.fontSize = size + 'px'; }
      });
      var b = c.querySelector('.cn b'); if (b) b.style.fontSize = Math.min(hgt * 0.62, 8.4 * vh) + 'px';
      var m = c.querySelector('.mid.score'); if (m) m.style.fontSize = Math.min(hgt * 0.46, 6.4 * vh) + 'px';
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
  document.addEventListener('visibilitychange', function () { if (!document.hidden) poll(); });
  window.addEventListener('resize', fit);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(fit);
  setInterval(function () { var c = document.getElementById('clock'); if (c) c.textContent = clockText(); status(); }, 5000);
  setInterval(showDate, 1000);
  showDate();

  window.Awake.start();      // screen stays on for as long as this page is open
  fullChanged();
  start();
})();
