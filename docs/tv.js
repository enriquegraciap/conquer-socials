/* Padel Socials — TV display. Read-only: checks the database every 2 seconds and redraws when something changed.
 *
 * What a TV shows: one of the socials, the club flyers (a slideshow), or the main menu where you choose.
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
  var root = document.getElementById('tv'), statusEl = document.getElementById('status'), codeEl = document.getElementById('tvcode'), fsBtn = document.getElementById('fs'), menuBtn = document.getElementById('menu');
  var POLL_MS = 2000, MONTH_ROWS = 10;
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var CROWN = '\uD83D\uDC51';   // beside the winning team: after the name on the left side, before it on the right side
  var MEDALS = ['\uD83E\uDD47', '\uD83E\uDD48', '\uD83E\uDD49'];   // gold, silver, bronze
  var FLYERS = '@flyers', MENU = '@menu';      // the two things a TV can show that are not a social
  var FORMATS = { 'kings-fixed': 'Fixed partner, King\u2019s Court' };
  var q0 = new URLSearchParams(location.search);
  var fixed = q0.get('flyers') ? FLYERS : q0.get('s');

  var st = { id: tvId(), mode: 'boot', series: {}, seriesId: null, seriesName: '', rev: null, ping: 0, session: null, pending: {},
    month: null, monthKey: null, busy: false, lastOk: 0, lastRound: 0, shown: false, ticks: 0, pendingSince: 0, menuShown: '',
    seenKey: '', seen: {}, cheer: [], fly: {}, flyer: '', flyerKey: '', lastSession: '', lastStatus: '', holdSince: 0, announce: 0 };

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
      return fixed ? null : S.get('pub/screens/' + st.id).catch(function () { return null; });
    }).then(function (scr) {
      st.busy = false;
      takePairing(scr);
      var ids = Object.keys(st.series), choice = S.pref('tvShow') || '';
      var want = fixed && (fixed === FLYERS || st.series[fixed]) ? fixed
        : choice === FLYERS ? FLYERS
        : choice && choice !== MENU && st.series[choice] ? choice
        : choice !== MENU && ids.length === 1 ? ids[0] : null;
      if (want === FLYERS) { if (st.mode !== 'flyers') showFlyers(); }
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
    return true;
  }
  function tick() {
    if (document.hidden) return;
    st.ticks++;
    if (st.mode === 'show') { poll(); if (st.ticks % 15 === 0) refreshEvent(); }
    else if (st.mode === 'flyers') { if (st.ticks % 15 === 0) loadFlyers(); }
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
      st.series[id] = meta; st.seriesName = meta.name || ''; barTitle(); loadEventFlyer();
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
    if (mode !== 'show') { st.seriesId = null; st.seriesName = ''; st.session = null; st.pendingSince = 0; st.flyer = ''; st.flyerKey = ''; endIntro(); }
    document.body.classList.toggle('mode-flyers', mode === 'flyers');
    document.body.classList.toggle('mode-menu', mode === 'menu');
    buttons();
  }
  function show(id) {
    setMode('show');
    st.seriesId = id; st.seriesName = (st.series[id] || {}).name || '';
    st.rev = null; st.ping = 0; st.session = null; st.pending = {}; st.shown = false; st.lastRound = 0; st.pendingSince = 0;
    st.lastSession = ''; st.lastStatus = ''; st.holdSince = 0; st.flyerKey = ''; st.flyer = '';
    barTitle();
    loadEventFlyer();
    root.replaceChildren(message(st.seriesName, 'Loading…'));
    poll();
  }
  // Chosen on this TV with the remote: remembered on this TV until someone chooses again.
  function choose(what) {
    S.pref('tvShow', what);
    if (fixed) {                                  // the address no longer decides
      fixed = null;
      var q = new URLSearchParams(location.search); q.delete('s'); q.delete('flyers');
      var qs = q.toString();
      try { history.replaceState(null, '', location.pathname + (qs ? '?' + qs : '')); } catch (e) { /* fine */ }
    }
    if (what === MENU) { menu(); decide(); }
    else if (what === FLYERS) showFlyers();
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
    items.push(item(FLYERS, 'Club flyers', 'Slideshow, a new flyer every 15 seconds'));
    var qr = qrSvg(S.link('admin', { tv: st.id }));
    root.replaceChildren(h('div', 'tvmenu', [
      h('div', 'list', [h('h1', null, 'What should this screen show?'), h('div', 'items' + (items.length > 5 ? ' two' : ''), items)]),
      h('div', 'side', [
        qr ? h('div', 'qrbox', qr) : null,
        h('p', null, 'Or choose from the club iPad: scan this code, or open Events and add this TV by its code.'),
        h('div', 'code', st.id)
      ])
    ]));
    var again = had && root.querySelector('[data-pick="' + had + '"]');
    (again || items[0]).focus();
  }

  // ---------------------------------------------------------------- club flyers
  // A slideshow of the photos uploaded on the flyers page: each fills the screen, a new one every 15 seconds.
  var FLY_PATH = 'pub/flyers/club', SLIDE_MS = 15000;
  var fl = { rev: undefined, list: [], data: {}, cur: null, top: 0, timer: null, loading: false, layers: [], msg: null };
  function showFlyers() {
    setMode('flyers');
    barTitle();
    fl.layers = [h('img', 'flyer'), h('img', 'flyer')];
    fl.layers.forEach(function (l) { l.alt = ''; });
    fl.msg = h('div', 'flymsg');
    fl.cur = null; fl.top = 0; fl.rev = undefined;
    root.replaceChildren(h('div', 'tvflyers', [fl.layers[0], fl.layers[1], fl.msg]));
    flyerMessage();
    loadFlyers();
    fl.timer = setInterval(nextFlyer, SLIDE_MS);
  }
  function stopFlyers() { clearInterval(fl.timer); fl.timer = null; fl.layers = []; fl.msg = null; }
  function readyFlyers() { return fl.list.filter(function (f) { return /^data:image\//.test(fl.data[f.id] || ''); }); }
  // Checks the list (a small number first, so nothing heavy is fetched unless something changed), then
  // fetches the pictures it does not have yet, one at a time.
  function loadFlyers() {
    if (fl.loading || st.mode !== 'flyers') return;
    fl.loading = true;
    S.get(FLY_PATH + '/rev').then(function (rev) {
      st.lastOk = Date.now();
      rev = rev || 0;
      if (rev === fl.rev) return null;
      return S.get(FLY_PATH + '/index').then(function (idx) {
        idx = idx || {};
        fl.list = Object.keys(idx).map(function (id) { return { id: id, order: Number(idx[id].order) || 0 }; })
          .sort(function (a, b) { return a.order - b.order || (a.id < b.id ? -1 : 1); });
        Object.keys(fl.data).forEach(function (id) { if (!idx[id]) delete fl.data[id]; });
        fl.rev = rev;
        if (fl.cur && !idx[fl.cur]) nextFlyer();                   // the flyer on screen was removed
        flyerMessage();
        return fetchFlyers();
      });
    }).catch(function () { /* tried again in half a minute */ }).then(function () { fl.loading = false; flyerMessage(); });
  }
  function fetchFlyers() {
    var next = fl.list.filter(function (f) { return fl.data[f.id] === undefined; })[0];
    if (!next || st.mode !== 'flyers') return null;
    return S.get(FLY_PATH + '/data/' + next.id).then(function (d) {
      fl.data[next.id] = typeof d === 'string' ? d : '';
      if (fl.cur === null) nextFlyer();                            // the first one goes up as soon as it arrives
      return fetchFlyers();
    });
  }
  function nextFlyer() {
    if (st.mode !== 'flyers') return;
    var ready = readyFlyers(), at = -1;
    ready.forEach(function (f, i) { if (f.id === fl.cur) at = i; });
    flyerMessage();
    if (!ready.length) { fl.layers.forEach(function (l) { l.classList.remove('on'); }); fl.cur = null; return; }
    var nxt = ready[(at + 1) % ready.length];
    if (nxt.id === fl.cur) return;                                 // only one flyer: it simply stays
    fl.top = 1 - fl.top;
    var layer = fl.layers[fl.top], other = fl.layers[1 - fl.top];
    layer.onload = function () { layer.classList.add('on'); other.classList.remove('on'); };
    layer.setAttribute('data-id', nxt.id);
    layer.src = fl.data[nxt.id];
    fl.cur = nxt.id;
  }
  function flyerMessage() {
    if (!fl.msg) return;
    var ready = readyFlyers().length, wait = fl.rev === undefined || (fl.list.length && !ready);
    if (ready) { fl.msg.replaceChildren(); fl.msg.hidden = true; return; }
    fl.msg.hidden = false;
    var key = wait ? 'wait' : 'none';
    if (fl.msg.getAttribute('data-k') === key) return;
    fl.msg.setAttribute('data-k', key);
    var qr = wait ? null : qrSvg(S.link('flyers'));
    fl.msg.replaceChildren(h('h1', null, wait ? 'Loading the flyers…' : 'No flyers yet'),
      wait ? null : h('p', null, 'Add photos from the club iPad, a phone or a computer: open Events, then Club flyers. Or scan this code.'),
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
        if (st.session || !st.shown) { st.session = null; st.rev = null; st.pending = {}; st.shown = true; return loadMonth(E.localDate(new Date()).slice(0, 7)).then(function () { if (id === st.seriesId) draw(); }); }
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
    if (!st.seriesId) return Promise.resolve();
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
    if (st.mode !== 'show') return;
    var s = st.session, left;
    // The next round is ready while the last winner is still being celebrated: let the crown land first.
    var cur0 = s && !s.discarded && s.status === 'live' ? E.currentRound(s) : null;
    if (cur0 && st.lastSession === s.id && st.lastRound && cur0.n > st.lastRound && (flyers.length || sparks.length)) {
      st.holdSince = st.holdSince || Date.now();
      if (Date.now() - st.holdSince < 5000) { clearTimeout(st.holdTimer); st.holdTimer = setTimeout(draw, 250); return; }
    }
    st.holdSince = 0;
    if (!s || s.discarded) left = bigLeft('Tonight', st.seriesName, h('div', 'tvempty', 'The next night has not been set up yet.'));
    else if (s.status === 'setup') left = setupLeft(s);
    else if (s.status === 'ended') left = endedLeft(s);
    else left = liveLeft(s);
    if (!s || s.status !== 'live') st.pendingSince = 0;
    root.replaceChildren(h('div', 'tvroot', [left, rightSide(s)]));
    fit();
    st.lastSession = s && !s.discarded ? s.id : ''; st.lastStatus = s && !s.discarded ? s.status : '';
    if (st.announce) { roundIntro(st.announce); st.announce = 0; }
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
  // Top banner: the social's name, and under it, small, the format it is played in.
  function barTitle() {
    var b = document.getElementById('bartitle'), sub = document.getElementById('barsub'), meta = st.series[st.seriesId] || {};
    if (b) b.textContent = st.mode === 'menu' ? 'Main menu' : st.seriesName || '';
    if (sub) sub.textContent = st.mode === 'show' ? (FORMATS[meta.format] || '') : '';
    // a social with a flyer gets a banner in the flyer's colours; everything else keeps the club's own
    var look = st.mode === 'show' && meta.look && (meta.look.wide || meta.look.tall) ? meta.look : null;
    var sig = look ? JSON.stringify([look.cands, look.variant, look.pattern]) : '';
    if (sig !== st.barSig) { st.barSig = sig; L.paint(document.getElementById('tvbar'), look); }
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
    // A new round this screen watched arrive (the one before it, or the night being set up) gets the full-screen
    // announcement. Opening the page in the middle of a round does not.
    if (flash && ((st.lastSession === s.id && st.lastRound && r.n === st.lastRound + 1) || (st.lastSession === s.id && st.lastStatus === 'setup' && r.n === 1))) st.announce = r.n;
    st.lastRound = r.n;
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
      return h('div', 'tvcourt' + (c.level === top ? ' king' : '') + (has ? ' done' : ''), [
        h('div', 'cn', [h('span', null, c.level === top ? 'King’s Court' : 'Court'), h('b', null, String(c.court))]),
        h('div', 'tm a' + (has && w === 'b' ? ' lost' : ''), [name(c.a), has && w === 'a' ? ['\u00a0', crown(i)] : null]),
        c.void ? h('div', 'mid', 'no match') : has ? h('div', 'mid score', sa + ' – ' + sb) : h('div', 'mid', 'vs'),
        h('div', 'tm b' + (has && w === 'a' ? ' lost' : ''), [has && w === 'b' ? [crown(i), '\u00a0'] : null, name(c.b)])
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
    var waiting = E.activeTeams(s).filter(function (t) { return r.sitting.indexOf(t.id) < 0 && !r.courts.some(function (c) { return c.a === t.id || c.b === t.id; }); });
    // keep each team's name on one line, let the list wrap between teams
    var keep = function (txt) { return txt.replace(/ /g, ' '); };
    var names = r.sitting.map(function (id) { return keep(name(id)); }).concat(waiting.map(function (t) { return keep(t.name + ' (next round)'); })).join('  ·  ');
    // players scan this to enter their own court's score from their phone
    var qr = qrSvg(S.link('player', { s: st.seriesId }));
    return h('div', 'tvleft', [head('Round ' + r.n, flash), h('div', 'tvcourts', courts),
      h('div', 'tvbottom', [
        names ? h('div', 'tvsit', [h('div', 'lab', 'Sitting out this round'), h('div', 'names', names)]) : h('div', 'tvsit', [h('div', 'lab', 'Everyone plays'), h('div', 'names', '')]),
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
    var vh = window.innerHeight / 100;
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
    var vh = window.innerHeight / 100, now = performance.now();
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

  // ---------------------------------------------------------------- between rounds
  // The whole screen turns to the social's wide flyer for about three seconds and the new round's number makes an
  // entrance on top of it, a different one each round. With no flyer uploaded the background is the banner's colour.
  var inter = document.getElementById('inter'), interTimer = null, INTRO_KINDS = ['slam', 'spin', 'smash'];
  function endIntro() {
    clearTimeout(interTimer);
    if (inter) { inter.hidden = true; inter.className = 'inter'; }
  }
  function roundIntro(n) {
    if (!inter) return;
    clearTimeout(interTimer);
    var look = (st.series[st.seriesId] || {}).look, kind = INTRO_KINDS[n % INTRO_KINDS.length];
    inter.className = 'inter';
    inter.style.backgroundColor = look && (look.wide || look.tall) ? L.banner(look).color : '';
    inter.querySelector('.num').textContent = String(n);
    inter.hidden = false;
    void inter.offsetWidth;                                             // so the entrance plays again every time
    inter.className = 'inter on ' + kind + (st.flyer ? ' pic' : '');
    inter.setAttribute('data-round', String(n));
    var W = window.innerWidth, H = window.innerHeight, vh = H / 100;
    setTimeout(function () { if (!inter.hidden) { boom(W * 0.5, H * 0.56, 60, 50 * vh, 0); boom(W * 0.34, H * 0.4, 30, 34 * vh, 180); boom(W * 0.66, H * 0.42, 30, 34 * vh, 320); } }, kind === 'spin' ? 850 : 650);
    interTimer = setTimeout(function () {
      inter.classList.add('out');
      interTimer = setTimeout(endIntro, 460);
    }, 2700);
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
        boom(spot.x, spot.y, 22, 20 * window.innerHeight / 100, 0);
      }
      return false;
    });
    if (flyers.length) requestAnimationFrame(flyFrame); else flyOn = false;
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
  // The buttons stay visible (they never fade) until the page is in full screen: "Main menu" on the left,
  // "Full screen" on the right. While they are showing, the layout leaves a strip free at the bottom so they
  // never cover the leaderboard. Leaving full screen (the remote's Back button) brings them back.
  function buttons() {
    fsBtn.hidden = isFull() || !canFull;
    menuBtn.hidden = isFull() || st.mode === 'menu' || st.mode === 'boot';
    document.body.classList.toggle('hasbtn', !fsBtn.hidden || !menuBtn.hidden);
  }
  function fullChanged() {
    buttons();
    setTimeout(fit, 150);
    if (!isFull() && st.mode !== 'menu' && !fsBtn.hidden) fsBtn.focus();
  }
  fsBtn.addEventListener('click', toggleFull);
  menuBtn.addEventListener('click', function () { choose(MENU); });
  // A remote's arrow keys step through the buttons on screen; OK presses the one in focus.
  document.addEventListener('keydown', function (e) {
    if (!/^Arrow/.test(e.key || '')) return;
    var list = Array.prototype.filter.call(document.querySelectorAll('.tvmenu button, .tvbtns button'), function (b) { return !b.hidden; });
    if (!list.length) return;
    var at = list.indexOf(document.activeElement), fwd = e.key === 'ArrowDown' || e.key === 'ArrowRight';
    var to = at < 0 ? 0 : Math.max(0, Math.min(list.length - 1, at + (fwd ? 1 : -1)));
    list[to].focus();
    e.preventDefault();
  });
  document.addEventListener('fullscreenchange', fullChanged);
  document.addEventListener('webkitfullscreenchange', fullChanged);
  document.addEventListener('keydown', function (e) { if (e.metaKey || e.ctrlKey) return; if (e.key === 'f' || e.key === 'F') toggleFull(); else if ((e.key === 'm' || e.key === 'M') && st.mode !== 'menu') choose(MENU); });
  document.addEventListener('visibilitychange', function () { if (!document.hidden) tick(); });
  window.addEventListener('resize', fit);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(fit);
  setInterval(showDate, 1000);
  showDate();

  window.Awake.start();      // screen stays on for as long as this page is open
  fullChanged();
  start();
})();
