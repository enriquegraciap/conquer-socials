/* Padel Socials — players' phone page. A player picks their team once, then sees only their own court each
 * round and can send in its score. The score goes to a small, separate place in the database; the organizer's
 * device applies it to the night. No admin key is needed or used here.
 */
(function () {
  'use strict';
  var E = window.Engine, S = window.Store;
  var root = document.getElementById('app');
  var st = { seriesId: new URLSearchParams(location.search).get('s'), series: null, seriesName: '', rev: null, ping: 0, session: null, pending: {},
    me: null, form: null, changing: false, sending: false, error: '', loaded: false, busy: false, failed: false,
    role: null, askKey: false, keyInput: '', keyError: '', checking: false };

  function h(tag, attrs, kids) {
    var el = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v === null || v === undefined || v === false) return;
      if (k === 'class') el.className = v;
      else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    });
    var add = function (c) {
      if (c === null || c === undefined || c === false) return;
      if (Array.isArray(c)) { c.forEach(add); return; }
      el.appendChild(typeof c === 'object' ? c : document.createTextNode(String(c)));
    };
    add(kids);
    return el;
  }
  function teamName(id) { var t = st.session && st.session.teams[id]; return t ? t.name : ''; }
  function meKey() { return 'me.' + st.session.id; }

  // ---------------------------------------------------------------- data
  function boot() {
    if (!S.configured) { st.loaded = true; st.failed = true; return render(); }
    render();
    S.get('pub/series').then(function (list) {
      st.series = list || {};
      var ids = Object.keys(st.series);
      if (!st.seriesId || !st.series[st.seriesId]) st.seriesId = ids.length === 1 ? ids[0] : null;
      if (st.seriesId) st.seriesName = st.series[st.seriesId].name || '';
      if (!st.seriesId) { st.loaded = true; return render(); }
      splash();
      poll();
      setInterval(poll, 3000);
    }).catch(function () { st.loaded = true; st.failed = true; render(); setTimeout(function () { location.reload(); }, 8000); });
  }
  function pickEvent(id) {
    st.seriesId = id; st.seriesName = st.series[id].name || ''; st.loaded = false;
    splash();
    render(); poll(); setInterval(poll, 3000);
  }
  // The social's flyer fills the phone for a few seconds when the page is opened (after scanning the TV's QR code),
  // then gives way to the Player / Admin choice. A tap skips it. Once per visit, not on every reload.
  var SPLASH_MS = 3200;
  function splash() {
    var id = st.seriesId, look = (st.series[id] || {}).look;
    if (!look || !look.rev || !(look.wide || look.tall)) return;
    var key = 'socials.splash.' + id + '.' + look.rev;
    try { if (window.sessionStorage.getItem(key)) return; window.sessionStorage.setItem(key, '1'); } catch (e) { /* private mode: shown each time */ }
    var img = h('img', { alt: st.seriesName + ' flyer' });
    var el = h('div', { class: 'pl-splash', id: 'splash', role: 'img', 'aria-label': st.seriesName + ' flyer' }, [h('div', { class: 'wait' }, st.seriesName), img, h('span', { class: 'skip' }, 'Tap to continue')]);
    var timer = null, gone = false;
    var close = function () {
      if (gone) return;
      gone = true; clearTimeout(timer);
      el.classList.add('out');
      setTimeout(function () { el.remove(); }, 480);
    };
    try { el.style.backgroundColor = window.Look.colours(look).base; } catch (e) { /* default colour */ }
    el.addEventListener('click', close);
    document.body.appendChild(el);
    timer = setTimeout(close, 4500);                                    // a slow connection never holds anyone up
    flyerPic().then(function (data) {
      if (gone || !data) return close();
      img.onload = function () {
        if (gone) return;
        el.classList.add('ready');
        clearTimeout(timer); timer = setTimeout(close, SPLASH_MS);
      };
      img.onerror = close;
      img.src = data;
    }).catch(close);
  }
  function poll() {
    if (st.busy || document.hidden || !st.seriesId) return;
    st.busy = true;
    var id = st.seriesId;
    S.get('pub/live/' + id).then(function (live) {
      st.failed = false;
      if (!live || !live.sessionId) { st.session = null; st.loaded = true; render(); return null; }
      var ping = live.ping || 0;
      var needSession = live.rev !== st.rev || !st.session;
      if (!needSession && ping === st.ping && st.loaded) return null;
      var getSession = needSession ? S.get('pub/sessions/' + id + '/' + live.sessionId).then(E.normalize) : Promise.resolve(st.session);
      return getSession.then(function (s) {
        if (!s) return null;
        var cur = E.currentRound(s);
        var getScores = s.status === 'live' && cur ? S.get('pub/scores/' + id + '/' + s.id + '/r' + cur.n).catch(function () { return null; }) : Promise.resolve(null);
        return getScores.then(function (entries) {
          var before = st.session ? E.currentRound(st.session) : null;
          var roundChanged = !st.session || st.session.id !== s.id || (before ? before.n : 0) !== (cur ? cur.n : 0);
          st.session = s; st.rev = live.rev; st.ping = ping; st.pending = entries || {}; st.loaded = true;
          var saved = S.pref(meKey());
          st.me = saved && s.teams[saved] ? saved : null;
          if (roundChanged) { st.form = null; st.changing = false; st.error = ''; }
          if (!st.sending && !st.askKey) render();
        });
      });
    }).catch(function () { st.failed = true; if (!st.loaded) { st.loaded = true; render(); } })
      .then(function () { st.busy = false; });
  }

  // Where am I this round, and has my court's score been sent in?
  function myCourt() {
    var s = st.session, cur = s ? E.currentRound(s) : null;
    if (!s || !cur || !st.me) return null;
    for (var i = 0; i < cur.courts.length; i++) {
      var c = cur.courts[i];
      var side = E.sideOf(c, st.me);
      if (side) {
        var sent = E.pendingPlayerScores(s, cur.n, st.pending).filter(function (p) { return p.idx === i; })[0] || null;
        var entered = c.w ? { sa: c.sa, sb: c.sb, w: c.w } : sent;
        return { round: cur, idx: i, court: c, side: side, entered: entered, king: E.isKingsCourt(s, cur, c) };
      }
    }
    return null;
  }
  function send(mine) {
    var f = st.form, s = st.session, max = E.roundSetTo(s, mine.round);
    if (!f || f.us === null || f.them === null || st.sending) return;
    if (f.us === f.them && !f.w) return;
    if (f.us > max || f.them > max) return;
    var sa = mine.side === 'a' ? f.us : f.them, sb = mine.side === 'a' ? f.them : f.us;
    var w = sa > sb ? 'a' : sb > sa ? 'b' : (f.w === 'us' ? mine.side : (mine.side === 'a' ? 'b' : 'a'));
    var now = Date.now();
    var entry = { sa: sa, sb: sb, w: w, by: st.me, at: now };
    var up = {};
    up['pub/scores/' + st.seriesId + '/' + s.id + '/r' + mine.round.n + '/c' + mine.idx] = entry;
    up['pub/live/' + st.seriesId + '/ping'] = now;
    st.sending = true; st.error = ''; render();
    S.writePublic(up).then(function () {
      st.sending = false; st.changing = false; st.form = null;
      st.pending['c' + mine.idx] = entry; st.ping = now;
      render();
      setTimeout(poll, 1200);
    }).catch(function (err) {
      st.sending = false;
      st.error = (err && (err.status === 401 || err.status === 403)) ? 'Score entry from phones is not switched on yet. Please tell the organizer.' : 'Could not send. Check your signal and try again.';
      render();
    });
  }

  // ---------------------------------------------------------------- views
  // The welcome screen (Player or Admin?) is laid out differently from the rest: the social's name and round in
  // the middle at the top, the P symbol at the bottom, and behind it all the social's flyer, blurred until its
  // lettering is gone, so only its colours and shapes remain.
  function isHello() {
    var s = st.session;
    return !!(st.loaded && st.seriesId && !st.askKey && s && !s.discarded && !st.me && st.role !== 'player');
  }
  function render() {
    var hello = isHello(), kids;
    if (hello) {
      kids = [h('header', { class: 'pl-top center' }, h('div', null, [h('b', null, st.seriesName || 'Conquer Padel Club'), h('span', null, headline())])),
        h('main', { class: 'pl-main' }, body()),
        h('footer', { class: 'pl-logo' }, h('img', { src: '../logo-p.png?v=10', alt: 'Conquer Padel Club' }))];
    } else {
      kids = [h('header', { class: 'pl-top' }, [h('img', { src: '../logo-p.png?v=10', alt: '' }), h('div', null, [h('b', null, st.seriesName || 'Conquer Padel Club'), h('span', null, headline())])]),
        h('main', { class: 'pl-main' }, body())];
    }
    document.body.classList.toggle('hello', hello);
    if (hello) backdrop();
    root.replaceChildren.apply(root, kids);
  }
  // The social's flyer for phones, fetched once and shared by the opening splash and the welcome screen's background.
  function flyerPic() {
    var id = st.seriesId, look = (st.series[id] || {}).look;
    if (!id || !look || !look.rev || !(look.wide || look.tall)) return Promise.resolve(null);
    var key = id + ':' + look.rev;
    if (st.picKey !== key) {
      st.picKey = key;
      st.pic = S.get('pub/eventflyers/' + id + '/phone').then(function (d) { return typeof d === 'string' && /^data:image\//.test(d) ? d : null; }).catch(function () { st.picKey = ''; return null; });
    }
    return st.pic;
  }
  function backdrop() {
    var bg = document.getElementById('plbg');
    if (!bg) { bg = h('div', { id: 'plbg', 'aria-hidden': 'true' }); document.body.insertBefore(bg, document.body.firstChild); }
    var key = st.picKey;
    flyerPic().then(function (data) {
      if (!data) { bg.classList.remove('has'); return; }
      if (bg.getAttribute('data-for') !== st.picKey) { bg.style.backgroundImage = 'url("' + data + '")'; bg.setAttribute('data-for', st.picKey); }
      bg.classList.add('has');
    });
    return key;
  }
  function headline() {
    var s = st.session, cur = s ? E.currentRound(s) : null;
    if (!s) return '';
    if (s.status === 'ended') return 'Night finished';
    if (s.status === 'live' && cur && E.isWheel(s)) { var ws = E.wheelState(s); return ws === 'spin' ? 'New partners coming up' : ws === 'done' ? 'All matches played' : (cur.title || 'Round ' + cur.n) + ' · sets to ' + E.roundSetTo(s, cur); }
    if (s.status === 'live' && cur) return 'Round ' + cur.n + ' · sets to ' + (s.setTo || 4);
    return 'Starting soon';
  }
  function note(title, text) { return h('div', { class: 'pl-card' }, [h('h2', null, title), text ? h('p', null, text) : null]); }

  function body() {
    if (!st.loaded) return note('Loading…');
    if (st.failed && !st.session) return note('No connection', 'Check your signal. This page tries again by itself.');
    if (!st.seriesId) {
      var ids = Object.keys(st.series || {});
      if (!ids.length) return note('Nothing on yet', 'No social has been set up.');
      return [note('Which social are you playing?'), h('div', { class: 'pl-list' }, ids.map(function (id) {
        return h('button', { type: 'button', class: 'pl-pick', onclick: function () { pickEvent(id); } }, st.series[id].name);
      }))];
    }
    var s = st.session;
    if (st.askKey) return keyForm();
    if (!s || s.discarded) return [note('Not started yet', 'This page updates by itself when the night begins.'), adminLink()];
    if (!st.me && st.role !== 'player') return roleChoice();
    if (!st.me) return chooseTeam(s);
    var out = [];
    if (s.status === 'setup') out.push(note('You are checked in', E.isWheel(s) ? 'Your partner and court appear here when the wheel has been spun. Watch the screen!' : 'Round 1 will appear here when the night starts.'));
    else if (s.status === 'ended') out.push(note('Night finished', 'Thanks for playing. Final standings are on the screen.'));
    else out.push(roundCard(s));
    out.push(standing(s));
    return out;
  }

  // First screen after scanning the TV: are you playing, or running the night?
  // The first screen after the flyer: a greeting, and two buttons. A pressed button turns white for half a
  // second, so it is plain that it was pressed, before the page moves on.
  function roleChoice() {
    var press = function (which, go) {
      return function () {
        if (st.pressed) return;
        st.pressed = which; render();
        setTimeout(function () { st.pressed = null; go(); }, 500);
      };
    };
    var role = function (which, id, title, text, go) {
      return h('button', { type: 'button', class: 'pl-role' + (st.pressed === which ? ' pressed' : ''), id: id, onclick: press(which, go) },
        [h('span', { class: 'txt' }, [h('b', null, title), h('span', null, text)]), h('span', { class: 'go', 'aria-hidden': 'true' }, '\u203a')]);
    };
    return [
      h('div', { class: 'pl-hello' }, [h('h2', null, 'Hi, welcome!'), h('p', null, 'Are you playing tonight or running the social?')]),
      h('div', { class: 'pl-roles' }, [
        role('player', 'rolePlayer', 'Player', 'Find your court and send in your scores', function () { st.role = 'player'; render(); }),
        role('admin', 'roleAdmin', 'Admin', 'Run the night: scores, teams, courts, rounds', openAdmin)
      ])
    ];
  }
  function adminLink() { return h('button', { type: 'button', class: 'pl-link', style: 'color:#cfe0f3', id: 'roleAdmin', onclick: openAdmin }, 'Organizer? Open the admin page'); }
  function goAdmin() { S.go(S.here('admin', st.seriesId ? { s: st.seriesId } : {})); }
  // Admin: if this phone already holds a working key go straight in, otherwise ask for it.
  function openAdmin() {
    var have = S.getKey();
    if (!have) { st.askKey = true; st.keyError = ''; return render(); }
    S.checkKey(have).then(function (ok) { if (ok) goAdmin(); else { st.askKey = true; st.keyError = ''; render(); } })
      .catch(function () { st.askKey = true; st.keyError = 'No connection. Check your signal and try again.'; render(); });
  }
  function keyForm() {
    var submit = function () {
      var k = st.keyInput.trim();
      if (!k || st.checking) return;
      st.checking = true; st.keyError = ''; render();
      S.checkKey(k).then(function (ok) {
        st.checking = false;
        if (ok) { S.setKey(k); goAdmin(); } else { st.keyError = 'That key was not accepted. Check it and try again.'; render(); }
      }).catch(function () { st.checking = false; st.keyError = 'No connection. Check your signal and try again.'; render(); });
    };
    var input = h('input', { type: 'text', class: 'pl-key', id: 'adminKey', placeholder: 'Admin key', inputmode: 'text', autocapitalize: 'none', autocomplete: 'off', autocorrect: 'off', spellcheck: 'false',
      oninput: function (e) { st.keyInput = e.target.value; }, onkeydown: function (e) { if (e.key === 'Enter') submit(); } });
    input.value = st.keyInput;
    setTimeout(function () { var el = document.getElementById('adminKey'); if (el && document.activeElement !== el) el.focus(); }, 30);
    return h('div', { class: 'pl-card' }, [
      h('h2', null, 'Admin key'),
      h('p', null, 'Type the admin key to run the night from this phone. It is remembered on this phone.'),
      input,
      st.keyError ? h('p', { class: 'err', role: 'alert' }, st.keyError) : null,
      h('button', { type: 'button', class: 'pl-send', id: 'keyGo', disabled: st.checking, onclick: submit }, st.checking ? 'Checking…' : 'Open admin'),
      h('button', { type: 'button', class: 'pl-link', id: 'keyBack', onclick: function () { st.askKey = false; st.keyInput = ''; st.keyError = ''; render(); } }, 'Back')
    ]);
  }

  function chooseTeam(s) {
    var teams = E.activeTeams(s).slice().sort(function (a, b) { return a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1; });
    var solo = E.isSolo(s);
    if (!teams.length) return note(solo ? 'No players yet' : 'No teams yet', 'Ask the organizer to add you. This page updates by itself.');
    return [
      h('div', { class: 'pl-card' }, [h('h2', null, solo ? 'Who are you?' : 'Which team are you?'), h('p', null, solo ? 'Tap your name. You only do this once tonight.' : 'Tap your names. You only do this once tonight.'),
        h('button', { type: 'button', class: 'pl-link', id: 'roleBack', onclick: function () { st.role = null; render(); } }, 'Back')]),
      h('div', { class: 'pl-list' }, teams.map(function (t) {
        return h('button', { type: 'button', class: 'pl-pick', 'data-team': t.name, onclick: function () { S.pref(meKey(), t.id); st.me = t.id; st.form = null; render(); } }, t.name);
      }))
    ];
  }

  function roundCard(s) {
    var cur = E.currentRound(s), me = s.teams[st.me];
    if (me && me.left) return note('You are not in tonight’s draw', 'If that is a mistake, see the organizer.');
    if (!cur) return note('Starting soon');
    var mine = myCourt(), wheel = E.isWheel(s), wst = wheel ? E.wheelState(s) : 'none';
    if (wst === 'spin' && !(mine && !mine.entered)) return note('Time for new partners', 'Watch the screen: the wheel is about to spin. Your new partner and court appear here.');
    if (wst === 'done') return note('All matches played', 'Thanks for playing. The standings are on the screen.');
    if (!mine && wheel) {
      var paired = ((s.wheel || {}).teams || []).some(function (tm) { return tm.indexOf(st.me) >= 0; });
      return paired ? note('You rest this round', 'Your next court appears here as soon as this round finishes.')
        : note('You sit out for now', 'The wheel gives you a partner the next time it spins.');
    }
    if (!mine) {
      if (cur.sitting.indexOf(st.me) >= 0) return note('You are sitting out round ' + cur.n, 'Your next court appears here as soon as this round finishes.');
      return note('You join in the next round', 'Your court appears here when round ' + (cur.n + 1) + ' starts.');
    }
    var c = mine.court, max = E.roundSetTo(s, cur);
    var other = mine.side === 'a' ? 'b' : 'a', solo = E.isSolo(s);
    var partner = E.sideIds(c, mine.side).filter(function (id) { return id !== st.me; })[0];
    var head = h('div', { class: 'pl-court' + (mine.king ? ' king' : '') }, [h('span', null, wheel ? (c.label ? c.label + ' · court' : c.wait && !c.w ? 'Next on court' : 'Court') : mine.king ? 'King’s Court' : 'Court'), h('b', null, String(c.court))]);
    var versus = h('div', { class: 'pl-vs' }, [h('div', { class: 'us' }, solo ? ['You', partner ? ' & ' + teamName(partner) : ''] : E.sideName(s, c, mine.side)), h('div', { class: 'v' }, 'vs'), h('div', null, E.sideName(s, c, other))]);
    if (c.void) return h('div', { class: 'pl-card' }, [head, versus, h('p', null, wheel ? 'No match this round: one pair is a player short.' : 'No match on this court this round. You keep your place.')]);

    if (mine.entered && !st.changing) {
      var e = mine.entered;
      var us = mine.side === 'a' ? e.sa : e.sb, th = mine.side === 'a' ? e.sb : e.sa;
      return h('div', { class: 'pl-card done' }, [head, versus,
        h('div', { class: 'pl-score' }, [h('b', null, String(us)), h('span', null, '–'), h('b', null, String(th))]),
        h('p', { class: 'ok' }, wheel ? 'Score is in. What comes next appears here when every match has finished.' : 'Score is in. The next round appears here when every court has finished.'),
        h('button', { type: 'button', class: 'pl-link', id: 'change', onclick: function () { st.changing = true; st.form = { us: us, them: th, w: null }; render(); } }, 'Wrong score? Change it')
      ]);
    }

    var f = st.form || (st.form = { us: null, them: null, w: null });
    var digits = function (who) {
      var out = [];
      for (var v = 0; v <= max; v++) (function (v) {
        out.push(h('button', { type: 'button', class: f[who] === v ? 'on' : '', 'data-who': who, 'data-v': v, 'aria-pressed': f[who] === v ? 'true' : 'false',
          onclick: function () { f[who] = v; if (f.us !== f.them) f.w = null; render(); } }, String(v)));
      })(v);
      return h('div', { class: 'pl-digits' }, out);
    };
    var level = f.us !== null && f.them !== null && f.us === f.them;
    var ready = f.us !== null && f.them !== null && (!level || f.w);
    return h('div', { class: 'pl-card' }, [head, versus,
      h('div', { class: 'pl-row' }, [h('label', null, 'Your games'), digits('us')]),
      h('div', { class: 'pl-row' }, [h('label', null, 'Their games'), digits('them')]),
      level ? h('div', { class: 'pl-row' }, [h('label', null, wheel ? 'Level on games. Who won?' : 'Level on games. Who moves up?'), h('div', { class: 'pl-two' }, [
        h('button', { type: 'button', class: f.w === 'us' ? 'on' : '', onclick: function () { f.w = 'us'; render(); } }, 'We do'),
        h('button', { type: 'button', class: f.w === 'them' ? 'on' : '', onclick: function () { f.w = 'them'; render(); } }, 'They do')])]) : null,
      st.error ? h('p', { class: 'err', role: 'alert' }, st.error) : null,
      h('button', { type: 'button', class: 'pl-send', id: 'send', disabled: !ready || st.sending, onclick: function () { send(mine); } }, st.sending ? 'Sending…' : 'Send score'),
      st.changing ? h('button', { type: 'button', class: 'pl-link', onclick: function () { st.changing = false; st.form = null; render(); } }, 'Cancel') : null
    ]);
  }

  function standing(s) {
    var me = s.teams[st.me];
    if (!me) return null;
    var key = E.entityKey(me.players), rows = E.leaderboard(s);
    var row = rows.filter(function (r) { return r.key === key; })[0];
    return h('div', { class: 'pl-foot' }, [
      h('div', null, [h('b', null, me.name), row && row.played ? h('span', null, row.points + (row.points === 1 ? ' point' : ' points') + (E.isWheel(s) ? ' today' : ' tonight') + ' · place ' + row.rank + ' of ' + rows.length) : h('span', null, E.isWheel(s) ? 'No points yet today' : 'No points yet tonight')]),
      h('button', { type: 'button', class: 'pl-link', id: 'notme', onclick: function () { S.pref(meKey(), null); st.me = null; st.role = null; st.form = null; st.changing = false; render(); } }, 'Not you?')
    ]);
  }

  document.addEventListener('visibilitychange', function () { if (!document.hidden) poll(); });
  boot();
})();
