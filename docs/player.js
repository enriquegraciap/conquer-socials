/* Padel Socials — players' phone page. A player picks their team once, then sees only their own court each
 * round and can send in its score. The score goes to a small, separate place in the database; the organizer's
 * device applies it to the night. No admin key is needed or used here.
 */
(function () {
  'use strict';
  var E = window.Engine, S = window.Store;
  var root = document.getElementById('app');
  var st = { seriesId: new URLSearchParams(location.search).get('s'), series: null, seriesName: '', rev: null, ping: 0, session: null, pending: {},
    me: null, form: null, changing: false, sending: false, error: '', loaded: false, busy: false, failed: false };

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
      poll();
      setInterval(poll, 3000);
    }).catch(function () { st.loaded = true; st.failed = true; render(); setTimeout(function () { location.reload(); }, 8000); });
  }
  function pickEvent(id) {
    st.seriesId = id; st.seriesName = st.series[id].name || ''; st.loaded = false;
    render(); poll(); setInterval(poll, 3000);
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
          if (!st.sending) render();
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
      if (c.a === st.me || c.b === st.me) {
        var side = c.a === st.me ? 'a' : 'b';
        var sent = E.pendingPlayerScores(s, cur.n, st.pending).filter(function (p) { return p.idx === i; })[0] || null;
        var entered = c.w ? { sa: c.sa, sb: c.sb, w: c.w } : sent;
        return { round: cur, idx: i, court: c, side: side, entered: entered, king: E.isKingsCourt(s, cur, c) };
      }
    }
    return null;
  }
  function send(mine) {
    var f = st.form, s = st.session, max = s.setTo === 6 ? 6 : 4;
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
  function render() {
    var kids = [h('header', { class: 'pl-top' }, [h('img', { src: '../logo-p.png?v=10', alt: '' }), h('div', null, [h('b', null, st.seriesName || 'Conquer Padel Club'), h('span', null, headline())])])];
    kids.push(h('main', { class: 'pl-main' }, body()));
    root.replaceChildren.apply(root, kids);
  }
  function headline() {
    var s = st.session, cur = s ? E.currentRound(s) : null;
    if (!s) return '';
    if (s.status === 'ended') return 'Night finished';
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
    if (!s || s.discarded) return note('Not started yet', 'This page updates by itself when the night begins.');
    if (!st.me) return chooseTeam(s);
    var out = [];
    if (s.status === 'setup') out.push(note('You are checked in', 'Round 1 will appear here when the night starts.'));
    else if (s.status === 'ended') out.push(note('Night finished', 'Thanks for playing. Final standings are on the screen.'));
    else out.push(roundCard(s));
    out.push(standing(s));
    return out;
  }

  function chooseTeam(s) {
    var teams = E.activeTeams(s).slice().sort(function (a, b) { return a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1; });
    if (!teams.length) return note('No teams yet', 'Ask the organizer to add you. This page updates by itself.');
    return [
      h('div', { class: 'pl-card' }, [h('h2', null, 'Which team are you?'), h('p', null, 'Tap your names. You only do this once tonight.')]),
      h('div', { class: 'pl-list' }, teams.map(function (t) {
        return h('button', { type: 'button', class: 'pl-pick', 'data-team': t.name, onclick: function () { S.pref(meKey(), t.id); st.me = t.id; st.form = null; render(); } }, t.name);
      }))
    ];
  }

  function roundCard(s) {
    var cur = E.currentRound(s), me = s.teams[st.me];
    if (me && me.left) return note('You are not in tonight’s draw', 'If that is a mistake, see the organizer.');
    if (!cur) return note('Starting soon');
    var mine = myCourt();
    if (!mine) {
      if (cur.sitting.indexOf(st.me) >= 0) return note('You are sitting out round ' + cur.n, 'Your next court appears here as soon as this round finishes.');
      return note('You join in the next round', 'Your court appears here when round ' + (cur.n + 1) + ' starts.');
    }
    var c = mine.court, max = s.setTo === 6 ? 6 : 4;
    var them = mine.side === 'a' ? c.b : c.a;
    var head = h('div', { class: 'pl-court' + (mine.king ? ' king' : '') }, [h('span', null, mine.king ? 'King’s Court' : 'Court'), h('b', null, String(c.court))]);
    var versus = h('div', { class: 'pl-vs' }, [h('div', { class: 'us' }, teamName(st.me)), h('div', { class: 'v' }, 'vs'), h('div', null, teamName(them))]);
    if (c.void) return h('div', { class: 'pl-card' }, [head, versus, h('p', null, 'No match on this court this round. You keep your place.')]);

    if (mine.entered && !st.changing) {
      var e = mine.entered;
      var us = mine.side === 'a' ? e.sa : e.sb, th = mine.side === 'a' ? e.sb : e.sa;
      return h('div', { class: 'pl-card done' }, [head, versus,
        h('div', { class: 'pl-score' }, [h('b', null, String(us)), h('span', null, '–'), h('b', null, String(th))]),
        h('p', { class: 'ok' }, 'Score is in. The next round appears here when every court has finished.'),
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
      level ? h('div', { class: 'pl-row' }, [h('label', null, 'Level on games. Who moves up?'), h('div', { class: 'pl-two' }, [
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
      h('div', null, [h('b', null, me.name), row && row.played ? h('span', null, row.points + (row.points === 1 ? ' point' : ' points') + ' tonight · place ' + row.rank + ' of ' + rows.length) : h('span', null, 'No points yet tonight')]),
      h('button', { type: 'button', class: 'pl-link', id: 'notme', onclick: function () { S.pref(meKey(), null); st.me = null; st.form = null; st.changing = false; render(); } }, 'Not you?')
    ]);
  }

  document.addEventListener('visibilitychange', function () { if (!document.hidden) poll(); });
  boot();
})();
