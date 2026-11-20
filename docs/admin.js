/* Padel Socials — iPad admin page. */
(function () {
  'use strict';
  var E = window.Engine, S = window.Store;
  var root = document.getElementById('app');
  var MAX_COURT = 14, MAX_SCORE = 7;

  var state = {
    phase: 'boot',            // boot | nodb | error | series | night
    error: '',
    series: {}, seriesId: null,
    session: null,            // the night being edited (working copy)
    remote: null,             // the copy known to be saved
    remoteResults: null,
    liveRev: null,
    version: 0, dirty: false, saving: false, saveError: '', needKey: false,
    regulars: [],
    ui: { p1: '', p2: '', modal: null, toast: '', newSeries: '', keyInput: '', prevOpen: false, focus: null }
  };
  var toastTimer = null, retryTimer = null;

  // ---------------------------------------------------------------- tiny DOM helper
  function h(tag, attrs, kids) {
    var el = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v === null || v === undefined || v === false) return;
      if (k === 'class') el.className = v;
      else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);
      else if (k === 'value') el.value = v;
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
  function btn(label, cls, onclick, extra) {
    var a = { class: 'btn ' + (cls || ''), type: 'button', onclick: onclick };
    if (extra) Object.keys(extra).forEach(function (k) { a[k] = extra[k]; });
    return h('button', a, label);
  }
  function toast(msg) {
    state.ui.toast = msg;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { state.ui.toast = ''; render(); }, 4500);
  }
  function slug(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'event'; }
  function teamNameOf(id) { var t = state.session.teams[id]; return t ? t.name : '(removed)'; }

  // ---------------------------------------------------------------- loading and saving
  function boot() {
    var m = /[#&]k=([^&]+)/.exec(location.hash || '');
    if (m) { S.setKey(decodeURIComponent(m[1])); history.replaceState(null, '', location.pathname + location.search); }
    if (!S.configured) { state.phase = 'nodb'; return render(); }
    render();
    S.get('pub/series').then(function (list) {
      state.series = list || {};
      var want = new URLSearchParams(location.search).get('s') || S.pref('series');
      var ids = Object.keys(state.series);
      if (want && state.series[want]) return openSeries(want);
      if (ids.length === 1) return openSeries(ids[0]);
      state.phase = 'series'; render();
    }).catch(fail);
  }
  function fail(err) { state.phase = 'error'; state.error = (err && err.message) || String(err); render(); }

  function openSeries(id) {
    state.seriesId = id; S.pref('series', id);
    state.phase = 'boot'; state.session = null; render();
    loadNight().catch(fail);
  }
  function loadNight() {
    var id = state.seriesId;
    return S.get('pub/live/' + id).then(function (live) {
      if (!live || !live.sessionId) return null;
      state.liveRev = live.rev;
      return S.get('pub/sessions/' + id + '/' + live.sessionId);
    }).then(function (data) {
      var s = E.normalize(data);
      if (s && !s.discarded) {
        state.session = s; state.remote = E.clone(s);
        state.remoteResults = resultsFor(s);
        state.dirty = false;
      } else newNight(s && s.discarded ? s : null);
      state.phase = 'night'; render();
      return S.get('pub/results/' + id).then(function (all) { state.regulars = regularsFrom(all); render(); }).catch(function () { /* optional */ });
    });
  }
  function resultsFor(s) {
    if (s.status === 'setup' || s.discarded) return null;
    var rd = E.resultsDoc(s);
    return Object.keys(rd.entries).length ? rd : null;
  }
  function regularsFrom(all) {
    var seen = {}, out = [];
    Object.keys(all || {}).sort().reverse().forEach(function (month) {
      Object.keys(all[month] || {}).forEach(function (sid) {
        var en = (all[month][sid] || {}).entries || {};
        Object.keys(en).forEach(function (k) {
          if (seen[k] || !en[k].players) return;
          seen[k] = true; out.push({ key: k, name: en[k].name, players: en[k].players });
        });
      });
    });
    return out.sort(function (a, b) { return a.name < b.name ? -1 : 1; });
  }
  function newNight(prev) {
    var meta = state.series[state.seriesId] || {};
    state.session = E.newSession({
      seriesId: state.seriesId, seriesName: meta.name || '', format: meta.format, scoring: meta.scoring,
      courts: prev ? prev.courts : (meta.courts || []), round1: prev ? prev.round1 : 'random'
    });
    state.remote = null; state.remoteResults = null;
    touch();
  }
  function touch() { state.version++; state.dirty = true; setTimeout(flush, 0); }
  // Change the night, show it at once, save in the background.
  function commit(fn) {
    var out = fn(state.session);
    touch(); render();
    return out;
  }
  function flush() {
    if (state.saving || !state.dirty || state.needKey || !state.session) return;
    var s = state.session, id = state.seriesId, updates = {};
    var put = function (base, diff) { Object.keys(diff).forEach(function (k) { updates[k ? base + '/' + k : base] = diff[k]; }); };
    var rd = resultsFor(s);
    put('pub/sessions/' + id + '/' + s.id, E.diffPaths(state.remote, s));
    put('pub/results/' + id + '/' + s.month + '/' + s.id, E.diffPaths(state.remoteResults, rd));
    if (!Object.keys(updates).length) { state.dirty = false; return render(); }
    var rev = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    updates['pub/live/' + id] = { sessionId: s.id, rev: rev };
    var sent = E.clone(s), sentResults = E.clone(rd), v = state.version;
    state.saving = true; render();
    S.write(updates).then(function () {
      state.remote = sent; state.remoteResults = sentResults; state.liveRev = rev;
      state.saving = false; state.saveError = '';
      state.dirty = state.version !== v;
      render();
      if (state.dirty) flush();
    }).catch(function (err) {
      state.saving = false;
      if (err.status === 401 || err.status === 403) { state.needKey = true; state.saveError = 'Not saved: admin key needed'; state.ui.modal = { type: 'key', wrong: !!S.getKey() }; }
      else { state.saveError = 'Not saved yet. Retrying…'; clearTimeout(retryTimer); retryTimer = setTimeout(flush, 3000); }
      render();
    });
  }
  // Pick up changes made on another admin device.
  function watch() {
    if (state.phase !== 'night' || state.dirty || state.saving || document.hidden) return;
    var id = state.seriesId;
    S.get('pub/live/' + id).then(function (live) {
      if (!live || live.rev === state.liveRev || state.dirty || state.saving || id !== state.seriesId) return;
      return loadNight();
    }).catch(function () { /* offline for a moment: the next tick tries again */ });
  }

  // ---------------------------------------------------------------- views
  function render() {
    var active = document.activeElement, focusId = state.ui.focus || (active && active.id) || null;
    var sel = active && active.selectionStart !== undefined && active.id === focusId ? [active.selectionStart, active.selectionEnd] : null;
    state.ui.focus = null;
    var kids = [];
    if (state.phase === 'boot') kids = [topbar(), h('div', { class: 'wrap' }, h('p', { class: 'hint' }, 'Loading…'))];
    else if (state.phase === 'nodb') kids = [topbar(), h('div', { class: 'wrap' }, h('div', { class: 'notice err' }, 'No database address is set yet. Open config.js and fill in databaseURL.'))];
    else if (state.phase === 'error') kids = [topbar(), h('div', { class: 'wrap' }, [h('div', { class: 'notice err' }, 'Could not reach the database: ' + state.error), btn('Try again', 'primary', function () { state.phase = 'boot'; boot(); })])];
    else if (state.phase === 'series') kids = [topbar(), seriesView()];
    else kids = [topbar(), nightView()];
    if (state.ui.modal) kids.push(modalView());
    if (state.ui.toast) kids.push(h('div', { class: 'toast', role: 'status' }, state.ui.toast));
    root.replaceChildren.apply(root, kids);
    if (focusId) {
      var el = document.getElementById(focusId);
      if (el) { el.focus(); if (sel && el.setSelectionRange) { try { el.setSelectionRange(sel[0], sel[1]); } catch (e) { /* not a text field */ } } }
    }
  }

  function topbar() {
    var s = state.session, meta = state.series[state.seriesId] || {};
    var pill = null;
    if (state.phase === 'night' && s) {
      var cur = E.currentRound(s);
      pill = s.status === 'live' ? h('span', { class: 'pill live' }, 'Round ' + (cur ? cur.n : 1)) : h('span', { class: 'pill' }, s.status === 'ended' ? 'Night ended' : 'Setting up');
    }
    var sync = state.saveError ? h('span', { class: 'sync bad' }, state.saveError) : h('span', { class: 'sync' }, state.saving || state.dirty ? 'Saving…' : (state.phase === 'night' ? 'Saved' : ''));
    return h('div', { class: 'topbar' }, [
      h('h1', null, state.phase === 'night' ? (meta.name || 'Padel Socials') : 'Padel Socials'),
      pill, h('span', { class: 'spacer' }), sync,
      state.phase === 'night' ? h('button', { class: 'linkbtn', type: 'button', onclick: function () { state.ui.modal = { type: 'tv' }; render(); } }, 'TV screen') : null,
      state.phase === 'night' ? h('button', { class: 'linkbtn', type: 'button', onclick: function () { state.phase = 'series'; render(); } }, 'Events') : null
    ]);
  }

  function seriesView() {
    var ids = Object.keys(state.series).sort(function (a, b) { return state.series[a].name < state.series[b].name ? -1 : 1; });
    var create = function () {
      var name = state.ui.newSeries.replace(/\s+/g, ' ').trim();
      if (!name) return;
      var id = slug(name), n = 2;
      while (state.series[id]) id = slug(name) + '-' + n++;
      var meta = { name: name, format: 'kings-fixed', scoring: 'team', created: E.localDate(new Date()) };
      var up = {}; up['pub/series/' + id] = meta;
      S.write(up).then(function () { state.series[id] = meta; state.ui.newSeries = ''; openSeries(id); })
        .catch(function (err) {
          if (err.status === 401 || err.status === 403) { state.ui.modal = { type: 'key', wrong: !!S.getKey(), then: create }; render(); }
          else { toast('Could not save: ' + err.message); render(); }
        });
    };
    return h('div', { class: 'wrap' }, [
      ids.length ? h('div', { class: 'panel' }, [
        h('h2', null, 'Your events'),
        h('div', { class: 'serieslist' }, ids.map(function (id) {
          return btn([state.series[id].name, h('span', { class: 'hint' }, '  King’s Court, fixed partners')], '', function () { openSeries(id); });
        }))
      ]) : null,
      h('div', { class: 'panel' }, [
        h('h2', null, ids.length ? 'Add another event' : 'Name your first event'),
        h('p', { class: 'hint' }, 'One event per weekly social and club, for example “Lehi Date Night”. Each event keeps its own monthly leaderboard.'),
        h('div', { class: 'row', style: 'margin-top:10px' }, [
          h('input', { type: 'text', id: 'newSeries', placeholder: 'Event name', value: state.ui.newSeries, maxlength: 40, style: 'flex:1',
            oninput: function (e) { state.ui.newSeries = e.target.value; }, onkeydown: function (e) { if (e.key === 'Enter') create(); } }),
          btn('Create', 'primary', create)
        ]),
        h('p', { class: 'hint' }, 'Format: King’s Court, fixed partners, with sit-outs. Points belong to the couple.')
      ])
    ]);
  }

  function nightView() {
    var s = state.session;
    if (s.status === 'setup') return setupView(s);
    if (s.status === 'ended') return endedView(s);
    return liveView(s);
  }

  // ---- Setup
  function setupView(s) {
    var teams = E.teamList(s), N = teams.length, C = s.courts.length;
    var k = Math.min(C, Math.floor(N / 2)), sit = N - 2 * k;
    var summary = !C ? 'Pick the courts first.' : N < 2 ? 'Add at least two teams.' :
      N + ' teams on ' + k + (k === 1 ? ' court' : ' courts') + ': ' + (2 * k) + ' play, ' + (sit ? sit + ' sit out each round.' : 'nobody sits out.') +
      (k < C ? ' Only the top ' + k + ' of your ' + C + ' courts are needed.' : '');
    // Portrait (how the iPad is used): courts, round 1, teams, then a Start bar that stays at the bottom.
    // Landscape: teams on the left, the rest on the right.
    return h('div', { class: 'wrap' }, [
      h('div', { class: 'setupgrid' }, [
        h('div', { class: 'a-teams' }, teamsPanel(s, true)),
        h('div', { class: 'a-courts' }, courtsPanel(s)),
        h('div', { class: 'a-r1' },
          h('div', { class: 'panel' }, [
            h('h2', null, 'Round 1'),
            h('div', { class: 'seg' }, [
              h('button', { type: 'button', class: s.round1 === 'random' ? 'on' : '', onclick: function () { commit(function (x) { x.round1 = 'random'; }); } }, 'Random draw'),
              h('button', { type: 'button', class: s.round1 === 'seeded' ? 'on' : '', onclick: function () { commit(function (x) { x.round1 = 'seeded'; }); } }, 'Seeded')
            ]),
            h('p', { class: 'hint' }, s.round1 === 'seeded' ? 'Seeded: the team list order is the seeding. Teams 1 and 2 start on King’s Court. Use the arrows to reorder.' : 'Random: teams are drawn onto courts at random.')
          ])),
        h('div', { class: 'a-start' },
          h('div', { class: 'panel startbar' }, [
            h('p', { class: 'sitlist' }, summary),
            btn('Start night', 'gold', function () {
              commit(function (x) { x.date = E.localDate(new Date()); x.month = x.date.slice(0, 7); E.startNight(x); });
              toast('Round 1 is on the TV.');
            }, { disabled: N < 2 || !C, id: 'startNight' })
          ]))
      ])
    ]);
  }

  function courtsPanel(s) {
    var toggle = function (n) {
      commit(function (x) {
        var i = x.courts.indexOf(n);
        if (i >= 0) x.courts.splice(i, 1); else x.courts.push(n);
      });
    };
    var chips = [];
    for (var n = 1; n <= MAX_COURT; n++) (function (n) {
      var i = s.courts.indexOf(n), king = i >= 0 && i === s.courts.length - 1;
      chips.push(h('button', { type: 'button', class: 'chip' + (i >= 0 ? ' on' : '') + (king ? ' king' : ''), 'aria-pressed': i >= 0 ? 'true' : 'false', 'data-court': n,
        onclick: function () { toggle(n); } }, [String(n), i >= 0 ? h('span', { class: 'ord' }, king ? 'King' : String(i + 1)) : null]));
    })(n);
    return h('div', { class: 'panel' }, [
      h('h2', null, ['Courts', h('small', null, 'tap from the bottom court up to King’s Court')]),
      h('div', { class: 'courtpick' }, chips),
      s.courts.length ? h('div', { class: 'ladder' }, ['Bottom: ' + s.courts.slice(0, -1).join(' → ') + (s.courts.length > 1 ? ' → ' : ''), h('b', null, s.courts[s.courts.length - 1] + ' King’s Court')]) : h('p', { class: 'hint' }, 'No courts picked yet.'),
      s.courts.length ? h('div', { class: 'row', style: 'margin-top:8px' }, [
        btn('Reverse order', 'small', function () { commit(function (x) { x.courts.reverse(); }); }),
        btn('Clear', 'small', function () { commit(function (x) { x.courts = []; }); })
      ]) : null
    ]);
  }

  function teamsPanel(s, setup) {
    var teams = E.teamList(s), cur = E.currentRound(s);
    var add = function () {
      var p = [state.ui.p1, state.ui.p2];
      if (!(p[0] + p[1]).trim()) return;
      var res = commit(function (x) { return E.addTeam(x, p); });
      if (!res) toast('That team is already on the list.');
      else { state.ui.p1 = ''; state.ui.p2 = ''; if (!setup) toast(res.name + ' joins from the next round.'); }
      state.ui.focus = 'p1'; render();
    };
    var status = function (t) {
      if (t.left) return 'Left';
      if (setup || !cur) return '';
      if (cur.sitting.indexOf(t.id) >= 0) return 'Sitting out';
      var c = cur.courts.filter(function (c) { return c.a === t.id || c.b === t.id; })[0];
      return c ? 'Court ' + c.court : 'Joins next round';
    };
    var move = function (t, dir) {
      commit(function (x) {
        var list = E.teamList(x), i = list.map(function (y) { return y.id; }).indexOf(t.id), j = i + dir;
        if (j < 0 || j >= list.length) return;
        var tmp = list[i]; list[i] = list[j]; list[j] = tmp;
        list.forEach(function (y, n) { x.teams[y.id].order = n + 1; });
      });
    };
    var have = {};
    teams.forEach(function (t) { if (!t.left) have[E.entityKey(t.players)] = true; });
    var regs = state.regulars.filter(function (r) { return !have[r.key]; });
    return h('div', { class: 'panel' }, [
      h('h2', null, ['Teams', h('small', null, teams.filter(function (t) { return !t.left; }).length + (setup ? ' entered' : ' playing tonight'))]),
      h('div', { class: 'addteam' }, [
        h('input', { type: 'text', id: 'p1', placeholder: 'Player 1', value: state.ui.p1, maxlength: 30, autocapitalize: 'words', autocomplete: 'off',
          oninput: function (e) { state.ui.p1 = e.target.value; }, onkeydown: function (e) { if (e.key === 'Enter') document.getElementById('p2').focus(); } }),
        h('span', { class: 'amp' }, '&'),
        h('input', { type: 'text', id: 'p2', placeholder: 'Player 2', value: state.ui.p2, maxlength: 30, autocapitalize: 'words', autocomplete: 'off',
          oninput: function (e) { state.ui.p2 = e.target.value; }, onkeydown: function (e) { if (e.key === 'Enter') add(); } }),
        btn(setup ? 'Add team' : 'Add late team', 'primary', add, { id: 'addTeam' })
      ]),
      regs.length ? h('div', null, [h('p', { class: 'hint' }, 'Played before (tap to add):'), h('div', { class: 'regulars' }, regs.map(function (r) {
        return h('button', { type: 'button', onclick: function () { var res = commit(function (x) { return E.addTeam(x, r.players); }); if (res && !setup) toast(res.name + ' joins from the next round.'); } }, '+ ' + r.name);
      }))]) : null,
      h('ul', { class: 'teamlist' }, teams.map(function (t, i) {
        return h('li', { class: t.left ? 'gone' : '' }, [
          setup && s.round1 === 'seeded' ? h('span', { class: 'seed' }, String(i + 1)) : null,
          h('span', { class: 'nm' }, t.name),
          h('span', { class: 'st' }, status(t)),
          setup && s.round1 === 'seeded' ? btn('▲', 'small', function () { move(t, -1); }, { 'aria-label': 'Move ' + t.name + ' up', disabled: i === 0 }) : null,
          setup && s.round1 === 'seeded' ? btn('▼', 'small', function () { move(t, 1); }, { 'aria-label': 'Move ' + t.name + ' down', disabled: i === teams.length - 1 }) : null,
          t.left ? btn('Bring back', 'small', function () { commit(function (x) { x.teams[t.id].left = null; }); toast(t.name + ' rejoins from the next round.'); render(); })
            : btn('Remove', 'small danger', function () { removeTeam(t); }, { 'aria-label': 'Remove ' + t.name })
        ]);
      })),
      !teams.length ? h('p', { class: 'hint' }, 'No teams yet. Type the two players and press Add team.') : null
    ]);
  }
  function removeTeam(t) {
    var s = state.session;
    var go = function () {
      var out = commit(function (x) { return E.removeTeam(x, t.id); });
      if (out.substitute) toast(teamNameOf(out.substitute) + ' steps in on court ' + out.court + '.');
      else if (out.voided) toast('Court ' + out.voided + ': the other team keeps its place, no points for that match.');
      render();
    };
    if (s.status === 'setup') return go();
    state.ui.modal = { type: 'confirm', title: 'Remove ' + t.name + '?', text: 'They keep the points they have won tonight but are left out of the next rounds. If they are on court right now, a team that is sitting out takes their place.', ok: 'Remove team', danger: true, onOk: go };
    render();
  }

  // ---- Live
  function courtCard(s, r, c, i, small) {
    var king = c.level === s.courts.length - 1;
    var done = !!c.w && !c.void;
    var open = function () { state.ui.modal = { type: 'score', n: r.n, i: i, sa: c.sa, sb: c.sb, w: c.sa === c.sb ? c.w : null }; render(); };
    return h('button', { type: 'button', class: 'courtcard' + (king ? ' king' : '') + (c.void ? ' void' : done ? '' : ' todo'), disabled: c.void, 'data-court': c.court, 'data-round': r.n, onclick: open,
      'aria-label': 'Court ' + c.court + ': ' + teamNameOf(c.a) + ' against ' + teamNameOf(c.b) + (done ? ', ' + c.sa + ' to ' + c.sb + '. Tap to correct.' : '. Tap to enter the score.') }, [
      h('div', { class: 'cn' }, [h('b', null, String(c.court)), h('span', null, king ? 'King’s' : 'Court')]),
      h('div', { class: 'tm' }, [
        h('div', { class: done && c.w === 'a' ? 'won' : '' }, teamNameOf(c.a)),
        h('div', { class: done && c.w === 'b' ? 'won' : '' }, teamNameOf(c.b))
      ]),
      c.void ? h('div', { class: 'sc enter' }, 'No match') : done ? h('div', { class: 'sc num' }, [h('span', null, String(c.sa)), h('span', null, String(c.sb))]) : h('div', { class: 'sc enter' }, small ? 'Enter' : 'Enter score')
    ]);
  }

  function liveView(s) {
    var cur = E.currentRound(s), prev = s.rounds.slice(0, -1).reverse();
    var left = cur ? cur.courts.filter(function (c) { return !c.void && !c.w; }).length : 0;
    var waiting = E.activeTeams(s).filter(function (t) { return cur && cur.sitting.indexOf(t.id) < 0 && !cur.courts.some(function (c) { return c.a === t.id || c.b === t.id; }); });
    return h('div', { class: 'wrap' }, [
      h('div', { class: 'cols' }, [
        h('div', { class: 'stack' }, [
          h('div', { class: 'panel' }, [
            h('div', { class: 'roundhead' }, [
              h('span', { class: 'big' }, 'Round ' + (cur ? cur.n : 1)),
              h('span', { class: 'hint' }, !cur ? 'Add teams and courts to begin.' : left ? left + (left === 1 ? ' court' : ' courts') + ' still to score. The next round appears when the last score goes in.' : '')
            ]),
            cur ? h('div', { class: 'courtcards' }, cur.courts.map(function (c, i) { return courtCard(s, cur, c, i, false); })) : null,
            cur && cur.sitting.length ? h('p', { class: 'sitlist' }, [h('b', null, 'Sitting out: '), cur.sitting.map(teamNameOf).join(', ')]) : null,
            waiting.length ? h('p', { class: 'sitlist' }, [h('b', null, 'Joining next round: '), waiting.map(function (t) { return t.name; }).join(', ')]) : null,
            h('div', { class: 'row end', style: 'margin-top:8px' }, [
              cur && !E.roundHasScores(cur) ? btn('Re-draw this round', 'small', function () {
                state.ui.modal = { type: 'confirm', title: 'Re-draw round ' + cur.n + '?', text: cur.n === 1 ? 'Makes a new draw for round 1.' : 'Chooses again who sits out and where teams play, following the same rules. Use it after adding or removing a team.', ok: 'Re-draw', onOk: function () { commit(function (x) { E.redrawRound(x); }); render(); } };
                render();
              }) : null,
              btn('End night', 'small danger', function () {
                state.ui.modal = { type: 'confirm', title: 'End the night?', text: 'Tonight’s results are saved to the monthly leaderboard and the TV shows the final standings. You can reopen the night if you end it by mistake.', ok: 'End night', danger: true,
                  onOk: function () { commit(function (x) { E.endNight(x); }); render(); } };
                render();
              }, { id: 'endNight' })
            ])
          ]),
          prev.length ? h('div', { class: 'panel' }, h('details', { class: 'prev', open: state.ui.prevOpen, ontoggle: function (e) { state.ui.prevOpen = e.target.open; } }, [
            h('summary', null, 'Earlier rounds (tap a score to correct it)'),
            prev.map(function (r) {
              return h('div', null, [h('h2', { style: 'margin-top:12px' }, 'Round ' + r.n), h('div', { class: 'courtcards' }, r.courts.map(function (c, i) { return courtCard(s, r, c, i, true); })),
                r.sitting.length ? h('p', { class: 'hint' }, 'Sat out: ' + r.sitting.map(teamNameOf).join(', ')) : null]);
            })
          ])) : null
        ]),
        h('div', { class: 'stack' }, [boardPanel(s, 'Tonight'), teamsPanel(s, false)])
      ])
    ]);
  }

  function boardPanel(s, title) {
    var rows = E.leaderboard(s);
    return h('div', { class: 'panel' }, [
      h('h2', null, [title, h('small', null, 'a point for every game won')]),
      rows.length ? h('table', { class: 'board' }, [
        h('thead', null, h('tr', null, [h('th', null, ''), h('th', null, s.scoring === 'player' ? 'Player' : 'Team'), h('th', null, 'Played'), h('th', null, 'Won'), h('th', null, 'Sat'), h('th', null, 'Points')])),
        h('tbody', null, rows.map(function (r) {
          return h('tr', null, [h('td', null, String(r.rank)), h('td', null, r.name), h('td', { class: 'num' }, String(r.played)), h('td', { class: 'num' }, String(r.wins)), h('td', { class: 'num' }, String(r.sitOuts)), h('td', { class: 'pts num' }, String(r.points))]);
        }))
      ]) : h('p', { class: 'hint' }, 'No teams yet.')
    ]);
  }

  // ---- Ended
  function endedView(s) {
    var played = s.rounds.length;
    return h('div', { class: 'wrap' }, [
      h('div', { class: 'cols' }, [
        h('div', { class: 'stack' }, [boardPanel(s, 'Final standings')]),
        h('div', { class: 'stack' }, [
          h('div', { class: 'panel' }, [
            h('h2', null, 'Night ended'),
            h('p', { class: 'sitlist', style: 'margin:0 0 12px' }, played + (played === 1 ? ' round' : ' rounds') + ' played on ' + s.date + '. Saved to the monthly leaderboard.'),
            h('div', { class: 'stack', style: 'gap:10px' }, [
              btn('Set up the next night', 'primary', function () {
                if (state.dirty || state.saving) { toast('Still saving. Try again in a moment.'); return render(); }
                newNight(s); render();
              }, { id: 'nextNight' }),
              btn('Reopen this night', '', function () { commit(function (x) { E.reopenNight(x); }); render(); }),
              btn('Discard this night (do not count it)', 'danger', function () {
                state.ui.modal = { type: 'confirm', title: 'Discard this night?', text: 'Its points are removed from the monthly leaderboard. Use this for test runs.', ok: 'Discard', danger: true,
                  onOk: function () { discardNight(s); } };
                render();
              })
            ])
          ]),
          s.rounds.length ? h('div', { class: 'panel' }, h('details', { class: 'prev', open: state.ui.prevOpen, ontoggle: function (e) { state.ui.prevOpen = e.target.open; } }, [
            h('summary', null, 'Rounds (tap a score to correct it)'),
            s.rounds.slice().reverse().map(function (r) {
              return h('div', null, [h('h2', { style: 'margin-top:12px' }, 'Round ' + r.n), h('div', { class: 'courtcards' }, r.courts.map(function (c, i) { return courtCard(s, r, c, i, true); }))]);
            })
          ])) : null
        ])
      ])
    ]);
  }

  function discardNight(s) {
    if (state.dirty || state.saving) { toast('Still saving. Try again in a moment.'); return render(); }
    var id = state.seriesId, up = {};
    up['pub/results/' + id + '/' + s.month + '/' + s.id] = null;
    up['pub/sessions/' + id + '/' + s.id + '/discarded'] = true;
    S.write(up).then(function () { newNight(s); toast('Night discarded. It no longer counts.'); render(); })
      .catch(function (err) { toast('Could not discard: ' + err.message); render(); });
  }

  // ---- Modals
  function closeModal() { state.ui.modal = null; render(); }
  function modalView() {
    var m = state.ui.modal, s = state.session, body;
    if (m.type === 'confirm') {
      body = [h('h3', null, m.title), h('p', { style: 'margin:0;font-size:17px;line-height:1.45' }, m.text),
        h('div', { class: 'row end' }, [btn('Cancel', '', closeModal), btn(m.ok, m.danger ? 'danger' : 'primary', function () { state.ui.modal = null; m.onOk(); }, { id: 'modalOk' })])];
    } else if (m.type === 'tv') {
      var url = location.origin + location.pathname.replace(/index\.html$/, '') + 'tv/?s=' + encodeURIComponent(state.seriesId);
      body = [h('h3', null, 'TV screen'), h('p', { style: 'margin:0;font-size:17px' }, 'Open this address in the browser on each club TV, then press Full screen:'), h('div', { class: 'tvlink' }, url),
        h('p', { class: 'hint' }, 'If this is your only event you can leave off everything after “tv/”.'), h('div', { class: 'row end' }, btn('Close', 'primary', closeModal))];
    } else if (m.type === 'key') {
      var save = function () {
        var k = state.ui.keyInput.trim();
        if (!k) return;
        S.setKey(k); state.ui.keyInput = ''; state.needKey = false; state.saveError = ''; state.ui.modal = null;
        if (m.then) m.then(); else flush();
        render();
      };
      body = [h('h3', null, 'Admin key'), h('p', { style: 'margin:0;font-size:17px;line-height:1.45' }, m.wrong ? 'That key was not accepted. Check it and try again.' : 'Type the admin key once on this device. It is needed to change anything; the TV screens do not need it.'),
        h('input', { type: 'text', id: 'keyInput', placeholder: 'Admin key', value: state.ui.keyInput, autocapitalize: 'none', autocomplete: 'off', autocorrect: 'off', spellcheck: 'false',
          oninput: function (e) { state.ui.keyInput = e.target.value; }, onkeydown: function (e) { if (e.key === 'Enter') save(); } }),
        h('div', { class: 'row end' }, [btn('Cancel', '', closeModal), btn('Save key', 'primary', save, { id: 'saveKey' })])];
    } else {
      var r = s.rounds[m.n - 1], c = r.courts[m.i];
      var pick = function (side, v) { m[side] = v; if (m.sa !== m.sb) m.w = null; render(); };
      var digits = function (side) {
        var out = [];
        for (var v = 0; v <= MAX_SCORE; v++) (function (v) {
          out.push(h('button', { type: 'button', class: m[side] === v ? 'on' : '', 'data-side': side, 'data-v': v, 'aria-pressed': m[side] === v ? 'true' : 'false', onclick: function () { pick(side, v); } }, String(v)));
        })(v);
        return out;
      };
      var level = m.sa !== null && m.sb !== null && m.sa === m.sb;
      var ready = m.sa !== null && m.sb !== null && (!level || m.w);
      var saveScore = function () {
        var n = m.n, wasLast = n === s.rounds.length;
        var out = commit(function (x) { return E.setScore(x, n, m.i, m.sa, m.sb, m.w); });
        state.ui.modal = null;
        if (!out.ok) toast(out.error);
        else if (out.regenerated) toast('Round ' + (n + 1) + ' has been redone with the corrected result.');
        else if (out.tooLate) toast('Points corrected. Court positions stay as they were played.');
        else if (out.advanced && wasLast) toast('Round ' + (n + 1) + ' is up on the TV.');
        render();
      };
      body = [
        h('h3', null, 'Round ' + m.n + ' · Court ' + c.court + (c.level === s.courts.length - 1 ? ' · King’s Court' : '')),
        h('div', { class: 'scoreteam' }, [h('div', { class: 'nm' }, teamNameOf(c.a)), h('div', { class: 'digits' }, digits('sa'))]),
        h('div', { class: 'scoreteam' }, [h('div', { class: 'nm' }, teamNameOf(c.b)), h('div', { class: 'digits' }, digits('sb'))]),
        level ? h('div', { class: 'notice' }, [h('div', { style: 'margin-bottom:8px;font-weight:600' }, 'Level on games. Which team moves up?'), h('div', { class: 'row' }, [
          btn(teamNameOf(c.a), m.w === 'a' ? 'primary small' : 'small', function () { m.w = 'a'; render(); }),
          btn(teamNameOf(c.b), m.w === 'b' ? 'primary small' : 'small', function () { m.w = 'b'; render(); })])]) : null,
        h('div', { class: 'row end' }, [
          c.w ? btn('Clear score', 'danger', function () { commit(function (x) { E.setScore(x, m.n, m.i, null, null); }); closeModal(); }) : null,
          btn('Cancel', '', closeModal),
          btn('Save score', 'primary', saveScore, { disabled: !ready, id: 'saveScore' })
        ])
      ];
    }
    return h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', onclick: function (e) { if (e.target === e.currentTarget && m.type !== 'key') closeModal(); } }, h('div', { class: 'sheet' }, body));
  }

  // ---------------------------------------------------------------- go
  setInterval(watch, 5000);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) { watch(); flush(); } });
  window.addEventListener('online', flush);
  window.addEventListener('beforeunload', function (e) { if (state.dirty) { e.preventDefault(); e.returnValue = ''; } });
  boot();
})();
