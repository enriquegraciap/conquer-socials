/* Padel Socials — TV display. Read-only: checks the database every 2 seconds and redraws when something changed.
 *
 * What a TV shows: one of the socials, one of the two flyer slideshows (the club's everyday flyers, or the
 * flyers for a special event), or the main menu where you choose.
 *   1. something named in the address (tv/?s=event-id, tv/?flyers=1) wins until a choice is made on the TV;
 *   2. otherwise what was last chosen for this TV: on its own main menu with the remote, or from the admin
 *      page (scan the QR on the menu, or add the TV by its code). The most recent of the two counts;
 *   3. otherwise, if the club has exactly one social, that one;
 *   4. otherwise the main menu.
 * The "Main menu" button sits beside "Full screen" whenever the page is not in full screen.
 */
(function () {
  'use strict';
  var E = window.Engine, S = window.Store, L = window.Look;
  var root = document.getElementById('tv'), statusEl = document.getElementById('status'), codeEl = document.getElementById('tvcode'), fsBtn = document.getElementById('fs'), menuBtn = document.getElementById('menu'), turnBtn = document.getElementById('turn');
  var POLL_MS = 2000, MONTH_ROWS = 10;
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var CROWN = '\uD83D\uDC51';   // beside the winning team: after the name on the left side, before it on the right side
  var MEDALS = ['\uD83E\uDD47', '\uD83E\uDD48', '\uD83E\uDD49'];   // gold, silver, bronze
  var FLYERS = '@flyers', SPECIAL = '@special', MENU = '@menu', INTRO = '@intro';      // what a TV can show that is not a social
  var I = window.Intro;                                    // the "Intro to padel" slides (intro.js)
  var hasIntro = !!I && S.club.intro;
  function isFly(x) { return x === FLYERS || x === SPECIAL; }
  var FORMATS = {};
  Object.keys(E.FORMATS).forEach(function (f) { FORMATS[f] = E.FORMATS[f].name; });
  var q0 = new URLSearchParams(location.search);

  // ---------------------------------------------------------------- a screen hung sideways
  // Many TVs cannot turn their own picture. The "Turn screen" button (bottom right) does it here instead: each press
  // goes on to the next of: as the TV shows it, turned to the left, turned to the right. The TV remembers the choice.
  // A turned screen is this same page inside a frame that is as wide as the TV is high and turned a quarter;
  // inside the frame the page simply finds a portrait screen and lays itself out for one.
  // (?rotate=left, ?rotate=right or ?rotate=off in the address sets it too.)
  var TURNS = ['', 'left', 'right'];
  var turnedIn = TURNS.indexOf(q0.get('rotin') || '') > 0 ? q0.get('rotin') : '';      // this page is the one inside the turned frame
  if (q0.get('rotate')) S.pref('tvTurn', TURNS.indexOf(q0.get('rotate')) > 0 ? q0.get('rotate') : null);
  var turn = turnedIn || (TURNS.indexOf(S.pref('tvTurn') || '') > 0 ? S.pref('tvTurn') : '');
  function pageUrl(extra) {
    var q = new URLSearchParams(location.search);
    q.delete('rotate'); q.delete('rotin');
    if (extra) q.set('rotin', extra);
    var qs = q.toString();
    return location.pathname + (qs ? '?' + qs : '') + location.hash;
  }
  function turnScreen() {
    var next = TURNS[(TURNS.indexOf(turn) + 1) % TURNS.length];
    S.pref('tvTurn', next || null);
    var top = turnedIn ? window.parent : window;
    top.location.replace(pageUrl(''));                   // the outer page starts again and reads the new choice
  }
  if (turn && !turnedIn) {                                // the outer page of a turned screen: nothing but the frame
    var frame = document.createElement('iframe');
    frame.className = 'rotframe ' + turn;
    frame.title = 'Padel Socials TV';
    frame.setAttribute('allow', 'fullscreen; screen-wake-lock');
    frame.setAttribute('allowfullscreen', '');
    frame.src = pageUrl(turn);
    document.body.classList.add('rotshell');
    document.body.appendChild(frame);
    frame.addEventListener('load', function () { try { frame.contentWindow.focus(); } catch (e) { /* the remote's pointer still works */ } });
    return;
  }

  var fixed = q0.get('intro') && hasIntro ? INTRO : q0.get('flyers') === 'special' ? SPECIAL : q0.get('flyers') ? FLYERS : q0.get('s');

  var st = { id: tvId(), mode: 'boot', series: {}, seriesId: null, seriesName: '', rev: null, ping: 0, session: null, pending: {},
    month: null, monthKey: null, busy: false, lastOk: 0, lastRound: 0, shown: false, ticks: 0, pendingSince: 0, menuShown: '',
    seenKey: '', seen: {}, cheer: [], fly: {}, ratings: {}, promo: null, promoKey: '', flyer: '', flyerKey: '', lastSession: '', lastStatus: '', holdSince: 0, announce: 0 };

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
  // One side of a court: a couple, or (individual format) the two players paired for this round.
  // two players paired for a round: each name stays in one piece, so a long side breaks after the "&"
  // One side of a court: { kids, pair }. crownEl (the winner's crown) goes after the name on the left side and
  // before it on the right (before = true). With two names, each stays in one piece ("Ana Lopez &" / "Bruno Diaz",
  // the crown stuck to its name), so a side that is too wide is made smaller instead of being cut anywhere.
  function side(c, which, crownEl, before) {
    var ids = E.sideIds(c, which), t = ids.length === 1 ? st.session.teams[ids[0]] : null;
    var parts = ids.length > 1 ? ids.map(name) : t && t.players && t.players.length > 1 && t.players.join(' & ') === t.name ? t.players : null;
    if (!parts) {
      var text = ids.map(name).join(' & ');
      return { pair: false, kids: before ? [crownEl ? [crownEl, '\u00a0'] : null, text] : [text, crownEl ? ['\u00a0', crownEl] : null] };
    }
    var kids = [], last = parts.length - 1;
    parts.forEach(function (nm, i) {
      var inside = [nm];
      if (i < last) inside.push(' &');
      if (crownEl && before && i === 0) inside.unshift(crownEl, '\u00a0');
      if (crownEl && !before && i === last) inside.push('\u00a0', crownEl);
      if (i) kids.push(' ');
      kids.push(h('span', 'pn', inside));
    });
    return { pair: true, kids: kids };
  }

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
  function qrSvg(text, margin) {
    try {
      var q = window.qrcode(0, 'L');
      q.addData(text); q.make();
      var n = q.getModuleCount(), quiet = margin || 3, size = n + quiet * 2, d = '';
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
      return fixed ? null : S.get('pub/screens/' + st.id).catch(function () { return null; });
    }).then(function (scr) {
      st.busy = false;
      takePairing(scr);
      var ids = Object.keys(st.series), choice = S.pref('tvShow') || '';
      var want = fixed && (isFly(fixed) || fixed === INTRO || st.series[fixed]) ? fixed
        : isFly(choice) || (choice === INTRO && hasIntro) ? choice
        : choice && choice !== MENU && st.series[choice] ? choice
        : choice !== MENU && ids.length === 1 ? ids[0] : null;
      if (want === INTRO) { if (st.mode !== 'intro') showIntro(); }
      else if (isFly(want)) { if (st.mode !== 'flyers' || fl.which !== want) showFlyers(want); }
      else if (want) { if (want !== st.seriesId || st.mode !== 'show') show(want); }
      else menu();
    }).catch(function () {
      st.busy = false;
      if (st.mode === 'boot') root.replaceChildren(message('Connecting…', 'Waiting for the internet connection.'));
    });
  }
  // A choice made for this TV on the admin page counts once, when it is made: it replaces whatever the TV was
  // showing, and a later choice on the TV's own menu replaces it in turn.
  function takePairing(scr) {
    if (!scr || !scr.seriesId || String(scr.at || 0) === S.pref('tvPairAt')) return false;
    S.pref('tvPairAt', String(scr.at || 0));
    S.pref('tvShow', scr.seriesId);
    st.restHold = Date.now() + 10 * 60000;        // someone asked for it: it stays up for a while even if the social is over
    return true;
  }
  function tick() {
    if (document.hidden) return;
    st.ticks++;
    if (st.mode === 'show') { if (restDue()) startRest(); else { poll(); if (st.ticks % 15 === 0) refreshEvent(); if (st.ticks % 150 === 0) loadPromo(); } }
    else if (st.mode === 'flyers') { if (st.ticks % 15 === 0) loadFlyers(); if (st.ticks % 30 === 0) loadBoards(); if (fl.rest && st.ticks % 3 === 0) restCheck(); }
    else if (st.mode === 'intro') { /* nothing to fetch: the slides are part of the page */ }
    else decide();
    if (st.mode !== 'menu' && st.mode !== 'boot' && !fixed && st.ticks % 3 === 0) checkPairing();
    status();
  }
  // Has someone pointed this TV at something else from the admin page?
  function checkPairing() {
    S.get('pub/screens/' + st.id).then(function (scr) { if (takePairing(scr)) decide(); }).catch(function () { /* tried again on a later tick */ });
  }
  // Pick up a new name for the social on screen without reloading the page.
  function refreshEvent() {
    var id = st.seriesId;
    S.get('pub/series/' + id).then(function (meta) {
      if (!meta || id !== st.seriesId) return;
      st.series[id] = meta; st.seriesName = meta.name || ''; if (barTitle()) draw(); loadEventFlyer();
    }).catch(function () { /* next time */ });
  }
  // The social's wide flyer, for the moment between rounds. Fetched once, and again only when it is replaced.
  function loadEventFlyer() {
    var id = st.seriesId, look = (st.series[id] || {}).look || {}, key = id + ':' + (look.wide ? look.rev : 'none');
    if (key === st.flyerKey) return;
    st.flyerKey = key;
    var pic = document.getElementById('interpic');
    if (!look.wide) { st.flyer = ''; if (pic) pic.removeAttribute('src'); return; }
    S.get('pub/eventflyers/' + id + '/wide').then(function (data) {
      if (st.flyerKey !== key) return;
      st.flyer = typeof data === 'string' && /^data:image\//.test(data) ? data : '';
      if (pic) { if (st.flyer) pic.src = st.flyer; else pic.removeAttribute('src'); }
    }).catch(function () { if (st.flyerKey === key) st.flyerKey = ''; /* tried again in half a minute */ });
  }
  function setMode(mode) {
    if (st.mode === 'flyers' && mode !== 'flyers') stopFlyers();
    st.mode = mode;
    if (mode !== 'menu') st.menuShown = '';
    if (mode !== 'show') { st.seriesId = null; st.seriesName = ''; st.session = null; st.pendingSince = 0; st.flyer = ''; st.flyerKey = ''; endIntro(); wheelEnd(); applyTheme(null); }
    document.body.classList.toggle('mode-flyers', mode === 'flyers');
    document.body.classList.toggle('mode-intro', mode === 'intro');
    document.body.classList.toggle('mode-menu', mode === 'menu');
    buttons();
  }
  function show(id) {
    setMode('show');
    st.seriesId = id; st.seriesName = (st.series[id] || {}).name || '';
    st.rev = null; st.ping = 0; st.session = null; st.saved = null; st.pending = {}; st.shown = false; st.lastRound = 0; st.pendingSince = 0;
    st.lastSession = ''; st.lastStatus = ''; st.holdSince = 0; st.flyerKey = ''; st.flyer = '';
    barTitle();
    loadEventFlyer();
    loadPromo();
    root.replaceChildren(message(st.seriesName, 'Loading…'));
    poll();
  }
  // Chosen on this TV with the remote: remembered on this TV until someone chooses again.
  function choose(what) {
    S.pref('tvShow', what);
    st.restHold = Date.now() + 10 * 60000;
    if (fixed) {                                  // the address no longer decides
      fixed = null;
      var q = new URLSearchParams(location.search); q.delete('s'); q.delete('flyers'); q.delete('intro');
      var qs = q.toString();
      try { history.replaceState(null, '', location.pathname + (qs ? '?' + qs : '')); } catch (e) { /* fine */ }
    }
    if (what === MENU) { menu(); decide(); }
    else if (what === INTRO) showIntro();
    else if (isFly(what)) showFlyers(what);
    else show(what);
  }
  // The main menu: every social, and the club flyers. Big buttons, so a TV remote can move through them.
  function menu() {
    var ids = Object.keys(st.series).sort(function (a, b) { return (st.series[a].name || '') < (st.series[b].name || '') ? -1 : 1; });
    var key = st.id + ':' + ids.map(function (id) { return id + '=' + st.series[id].name; }).join('|');
    if (st.mode === 'menu' && st.menuShown === key) return;       // already on screen: do not redraw every two seconds
    var had = st.mode === 'menu' && document.activeElement && document.activeElement.getAttribute('data-pick');
    setMode('menu');
    st.menuShown = key;
    barTitle();
    var item = function (what, title, sub) {
      var b = h('button', 'pickbtn', [h('b', null, title), h('span', null, sub)]);
      b.type = 'button'; b.setAttribute('data-pick', what);
      b.addEventListener('click', function () { choose(what); });
      return b;
    };
    var items = ids.map(function (id) { return item(id, st.series[id].name, FORMATS[st.series[id].format] || 'Social'); });
    items.push(item(FLYERS, 'Club flyers', 'Slideshow of the club\u2019s flyers and the monthly leaderboards'));
    items.push(item(SPECIAL, 'Special event flyers', 'Slideshow of the flyers for a special event'));
    if (hasIntro) items.push(item(INTRO, 'Intro to padel', 'Slides for explaining the game to new players: the remote\u2019s arrows change the slide'));
    var qr = qrSvg(S.here('admin', { tv: st.id }));
    root.replaceChildren(h('div', 'tvmenu', [
      h('div', 'list', [h('h1', null, 'What should this screen show?'), h('div', 'items' + (items.length > 5 ? ' two' : ''), items)]),
      h('div', 'side', [
        qr ? h('div', 'qrbox', qr) : null,
        h('p', null, 'Or choose from the club iPad: scan this code, or open Events and add this TV by its code.'),
        h('div', 'code', st.id)
      ])
    ]));
    Array.prototype.forEach.call(root.querySelectorAll('.pickbtn b'), function (el) {      // long names shrink to fit
      var size = parseFloat(getComputedStyle(el).fontSize), min = size * 0.55, guard = 0;
      while (el.scrollWidth > el.clientWidth + 1 && size > min && guard++ < 24) { size *= 0.95; el.style.fontSize = size + 'px'; }
    });
    var again = had && root.querySelector('[data-pick="' + had + '"]');
    (again || items[0]).focus();
  }

  // ---------------------------------------------------------------- intro to padel
  // A slide deck for explaining the game to people who have never played (the slides are in intro.js). It does not
  // move by itself: the remote's right and left arrows (or OK, or a click on the slide) change the slide, so the
  // person explaining sets the pace. The last slide has a QR code to the phone page with rules, tips and questions.
  var intro = { at: 0, box: null, nav: null };
  function showIntro() {
    setMode('intro');
    barTitle();
    intro.at = 0;
    intro.box = h('div', 'in-stage');
    intro.nav = h('div', 'in-nav');
    var wrap = h('div', 'tvintro', [intro.box, intro.nav]);
    wrap.tabIndex = 0;
    intro.box.addEventListener('click', function () { introGo(1); });
    root.replaceChildren(wrap);
    introDraw();
    wrap.focus();
  }
  function introDraw() {
    if (st.mode !== 'intro' || !intro.box) return;
    var n = I.count, at = intro.at, qr = I.ids[at] === 'go' ? qrSvg(S.link('learn')) : null;
    intro.box.replaceChildren(I.build(at, { asset: S.asset, qr: qr }));
    intro.box.setAttribute('data-at', String(at + 1));
    var btn = function (cls, label, text, step, off) {
      var b = h('button', 'in-btn ' + cls, text);
      b.type = 'button'; b.setAttribute('aria-label', label); b.disabled = off; b.tabIndex = -1;
      b.addEventListener('click', function (e) { e.stopPropagation(); introGo(step); });
      return b;
    };
    var dots = [];
    for (var i = 0; i < n; i++) dots.push(h('i', i === at ? 'on' : i < at ? 'done' : null));
    intro.nav.replaceChildren(btn('prev', 'Previous slide', '\u2039', -1, at === 0), h('div', 'in-dots', dots), h('span', 'in-count', (at + 1) + ' / ' + n), btn('next', 'Next slide', '\u203a', 1, at === n - 1));
  }
  function introGo(step) {
    var to = Math.max(0, Math.min(I.count - 1, intro.at + step));
    if (to === intro.at) return;
    intro.at = to;
    introDraw();
  }

  // ---------------------------------------------------------------- club flyers
  // A slideshow of the photos uploaded on the flyers page: each fills the screen, a new one every 15 seconds.
  // Two sets: the club's everyday flyers (pub/flyers/club, which also shows the monthly leaderboards) and the
  // flyers for a special event (pub/flyers/special).
  var SLIDE_MS = 15000;
  // A social that is over hands its screen to the club flyers by itself: a few minutes after End night (the final
  // standings stay up first), or when no score has come in for 45 minutes. The TV stays on that social: as soon as
  // anything happens in it again (a new night is set up, a score, the night reopened) the social is back on screen.
  var REST_AFTER_END = 5 * 60000, REST_QUIET = 45 * 60000;
  var BOARDS = '@boards';                       // the slide that is made here: this month's top three of every social
  var fl = { rev: undefined, list: [], data: {}, cur: null, top: 0, timer: null, loading: false, layers: [], msg: null, board: null, boards: [], month: '' };
  function restKey() { return st.seriesId + ':' + (st.saved ? st.saved.id : '') + ':' + st.rev + ':' + (st.ping || 0); }
  function restDue() {
    var s = st.saved, now = Date.now();
    if (st.mode !== 'show' || !st.shown || !s || s.discarded || now < (st.restHold || 0) || restKey() === st.restSkip) return false;
    if (s.status === 'ended') return !s.endedAt || now - Number(s.endedAt) >= REST_AFTER_END;
    if (s.status !== 'live' || !s.rounds || !s.rounds.length) return false;
    var last = Math.max(Number(s.scoredAt) || 0, st.phoneAt || 0);
    if (last) return now - last >= REST_QUIET;
    return String(s.date) < E.localDate(new Date(now - 6 * 3600000));      // an older night nobody ended, from before these times were kept
  }
  function startRest() {
    var back = { series: st.seriesId, session: st.saved.id, rev: st.rev, ping: st.ping || 0, key: restKey(), at: Date.now() };
    showFlyers(FLYERS);
    fl.rest = back;
  }
  // While resting: has anything happened in the social? Then it is back. (And with nothing at all to show, no flyers
  // and no leaderboards, the social simply stays on screen.)
  function restCheck() {
    var r = fl.rest;
    if (!r || st.mode !== 'flyers') return;
    if (Date.now() - r.at > 30000 && fl.rev !== undefined && !fl.loading && !slides().length) { fl.rest = null; st.restSkip = r.key; return show(r.series); }
    S.get('pub/live/' + r.series).then(function (live) {
      if (fl.rest !== r || st.mode !== 'flyers') return;
      if (live && (live.sessionId !== r.session || live.rev !== r.rev || (live.ping || 0) !== r.ping)) { fl.rest = null; show(r.series); }
    }).catch(function () { /* next time */ });
  }
  function showFlyers(which) {
    setMode('flyers');
    fl.rest = null;
    fl.which = which === SPECIAL ? SPECIAL : FLYERS;
    fl.path = 'pub/flyers/' + (fl.which === SPECIAL ? 'special' : 'club');
    fl.list = []; fl.data = {}; fl.boardSig = '';
    barTitle();
    fl.layers = [h('img', 'flyer'), h('img', 'flyer')];
    fl.layers.forEach(function (l) { l.alt = ''; });
    fl.msg = h('div', 'flymsg');
    fl.board = h('div', 'lb');
    fl.cur = null; fl.top = 0; fl.rev = undefined; fl.boards = [];
    root.replaceChildren(h('div', 'tvflyers', [fl.layers[0], fl.layers[1], fl.board, fl.msg]));
    flyerMessage();
    loadFlyers();
    loadBoards();
    fl.timer = setInterval(nextFlyer, SLIDE_MS);
  }
  function stopFlyers() { clearInterval(fl.timer); fl.timer = null; fl.layers = []; fl.msg = null; fl.board = null; }
  function readyFlyers() { return fl.list.filter(function (f) { return /^data:image\//.test(fl.data[f.id] || ''); }); }
  // Everything the slideshow goes through: the uploaded flyers in their order, then the leaderboards.
  function slides() {
    var ids = readyFlyers().map(function (f) { return f.id; });
    if (fl.boards.length) ids.push(BOARDS);
    return ids;
  }
  // This month's top three of every social, from the nights that have ended. Read again every minute, so the
  // slide is up to date shortly after a social finishes.
  function loadBoards() {
    if (st.mode !== 'flyers' || fl.which !== FLYERS) return;       // the leaderboards belong to the club's slideshow
    var month = E.localDate(new Date()).slice(0, 7);
    S.get('pub/series').then(function (series) {
      series = series || {};
      var ids = Object.keys(series).sort(function (a, b) { return (series[a].name || '') < (series[b].name || '') ? -1 : 1; });
      return Promise.all(ids.map(function (id) { return S.get('pub/results/' + id + '/' + month).catch(function () { return null; }); })).then(function (all) {
        if (st.mode !== 'flyers' || fl.which !== FLYERS) return;
        st.series = series;
        var list = [];
        ids.forEach(function (id, i) {
          var docs = {};
          Object.keys(all[i] || {}).forEach(function (k) { var d = all[i][k]; if (d && d.status === 'ended' && d.entries) docs[k] = d; });
          var rows = E.monthlyBoard(docs).filter(function (r) { return r.points > 0; }).slice(0, 3);
          if (rows.length) list.push({ id: id, name: series[id].name || '', format: FORMATS[series[id].format] || '', look: series[id].look || null, nights: Object.keys(docs).length, rows: rows });
        });
        var sig = JSON.stringify(list.map(function (b) { return [b.id, b.name, b.nights, b.look && b.look.rev, b.rows.map(function (r) { return [r.name, r.points]; })]; }));
        var changed = sig !== fl.boardSig || month !== fl.month;
        fl.boards = list; fl.month = month; fl.boardSig = sig;
        if (fl.cur === BOARDS && !list.length) nextFlyer();
        else if (fl.cur === BOARDS && changed) drawBoards();
        else if (fl.cur === null) nextFlyer();
        flyerMessage();
      });
    }).catch(function () { /* tried again in a minute */ });
  }
  function drawBoards() {
    if (!fl.board) return;
    var n = fl.boards.length, cols = n <= 3 ? n : n === 4 ? 2 : n <= 6 || n === 9 ? 3 : 4, rowsN = Math.ceil(n / cols);
    var k = rowsN === 1 ? [1.3, 1.15, 0.9][cols - 1] : rowsN === 2 ? (cols <= 2 ? 0.95 : cols === 3 ? 0.86 : 0.72) : (cols <= 3 ? 0.62 : 0.55);
    var mName = MONTHS[Number(fl.month.slice(5, 7)) - 1] || '';
    var grid = h('div', 'lbgrid', fl.boards.map(function (b) {
      var head = h('div', 'lbname', [h('b', null, b.name), h('span', null, b.format + (b.format ? ' \u00b7 ' : '') + b.nights + (b.nights === 1 ? ' night' : ' nights'))]);
      if (b.look && (b.look.wide || b.look.tall)) L.paint(head, b.look);
      var card = h('div', 'lbcard', [head, h('div', 'lbrows', b.rows.map(function (r, i) {
        return h('div', 'lbrow', [h('span', 'md', MEDALS[i]), h('span', 'nm', r.name), h('span', 'pt', [String(r.points), h('small', null, 'pts')])]);
      }))]);
      card.setAttribute('data-board', b.id);
      return card;
    }));
    grid.style.setProperty('--cols', String(cols)); grid.style.setProperty('--k', String(k));
    var p = h('img', 'p'), w = h('img', 'w');
    p.src = S.asset('logo-p.png'); p.alt = ''; w.src = S.asset('conquer-wordmark-white.png'); w.alt = 'Conquer Padel Club';
    fl.board.replaceChildren(h('div', 'lbhead', [p, h('div', 't', [h('h1', null, mName + ' leaderboards'), h('span', null, 'Top three of every social')]), w]), grid);
    // long names are made a little smaller rather than cut off
    Array.prototype.forEach.call(fl.board.querySelectorAll('.lbname b, .lbrow .nm'), function (el) {
      var size = parseFloat(getComputedStyle(el).fontSize), min = size * 0.6, guard = 0;
      while (el.scrollWidth > el.clientWidth + 1 && size > min && guard++ < 20) { size *= 0.95; el.style.fontSize = size + 'px'; }
    });
  }
  // Checks the list (a small number first, so nothing heavy is fetched unless something changed), then
  // fetches the pictures it does not have yet, one at a time.
  function loadFlyers() {
    if (fl.loading || st.mode !== 'flyers') return;
    fl.loading = true;
    var path = fl.path;
    S.get(path + '/rev').then(function (rev) {
      if (path !== fl.path) return null;
      st.lastOk = Date.now();
      rev = rev || 0;
      if (rev === fl.rev) return null;
      return S.get(path + '/index').then(function (idx) {
        if (path !== fl.path) return null;
        idx = idx || {};
        fl.list = Object.keys(idx).map(function (id) { return { id: id, order: Number(idx[id].order) || 0 }; })
          .sort(function (a, b) { return a.order - b.order || (a.id < b.id ? -1 : 1); });
        Object.keys(fl.data).forEach(function (id) { if (!idx[id]) delete fl.data[id]; });
        fl.rev = rev;
        if (fl.cur && fl.cur !== BOARDS && !idx[fl.cur]) nextFlyer();   // the flyer on screen was removed
        flyerMessage();
        return fetchFlyers();
      });
    }).catch(function () { /* tried again in half a minute */ }).then(function () { fl.loading = false; flyerMessage(); });
  }
  function fetchFlyers() {
    var next = fl.list.filter(function (f) { return fl.data[f.id] === undefined; })[0];
    if (!next || st.mode !== 'flyers') return null;
    var path = fl.path;
    return S.get(path + '/data/' + next.id).then(function (d) {
      if (path !== fl.path) return null;
      fl.data[next.id] = typeof d === 'string' ? d : '';
      // the first flyer goes up as soon as it arrives, also when only the leaderboards were showing until now
      if (fl.cur === null || (fl.cur === BOARDS && readyFlyers().length === 1)) nextFlyer();
      return fetchFlyers();
    });
  }
  function nextFlyer() {
    if (st.mode !== 'flyers') return;
    var ids = slides(), at = ids.indexOf(fl.cur);
    flyerMessage();
    if (!ids.length) { fl.layers.forEach(function (l) { l.classList.remove('on'); }); fl.board.classList.remove('on'); fl.cur = null; return; }
    var nxt = ids[(at + 1) % ids.length];
    if (nxt === fl.cur) return;                                    // only one slide: it simply stays
    if (nxt === BOARDS) {
      drawBoards();
      fl.board.classList.add('on');
      fl.layers.forEach(function (l) { l.classList.remove('on'); });
      fl.cur = BOARDS;
      return;
    }
    fl.top = 1 - fl.top;
    var layer = fl.layers[fl.top], other = fl.layers[1 - fl.top], board = fl.board;
    layer.onload = function () { layer.classList.add('on'); other.classList.remove('on'); if (board) board.classList.remove('on'); };
    layer.setAttribute('data-id', nxt);
    layer.src = fl.data[nxt];
    fl.cur = nxt;
  }
  function flyerMessage() {
    if (!fl.msg) return;
    var ready = slides().length, wait = fl.rev === undefined || (fl.list.length && !ready);
    if (ready) { fl.msg.replaceChildren(); fl.msg.hidden = true; return; }
    fl.msg.hidden = false;
    var key = wait ? 'wait' : 'none';
    if (fl.msg.getAttribute('data-k') === key) return;
    fl.msg.setAttribute('data-k', key);
    var special = fl.which === SPECIAL, qr = wait ? null : qrSvg(S.here('flyers', special ? { set: 'special' } : {}));
    fl.msg.replaceChildren(h('h1', null, wait ? 'Loading the flyers…' : special ? 'No special event flyers yet' : 'No flyers yet'),
      wait ? null : h('p', null, 'Add photos from the club iPad, a phone or a computer: open Events, then ' + (special ? 'Special event flyers' : 'Club flyers') + '. Or scan this code.'),
      qr ? h('div', 'qrbox', qr) : null);
  }
  function poll() {
    if (st.busy || document.hidden || st.mode !== 'show') return;
    st.busy = true;
    var id = st.seriesId;
    S.get('pub/live/' + id).then(function (live) {
      st.lastOk = Date.now();
      if (id !== st.seriesId) return null;
      if (!live || !live.sessionId) {
        if (st.session || !st.shown) { st.session = null; st.saved = null; st.rev = null; st.pending = {}; st.shown = true; return loadMonth(E.localDate(new Date()).slice(0, 7)).then(function () { if (id === st.seriesId) draw(); }); }
        return null;
      }
      var ping = live.ping || 0;
      var needSession = live.rev !== st.rev || !st.saved || !st.shown;
      if (!needSession && ping === st.ping) return null;
      // st.saved is the night as the organizer's device last saved it; st.session is what is shown: the saved night
      // plus every score the phones have sent since, and the rounds that follow from them (no device has to be open
      // for the next round to start: see withPlayerScores in engine.js).
      var getSession = needSession ? S.get('pub/sessions/' + id + '/' + live.sessionId).then(E.normalize) : Promise.resolve(st.saved);
      return getSession.then(function (s) {
        if (!s || id !== st.seriesId) return null;
        var getScores = s.status === 'live' && E.currentRound(s) ? S.get('pub/scores/' + id + '/' + s.id).catch(function () { return null; }) : Promise.resolve(null);
        return getScores.then(function (scores) {
          return loadMonth(s.month).then(function () {
            if (id !== st.seriesId) return;
            var now = E.withPlayerScores(s, scores), before = st.session;
            st.phoneAt = 0;
            Object.keys(scores || {}).forEach(function (r) { Object.keys(scores[r] || {}).forEach(function (c) { var at = Number((scores[r][c] || {}).at) || 0; if (at > st.phoneAt) st.phoneAt = at; }); });
            st.saved = s; st.rev = live.rev; st.ping = ping; st.pending = {}; st.shown = true;
            // The last score of a round and the round after it arrive together. Show the finished round first, so its
            // winner gets the crown and the fireworks, and then move on (draw waits for the celebration to end).
            var was = before && !before.discarded && before.id === now.id && before.status === 'live' ? E.currentRound(before) : null;
            var cur = now.status === 'live' ? E.currentRound(now) : null;
            clearTimeout(st.nextTimer);
            if (was && cur && cur.n === was.n + 1 && !E.roundComplete(was) && E.roundComplete(now.rounds[was.n - 1])) {
              var finished = E.normalize(E.clone(now));
              finished.rounds = finished.rounds.slice(0, was.n);
              st.session = finished;
              draw();
              st.session = now;
              st.nextTimer = setTimeout(draw, 400);
            } else { st.session = now; draw(); }
          });
        });
      });
    }).catch(function () { /* shown as "reconnecting" by the status line */ })
      .then(function () { st.busy = false; status(); });
  }
  function loadMonth(monthKey) {
    if (!st.seriesId) return Promise.resolve();
    // the players' WPR Social ratings come along with the results (they change rarely)
    return Promise.all([S.get('pub/results/' + st.seriesId + '/' + monthKey), S.get('pub/ratings').catch(function () { return st.ratings; })]).then(function (got) {
      st.month = got[0] || {}; st.monthKey = monthKey; st.ratings = got[1] || {};
    });
  }
  // "Carter (4.37) & Casey (NR)": each player's WPR Social rating after their name, NR when there is none.
  function rated(row) {
    var players = row.players && row.players.length ? row.players : [row.name], out = [];
    // on a portrait screen the boards are narrow: a team goes on two lines, broken after the "&" and nowhere else
    var tall = window.innerHeight > window.innerWidth;
    players.forEach(function (p, i) {
      var r = (st.ratings || {})[E.keyOf(p)], has = !!r && typeof r.s === 'number';
      if (i) out.push(tall ? '\u00a0& ' : ' & ');
      out.push(tall ? p.replace(/ /g, '\u00a0') : p, h('span', 'rt' + (has ? '' : ' nr'), '(' + (has ? r.s.toFixed(2) : 'NR') + ')'));
    });
    return out;
  }
  function status() {
    var late = st.lastOk && Date.now() - st.lastOk > 10000;
    statusEl.textContent = late ? 'Reconnecting…' : '';
  }

  // ---------------------------------------------------------------- drawing
  function message(title, text) { return h('div', 'tvpick', [h('h1', null, title), h('p', null, text)]); }

  function draw() {
    if (st.mode !== 'show') return;
    barTitle();                                             // (the screen's colours are settled before anything is drawn)
    var s = st.session, left;
    // The next round is ready while the last winner is still being celebrated: let the crown land first.
    var cur0 = s && !s.discarded && s.status === 'live' ? E.currentRound(s) : null;
    if (cur0 && st.lastSession === s.id && st.lastRound && cur0.n > st.lastRound && (flyers.length || sparks.length)) {
      st.holdSince = st.holdSince || Date.now();
      if (Date.now() - st.holdSince < 4000) { clearTimeout(st.holdTimer); st.holdTimer = setTimeout(draw, 250); return; }
    }
    st.holdSince = 0;
    if (!s || s.discarded) left = bigLeft(E.dayWord(null, new Date()), st.seriesName, h('div', 'tvempty', 'The next night has not been set up yet.'));
    else if (s.status === 'setup') left = setupLeft(s);
    else if (s.status === 'ended') left = endedLeft(s);
    else left = liveLeft(s);
    if (!s || s.status !== 'live') st.pendingSince = 0;
    var parts = [left, rightSide(s)];
    // On a portrait screen the order is: the round and its courts, the leaderboards, and last, at the foot, the sign
    // (who sits out, what is coming up) with the QR code. The foot is the last part of the left-hand block.
    if (window.innerHeight > window.innerWidth && left.children.length === 3) {
      var foot = left.lastChild;
      left.removeChild(foot);
      left.classList.add('nofoot');
      if (foot.className || foot.childNodes.length) { foot.classList.add('tvfoot'); parts.push(foot); }
    }
    root.replaceChildren(h('div', 'tvroot', parts));
    fit();
    st.lastSession = s && !s.discarded ? s.id : ''; st.lastStatus = s && !s.discarded ? s.status : '';
    if (!s || s.discarded || s.status !== 'live' || !s.wheel) wheelEnd();
    if (st.spinShow) { var still = st.spinShow === 'still'; st.spinShow = false; st.announce = 0; wheelShow(s, still); }
    else if (st.announce) { roundIntro(st.announce, st.announceText); st.announce = 0; }
    // a score has just come in: fireworks around the winning team's name, and the crown dances its way onto it
    var cheer = st.cheer; st.cheer = [];
    cheer.forEach(function (c, n) {
      var el = document.querySelectorAll('.tvcourt')[c.idx];
      el = el && el.querySelector(c.side === 'a' ? '.tm.a' : '.tm.b');
      if (!el) return;
      var range = document.createRange(); range.selectNodeContents(el);
      var box = range.getBoundingClientRect();
      if (!box.width) return;
      fireworks(box.left + box.width / 2, box.top + box.height / 2, box.width);
      crownDance(c.idx, c.side, n);
    });
  }
  function head(title, flash, note) {
    // the event name lives in the top banner; this line carries the round and the set length (the clock is bottom left)
    var s = st.session, sets = note !== undefined ? note : s && !s.discarded && s.status !== 'ended' ? 'Sets to ' + (s.setTo || 4) : '';
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
  // A long name is made smaller until it fits the banner, never cut off.
  function fitTitle() {
    var b = document.getElementById('bartitle');
    if (!b) return;
    b.style.fontSize = '';
    var size = parseFloat(getComputedStyle(b).fontSize), min = size * 0.5, guard = 0;
    while (b.scrollWidth > b.clientWidth + 1 && size > min && guard++ < 30) { size *= 0.96; b.style.fontSize = size + 'px'; }
  }
  // Top banner: the social's name, and under it, small, the format it is played in.
  function barTitle() {
    var b = document.getElementById('bartitle'), sub = document.getElementById('barsub'), meta = st.series[st.seriesId] || {};
    if (b) {
      b.textContent = st.mode === 'menu' ? 'Main menu' : st.seriesName || '';
      b.classList.toggle('social', st.mode === 'show' && !!st.seriesName);     // a social's name gets the brush script
      fitTitle();
    }
    var fmt = st.mode === 'show' ? (FORMATS[meta.format] || '') : '';
    if (sub) sub.textContent = fmt ? fmt.charAt(0).toUpperCase() + fmt.slice(1).toLowerCase() : '';     // "Fixed partner, king's court"
    // a social with a flyer gets a banner in the flyer's colours; everything else keeps the club's own
    var look = st.mode === 'show' && meta.look && (meta.look.wide || meta.look.tall || meta.look.bar) ? meta.look : null;
    // (a strip of the flyer itself as the banner: its picture is fetched once per choice, and painted when it is here)
    var bandKey = look && look.band && !look.bar ? st.seriesId + ':' + (look.bandRev || 0) : '';
    if (bandKey !== (st.bandKey || '')) {
      st.bandKey = bandKey; st.bandPic = null;
      if (bandKey) S.get('pub/eventflyers/' + st.seriesId + '/band').then(function (d) { if (st.bandKey === bandKey && typeof d === 'string') { st.bandPic = d; st.barSig = null; barTitle(); } }).catch(function () { st.bandKey = ''; });
    }
    var sig = look ? JSON.stringify([look.cands, look.variant, look.pattern, look.bar, look.barInk, bandKey, !!st.bandPic, look.bandInk]) : '';
    if (sig !== st.barSig) { st.barSig = sig; L.paint(document.getElementById('tvbar'), look, st.bandPic); }
    barLogos(look);
    return applyTheme(look ? L.theme(look) : null);        // true when the screen's colours have just changed
  }
  // A social can bring its own logos for the two ends of the banner (Flyer and look, on the organizer's device):
  // they take the place of the club's, on that social's screen only. An end without one stays empty.
  function barLogos(look) {
    var own = !!(look && look.bar && (look.logoL || look.logoR)), key = own ? st.seriesId + ':' + (look.logoRev || 0) : '';
    if (key === (st.logoKey || '')) return;
    st.logoKey = key;
    var imgs = [document.querySelector('.tvbar-l img'), document.querySelector('.tvbar-r img')];
    if (!imgs[0] || !imgs[1]) return;
    if (!st.logo0) st.logo0 = imgs.map(function (im) { return im.getAttribute('src'); });
    var back = function () { imgs.forEach(function (im, i) { im.src = st.logo0[i]; im.style.visibility = ''; im.hidden = false; }); };
    if (!own) return back();
    var id = st.seriesId;
    imgs.forEach(function (im) { im.style.visibility = 'hidden'; });
    Promise.all(['logoL', 'logoR'].map(function (k) { return look[k] ? S.get('pub/eventflyers/' + id + '/' + k).catch(function () { return null; }) : Promise.resolve(null); })).then(function (got) {
      if (st.logoKey !== key) return;
      got.forEach(function (data, i) {
        var ok = typeof data === 'string' && /^data:image\//.test(data);
        if (ok) { imgs[i].src = data; imgs[i].hidden = false; }
        imgs[i].style.visibility = ok ? '' : 'hidden';
      });
    }).catch(function () { st.logoKey = ''; });
  }
  // A social can ask for the whole screen in tones of its flyer's colour (Flyer and look, on the organizer's device).
  var THEME_VARS = ['bg', 'blob1', 'blob2', 'panel', 'deep', 'main', 'mid', 'pale', 'soft', 'ink', 'dim'];
  function applyTheme(th) {
    var sig = th ? JSON.stringify(th) : '';
    if (sig === (st.themeSig || '')) return false;
    st.themeSig = sig; st.theme = th;
    document.body.classList.toggle('themed', !!th);
    THEME_VARS.forEach(function (k) { if (th) document.body.style.setProperty('--t-' + k, th[k]); else document.body.style.removeProperty('--t-' + k); });
    return true;
  }
  function bigLeft(title, sub, body) { return h('div', 'tvleft', [head(title, false), h('div', 'tvbig', body), h('div')]); }

  function setupLeft(s) {
    var teams = E.activeTeams(s);
    if (E.isWheel(s)) {                                   // everyone who has checked in goes on the wheel
      var plan = E.wheelPlan(teams.length), idle = h('div', 'wheelidle');
      st.spinKey = '';                                    // the next spin is a first spin again (also after a restart)
      idle.innerHTML = wheelSvg(teams.map(function (t) { return t.name; }), 'l');
      idle.firstChild.style.animationDelay = -(Date.now() % 90000) + 'ms';      // keeps turning smoothly when a name is added
      return h('div', 'tvleft', [head('Today', false, ''),
        h('div', 'tvwheel', [idle, h('div', 'txt', [
          h('div', 'ttl', teams.length ? teams.length + (teams.length === 1 ? ' player' : ' players') + ' checked in' : 'Starting soon'),
          h('div', 'how', plan ? plan.text : 'The wheel picks your partner. It spins when at least four players are here.')])]),
        s.courts.length ? h('div', 'tvsit', [h('div', 'lab', s.courts.length === 1 ? 'Court' : 'Courts'), h('div', 'names', s.courts.join(' · '))]) : h('div')]);
    }
    return h('div', 'tvleft', [head(E.dayWord(s, new Date()), false),
      h('div', 'tvbig', teams.length ? [h('div', 'ttl', teams.length + ' ' + E.formatOf(s).units + ' checked in'), h('div', 'teams', teams.map(function (t) { return h('div', null, t.name); }))]
        : h('div', 'ttl', 'Starting soon')),
      s.courts.length ? h('div', 'tvsit', [h('div', 'lab', 'Courts'), h('div', 'names', s.courts.join(' · ') + '   (court ' + s.courts[s.courts.length - 1] + ' is King’s Court)')]) : h('div')]);
  }
  function liveLeft(s) {
    var r = E.currentRound(s);
    if (!r) return bigLeft(E.dayWord(s, new Date()), '', h('div', 'ttl', 'Starting soon'));
    var flash = r.n !== st.lastRound;
    // A new round this screen watched arrive (the one before it, or the night being set up) gets the full-screen
    // announcement. Opening the page in the middle of a round does not.
    if (flash && ((st.lastSession === s.id && st.lastRound && r.n === st.lastRound + 1) || (st.lastSession === s.id && st.lastStatus === 'setup' && r.n === 1))) st.announce = r.n;
    st.lastRound = r.n;
    // Wheel of Fortune: a spin this screen watched happen gets the two wheels instead of the round announcement
    var wheel = E.isWheel(s), wst = wheel ? E.wheelState(s) : 'none', spinKey = wheel && s.wheel ? s.id + ':' + s.wheel.spin : '';
    if (wheel) {
      var held = !!(s.wheel && s.wheel.hold);
      if (spinKey && spinKey !== st.spinKey && st.lastSession === s.id) st.spinShow = true;
      else if (held && !ws.el) st.spinShow = 'still';        // a TV switched on while the pairs are up: show them, without the spin
      else if (!held && ws.el && ws.key === spinKey) wheelLeave();      // the organizer has sent the TV on to the courts
      st.spinKey = spinKey;
      st.announceText = INTRO_WORDS[r.stage] ? INTRO_WORDS[r.stage] : [r.stage === 'set' ? 'Set' : s.wheel && s.wheel.respin ? 'Round' : 'Pool round', String(r.n - (s.wheel ? s.wheel.start : 0))];
    } else st.announceText = null;
    var top = r.top !== undefined && r.top !== null ? r.top : s.courts.length - 1;
    // scores sent from phones that the organizer's device has not applied yet: shown at once, in green
    var sent = {};
    E.pendingPlayerScores(s, r.n, st.pending).forEach(function (p) { sent[p.idx] = p; });
    var anySent = false;
    var roundKey = s.id + ':' + r.n;
    // the crown sits in its own little box so it can be hidden while its double dances around the screen
    var crown = function (i) { return h('span', 'crown' + (st.fly[roundKey + ':' + i] ? ' away' : ''), CROWN); };
    var courts = r.courts.map(function (c, i) {
      var done = !!c.w && !c.void, p = !done && !c.void ? sent[i] : null;
      if (p) anySent = true;
      var sa = done ? c.sa : p ? p.sa : null, sb = done ? c.sb : p ? p.sb : null, w = done ? c.w : p ? p.w : null;
      var has = done || !!p;
      // green behind the names once the score is in, so it is easy to see which courts are still missing
      var king = wheel ? E.isKingsCourt(s, r, c) : c.level === top;
      var label = wheel ? (c.label || (c.wait && !has ? 'Next on' : 'Court')) : king ? 'King’s Court' : 'Court';
      var sideA = side(c, 'a', has && w === 'a' ? crown(i) : null, false), sideB = side(c, 'b', has && w === 'b' ? crown(i) : null, true);
      return h('div', 'tvcourt' + (king ? ' king' : '') + (has ? ' done' : '') + (c.wait && !has ? ' wait' : ''), [
        h('div', 'cn', [h('span', wheel ? 'lbl' : null, label), h('b', null, String(c.court))]),
        h('div', 'tm a' + (sideA.pair ? ' pair' : '') + (has && w === 'b' ? ' lost' : ''), sideA.kids),
        c.void ? h('div', 'mid', 'no match') : has ? h('div', 'mid score', sa + ' – ' + sb) : h('div', 'mid', 'vs'),
        h('div', 'tm b' + (sideB.pair ? ' pair' : '') + (has && w === 'a' ? ' lost' : ''), sideB.kids)
      ]);
    });
    st.pendingSince = anySent ? (st.pendingSince || Date.now()) : 0;
    // Which courts got their score since the last look? Nothing is celebrated on the first look at a round,
    // so reloading the page or joining mid-round does not set off every court at once.
    var first = st.seenKey !== roundKey;
    if (first) { st.seenKey = roundKey; st.seen = {}; st.fly = {}; }
    r.courts.forEach(function (c, i) {
      var done = !!c.w && !c.void, p = !done && !c.void ? sent[i] : null, w = done ? c.w : p ? p.w : null;
      if (w && !st.seen[i] && !first) st.cheer.push({ idx: i, side: w });
      st.seen[i] = !!w;
    });
    var waiting = E.activeTeams(s).filter(function (t) { return r.sitting.indexOf(t.id) < 0 && !r.courts.some(function (c) { return !!E.sideOf(c, t.id); }); });
    // keep each team's name on one line, let the list wrap between teams
    var keep = function (txt) { return txt.replace(/ /g, ' '); };
    var names = r.sitting.map(function (id) { return keep(name(id)); }).concat(waiting.map(function (t) { return keep(t.name + ' (next round)'); })).join('  ·  ');
    // players scan this to enter their own court's score from their phone
    var qr = qrSvg(S.link('player', { s: st.seriesId }));
    var title = !wheel ? 'Round ' + r.n : wst === 'spin' ? 'Wheel time!' : wst === 'done' ? 'All matches played' : r.title || 'Round ' + r.n;
    var note = !wheel ? undefined : wst === 'spin' ? 'New partners next' : wst === 'done' ? '' : 'Sets to ' + E.roundSetTo(s, r);
    return h('div', 'tvleft', [head(title, flash, note), h('div', 'tvcourts', courts),
      h('div', 'tvbottom', [
        signBox(roundKey, names),
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
    // a daytime social: "today", "2 days" (by when it started; before the start, by the clock)
    var byDay = s && !s.discarded ? E.isDaytime(s, s.status === 'setup' ? new Date() : null) : E.isDaytime(null, new Date());
    return h('div', 'tvright', [
      board(byDay ? 'Today' : 'Tonight', tonight.length ? tonight.length + ' ' + unit : '', tonight, tonight.length, 'Waiting for ' + unit),
      board(mName, nights ? nights + (byDay ? (nights === 1 ? ' day' : ' days') : (nights === 1 ? ' night' : ' nights')) : '', month.slice(0, MONTH_ROWS), Math.min(month.length, MONTH_ROWS), 'No results yet this month')
    ]);
  }
  function board(title, sub, rows, count, empty) {
    // a long list goes in two columns. On a portrait screen the two boards stand side by side: a long one then gets
    // two thirds of the width (CSS: .tvboard.wide), which is room for its two columns.
    var two = rows.length > 16;
    var list = h('div', 'tvrows' + (two ? ' two' : ''), rows.map(function (r) {
      // gold, silver and bronze for places 1 to 3 once there are points; teams level on points share a medal
      var medal = r.points > 0 && r.rank <= 3 ? MEDALS[r.rank - 1] : '';
      return h('div', 'tvrow' + (r.rank === 1 && r.points > 0 ? ' lead' : ''), [h('span', 'md' + (medal && r.rank === 1 ? ' gold' : ''), medal), h('span', 'rk', String(r.rank)), h('span', 'nm', rated(r)), h('span', 'pt', String(r.points))]);
    }));
    if (two) list.style.gridTemplateRows = 'repeat(' + Math.ceil(rows.length / 2) + ', minmax(0, 1fr))';
    list.setAttribute('data-per', String(two ? Math.ceil(rows.length / 2) : Math.max(rows.length, 1)));
    var box = h('div', 'tvboard' + (two ? ' wide' : ''), [h('h2', null, [title, h('small', null, sub)]), rows.length ? list : h('div', 'tvempty', empty)]);
    box.style.flexGrow = String(Math.max(two ? Math.ceil(count / 2) : count, 4) + 1.6);
    return box;
  }
  // Size the text to the space each row actually has, whatever the number of teams or courts.
  function fit() {
    var vh = Math.min(window.innerWidth, window.innerHeight) / 100;
    Array.prototype.forEach.call(document.querySelectorAll('.tvrows'), function (list) {
      var per = Number(list.getAttribute('data-per')) || 1;
      var rowH = list.clientHeight / per;
      var size = Math.max(10, Math.min(rowH * 0.66, 4.8 * vh)), floor = size * 0.5, guard = 0;
      list.style.fontSize = size + 'px';
      // every name (with its ratings) has to show in full: make the whole list smaller until the longest one fits
      var names = list.querySelectorAll('.nm');
      var tight = function () {
        var worst = 1;
        Array.prototype.forEach.call(names, function (n) {
          if (n.scrollWidth > n.clientWidth + 1) worst = Math.min(worst, n.clientWidth / n.scrollWidth);
          if (n.scrollHeight > rowH + 1) worst = Math.min(worst, rowH / n.scrollHeight);       // a name on two lines (portrait) has to fit its row
        });
        return worst;
      };
      for (var w = tight(); w < 1 && size > floor && guard++ < 8; w = tight()) { size = Math.max(floor, size * Math.max(w, 0.8) * 0.985); list.style.fontSize = size + 'px'; }
    });
    // The check-in list before the night starts: however many names there are, they all fit under the heading.
    // Tried in two, three and four columns; the arrangement that allows the largest letters wins.
    var names = document.querySelector('.tvbig .teams');
    if (names && names.children.length) {
      var box = names.parentNode, ttl = box.querySelector('.ttl'), count = names.children.length, best = null;
      var room = box.clientHeight - (ttl ? ttl.offsetHeight : 0) - 2.4 * vh;
      [2, 3, 4].forEach(function (cols) {
        if (cols > 2 && count <= cols * 4) return;
        var rows = Math.ceil(count / cols), size = Math.min(4.2 * vh, room / rows / 1.5), guard = 0;
        names.style.gridTemplateColumns = 'repeat(' + cols + ', minmax(0, 1fr))';
        var set = function () { names.style.fontSize = size + 'px'; names.style.rowGap = (size * 0.22) + 'px'; };
        var cut = function () { return names.offsetHeight > room + 1 || Array.prototype.some.call(names.children, function (el) { return el.scrollWidth > el.clientWidth + 1; }); };
        for (set(); cut() && size > 1.5 * vh && guard++ < 40; set()) size *= 0.95;
        if (!best || size > best.size * 1.04) best = { cols: cols, size: size };
      });
      names.style.gridTemplateColumns = 'repeat(' + best.cols + ', minmax(0, 1fr))';
      names.style.fontSize = best.size + 'px'; names.style.rowGap = (best.size * 0.22) + 'px';
    }
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

  // ---------------------------------------------------------------- fireworks
  // A short show around a name: bursts one after another for about 3.2 seconds, each a flash and a ring of sparks
  // that fly out, fall and fade.
  var fx = document.getElementById('fx'), fxCtx = fx && fx.getContext ? fx.getContext('2d') : null;
  var sparks = [], flashes = [], fxOn = false, fxLast = 0;
  var FX_COLORS = ['#ffd54a', '#ffffff', '#f4b63f', '#ff7a59', '#7fe3ff', '#ff5fa2', '#b6ff6a'];
  var calm = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function fxSize() { if (fx) { fx.width = window.innerWidth; fx.height = window.innerHeight; } }
  function fireworks(x, y, width) {
    if (!fxCtx || calm) return;
    if (fx.width !== window.innerWidth || fx.height !== window.innerHeight) fxSize();
    var vh = Math.min(window.innerWidth, window.innerHeight) / 100;
    var spread = Math.max(width * 0.3, 6 * vh);
    boom(x, y, 80, 52 * vh, 0);                                          // the big one, right on the name
    boom(x - spread, y - 2 * vh, 36, 34 * vh, 160);                      // two smaller ones either side, a beat later
    boom(x + spread, y + 1 * vh, 36, 34 * vh, 300);
    boom(x + spread * 0.4, y - 5 * vh, 50, 44 * vh, 750);                // a second wave, a little higher and wider
    boom(x - spread * 1.5, y + 2 * vh, 36, 34 * vh, 1050);
    boom(x + spread * 1.5, y - 1 * vh, 36, 34 * vh, 1300);
    boom(x, y, 70, 50 * vh, 1650);                                       // and a last big one back on the name
  }
  function boom(cx, cy, count, power, delay) {
    if (!fxCtx || calm) return;
    if (fx.width !== window.innerWidth || fx.height !== window.innerHeight) fxSize();
    var vh = Math.min(window.innerWidth, window.innerHeight) / 100, now = performance.now();
    flashes.push({ x: cx, y: cy, t0: now + delay, life: 260, r: power * 0.2 });
    for (var i = 0; i < count; i++) {
      var a = Math.random() * Math.PI * 2, sp = power * (0.35 + Math.random() * 0.65);
      sparks.push({ x: cx, y: cy, px: cx, py: cy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - power * 0.12, t0: now + delay,
        life: 900 + Math.random() * 650, size: vh * (0.4 + Math.random() * 0.55), color: FX_COLORS[Math.floor(Math.random() * FX_COLORS.length)] });
    }
    if (!fxOn) { fxOn = true; fxLast = now; requestAnimationFrame(fxFrame); }
  }
  function fxFrame(now) {
    var dt = Math.min(0.05, (now - fxLast) / 1000); fxLast = now;
    var g = window.innerHeight * 0.55;                                    // sparks fall a little as they fade
    fxCtx.clearRect(0, 0, fx.width, fx.height);
    fxCtx.lineCap = 'round';
    flashes = flashes.filter(function (f) { return now - f.t0 < f.life; });
    flashes.forEach(function (f) {
      var t = (now - f.t0) / f.life;
      if (t < 0) return;
      fxCtx.globalAlpha = (1 - t) * 0.45;
      fxCtx.beginPath(); fxCtx.arc(f.x, f.y, f.r * (0.15 + t * 0.85), 0, Math.PI * 2);
      fxCtx.fillStyle = '#fff6cf'; fxCtx.fill();
    });
    sparks = sparks.filter(function (p) { return now - p.t0 < p.life; });
    sparks.forEach(function (p) {
      var age = now - p.t0;
      if (age < 0) return;
      var drag = Math.pow(0.06, dt);                                      // fast out of the burst, slowing quickly
      p.px = p.x; p.py = p.y;
      p.vx *= drag; p.vy = p.vy * drag + g * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
      var t = age / p.life;
      fxCtx.globalAlpha = t < 0.6 ? 1 : Math.max(0, 1 - (t - 0.6) / 0.4);
      fxCtx.strokeStyle = p.color; fxCtx.lineWidth = p.size * (1 - t * 0.5);
      fxCtx.beginPath(); fxCtx.moveTo(p.px, p.py); fxCtx.lineTo(p.x, p.y); fxCtx.stroke();
    });
    fxCtx.globalAlpha = 1;
    if (sparks.length || flashes.length) requestAnimationFrame(fxFrame);
    else { fxOn = false; fxCtx.clearRect(0, 0, fx.width, fx.height); }
  }
  window.addEventListener('resize', fxSize);
  fxSize();

  // ---------------------------------------------------------------- the sign under the courts
  // A still line that changes every 10 seconds. With nobody sitting out it goes through the club's next three
  // events: name, day and time, spots left. With players sitting out: their names for the first 30 seconds of
  // a round, then the three events (10 seconds each) and the names again for 10 seconds, over and over.
  // The events are read from pub/promo/{club}: the club's coming sessions from PlayByPoint. Beside each event is a
  // small QR code to its sign-up page (S.signupURL + the event's program id).
  var SIGN_FIRST = 30000, SIGN_SWAP = 10000, SIGN_NAMES = 10000, SIGN_EVENTS = 3;
  var sign = { el: null, lab: null, line: null, qr: null, round: '', since: 0, names: '', shown: '' };
  function loadPromo() {
    var id = st.seriesId, club = S.club.id;                   // each club's coming sessions are in its own part of the database
    S.get('pub/promo/' + club).then(function (p) { if (id === st.seriesId) { st.promo = p || null; signUpdate(); } }).catch(function () { /* next time */ });
  }
  function clock12(t) {
    var m = /^(\d{1,2}):(\d{2})/.exec(String(t || ''));
    if (!m) return '';
    var hh = Number(m[1]), mm = m[2];
    return ((hh + 11) % 12 + 1) + (mm === '00' ? '' : ':' + mm) + (hh < 12 ? ' AM' : ' PM');
  }
  function dayWord(date, now) {
    var d = new Date(date + 'T12:00:00'), today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12);
    var diff = Math.round((d - today) / 86400000);
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Tomorrow';
    if (diff > 1 && diff < 7) return DAYS[d.getDay()];
    return DAYS[d.getDay()] + ', ' + MONTHS[d.getMonth()] + ' ' + ordinal(d.getDate());
  }
  // The next three things to announce: sessions that have not started yet, one per program, and not the social
  // that is on this screen right now.
  function adItems() {
    var list = st.promo && st.promo.items, now = new Date(), out = [], seen = {};
    if (!list) return out;
    if (!Array.isArray(list)) list = Object.keys(list).map(function (k) { return list[k]; });
    // the daily job writes names URL-encoded (enc: 1) so that no character in a name can break what it sends
    var plain = function (x) { if (!st.promo.enc) return x; try { return decodeURIComponent(String(x).replace(/\+/g, ' ')); } catch (e) { return x; } };
    list = list.map(function (it) { return it && it.name ? { program: it.program, name: plain(it.name), date: it.date, start: it.start, end: it.end, count: it.count, cap: it.cap } : it; });
    var norm = function (x) { return String(x || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }, mine = norm(st.seriesName);
    list.filter(function (it) { return it && it.name && /^\d{4}-\d\d-\d\d$/.test(it.date || ''); }).map(function (it) {
      var m = /^(\d{1,2}):(\d{2})/.exec(it.start || '') || [0, 0, 0];
      return { it: it, at: new Date(Number(it.date.slice(0, 4)), Number(it.date.slice(5, 7)) - 1, Number(it.date.slice(8, 10)), Number(m[1]), Number(m[2])).getTime() };
    }).sort(function (a, b) { return a.at - b.at; }).forEach(function (x) {
      var it = x.it, key = it.program || norm(it.name), n = norm(it.name);
      if (out.length >= SIGN_EVENTS || x.at <= now.getTime() || seen[key]) return;
      if (mine && n && (n === mine || (mine.length >= 10 && n.indexOf(mine.slice(0, 10)) === 0) || (n.length >= 10 && mine.indexOf(n.slice(0, 10)) === 0))) return;
      seen[key] = true;
      var cap = Number(it.cap) || 0, left = cap - (Number(it.count) || 0);
      out.push({ name: it.name, when: dayWord(it.date, now) + ' · ' + clock12(it.start) + (it.end ? ' to ' + clock12(it.end) : ''),
        spots: !cap ? '' : left <= 0 ? 'Full' : left + (left === 1 ? ' spot left' : ' spots left'),
        url: S.signupURL && /^[A-Za-z0-9._~-]+$/.test(it.program || '') ? S.signupURL + it.program : '' });
    });
    return out;
  }
  // The box itself is made once and kept, so a redraw of the screen does not disturb it.
  function signBox(roundKey, names) {
    if (!sign.el) {
      sign.lab = h('div', 'lab'); sign.line = h('div', 'line'); sign.qr = h('div', 'sq');
      sign.el = h('div', 'tvsit sign', [sign.lab, sign.line, sign.qr]);
    }
    if (sign.round !== roundKey) { sign.round = roundKey; sign.since = Date.now(); }
    sign.names = names || '';
    sign.el.setAttribute('data-names', sign.names);
    setTimeout(signUpdate, 0);                                          // once it is on the page and has a width
    return sign.el;
  }
  // What the sign shows right now: { phase: 'wait' | 'ads' | 'none', idx: which event }
  function signState(ads) {
    var n = ads.length;
    if (!sign.names) return n ? { phase: 'ads', idx: Math.floor(Date.now() / SIGN_SWAP) % n } : { phase: 'none', idx: 0 };
    if (!n) return { phase: 'wait', idx: 0 };
    var t = Date.now() - sign.since;
    if (t < SIGN_FIRST) return { phase: 'wait', idx: 0 };
    var c = (t - SIGN_FIRST) % (n * SIGN_SWAP + SIGN_NAMES);
    return c < n * SIGN_SWAP ? { phase: 'ads', idx: Math.floor(c / SIGN_SWAP) } : { phase: 'wait', idx: 0 };
  }
  function signUpdate() {
    if (!sign.el || !sign.el.isConnected || st.mode !== 'show') return;
    var ads = adItems(), now = signState(ads), a = ads[now.idx], url = now.phase === 'ads' && a.url ? a.url : '';
    sign.el.className = 'tvsit sign ' + now.phase + (url ? ' hasqr' : '');      // first: the QR code takes room from the line
    var key = now.phase + '|' + (now.phase === 'wait' ? sign.names : now.phase === 'ads' ? JSON.stringify(a) : '') + '|' + sign.line.clientWidth;
    sign.el.setAttribute('data-phase', now.phase);
    sign.el.setAttribute('data-idx', String(now.idx));
    sign.el.setAttribute('data-ads', JSON.stringify(ads.map(function (x) { return [x.name, x.when, x.spots]; })));
    if (key === sign.shown) return;
    sign.shown = key;
    var code = url ? qrSvg(url, 1) : null;
    sign.qr.replaceChildren.apply(sign.qr, code ? [code, h('span', null, a.spots === 'Full' ? 'Details' : 'Sign up')] : []);
    if (!code) sign.el.classList.remove('hasqr');
    sign.lab.textContent = now.phase === 'wait' ? 'Sitting out this round' : now.phase === 'ads' ? 'Coming up at Conquer' : 'Everyone plays';
    var parts = now.phase === 'wait' ? [h('div', 'who', sign.names)]
      : now.phase === 'ads' ? [h('div', 'ev', a.name), h('div', 'det', [h('span', 'when', a.when), a.spots ? h('span', 'spots' + (a.spots === 'Full' ? ' full' : ''), a.spots) : null])] : [];
    sign.line.replaceChildren.apply(sign.line, parts);
    sign.line.classList.remove('swap'); void sign.line.offsetWidth; sign.line.classList.add('swap');      // a soft fade on every change
    // long text is made smaller until it fits on its line(s), never cut off
    Array.prototype.forEach.call(sign.line.children, function (el) {
      el.style.fontSize = '';
      // (a long list of people sitting out may get quite small: every name has to be there)
      var size = parseFloat(getComputedStyle(el).fontSize), min = size * (el.className === 'who' ? 0.36 : el.className === 'ev' ? 0.45 : 0.55), guard = 0;
      while ((el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 2) && size > min && guard++ < 40) { size *= 0.95; el.style.fontSize = size + 'px'; }
    });
  }
  setInterval(signUpdate, 1000);

  // ---------------------------------------------------------------- between rounds
  // The whole screen turns to the social's wide flyer for about six seconds. The new round's number makes an
  // entrance (three take turns), padel balls rain down, a ball with a face rolls in and delivers a padel pun,
  // and a racket smacks it off the screen. With no flyer uploaded the background is the banner's colour.
  var inter = document.getElementById('inter'), interTimers = [], INTRO_KINDS = ['slam', 'spin', 'smash'], INTRO_MS = 5500;
  var PUNS = [
    'Lob and behold!', 'No padel, no party.', 'Time to raise a racket.', 'Keep calm and bandeja on.', 'Wall you be my partner?',
    'New round, new excuses.', 'Net gains ahead.', 'Chiquita now, smash later.', 'Golden point energy!', 'Blame the racket. Everyone does.',
    'Winners go up. So do egos.', 'Por tres or it didn\u2019t happen.', 'Hit the ball, not your partner.', 'Less talking, more lobbing.',
    'Your partner believes in you. Sort of.', 'Vamos, vamos, VAMOS!', 'Smash first, apologise later.'
  ];
  // a padel ball as it looks on court: felt yellow, lit from the upper left, two curved seams
  var BUDDY = '<svg viewBox="0 0 100 100" aria-hidden="true"><defs>' +
    '<radialGradient id="bud" cx="34%" cy="28%" r="78%"><stop offset="0" stop-color="#f4ff8f"/><stop offset=".45" stop-color="#d9ee2a"/><stop offset=".85" stop-color="#a9c40a"/><stop offset="1" stop-color="#7f9600"/></radialGradient>' +
    '<radialGradient id="budshade" cx="70%" cy="78%" r="60%"><stop offset="0" stop-color="#000" stop-opacity=".22"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>' +
    '<clipPath id="budclip"><circle cx="50" cy="50" r="47"/></clipPath></defs>' +
    '<circle cx="50" cy="50" r="47" fill="url(#bud)"/>' +
    '<g clip-path="url(#budclip)" fill="none" stroke="#fbfde8" stroke-width="4.2" stroke-linecap="round" opacity=".95">' +
    '<path d="M-6 30C22 34 38 52 34 104"/><path d="M106 70C78 66 62 48 66 -4"/></g>' +
    '<circle cx="50" cy="50" r="47" fill="url(#budshade)"/><circle cx="50" cy="50" r="46.5" fill="none" stroke="#6f8400" stroke-opacity=".55" stroke-width="1"/></svg>';
  function racketSvg(colour) {
    var holes = '';
    [[32, 30], [50, 26], [68, 30], [26, 46], [42, 44], [58, 44], [74, 46], [30, 62], [50, 60], [70, 62], [38, 78], [62, 78], [50, 90]].forEach(function (p) { holes += '<circle cx="' + p[0] + '" cy="' + p[1] + '" r="3.6"/>'; });
    return '<svg viewBox="0 0 100 180" aria-hidden="true"><path d="M30 96L44 128H56L70 96Z" fill="#14202e"/><ellipse cx="50" cy="56" rx="42" ry="52" fill="' + colour + '" stroke="#14202e" stroke-width="6"/>' +
      '<g fill="#14202e" opacity=".55">' + holes + '</g><rect x="42" y="124" width="16" height="52" rx="6" fill="#14202e"/>' +
      '<path d="M42 136l16 6M42 148l16 6M42 160l16 6" stroke="#fff" stroke-width="2.5" opacity=".8"/></svg>';
  }
  function buildIntro() {
    if (!inter || inter.getAttribute('data-built')) return;
    inter.setAttribute('data-built', '1');
    var rain = h('div', 'rain'), spots = [6, 17, 29, 41, 52, 63, 74, 85, 94, 12, 58, 80];
    spots.forEach(function (left, i) {
      var b = h('i');
      b.style.left = left + 'vw'; b.style.width = b.style.height = (3 + (i * 7) % 4) + 'vmin';
      b.style.animationDelay = (0.5 + ((i * 5) % 12) * 0.27).toFixed(2) + 's'; b.style.animationDuration = (1.5 + (i % 4) * 0.25).toFixed(2) + 's';
      rain.appendChild(b);
    });
    var buddy = h('div', 'buddy', h('div', 'hop')), racket = h('div', 'racket');
    buddy.firstChild.innerHTML = BUDDY;
    inter.insertBefore(rain, inter.querySelector('.ball'));
    inter.appendChild(h('div', 'pun'));
    inter.appendChild(buddy);
    inter.appendChild(racket);
  }
  function endIntro() {
    interTimers.forEach(clearTimeout); interTimers = [];
    if (inter) { inter.hidden = true; inter.className = 'inter'; }
  }
  // The same pun on every TV for a given round, a different run of them every night.
  function punFor(n) {
    if (n === 1) return 'Let’s get this padel started!';
    var id = (st.session && st.session.id) || '', seed = 0;
    for (var i = 0; i < id.length; i++) seed = (seed * 31 + id.charCodeAt(i)) % 9973;
    return PUNS[(seed + n * 7) % PUNS.length];
  }
  // What the announcement says for the play-off rounds of a wheel day: a line above, and the big word.
  var INTRO_WORDS = { playin: ['4th v 5th', 'Play-in'], semi: ['Time for the', 'Semis'], final: ['Here comes the', 'Final'], place: ['Time for the', 'Medals'] };
  function roundIntro(n, text) {
    if (!inter) return;
    endIntro();
    buildIntro();
    var look = (st.series[st.seriesId] || {}).look, kind = INTRO_KINDS[n % INTRO_KINDS.length], has = look && (look.wide || look.tall);
    inter.style.backgroundColor = has ? L.banner(look).color : '';
    inter.querySelector('.word').textContent = text ? text[0] : 'Round';
    inter.querySelector('.num').textContent = text ? text[1] : String(n);
    inter.querySelector('.num').classList.toggle('text', !!text && !/^\d+$/.test(text[1]));
    inter.querySelector('.pun').textContent = punFor(n);
    inter.querySelector('.racket').innerHTML = racketSvg('#f3ead6');          // a cream racket, whatever the flyer's colours
    inter.hidden = false;
    void inter.offsetWidth;                                             // so the whole show plays again every time
    inter.className = 'inter on ' + kind + (st.flyer ? ' pic' : '');
    inter.setAttribute('data-round', String(n));
    interTimers.push(setTimeout(function () {
      inter.classList.add('out');
      interTimers.push(setTimeout(endIntro, 460));
    }, INTRO_MS));
  }

  // ---------------------------------------------------------------- the wheel of fortune
  // One wheel while players check in. When the organizer spins, two wheels fill the screen: half the players on
  // each. They spin, stop on a name each, and the two names under the pointers are partners; again and again
  // until everyone has one. Who is paired with whom was decided on the organizer's device (session.wheel).
  var WHEEL_COLOURS = [['#12508f', '#ffffff'], ['#f4b63f', '#0e2238'], ['#0a2f57', '#ffffff'], ['#f3ead6', '#0e2238'], ['#1f8a7a', '#ffffff'], ['#e2604a', '#ffffff']];
  function esc(t) { return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  // side 'l': a name reads outwards and stops under a pointer at 3 o'clock. side 'r': the mirror image, pointer at 9 o'clock.
  function wheelSvg(names, side) {
    var n = Math.max(names.length, 1), step = 360 / n, half = step / 2 * Math.PI / 180, flip = side === 'r', R = 100;
    var th = st.theme, cols = th ? th.wheel : WHEEL_COLOURS, dark = th ? th.ink : '#071a30';
    var out = ['<svg viewBox="-112 -112 224 224" aria-hidden="true"><circle r="111" fill="' + (th ? th.ink : '#0e2238') + '"/><circle r="108" fill="' + (th ? th.pale : '#f4b63f') + '"/><circle r="' + (R + 1.5) + '" fill="' + dark + '"/>'];
    var chord = n <= 2 ? 60 : 2 * 62 * Math.sin(half), fs0 = Math.min(19, chord * 0.6), room = 62, em = 0.37;
    for (var i = 0; i < n; i++) {
      var col = cols[i % cols.length];
      if (n > 1 && i === n - 1 && i % cols.length === 0) col = cols[3];      // never the same colour as its neighbour
      var x = R * Math.cos(half), y = R * Math.sin(half), turn = i * step + (flip ? 180 : 0);
      out.push(n === 1 ? '<circle r="' + R + '" fill="' + col[0] + '"/>'
        : '<path transform="rotate(' + turn.toFixed(3) + ')" d="M0 0L' + x.toFixed(3) + ' ' + (-y).toFixed(3) + 'A' + R + ' ' + R + ' 0 ' + (step > 180 ? 1 : 0) + ' 1 ' + x.toFixed(3) + ' ' + y.toFixed(3) + 'Z" fill="' + col[0] + '" stroke="' + dark + '" stroke-width=".8"/>');
      var label = String(names[i] || ''), floor = fs0 * 0.6, parts = label.split(' ');
      // a name too long for its slice, even in small letters, goes on as "Francisco G."
      if (label.length * floor * em > room * 1.2 && parts.length > 1) label = parts[0] + ' ' + parts[parts.length - 1].charAt(0) + '.';
      var fs = fs0, wide = label.length * fs * em, squeeze = '';
      if (wide > room) { fs = Math.max(floor, fs0 * room / wide); if (label.length * fs * em > room) squeeze = ' textLength="' + room + '" lengthAdjust="spacingAndGlyphs"'; }
      out.push('<text transform="rotate(' + (i * step).toFixed(3) + ')" x="' + (flip ? -94 : 94) + '" y="0" text-anchor="' + (flip ? 'start' : 'end') + '" dominant-baseline="central" font-size="' + fs.toFixed(2) + '" fill="' + col[1] + '"' + squeeze + '>' + esc(label) + '</text>');
    }
    for (var b = 0; b < 24; b++) out.push('<circle cx="' + (104.8 * Math.cos(b * Math.PI / 12)).toFixed(2) + '" cy="' + (104.8 * Math.sin(b * Math.PI / 12)).toFixed(2) + '" r="1.7" fill="' + (th ? th.mid : '#fffbe0') + '"/>');
    out.push('<circle r="17" fill="' + (th ? th.pale : '#f4b63f') + '" stroke="' + dark + '" stroke-width="1.2"/><circle r="9" fill="' + dark + '"/></svg>');
    return out.join('');
  }
  // The pairs stay on the screen until the organizer presses "Show the courts" (session.wheel.hold goes false).
  var ws = { el: null, timers: [], key: '', done: false };
  function wheelEnd() { if (!ws) return; ws.timers.forEach(clearTimeout); ws.timers = []; if (ws.el) { ws.el.remove(); ws.el = null; } ws.done = false; }
  function wheelLeave() {
    if (!ws.el || ws.el.classList.contains('out')) return;
    ws.timers.forEach(clearTimeout); ws.timers = [];
    ws.el.classList.add('out');
    ws.timers.push(setTimeout(wheelEnd, 500));
  }
  function holding() { var s = st.session; return !!(s && s.wheel && s.wheel.hold && s.id + ':' + s.wheel.spin === ws.key); }
  function wheelShow(s, still) {
    var w = s.wheel;
    if (!w || !w.left || !w.left.length || w.left.length !== (w.right || []).length) return;
    wheelEnd(); endIntro();
    var T = w.left.length, seed = 7;
    for (var i = 0; i < s.id.length; i++) seed = (seed * 31 + s.id.charCodeAt(i)) % 65521;
    seed = (seed + w.spin * 977) % 65521;
    var rnd = function () { seed = (seed * 75 + 74) % 65537; return seed / 65537; };
    var mix = function (list) { var a = list.slice(); for (var k = a.length - 1; k > 0; k--) { var j = Math.floor(rnd() * (k + 1)), t = a[k]; a[k] = a[j]; a[j] = t; } return a; };
    // the names sit around each wheel in a shuffled order, so nobody can read the pairs off before it stops
    var onL = mix(w.left), onR = mix(w.right), step = 360 / T;
    var third = function (i) { var tm = (w.teams || [])[i] || []; return tm.length > 2 ? tm.slice(2) : []; };
    var rotL = h('div', 'wrot'), rotR = h('div', 'wrot');
    rotL.innerHTML = wheelSvg(onL.map(name), 'l'); rotR.innerHTML = wheelSvg(onR.map(name), 'r');
    var nowA = h('div', 'a'), nowB = h('div', 'b'), now = h('div', 'wnow', [nowA, h('div', 'amp', '&'), nowB]), pairs = h('div', 'wpairs'), extra = h('div', 'wextra');
    ws.el = h('div', 'wheelshow', [
      h('div', 'wtitle', st.seriesName || 'Wheel of Fortune'),
      h('div', 'wsub', w.spin > 1 ? 'New partners!' : 'Who plays with whom?'),
      h('div', 'wstage', [h('div', 'wbox l', [rotL, h('i', 'wptr')]), h('div', 'wmid', now), h('div', 'wbox r', [rotR, h('i', 'wptr')])]),
      pairs, extra]);
    ws.key = s.id + ':' + w.spin;
    ws.el.setAttribute('data-spin', String(w.spin));
    ws.el.setAttribute('data-teams', String(T));
    document.body.appendChild(ws.el);
    var reveal = function (i) {
      nowA.textContent = name(w.left[i]); nowB.textContent = name(w.right[i]);
      now.classList.remove('pop'); void now.offsetWidth; now.classList.add('pop');
      var plus = third(i).map(name);
      pairs.appendChild(h('div', 'wpair', [name(w.left[i]) + ' & ' + name(w.right[i]), plus.length ? h('small', null, ' + ' + plus.join(' + ')) : null]));
      ws.el.setAttribute('data-shown', String(i + 1));
    };
    var finish = function (hold) {
      var sit = (w.sit || []).map(name).filter(Boolean), trio = [];
      for (var i = 0; i < T; i++) if (third(i).length) trio.push(third(i).map(name).join(' and ') + ' joins ' + name(w.left[i]) + ' & ' + name(w.right[i]) + ': they take turns resting');
      extra.textContent = (sit.length ? 'Sitting out: ' + sit.join(', ') : '') + (sit.length && trio.length ? '   ·   ' : '') + trio.join('   ·   ');
      ws.el.classList.add('all');
      ws.done = true;
      // an organizer's device that does not hold the screen (or has already let go): move on by itself
      ws.timers.push(setTimeout(function () { if (!holding()) wheelLeave(); }, hold));
    };
    if (calm || still) {
      for (var k = 0; k < T; k++) reveal(k);
      rotL.style.transitionDuration = rotR.style.transitionDuration = '0ms';
      rotL.style.transform = 'rotate(' + (-onL.indexOf(w.left[T - 1]) * step) + 'deg)'; rotR.style.transform = 'rotate(' + (-onR.indexOf(w.right[T - 1]) * step) + 'deg)';
      return finish(still ? 600 : 7000);
    }
    var quick = T > 5, first = 3200, spin = quick ? 1400 : 1800, hold = quick ? 900 : 1200, a = 0, b = 0, t = 500;
    var go = function (i) {
      var dur = i === 0 ? first : spin, turns = i === 0 ? 4 : 1, baseL = -onL.indexOf(w.left[i]) * step, baseR = -onR.indexOf(w.right[i]) * step;
      a = baseL + 360 * Math.ceil((a + turns * 360 - baseL) / 360);           // the left wheel turns clockwise, the right one the other way
      b = baseR + 360 * Math.floor((b - turns * 360 - baseR) / 360);
      rotL.style.transitionDuration = rotR.style.transitionDuration = dur + 'ms';
      rotL.style.transform = 'rotate(' + a + 'deg)'; rotR.style.transform = 'rotate(' + b + 'deg)';
      now.classList.remove('pop');
      ws.timers.push(setTimeout(function () { reveal(i); }, dur + 60));
    };
    for (var p = 0; p < T; p++) (function (p) {
      ws.timers.push(setTimeout(function () { go(p); }, t));
      t += (p === 0 ? first : spin) + hold;
    })(p);
    ws.timers.push(setTimeout(function () { finish(4200); }, t));
  }

  // ---------------------------------------------------------------- the dancing crown
  // When a score comes in, the winner's crown does a happy lap of the screen before it settles: it hops up from
  // the name, swings off the top edge, across the leaderboards, off the bottom edge, and drops back onto the name.
  // The real crown beside the name is hidden meanwhile (st.fly) and shown again, with a little pop, on landing.
  var FLY_MS = 3600, flyers = [], flyOn = false;
  function crownSpot(f) {
    if (st.seenKey !== f.round) return null;                              // the next round is already on screen
    var court = document.querySelectorAll('.tvcourt')[f.idx];
    var el = court && court.querySelector('.tm.' + f.side + ' .crown');
    var b = el && el.getBoundingClientRect();
    return b && b.width ? { x: b.left + b.width / 2, y: b.top + b.height / 2, el: el } : null;
  }
  function crownDance(idx, side, n) {
    if (calm) return;
    var f = { idx: idx, side: side, round: st.seenKey, key: st.seenKey + ':' + idx, t0: performance.now() + n * 280, flip: n % 2 === 1 };
    var spot = crownSpot(f);
    if (!spot || st.fly[f.key]) return;
    st.fly[f.key] = true;
    spot.el.classList.add('away');
    f.home = { x: spot.x, y: spot.y };
    f.el = h('div', 'crownfly', CROWN);
    f.el.style.fontSize = (parseFloat(getComputedStyle(spot.el).fontSize) || 40) + 'px';
    f.jx = (Math.random() - 0.5) * 0.08; f.jy = (Math.random() - 0.5) * 0.08;   // no two laps quite the same
    document.body.appendChild(f.el);
    flyers.push(f);
    placeCrown(f, f.t0);
    if (!flyOn) { flyOn = true; requestAnimationFrame(flyFrame); }
  }
  // A smooth curve through the stops of the lap (Catmull-Rom), u from 0 to 1.
  function along(pts, u) {
    var n = pts.length - 1, x = Math.max(0, Math.min(1, u)) * n, i = Math.min(n - 1, Math.floor(x)), t = x - i;
    var p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(n, i + 2)];
    var c = function (a, b, d, e) { return 0.5 * (2 * b + (d - a) * t + (2 * a - 5 * b + 4 * d - e) * t * t + (3 * b - a - 3 * d + e) * t * t * t); };
    return { x: c(p0.x, p1.x, p2.x, p3.x), y: c(p0.y, p1.y, p2.y, p3.y) };
  }
  function placeCrown(f, now) {
    var W = window.innerWidth, H = window.innerHeight, t = Math.max(0, Math.min(1, (now - f.t0) / FLY_MS));
    var spot = crownSpot(f);
    if (spot) f.home = { x: spot.x, y: spot.y }; else if (f.lostAt === undefined) f.lostAt = t;
    var T = f.home, X = function (v) { return (f.flip ? 0.94 - v : v) * W; };
    var pts = [T,
      { x: T.x + 0.07 * W, y: T.y - 0.20 * H },                           // a hop up off the name
      { x: X(0.56 + f.jx), y: -0.09 * H },                                // out over the top edge
      { x: X(0.88), y: (0.42 + f.jy) * H },                               // down across the leaderboards
      { x: X(0.58 - f.jx), y: 1.09 * H },                                 // out under the bottom edge
      { x: X(0.14), y: (0.58 - f.jy) * H },                               // back up the far side
      { x: T.x - 0.05 * W, y: T.y - 0.24 * H },                           // above the name...
      T];                                                                 // ...and down onto it
    var ease = t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t);
    var p = along(pts, 0.45 * t + 0.55 * ease);
    var swing = Math.min(1, t * 8, (1 - t) * 8);                          // the dance: starts and ends still
    var beat = Math.sin(t * Math.PI * 2 * 7);
    var turn = beat * 24 * swing, grow = 1 + 1.7 * Math.sin(Math.PI * t), bob = -Math.abs(beat) * 0.02 * H * swing;
    f.el.style.transform = 'translate3d(' + p.x.toFixed(1) + 'px,' + (p.y + bob).toFixed(1) + 'px,0) translate(-50%,-50%) rotate(' + turn.toFixed(1) + 'deg) scale(' + grow.toFixed(3) + ')';
    if (f.lostAt !== undefined) f.el.style.opacity = String(Math.max(0, 1 - (t - f.lostAt) / 0.12));   // its court has gone: fade away
    return t >= 1;
  }
  function flyFrame(now) {
    flyers = flyers.filter(function (f) {
      if (!placeCrown(f, now)) return true;
      f.el.remove();
      delete st.fly[f.key];
      var spot = crownSpot(f);
      if (spot) {                                                         // landed: show the real crown again, with a pop and a few sparks
        spot.el.classList.remove('away'); spot.el.classList.add('landed');
        boom(spot.x, spot.y, 22, 20 * Math.min(window.innerWidth, window.innerHeight) / 100, 0);
      }
      return false;
    });
    if (flyers.length) requestAnimationFrame(flyFrame); else flyOn = false;
  }

  // ---------------------------------------------------------------- full screen, keep-awake, clock
  // (on a turned screen it is the outer page that goes full screen, with the turned frame inside it)
  var fsDoc = document;
  if (turnedIn) { try { fsDoc = window.parent.document; } catch (e) { fsDoc = document; } }
  var canFull = !!(fsDoc.documentElement.requestFullscreen || fsDoc.documentElement.webkitRequestFullscreen);
  function isFull() { return !!(fsDoc.fullscreenElement || fsDoc.webkitFullscreenElement); }
  function toggleFull() {
    var el = fsDoc.documentElement, document = fsDoc;
    try {
      if (isFull()) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
      else {
        var p = (el.requestFullscreen || el.webkitRequestFullscreen).call(el);
        if (p && p.catch) p.catch(function () { /* the browser refused: its own full-screen option still works */ });
      }
    } catch (e) { /* not supported in this browser */ }
  }
  // The buttons stay visible (they never fade) until the page is in full screen: "Main menu" on the left,
  // "Full screen" on the right. While they are showing, the layout leaves a strip free at the bottom so they
  // never cover the leaderboard. Leaving full screen (the remote's Back button) brings them back.
  function buttons() {
    fsBtn.hidden = isFull() || !canFull;
    menuBtn.hidden = (isFull() && st.mode !== 'intro') || st.mode === 'menu' || st.mode === 'boot';      // (the slides keep a way back in full screen)
    turnBtn.hidden = isFull();
    document.body.classList.toggle('hasbtn', !fsBtn.hidden || !menuBtn.hidden || !turnBtn.hidden);
  }
  function fullChanged() {
    buttons();
    setTimeout(fit, 150);
    if (!isFull() && st.mode !== 'menu' && !fsBtn.hidden) fsBtn.focus();
  }
  fsBtn.addEventListener('click', toggleFull);
  turnBtn.addEventListener('click', turnScreen);
  menuBtn.addEventListener('click', function () { choose(MENU); });
  // A remote's arrow keys step through the buttons on screen; OK presses the one in focus.
  document.addEventListener('keydown', function (e) {
    // the intro slides: right / left (and OK, space, page keys) change the slide; down reaches the buttons below
    if (st.mode === 'intro' && !e.metaKey && !e.ctrlKey) {
      var onBtn = document.activeElement && document.activeElement.closest && document.activeElement.closest('.tvbtns');
      var next = e.key === 'ArrowRight' || e.key === 'PageDown' || ((e.key === 'Enter' || e.key === ' ') && !onBtn);
      var prev = e.key === 'ArrowLeft' || e.key === 'PageUp' || e.key === 'Backspace';
      if ((next || prev) && !(onBtn && /^Arrow/.test(e.key))) { introGo(next ? 1 : -1); e.preventDefault(); e.stopImmediatePropagation(); return; }
      if (e.key === 'ArrowUp' && onBtn) { var w = root.querySelector('.tvintro'); if (w) w.focus(); e.preventDefault(); return; }
    }
    if (!/^Arrow/.test(e.key || '')) return;
    var list = Array.prototype.filter.call(document.querySelectorAll('.tvmenu button, .tvbtns button'), function (b) { return !b.hidden; });
    if (!list.length) return;
    var at = list.indexOf(document.activeElement), fwd = e.key === 'ArrowDown' || e.key === 'ArrowRight';
    var to = at < 0 ? 0 : Math.max(0, Math.min(list.length - 1, at + (fwd ? 1 : -1)));
    list[to].focus();
    e.preventDefault();
  });
  fsDoc.addEventListener('fullscreenchange', fullChanged);
  fsDoc.addEventListener('webkitfullscreenchange', fullChanged);
  document.addEventListener('keydown', function (e) { if (e.metaKey || e.ctrlKey) return; if (e.key === 'f' || e.key === 'F') toggleFull(); else if ((e.key === 'm' || e.key === 'M') && st.mode !== 'menu') choose(MENU); });
  document.addEventListener('visibilitychange', function () { if (!document.hidden) tick(); });
  window.addEventListener('resize', function () { if (st.mode === 'show' && st.shown) draw(); else fit(); fitTitle(); });      // also when a screen is turned
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { fit(); fitTitle(); });
  setInterval(showDate, 1000);
  showDate();

  window.Awake.start();      // screen stays on for as long as this page is open
  fullChanged();
  start();
})();
