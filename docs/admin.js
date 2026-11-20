/* Padel Socials — iPad admin page. */
(function () {
  'use strict';
  var E = window.Engine, S = window.Store, L = window.Look, V = window.Voice;
  var root = document.getElementById('app');
  var MAX_COURT = 7;         // the club has courts 1 to 7

  var state = {
    phase: 'boot',            // boot | nodb | error | series | night
    error: '',
    series: {}, seriesId: null,
    session: null,            // the night being edited (working copy)
    remote: null,             // the copy known to be saved
    remoteResults: null,
    liveRev: null, livePing: 0,
    screens: {}, pairTv: null,
    ratings: {},              // players' WPR Social ratings, by name (pub/ratings)
    version: 0, dirty: false, saving: false, saveError: '', needKey: false,
    regulars: [],
    ui: { p1: '', p2: '', modal: null, toast: '', newSeries: '', newFormat: 'kings-fixed', keyInput: '', prevOpen: false, focus: null, tvCode: '', tvEvent: '' }
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
  var FLYERS = '@flyers', SPECIAL = '@special';     // a TV can show one of the two flyer slideshows instead of a social
  function showName(id) { return id === FLYERS ? 'the club flyers' : id === SPECIAL ? 'the special event flyers' : (state.series[id] || {}).name || 'that social'; }
  function slug(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'event'; }
  function teamNameOf(id) { var t = state.session.teams[id]; return t ? t.name : '(removed)'; }
  function sideNameOf(c, side) { return E.sideName(state.session, c, side); }      // a team, or the two players paired for that round
  // Words for the night's format: "team" and "teams" with fixed partners, "player" and "players" when everyone plays for themselves.
  function words(s) { var f = E.formatOf(s); return { solo: f.solo, per: f.per, one: f.unit, many: f.units, One: f.unit.charAt(0).toUpperCase() + f.unit.slice(1), Many: f.units.charAt(0).toUpperCase() + f.units.slice(1) }; }

  // ---------------------------------------------------------------- loading and saving
  function boot() {
    var m = /[#&]k=([^&]+)/.exec(location.hash || '');
    if (m) { S.setKey(decodeURIComponent(m[1])); history.replaceState(null, '', location.pathname + location.search); }
    if (!S.configured) { state.phase = 'nodb'; return render(); }
    render();
    var q = new URLSearchParams(location.search);
    var tv = (q.get('tv') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
    if (tv.length === 4) {            // arrived by scanning a TV: ask what that TV should show
      state.pairTv = tv;
      history.replaceState(null, '', location.pathname);
    }
    S.get('pub/series').then(function (list) {
      state.series = list || {};
      var want = q.get('s') || S.pref('series');
      var ids = Object.keys(state.series);
      if (state.pairTv) { state.phase = 'series'; state.ui.modal = { type: 'pair', code: state.pairTv }; loadScreens(); return render(); }
      if (want && state.series[want]) return openSeries(want);
      if (ids.length === 1) return openSeries(ids[0]);
      state.phase = 'series'; loadScreens(); render();
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
    loadRatings();
    return S.get('pub/live/' + id).then(function (live) {
      if (!live || !live.sessionId) return null;
      state.liveRev = live.rev; state.livePing = live.ping || 0;
      return S.get('pub/sessions/' + id + '/' + live.sessionId);
    }).then(function (data) {
      var s = E.normalize(data);
      if (s && !s.discarded) {
        state.session = s; state.remote = E.clone(s);
        state.remoteResults = resultsFor(s);
        state.dirty = false;
      } else newNight(s && s.discarded ? s : null);
      state.phase = 'night'; render();
      applyPhoneScores();
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
      courts: prev ? prev.courts : (meta.courts || []), round1: prev ? prev.round1 : 'random', setTo: prev ? prev.setTo : 4
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
      if (!live || state.dirty || state.saving || id !== state.seriesId) return;
      if (live.rev !== state.liveRev) return loadNight();
      if ((live.ping || 0) !== state.livePing) { state.livePing = live.ping || 0; return applyPhoneScores(); }
    }).catch(function () { /* offline for a moment: the next tick tries again */ });
  }
  // Scores that players sent from their phones for the round on court: put them into the night. When the
  // last court comes in, this also starts the next round, exactly as if it had been typed here.
  function applyPhoneScores() {
    var s = state.session, id = state.seriesId, cur = s ? E.currentRound(s) : null;
    if (!s || s.status !== 'live' || !cur) return Promise.resolve();
    return S.get('pub/scores/' + id + '/' + s.id + '/r' + cur.n).then(function (entries) {
      if (state.session !== s || !entries || !E.pendingPlayerScores(s, cur.n, entries).length) return;
      var out = commit(function (x) { return E.applyPlayerScores(x, cur.n, entries); });
      if (out.applied.length) {
        var last = out.applied[out.applied.length - 1];
        toast(out.advanced ? 'Last score came in from a phone. Round ' + (cur.n + 1) + ' is up.' :
          'Court ' + last.court + ': ' + last.sa + '\u2013' + last.sb + ' sent from a phone.');
        render();
      }
    }).catch(function () { /* tried again on the next change */ });
  }

  // ---- Each social's flyer and look (see look.js). The pictures go to pub/eventflyers/{id}; the rest sits with the social.
  function lookOf(id) { return E.clone((state.series[id] || {}).look || {}); }
  function saveLook(id, look, extra, okMsg) {
    var up = {};
    Object.keys(extra || {}).forEach(function (k) { up['pub/eventflyers/' + id + '/' + k] = extra[k]; });
    Object.keys(look).forEach(function (k) { if (look[k] === null || look[k] === undefined || look[k] === false) delete look[k]; });
    up['pub/series/' + id + '/look'] = Object.keys(look).length ? look : null;
    var again = function () { saveLook(id, look, extra, okMsg); };
    state.ui.lookBusy = extra ? 'Saving…' : ''; render();
    return S.write(up).then(function () {
      state.series[id].look = look; state.ui.lookBusy = '';
      if (okMsg) toast(okMsg);
      render();
    }).catch(function (err) {
      state.ui.lookBusy = '';
      if (err.status === 401 || err.status === 403) { var back = state.ui.modal; state.ui.modal = { type: 'key', wrong: !!S.getKey(), then: function () { state.ui.modal = back; again(); } }; render(); }
      else { toast('Could not save: ' + err.message); render(); }
    });
  }
  // kind: 'wide' (landscape: the TV between rounds, and the banner's colours) or 'tall' (portrait: players' phones)
  function addFlyer(id, kind, file) {
    if (!file || state.ui.lookBusy) return;
    state.ui.lookBusy = 'Preparing the picture…'; render();
    L.readImage(file).then(function (img) {
      var look = lookOf(id), extra = {};
      if (kind === 'wide') {
        extra.wide = L.fitted(img, 1920, 1080);
        look.wide = true; look.thumbW = L.shrink(img, 360, 360, 0.7);
        look.cands = L.palette(img); look.variant = 0;
        if (!look.tall) extra.phone = L.fitted(img, 1200, 1200);       // phones show the wide flyer until there is a tall one
      } else {
        extra.phone = L.fitted(img, 1080, 1920);
        look.tall = true; look.thumbT = L.shrink(img, 360, 360, 0.7);
        if (!look.wide) { look.cands = L.palette(img); look.variant = 0; }
      }
      if (!look.pattern) look.pattern = 'confetti';
      look.rev = Date.now();
      URL.revokeObjectURL(img.src);
      state.ui.lookBusy = '';
      return saveLook(id, look, extra, kind === 'wide' ? 'Flyer saved. The TV banner now follows its colours.' : 'Phone flyer saved.');
    }).catch(function (err) { state.ui.lookBusy = ''; toast((err && err.message) || 'That picture could not be used.'); render(); });
  }
  function removeFlyer(id, kind) {
    if (state.ui.lookBusy) return;
    var look = lookOf(id), extra = {}, other = kind === 'wide' ? 'tall' : 'wide';
    look[kind] = null; look[kind === 'wide' ? 'thumbW' : 'thumbT'] = null; look.rev = Date.now();
    if (kind === 'wide') extra.wide = null;
    if (!look[other]) { extra.phone = null; look.cands = null; look.variant = null; return saveLook(id, look, extra, 'Flyer removed.'); }
    if (kind === 'wide') return saveLook(id, look, extra, 'Wide flyer removed.');      // phones keep the tall one
    // the tall one goes: phones fall back to the wide flyer, made phone-sized from the stored copy
    state.ui.lookBusy = 'Saving…'; render();
    S.get('pub/eventflyers/' + id + '/wide').then(function (data) { return L.fromDataUrl(data); }).then(function (img) {
      extra.phone = L.fitted(img, 1200, 1200);
      state.ui.lookBusy = '';
      return saveLook(id, look, extra, 'Phone flyer removed. Phones show the wide flyer again.');
    }).catch(function (err) { state.ui.lookBusy = ''; toast('Could not do that: ' + ((err && err.message) || err)); render(); });
  }

  // ---- TVs: which event each paired screen shows
  function loadScreens() {
    return S.get('pub/screens').then(function (all) { state.screens = all || {}; render(); }).catch(function () { /* optional */ });
  }
  function saveScreen(code, patch, done) {
    var cur = state.screens[code] || {};
    var next = { seriesId: patch.seriesId !== undefined ? patch.seriesId : (cur.seriesId || ''), name: patch.name !== undefined ? patch.name : (cur.name || ''), at: Date.now() };
    var up = {}; up['pub/screens/' + code] = patch.remove ? null : next;
    var again = function () { saveScreen(code, patch, done); };
    S.write(up).then(function () {
      if (patch.remove) delete state.screens[code]; else state.screens[code] = next;
      if (done) done(); else render();
    }).catch(function (err) {
      if (err.status === 401 || err.status === 403) { state.ui.modal = { type: 'key', wrong: !!S.getKey(), then: again }; render(); }
      else { toast('Could not save: ' + err.message); render(); }
    });
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
      h('h1', null, state.phase === 'night' ? (meta.name || 'Padel Socials') : 'Padel Socials' + (S.club.name ? ' · ' + S.club.name : '')),
      pill, h('span', { class: 'spacer' }), sync,
      state.phase === 'night' ? h('button', { class: 'linkbtn', type: 'button', onclick: function () { state.ui.modal = { type: 'tv' }; render(); } }, 'TV screen') : null,
      state.phase === 'night' ? h('button', { class: 'linkbtn', type: 'button', onclick: function () { state.phase = 'series'; loadScreens(); render(); } }, 'Events') : null
    ]);
  }

  function seriesView() {
    var ids = Object.keys(state.series).sort(function (a, b) { return state.series[a].name < state.series[b].name ? -1 : 1; });
    var create = function () {
      var name = state.ui.newSeries.replace(/\s+/g, ' ').trim();
      if (!name) return;
      var id = slug(name), n = 2;
      while (state.series[id]) id = slug(name) + '-' + n++;
      var fmt = E.FORMATS[state.ui.newFormat] ? state.ui.newFormat : 'kings-fixed';
      var meta = { name: name, format: fmt, scoring: E.FORMATS[fmt].scoring, created: E.localDate(new Date()) };
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
          return h('div', { class: 'seriesrow' }, [
            btn([state.series[id].name, h('span', { class: 'hint' }, '  ' + E.formatOf(state.series[id].format).name)], '', function () { openSeries(id); }, { 'data-open': id }),
            btn('Flyer', 'small', function () { state.ui.modal = { type: 'look', id: id }; render(); }, { 'data-look': id }),
            btn('Rename', 'small', function () { state.ui.modal = { type: 'renameSeries', id: id, name: state.series[id].name }; state.ui.focus = 'seriesName'; render(); }, { 'data-rename': id })
          ]);
        }))
      ]) : null,
      h('div', { class: 'panel' }, [
        h('h2', null, ids.length ? 'Add another event' : 'Name your first event'),
        h('p', { class: 'hint' }, 'One event per weekly social, for example “Padel Date Night”. Each event keeps its own monthly leaderboard.'),
        h('div', { class: 'row', style: 'margin-top:10px' }, [
          h('input', { type: 'text', id: 'newSeries', placeholder: 'Event name', value: state.ui.newSeries, maxlength: 60, style: 'flex:1',
            oninput: function (e) { state.ui.newSeries = e.target.value; }, onkeydown: function (e) { if (e.key === 'Enter') create(); } }),
          btn('Create', 'primary', create)
        ]),
        h('div', { style: 'margin-top:12px;font-weight:600' }, 'Format'),
        h('div', { class: 'fmtpick' }, Object.keys(E.FORMATS).filter(function (f) { return !S.club.formats || S.club.formats.indexOf(f) >= 0; }).map(function (f) {
          var on = state.ui.newFormat === f;
          return h('button', { type: 'button', class: 'fmt' + (on ? ' on' : ''), 'data-format': f, 'aria-pressed': on ? 'true' : 'false', onclick: function () { state.ui.newFormat = f; render(); } }, [
            h('b', null, E.FORMATS[f].name),
            h('span', null, f === 'wheel'
              ? 'Everyone signs up alone and a wheel on the TV picks the partners. How the day runs depends on how many came: new partners after every set with 4 to 7 players; with 8 or more, the same partner all day, pool rounds and play-offs. Points and the leaderboard are per player.'
              : f === 'kings-individual'
              ? 'Everyone signs up alone. After each round the pairs split: the two winners move up a court and face each other with new partners, the two losers move down and split. Points and the leaderboard are per player.'
              : 'Couples sign up together and stay together all night. Winners move up a court, losers move down. Points and the leaderboard are per couple.')
          ]);
        })),
        h('p', { class: 'hint' }, 'Every game won is a point in all of them. The format is chosen once, when the event is created.')
      ]),
      h('div', { class: 'panel' }, [
        h('h2', null, ['Flyers', h('small', null, 'two slideshows for the TVs')]),
        h('p', { class: 'hint', style: 'margin:0 0 10px' }, 'Any TV can show either one, a new flyer every 15 seconds: the club’s everyday flyers (with the monthly leaderboards), or the flyers for a special event. On the TV, choose one from its main menu.'),
        h('div', { class: 'row' }, [
          h('a', { class: 'btn', href: S.here('flyers'), target: S.framed ? '_top' : null, id: 'openFlyers', style: 'display:inline-flex;align-items:center;text-decoration:none;color:inherit' }, 'Open club flyers'),
          h('a', { class: 'btn', href: S.here('flyers', { set: 'special' }), target: S.framed ? '_top' : null, id: 'openSpecial', style: 'display:inline-flex;align-items:center;text-decoration:none;color:inherit' }, 'Open special event flyers')
        ])
      ]),
      ids.length ? tvsPanel(ids) : null
    ]);
  }

  function tvsPanel(ids) {
    var codes = Object.keys(state.screens).sort();
    var options = function (selected) {
      return [h('option', { value: '' }, 'Choose…')].concat(ids.map(function (id) {
        return h('option', { value: id, selected: id === selected }, state.series[id].name);
      })).concat([h('option', { value: FLYERS, selected: selected === FLYERS }, 'Club flyers'), h('option', { value: SPECIAL, selected: selected === SPECIAL }, 'Special event flyers')]);
    };
    var add = function () {
      var code = state.ui.tvCode.toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (code.length !== 4) { toast('The TV code has four letters or numbers. It is shown on the TV.'); return render(); }
      if (!state.ui.tvEvent) { toast('Choose what that TV should show.'); return render(); }
      saveScreen(code, { seriesId: state.ui.tvEvent }, function () { state.ui.tvCode = ''; toast('TV ' + code + ' now shows ' + showName(state.ui.tvEvent) + '.'); render(); });
    };
    return h('div', { class: 'panel' }, [
      h('h2', null, ['TVs', h('small', null, 'what each screen shows')]),
      codes.length ? h('div', { class: 'tvlist' }, codes.map(function (code) {
        var scr = state.screens[code];
        return h('div', { class: 'tvitem', 'data-tv': code }, [
          h('span', { class: 'code' }, code),
          h('input', { type: 'text', id: 'tvname-' + code, placeholder: 'Name, e.g. Bar', maxlength: 24, value: scr.name || '', 'aria-label': 'Name of TV ' + code,
            onchange: function (e) { saveScreen(code, { name: e.target.value.trim() }); } }),
          h('select', { id: 'tvevent-' + code, 'aria-label': 'Social shown on TV ' + code, onchange: function (e) { if (e.target.value) saveScreen(code, { seriesId: e.target.value }, function () { toast('TV ' + code + ' now shows ' + showName(e.target.value) + '.'); render(); }); } }, options(scr.seriesId)),
          btn('Remove', 'small danger', function () { saveScreen(code, { remove: true }); }, { 'aria-label': 'Remove TV ' + code })
        ]);
      })) : h('p', { class: 'hint' }, 'No TV has been set from here yet. Every TV has a main menu of its own; its four-character code is on that menu and in the corner of the screen.'),
      h('div', { class: 'tvadd' }, [
        h('input', { type: 'text', id: 'tvCode', placeholder: 'TV code', maxlength: 4, autocapitalize: 'characters', autocomplete: 'off', value: state.ui.tvCode,
          oninput: function (e) { state.ui.tvCode = e.target.value; }, onkeydown: function (e) { if (e.key === 'Enter') add(); } }),
        h('select', { id: 'tvEvent', 'aria-label': 'Social for the new TV', onchange: function (e) { state.ui.tvEvent = e.target.value; } }, options(state.ui.tvEvent)),
        btn('Add TV', 'primary', add, { id: 'addTv' })
      ]),
      h('p', { class: 'hint' }, 'Scan the QR code on a TV’s main menu, or type its code here. The small code in the corner of each TV tells you which is which. Whatever was chosen last, here or on the TV itself, is what the TV shows.')
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
    if (E.isWheel(s)) return wheelSetup(s);
    var teams = E.teamList(s), N = teams.length, C = s.courts.length;
    var W = words(s), k = Math.min(C, Math.floor(N / W.per)), sit = N - W.per * k;
    var summary = !C ? 'Pick the courts first.' : N < W.per ? (W.solo ? 'Add at least four players.' : 'Add at least two teams.') :
      N + ' ' + W.many + ' on ' + k + (k === 1 ? ' court' : ' courts') + ': ' + (W.per * k) + ' play, ' + (sit ? sit + (sit === 1 ? ' sits' : ' sit') + ' out each round.' : 'nobody sits out.') +
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
            h('p', { class: 'hint' }, s.round1 === 'seeded' ? (W.solo ? 'Seeded: the player list order is the seeding. Players 1 to 4 start on King’s Court, 1 with 4 against 2 with 3. Use the arrows to reorder.' : 'Seeded: the team list order is the seeding. Teams 1 and 2 start on King’s Court. Use the arrows to reorder.')
              : (W.solo ? 'Random: players are drawn onto courts and into pairs at random.' : 'Random: teams are drawn onto courts at random.'))
          ])),
        h('div', { class: 'a-sets' },
          h('div', { class: 'panel' }, [
            h('h2', null, ['Sets', h('small', null, 'played to')]),
            setsControl(s),
            h('p', { class: 'hint' }, 'Every game won is a point, so a set to ' + s.setTo + ' is worth up to ' + s.setTo + ' points.')
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

  // ---- Wheel of Fortune: the wheel makes the pairs; the head count decides how the day runs.
  function sitPicker(s, plan) {
    var players = E.activeTeams(s), ids = players.map(function (t) { return t.id; });
    var chosen = (state.ui.wheelSit || []).filter(function (id) { return ids.indexOf(id) >= 0; }).slice(0, plan.sit);
    state.ui.wheelSit = chosen;
    var toggle = function (id) {
      var at = chosen.indexOf(id);
      if (at >= 0) chosen.splice(at, 1); else { if (chosen.length >= plan.sit) chosen.shift(); chosen.push(id); }
      state.ui.wheelSit = chosen; render();
    };
    return h('div', { class: 'sitpick' }, [
      h('b', null, 'Who sits out first?'),
      h('p', { class: 'hint', style: 'margin:2px 0 8px' }, 'Tap a name, for example an ambassador. Leave it and the wheel picks someone who has sat the least.'),
      h('div', { class: 'regulars' }, players.map(function (t) {
        var on = chosen.indexOf(t.id) >= 0;
        return h('button', { type: 'button', class: on ? 'on' : '', 'data-sit': t.name, 'aria-pressed': on ? 'true' : 'false', onclick: function () { toggle(t.id); } }, t.name);
      }))
    ]);
  }
  function spinWheel() {
    var first = state.session.status === 'setup';
    var out = commit(function (x) {
      if (first) { x.date = E.localDate(new Date()); x.month = x.date.slice(0, 7); }
      return E.wheelSpin(x, { sit: state.ui.wheelSit || [] });
    });
    state.ui.wheelSit = [];
    toast(out.ok ? 'The wheel is spinning on the TV. It stays there until you press “Show the courts”.' : out.error);
    render();
  }
  function wheelSetup(s) {
    var N = E.teamList(s).length, C = s.courts.length, plan = E.wheelPlan(N);
    var summary = !C ? 'Pick the courts first.' : !plan ? 'Add at least four players.' : N + ' players on ' + C + (C === 1 ? ' court' : ' courts') + ', ' + plan.teams + ' teams' + (plan.sit ? ', ' + plan.sit + ' sitting out' : '') + '.';
    return h('div', { class: 'wrap' }, [
      h('div', { class: 'setupgrid wheel' }, [
        h('div', { class: 'a-teams' }, teamsPanel(s, true)),
        h('div', { class: 'a-courts' }, courtsPanel(s)),
        h('div', { class: 'a-r1' },
          h('div', { class: 'panel', id: 'wheelPlan' }, [
            h('h2', null, ['How today runs', h('small', null, 'decided by how many came')]),
            h('p', { class: 'sitlist', style: 'margin:0' }, plan ? N + ' players. ' + plan.text : 'The wheel needs at least four players. The format is set when you spin: 4 or 5 players play sets to 6 with a new partner each time, 6 or 7 make three teams, 8 and more keep the same partner all day and finish with play-offs.'),
            plan && plan.sit ? sitPicker(s, plan) : null,
            h('p', { class: 'hint' }, 'Every game a pair wins is a point for both of its players, play-offs included.')
          ])),
        h('div', { class: 'a-start' },
          h('div', { class: 'panel startbar' }, [
            h('p', { class: 'sitlist' }, summary),
            btn('Spin the wheel', 'gold', spinWheel, { disabled: !plan || !C, id: 'startNight' })
          ]))
      ])
    ]);
  }
  // What the organizer does next on a wheel day: spin for new partners, or finish.
  function wheelNext(s) {
    var state2 = E.wheelState(s), N = E.activeTeams(s).length, plan = E.wheelPlan(N);
    // after a spin the TV keeps the wheels and the pairs up until the organizer moves it on
    if (s.wheel && s.wheel.hold && state2 === 'playing') return h('div', { class: 'panel wheelnext', id: 'wheelHold' }, [
      h('h2', null, 'The pairs are on the TV'),
      h('p', { class: 'sitlist', style: 'margin:0' }, 'The wheels stay on the screen so everyone can find their partner. When they have, send the TV on to the courts.'),
      h('div', { class: 'row end', style: 'margin-top:10px' }, btn('Show the courts on the TV', 'gold', function () { commit(function (x) { E.wheelRelease(x); }); toast('The TV now shows the courts.'); render(); }, { id: 'showCourts' }))
    ]);
    if (state2 === 'spin') return h('div', { class: 'panel wheelnext', id: 'wheelNext' }, [
      h('h2', null, 'Time to spin the wheel'),
      h('p', { class: 'sitlist', style: 'margin:0' }, plan ? 'New partners for everyone. ' + N + ' players: ' + plan.text : 'The wheel needs at least four players.'),
      plan && plan.sit ? sitPicker(s, plan) : null,
      h('div', { class: 'row end', style: 'margin-top:10px' }, btn('Spin the wheel', 'gold', spinWheel, { disabled: !plan, id: 'spinWheel' }))
    ]);
    if (state2 === 'done') return h('div', { class: 'panel wheelnext', id: 'wheelNext' }, [
      h('h2', null, 'All matches played'),
      h('p', { class: 'sitlist', style: 'margin:0' }, 'End the day to save the points to the monthly leaderboard. Time left? Spin again for new partners and another block.'),
      h('div', { class: 'row end', style: 'margin-top:10px' }, [btn('Spin again', '', spinWheel, { disabled: !plan, id: 'spinWheel' }), btn('End the day', 'gold', endNightAsk, { id: 'endDay' })])
    ]);
    return null;
  }
  // The teams the wheel made, ranked: this is what decides who meets whom in the play-offs.
  function poolPanel(s) {
    var w = s.wheel, rows = w ? E.wheelStandings(s) : [];
    if (!rows.length) return null;
    var nm = function (row) { return row.players.filter(function (id) { return s.teams[id] && !s.teams[id].left; }).map(teamNameOf).join(' & ') || '(left)'; };
    return h('div', { class: 'panel', id: 'poolTable' }, [
      h('h2', null, ['Teams', h('small', null, w.respin ? 'until the next spin' : 'ranked by matches won, then games')]),
      h('table', { class: 'board pooltable' }, [
        h('thead', null, h('tr', null, [h('th', null, ''), h('th', null, 'Pair'), h('th', null, 'Won'), h('th', null, 'Lost'), h('th', null, 'Games')])),
        h('tbody', null, rows.map(function (r) {
          return h('tr', null, [h('td', null, String(r.rank)), h('td', { class: 'pair' }, nm(r)), h('td', { class: 'num' }, String(r.won)), h('td', { class: 'num' }, String(r.lost)), h('td', { class: 'num' }, r.gf + '–' + r.ga)]);
        }))
      ])
    ]);
  }
  function endNightAsk() {
    state.ui.modal = { type: 'confirm', title: 'End the night?', text: 'Tonight’s results are saved to the monthly leaderboard and the TV shows the final standings. You can reopen the night if you end it by mistake.', ok: 'End night', danger: true,
      onOk: function () { commit(function (x) { E.endNight(x); }); render(); } };
    render();
  }
  function roundTitle(r) { return r.title ? r.title : 'Round ' + r.n; }
  function roundName(r) { return r.title ? 'Round ' + r.n + ' · ' + r.title : 'Round ' + r.n; }

  function setsControl(s) {
    var opt = function (n) {
      return h('button', { type: 'button', class: s.setTo === n ? 'on' : '', 'data-sets': n, 'aria-pressed': s.setTo === n ? 'true' : 'false',
        onclick: function () { commit(function (x) { x.setTo = n; }); } }, n + ' games');
    };
    return h('div', { class: 'seg' }, [opt(4), opt(6)]);
  }

  // The court buttons: tap from the bottom court up to King's Court. `courts` is the list being edited.
  function courtPicker(courts, onChange) {
    var chips = [], wheel = !!state.session && E.isWheel(state.session);
    for (var n = 1; n <= MAX_COURT; n++) (function (n) {
      var i = courts.indexOf(n), king = i >= 0 && i === courts.length - 1;
      chips.push(h('button', { type: 'button', class: 'chip' + (i >= 0 ? ' on' : '') + (king ? ' king' : ''), 'aria-pressed': i >= 0 ? 'true' : 'false', 'data-court': n,
        onclick: function () { var next = courts.slice(), j = next.indexOf(n); if (j >= 0) next.splice(j, 1); else next.push(n); onChange(next); } },
        [String(n), i >= 0 ? h('span', { class: 'ord' }, king ? (wheel ? 'Main' : 'King') : String(i + 1)) : null]));
    })(n);
    return [
      h('div', { class: 'courtpick' }, chips),
      courts.length ? (wheel ? h('div', { class: 'ladder' }, [courts.slice(0, -1).join(' · ') + (courts.length > 1 ? ' · ' : ''), h('b', null, courts[courts.length - 1] + ' main court')])
        : h('div', { class: 'ladder' }, ['Bottom: ' + courts.slice(0, -1).join(' → ') + (courts.length > 1 ? ' → ' : ''), h('b', null, courts[courts.length - 1] + ' King’s Court')])) : h('p', { class: 'hint' }, 'No courts picked yet.'),
      courts.length ? h('div', { class: 'row', style: 'margin-top:8px' }, [
        btn('Sort low to high', 'small', function () { onChange(courts.slice().sort(function (a, b) { return a - b; })); }),
        btn('Reverse order', 'small', function () { onChange(courts.slice().reverse()); }),
        btn('Clear', 'small', function () { onChange([]); })
      ]) : null
    ];
  }
  function courtsPanel(s) {
    return h('div', { class: 'panel' }, [
      h('h2', null, ['Courts', h('small', null, E.isWheel(s) ? 'tap the courts you have; the last one is the main court' : 'tap from the bottom court up to King’s Court')]),
      courtPicker(s.courts, function (next) { commit(function (x) { E.setCourts(x, next); }); })
    ]);
  }

  function teamsPanel(s, setup) {
    var teams = E.teamList(s), cur = E.currentRound(s), W = words(s);
    var add = function () {
      var p = W.solo ? [state.ui.p1] : [state.ui.p1, state.ui.p2];
      if (!p.join('').trim()) return;
      var res = commit(function (x) { return E.addTeam(x, p); });
      if (!res) toast('That ' + W.one + ' is already on the list.');
      else { state.ui.p1 = ''; state.ui.p2 = ''; if (!setup) toast(joinNote(res)); }
      state.ui.focus = 'p1'; render();
    };
    var wheel = E.isWheel(s);
    var joinNote = function (res) {                       // what happens to someone added after the start
      if (!wheel) return res.name + ' joins from the next round.';
      var tm = ((state.session.wheel || {}).teams || []).filter(function (x) { return x.indexOf(res.id) >= 0; })[0];
      var mate = tm ? tm.filter(function (x) { return x !== res.id && state.session.teams[x] && !state.session.teams[x].left; })[0] : null;
      return mate ? res.name + ' plays with ' + teamNameOf(mate) + ' from the next round.' : res.name + ' is on the list and gets a partner at the next spin of the wheel.';
    };
    var status = function (t) {
      if (t.left) return 'Left';
      if (setup || !cur) return '';
      var c = cur.courts.filter(function (c) { return !c.void && !!E.sideOf(c, t.id); })[0];
      if (c) return (c.wait ? 'Next on court ' : 'Court ') + c.court;
      if (wheel) return ((s.wheel || {}).teams || []).some(function (x) { return x.indexOf(t.id) >= 0; }) ? 'Resting' : ((s.wheel || {}).sit || []).indexOf(t.id) >= 0 ? 'Sitting out' : 'Waits for the next spin';
      if (cur.sitting.indexOf(t.id) >= 0) return 'Sitting out';
      return 'Joins next round';
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
      h('h2', null, [W.Many, h('small', null, teams.filter(function (t) { return !t.left; }).length + (setup ? ' entered' : ' playing tonight'))]),
      W.solo ? h('div', { class: 'addteam solo' }, [
        h('input', { type: 'text', id: 'p1', placeholder: 'Player name', value: state.ui.p1, maxlength: 30, autocapitalize: 'words', autocomplete: 'off',
          oninput: function (e) { state.ui.p1 = e.target.value; }, onkeydown: function (e) { if (e.key === 'Enter') add(); } }),
        btn(setup ? 'Add player' : 'Add late player', 'primary', add, { id: 'addTeam' })
      ]) : h('div', { class: 'addteam' }, [
        h('input', { type: 'text', id: 'p1', placeholder: 'Player 1', value: state.ui.p1, maxlength: 30, autocapitalize: 'words', autocomplete: 'off',
          oninput: function (e) { state.ui.p1 = e.target.value; }, onkeydown: function (e) { if (e.key === 'Enter') document.getElementById('p2').focus(); } }),
        h('span', { class: 'amp' }, '&'),
        h('input', { type: 'text', id: 'p2', placeholder: 'Player 2', value: state.ui.p2, maxlength: 30, autocapitalize: 'words', autocomplete: 'off',
          oninput: function (e) { state.ui.p2 = e.target.value; }, onkeydown: function (e) { if (e.key === 'Enter') add(); } }),
        btn(setup ? 'Add team' : 'Add late team', 'primary', add, { id: 'addTeam' })
      ]),
      S.voiceURL && V && V.supported ? h('div', { class: 'row', style: 'margin-top:10px' }, [
        btn([h('span', { 'aria-hidden': 'true' }, '\uD83C\uDFA4 '), 'Speak the names'], '', openVoice, { id: 'speakNames' }),
        h('span', { class: 'hint', style: 'margin:0' }, W.solo ? 'Say the players’ names; check the list; add them all at once.' : 'Say the couples’ names; check the list; add them all at once.')
      ]) : null,
      regs.length ? h('div', null, [h('p', { class: 'hint' }, 'Played before (tap to add):'), h('div', { class: 'regulars' }, regs.map(function (r) {
        return h('button', { type: 'button', onclick: function () { var res = commit(function (x) { return E.addTeam(x, r.players); }); if (res && !setup) toast(joinNote(res)); } }, '+ ' + r.name);
      }))]) : null,
      h('ul', { class: 'teamlist' }, teams.map(function (t, i) {
        return h('li', { class: t.left ? 'gone' : '' }, [
          setup && s.round1 === 'seeded' ? h('span', { class: 'seed' }, String(i + 1)) : null,
          h('button', { type: 'button', class: 'nm nmbtn', 'data-edit': t.name, 'aria-label': 'Edit the name of ' + t.name, onclick: function () { editTeam(t); } }, t.name),
          h('span', { class: 'st' }, status(t)),
          btn('Edit', 'small', function () { editTeam(t); }, { 'aria-label': 'Edit ' + t.name }),
          setup && s.round1 === 'seeded' ? btn('▲', 'small', function () { move(t, -1); }, { 'aria-label': 'Move ' + t.name + ' up', disabled: i === 0 }) : null,
          setup && s.round1 === 'seeded' ? btn('▼', 'small', function () { move(t, 1); }, { 'aria-label': 'Move ' + t.name + ' down', disabled: i === teams.length - 1 }) : null,
          t.left ? btn('Bring back', 'small', function () { commit(function (x) { x.teams[t.id].left = null; }); toast(t.name + (wheel ? ' is back on the list.' : ' rejoins from the next round.')); render(); })
            : btn('Remove', 'small danger', function () { removeTeam(t); }, { 'aria-label': 'Remove ' + t.name })
        ]);
      })),
      !teams.length ? h('p', { class: 'hint' }, W.solo ? 'No players yet. Type a name and press Add player.' : 'No teams yet. Type the two players and press Add team.') : null
    ]);
  }
  // ---- Speak the names: record, let the speech service write the names down, check them, add them.
  var voiceTimer = null;
  function openVoice() { state.ui.modal = { type: 'voice', step: 'idle', items: [], msg: '' }; render(); }
  function closeVoice() { clearInterval(voiceTimer); if (V) V.cancel(); state.ui.modal = null; render(); }
  function voiceStart() {
    var m = state.ui.modal;
    if (!S.getKey()) { state.ui.modal = { type: 'key', wrong: false, then: function () { state.ui.modal = m; render(); } }; return render(); }
    m.step = 'asking'; m.msg = ''; render();
    V.start().then(function (t0) {
      m.step = 'rec'; m.t0 = t0; render();
      clearInterval(voiceTimer);
      voiceTimer = setInterval(function () {
        if (state.ui.modal !== m || m.step !== 'rec') return clearInterval(voiceTimer);
        if (Date.now() - m.t0 >= V.maxMs) return voiceStop();
        var el = document.getElementById('voiceClock'); if (el) el.textContent = voiceClock(m);
      }, 250);
    }).catch(function () { m.step = 'error'; m.msg = 'The microphone could not be used. Allow the microphone for this page in the browser’s settings and try again.'; render(); });
  }
  function voiceClock(m) { var sec = Math.floor((Date.now() - m.t0) / 1000); return Math.floor(sec / 60) + ':' + (sec % 60 < 10 ? '0' : '') + (sec % 60); }
  function voiceStop() {
    var m = state.ui.modal, s = state.session, solo = E.isSolo(s);
    clearInterval(voiceTimer);
    m.step = 'work'; render();
    // names the club already knows help the service spell what it hears
    var known = {};
    E.teamList(s).forEach(function (t) { t.players.forEach(function (p) { known[p] = 1; }); });
    state.regulars.forEach(function (r) { (r.players || []).forEach(function (p) { known[p] = 1; }); });
    Object.keys(state.ratings || {}).forEach(function (k) { if (state.ratings[k].name) known[state.ratings[k].name] = 1; });
    var knownText = Object.keys(known).join(', ').replace(/["\\\u0000-\u001f]/g, ' ').slice(0, 1800);
    V.stop().then(function (rec) {
      if (rec.seconds < 0.7) throw new Error('That was too short. Press Start and say the names.');
      var body = new URLSearchParams({ key: S.getKey(), format: solo ? 'solo' : 'team', known: knownText, audio: rec.audio });
      return fetch(S.voiceURL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString() }).then(function (res) { return res.text(); });
    }).then(function (txt) {
      var data = null;
      try { data = JSON.parse(txt); } catch (e) { data = null; }
      if (state.ui.modal !== m) return;
      if (!data || typeof data !== 'object') throw new Error('The voice service did not answer properly. Try again in a moment.');
      if (!data.ok) {
        if (data.status === 'key') throw new Error('The voice service did not accept this device’s admin key.');
        if (data.status === 400 || data.status === 401 || data.status === 403) throw new Error('The voice service is not set up yet: the Gemini key is missing or was not accepted.');
        if (data.status === 429 || data.status === 503) throw new Error('The voice service is busy right now. Wait a few seconds and try again.');
        throw new Error('The voice service could not read the recording (code ' + data.status + '). Try again.');
      }
      var r = data.result || {}, clean = function (x) { return String(x === null || x === undefined ? '' : x).replace(/\s+/g, ' ').trim().slice(0, 30); };
      var players = (Array.isArray(r.players) ? r.players : []).map(clean).filter(Boolean);
      var teams = (Array.isArray(r.teams) ? r.teams : []).map(function (t) { return (Array.isArray(t) ? t : [t]).map(clean).filter(Boolean); }).filter(function (t) { return t.length; });
      var items;
      if (solo) items = (players.length ? players : [].concat.apply([], teams)).map(function (p) { return { p1: p, p2: '' }; });
      else {
        if (!teams.length) for (var i = 0; i < players.length; i += 2) teams.push(players.slice(i, i + 2));
        items = teams.map(function (t) { return { p1: t[0] || '', p2: t[1] || '' }; });
      }
      if (!items.length) throw new Error('No names came through. Speak a little closer to the microphone and try again.');
      m.items = items; m.step = 'review'; render();
    }).catch(function (err) {
      if (state.ui.modal !== m) return;
      m.step = 'error'; m.msg = (err && err.message) || 'Something went wrong. Try again.'; render();
    });
  }
  function voiceAdd() {
    var m = state.ui.modal, solo = E.isSolo(state.session), added = 0, skipped = [];
    var late = state.session.status !== 'setup';
    commit(function (x) {
      m.items.forEach(function (it) {
        var p = solo ? [it.p1] : [it.p1, it.p2];
        if (!p.join('').trim()) return;
        if (E.addTeam(x, p)) added++; else skipped.push(E.teamName(p));
      });
    });
    var W = words(state.session);
    state.ui.modal = null;
    toast(added + ' ' + (added === 1 ? W.one : W.many) + ' added' + (late && added ? ' from the next round' : '') + '.' + (skipped.length ? ' Already on the list: ' + skipped.join(', ') + '.' : ''));
    render();
  }

  // WPR Social ratings are kept per player name, apart from the nights, so every social and month shares them.
  function loadRatings() { return S.get('pub/ratings').then(function (all) { state.ratings = all || {}; }).catch(function () { /* optional */ }); }
  function ratingOf(name) { var r = state.ratings[E.keyOf(name || '')]; return r && typeof r.s === 'number' ? r.s.toFixed(2) : ''; }
  function parseRating(txt) {
    txt = String(txt || '').trim().replace(',', '.');
    if (!txt || /^nr$/i.test(txt)) return null;
    var v = Number(txt);
    return v >= 0 && v <= 21 ? Math.round(v * 100) / 100 : undefined;      // undefined = not a rating
  }
  function saveRatings(pairs, oldKeys) {
    var up = {}, n = 0;
    pairs.forEach(function (pr) {
      var key = E.keyOf(pr.name), cur = state.ratings[key], had = cur && typeof cur.s === 'number' ? cur.s : null;
      if (!pr.name || pr.value === had) return;
      up['pub/ratings/' + key] = pr.value === null ? null : { s: pr.value, name: pr.name, at: Date.now(), by: 'hand' };
      if (pr.value === null) delete state.ratings[key]; else state.ratings[key] = up['pub/ratings/' + key];
      n++;
    });
    (oldKeys || []).forEach(function (k) {                                 // a renamed player takes the rating along
      if (state.ratings[k] && !pairs.some(function (pr) { return E.keyOf(pr.name) === k; })) { up['pub/ratings/' + k] = null; delete state.ratings[k]; n++; }
    });
    if (!n) return;
    up['pub/live/' + state.seriesId + '/ping'] = Date.now();              // tells the TVs to read the ratings again
    S.write(up).catch(function (err) { toast('The rating could not be saved: ' + err.message); render(); });
  }
  function editTeam(t) {
    state.ui.modal = { type: 'rename', id: t.id, was: t.name, p1: t.players[0] || '', p2: t.players[1] || '', r1: ratingOf(t.players[0]), r2: ratingOf(t.players[1]), old: t.players.slice() };
    state.ui.focus = 'rn1';
    render();
  }
  // Earlier nights are saved under the team's names. Move them to the new names so the monthly table and the
  // "Played before" list keep one line for the team.
  function carryRename(out) {
    var id = state.seriesId, sid = state.session.id;
    return S.get('pub/results/' + id).then(function (all) {
      var up = {}, nights = 0;
      Object.keys(all || {}).forEach(function (month) {
        Object.keys(all[month] || {}).forEach(function (night) {
          var en = (all[month][night] || {}).entries || {}, old = en[out.oldKey];
          if (night === sid || !old) return;
          var base = 'pub/results/' + id + '/' + month + '/' + night + '/entries/', into = out.newKey !== out.oldKey ? en[out.newKey] : null;
          up[base + out.newKey] = { name: out.name, players: out.players, points: (old.points || 0) + (into ? into.points || 0 : 0),
            wins: (old.wins || 0) + (into ? into.wins || 0 : 0), played: (old.played || 0) + (into ? into.played || 0 : 0) };
          if (out.newKey !== out.oldKey) up[base + out.oldKey] = null;
          nights++;
        });
      });
      if (!nights) return 0;
      up['pub/live/' + id + '/ping'] = Date.now();          // tells the TVs to re-read the monthly table
      return S.write(up).then(function () { return nights; });
    }).then(function (nights) {
      if (nights) toast('Name changed for tonight and ' + nights + (nights === 1 ? ' earlier night.' : ' earlier nights.'));
      return S.get('pub/results/' + id).then(function (all) { state.regulars = regularsFrom(all); render(); });
    }).catch(function () { toast('Changed for tonight. Earlier nights could not be updated; edit the name again to retry.'); render(); });
  }
  function removeTeam(t) {
    var s = state.session;
    var go = function () {
      var out = commit(function (x) { return E.removeTeam(x, t.id); });
      if (out.substitute) toast(teamNameOf(out.substitute) + ' steps in on court ' + out.court + '.');
      else if (out.voided && E.isWheel(s)) toast('Court ' + out.voided + ': that match is called off. Add a late player to take the place, or spin the wheel again for new teams.');
      else if (out.voided) toast('Court ' + out.voided + (E.isSolo(s) ? ': nobody is free to step in, so that match is called off. The other three keep their court.' : ': the other team keeps its place, no points for that match.'));
      render();
    };
    if (s.status === 'setup') return go();
    state.ui.modal = { type: 'confirm', title: 'Remove ' + t.name + '?', text: E.isWheel(s) ? 'They keep the points they have won today. Their partner has no match until a late player takes the place or the wheel is spun again.'
      : 'They keep the points they have won tonight but are left out of the next rounds. If they are on court right now, a ' + words(s).one + ' that is sitting out takes their place.', ok: 'Remove ' + words(s).one, danger: true, onOk: go };
    render();
  }

  // Delete round n and every round after it (n = 1 restarts the night). Scores players sent from their phones
  // for those rounds are cleared first, so none of them can land on the rounds that are drawn afresh.
  function deleteFrom(n) {
    var s = state.session, id = state.seriesId, last = s.rounds.length, up = {};
    for (var k = n; k <= last; k++) up['pub/scores/' + id + '/' + s.id + '/r' + k] = null;
    var go = function () {
      S.write(up).then(function () {
        var out = commit(function (x) { return E.rewindTo(x, n); });
        state.ui.modal = null;
        toast(!out.ok ? 'Nothing was deleted.' : out.setup ? 'Back to the list of players. Spin the wheel when you are ready.' : n === 1 ? 'The night starts again: round 1 has been drawn afresh.' : 'Back to round ' + n + ': ' + out.removed + (out.removed === 1 ? ' round' : ' rounds') + ' deleted, round ' + n + ' drawn afresh.');
        render();
      }).catch(function (err) {
        if (err.status === 401 || err.status === 403) { state.ui.modal = { type: 'key', wrong: !!S.getKey(), then: go }; render(); }
        else { toast('Could not delete: ' + err.message); render(); }
      });
    };
    var scored = s.rounds.slice(n - 1).filter(function (r) { return E.roundHasScores(r); }).length;
    state.ui.modal = { type: 'confirm', danger: true,
      title: n === 1 ? 'Restart the night?' : 'Delete round ' + n + (last > n ? ' to ' + last : '') + '?',
      text: (E.isWheel(s) ? 'Every round played today is deleted, with its scores and points, and you are back at the list of players, ready to spin the wheel for the first time. Anyone who has left is taken off the list.'
        : n === 1 ? 'Every round played tonight is deleted, with its scores and points, and round 1 is drawn again with the ' + words(s).many + ' that are still here. Anyone who has left is taken off the list. Courts and set length stay as they are.'
        : 'Round ' + n + (last > n ? ' and every round after it are' : ' is') + ' deleted, with scores and points, and round ' + n + ' is drawn again from how things stood after round ' + (n - 1) + '.') +
        (scored ? ' ' + scored + (scored === 1 ? ' round with scores is' : ' rounds with scores are') + ' affected. This cannot be undone.' : ''),
      ok: n === 1 ? 'Restart night' : 'Delete from round ' + n, onOk: go };
    render();
  }

  // ---- Live
  function courtCard(s, r, c, i, small) {
    var king = E.isKingsCourt(s, r, c);
    var done = !!c.w && !c.void;
    var open = function () { state.ui.modal = { type: 'score', n: r.n, i: i, sa: c.sa, sb: c.sb, w: c.sa === c.sb ? c.w : null }; render(); };
    return h('button', { type: 'button', class: 'courtcard' + (king ? ' king' : '') + (c.void ? ' void' : done ? '' : ' todo'), disabled: c.void, 'data-court': c.court, 'data-round': r.n, onclick: open,
      'aria-label': (c.label ? c.label + ', court ' : 'Court ') + c.court + ': ' + sideNameOf(c, 'a') + ' against ' + sideNameOf(c, 'b') + (done ? ', ' + c.sa + ' to ' + c.sb + '. Tap to correct.' : '. Tap to enter the score.') }, [
      h('div', { class: 'cn' }, [h('b', null, String(c.court)), h('span', null, c.label ? c.label : c.wait && !done ? 'Next up' : E.isWheel(s) ? 'Court' : king ? 'King’s' : 'Court')]),
      h('div', { class: 'tm' }, [
        h('div', { class: done && c.w === 'a' ? 'won' : '' }, sideNameOf(c, 'a')),
        h('div', { class: done && c.w === 'b' ? 'won' : '' }, sideNameOf(c, 'b'))
      ]),
      c.void ? h('div', { class: 'sc enter' }, 'No match') : done ? h('div', { class: 'sc num' }, [h('span', null, String(c.sa)), h('span', null, String(c.sb))]) : h('div', { class: 'sc enter' }, small ? 'Enter' : 'Enter score')
    ]);
  }

  function liveView(s) {
    var cur = E.currentRound(s), prev = s.rounds.slice(0, -1).reverse();
    var left = cur ? cur.courts.filter(function (c) { return !c.void && !c.w; }).length : 0;
    var waiting = E.activeTeams(s).filter(function (t) { return cur && cur.sitting.indexOf(t.id) < 0 && !cur.courts.some(function (c) { return !!E.sideOf(c, t.id); }); });
    var wheel = E.isWheel(s), wst = E.wheelState(s);
    var spinAgain = function () {
      state.ui.modal = { type: 'confirm', title: 'Spin the wheel again?', text: 'Everyone gets a new partner and this block starts over from its first round: ' + roundTitle(cur) + ' has no scores yet and is replaced. Points already won stay. Use it after adding or removing a player.', ok: 'Spin again', onOk: spinWheel };
      render();
    };
    return h('div', { class: 'wrap' }, [
      h('div', { class: 'cols' }, [
        h('div', { class: 'stack' }, [
          wheel ? wheelNext(s) : null,
          h('div', { class: 'panel' }, [
            h('div', { class: 'roundhead' }, [
              h('span', { class: 'big' }, cur ? roundTitle(cur) : 'Round 1'),
              h('span', { class: 'hint' }, !cur ? 'Add ' + words(s).many + ' and courts to begin.' : (wheel ? 'Sets to ' + E.roundSetTo(s, cur) + '. ' : '') + (left ? left + (left === 1 ? ' match' : ' matches') + ' still to score.' + (wheel ? '' : ' The next round appears when the last score goes in.') : ''))
            ]),
            cur ? h('div', { class: 'courtcards' }, cur.courts.map(function (c, i) { return courtCard(s, cur, c, i, false); })) : null,
            cur && cur.sitting.length ? h('p', { class: 'sitlist' }, [h('b', null, 'Sitting out: '), cur.sitting.map(teamNameOf).join(', ')]) : null,
            waiting.length ? h('p', { class: 'sitlist' }, [h('b', null, 'Joining next round: '), waiting.map(function (t) { return t.name; }).join(', ')]) : null,
            h('div', { class: 'row end', style: 'margin-top:8px' }, [
              wheel ? null : h('span', { class: 'hint', style: 'margin:0' }, 'Sets to'), wheel ? null : setsControl(s), h('span', { style: 'flex:1' }),
              btn('Change courts', 'small', function () { state.ui.modal = { type: 'courts', courts: s.courts.slice() }; render(); }, { id: 'changeCourts' }),
              wheel && wst === 'playing' && cur && !E.roundHasScores(cur) ? btn('Spin again', 'small', spinAgain, { id: 'spinAgain' }) : null,
              !wheel && cur && !E.roundHasScores(cur) ? btn('Re-draw this round', 'small', function () {
                state.ui.modal = { type: 'confirm', title: 'Re-draw round ' + cur.n + '?', text: cur.n === 1 ? 'Makes a new draw for round 1.' : 'Chooses again who sits out and where everyone plays, following the same rules. Use it after adding or removing a ' + words(s).one + '.', ok: 'Re-draw', onOk: function () { commit(function (x) { E.redrawRound(x); }); render(); } };
                render();
              }) : null,
              cur ? btn('Restart night', 'small danger', function () { deleteFrom(1); }, { id: 'restartNight' }) : null,
              btn('End night', 'small danger', endNightAsk, { id: 'endNight' })
            ])
          ]),
          prev.length ? h('div', { class: 'panel' }, h('details', { class: 'prev', open: state.ui.prevOpen, ontoggle: function (e) { state.ui.prevOpen = e.target.open; } }, [
            h('summary', null, wheel ? 'Earlier rounds (tap a score to correct it)' : 'Earlier rounds (tap a score to correct it, or delete rounds)'),
            wheel ? null : h('p', { class: 'hint' }, 'Deleting a round also deletes every round after it, and that round is drawn again. Deleting from round 1 restarts the night.'),
            prev.map(function (r) {
              return h('div', null, [h('div', { class: 'prevhead' }, [h('h2', null, roundName(r)),
                wheel ? null : btn(r.n === 1 ? 'Delete all rounds' : 'Delete from round ' + r.n, 'small danger', function () { deleteFrom(r.n); }, { 'data-delete-from': r.n })]),
                h('div', { class: 'courtcards' }, r.courts.map(function (c, i) { return courtCard(s, r, c, i, true); })),
                r.sitting.length ? h('p', { class: 'hint' }, 'Sat out: ' + r.sitting.map(teamNameOf).join(', ')) : null]);
            })
          ])) : null
        ]),
        h('div', { class: 'stack' }, [wheel ? poolPanel(s) : null, boardPanel(s, wheel ? 'Today' : 'Tonight'), teamsPanel(s, false)])
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
      ]) : h('p', { class: 'hint' }, 'Nothing yet.')
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
              return h('div', null, [h('h2', { style: 'margin-top:12px' }, roundName(r)), h('div', { class: 'courtcards' }, r.courts.map(function (c, i) { return courtCard(s, r, c, i, true); }))]);
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
      body = [h('h3', null, 'TV screen'),
        h('p', { style: 'margin:0;font-size:17px;line-height:1.45' }, 'Open this address in the browser on each club TV, then press Full screen:'), h('div', { class: 'tvlink' }, S.here('tv')),
        h('p', { style: 'margin:0;font-size:17px;line-height:1.45' }, 'With one social the TV shows it by itself. With several, the TV opens on its main menu: choose there with the remote, or from this device under Events \u2192 TVs. The Main menu button is beside Full screen whenever the TV is not in full screen.'),
        h('p', { style: 'margin:0;font-size:17px;line-height:1.45' }, 'Players’ score page (the TV shows it as a QR code during a round):'), h('div', { class: 'tvlink' }, S.link('player', { s: state.seriesId })),
        h('div', { class: 'row end' }, btn('Close', 'primary', closeModal))];
    } else if (m.type === 'courts') {
      var curR = E.currentRound(s), same = JSON.stringify(m.courts) === JSON.stringify(s.courts);
      var teamsN = E.activeTeams(s).length, Wc = words(s), kk = Math.min(m.courts.length, Math.floor(teamsN / Wc.per));
      var effect = !m.courts.length ? 'Pick at least one court.' : same ? 'These are the courts in use now.' :
        E.isWheel(s) ? 'Matches that are not scored yet move to these courts now. With fewer courts than matches, the extra matches wait for a court to come free.' :
        (curR && !E.roundHasScores(curR)) ? 'Round ' + curR.n + ' has no scores yet, so it will be drawn again on these courts.' :
        m.courts.length === s.courts.length ? 'Matches in round ' + (curR ? curR.n : 1) + ' that are not scored yet move to the new court numbers now. Every later round uses them too.' :
        'Round ' + (curR ? curR.n : 1) + ' finishes on the courts it is on. The new courts start with the next round.';
      var applyCourts = function () {
        var out = commit(function (x) { return E.setCourts(x, m.courts); });
        state.ui.modal = null;
        toast(E.isWheel(s) ? 'Courts changed.' : out.redrawn ? 'Round redrawn on the new courts.' : out.moved ? out.moved + (out.moved === 1 ? ' match' : ' matches') + ' moved to the new court numbers.' : 'New courts start with the next round.');
        render();
      };
      body = [h('h3', null, 'Courts for tonight'),
        h('p', { style: 'margin:0;font-size:17px;line-height:1.45' }, E.isWheel(s) ? 'Tap the courts you have today. The last one you tap is the main court: finals are played there.' : 'Tap from the bottom court up to King’s Court. You can change the numbers, or use more or fewer courts.'),
        courtPicker(m.courts, function (next) { m.courts = next; render(); }),
        h('div', { class: 'notice' }, [effect, m.courts.length && !E.isWheel(s) ? h('div', { style: 'margin-top:6px' }, teamsN + ' ' + Wc.many + ' on ' + kk + (kk === 1 ? ' court' : ' courts') + ': ' + (Wc.per * kk) + ' play, ' + (teamsN - Wc.per * kk) + ' sit out each round.') : null]),
        h('div', { class: 'row end' }, [btn('Cancel', '', closeModal), btn('Use these courts', 'primary', applyCourts, { disabled: same || !m.courts.length, id: 'applyCourts' })])];
    } else if (m.type === 'rename') {
      // WPR Social rating beside each name on the TV's leaderboards; empty means NR (not rated)
      var ratingRow = function (fields) {
        return h('div', { class: 'ratings' }, [h('b', null, 'WPR Social rating'), h('span', { class: 'hint', style: 'margin:0' }, 'Shown after the name on the TV leaderboards. Leave empty for NR.'),
          h('div', { class: 'row' }, fields.map(function (f) {
            return h('label', { class: 'rating' }, [h('span', null, f[2]), h('input', { type: 'text', id: f[0], inputmode: 'decimal', placeholder: 'NR', value: m[f[1]], maxlength: 5, autocomplete: 'off',
              oninput: function (e) { m[f[1]] = e.target.value; }, onkeydown: function (e) { if (e.key === 'Enter') saveName(); } })]);
          }))]);
      };
      var saveName = function () {
        var v1 = parseRating(m.r1), v2 = E.isSolo(s) ? null : parseRating(m.r2);
        if (v1 === undefined || v2 === undefined) { toast('A WPR rating is a number like 4.37. Leave it empty for NR.'); return render(); }
        var out = commit(function (x) { return E.renameTeam(x, m.id, E.isSolo(s) ? [m.p1] : [m.p1, m.p2]); });
        if (!out.ok) { toast(out.error); return render(); }
        saveRatings(out.players.map(function (nm, i) { return { name: nm, value: i === 0 ? v1 : v2 }; }), (m.old || []).map(function (nm) { return E.keyOf(nm); }));
        state.ui.modal = null;
        toast('Now ' + out.name + ', in every round and on the leaderboard.');
        render();
        carryRename(out);
      };
      body = E.isSolo(s) ? [h('h3', null, 'Edit name'),
        h('p', { style: 'margin:0;font-size:17px;line-height:1.45' }, 'Was “' + m.was + '”. The change shows in every round tonight, on the leaderboards, and on this player’s earlier nights.'),
        h('input', { type: 'text', id: 'rn1', placeholder: 'Player name', value: m.p1, maxlength: 30, autocapitalize: 'words', autocomplete: 'off',
          oninput: function (e) { m.p1 = e.target.value; }, onkeydown: function (e) { if (e.key === 'Enter') saveName(); } }),
        ratingRow([['rt1', 'r1', m.p1 || 'Player']]),
        h('div', { class: 'row end' }, [btn('Cancel', '', closeModal), btn('Save', 'primary', saveName, { id: 'saveNames' })])]
      : [h('h3', null, 'Edit names'),
        h('p', { style: 'margin:0;font-size:17px;line-height:1.45' }, 'Was “' + m.was + '”. The change shows in every round tonight, on the leaderboards, and on this team’s earlier nights.'),
        h('div', { class: 'addteam', style: 'grid-template-columns:minmax(0,1fr) auto minmax(0,1fr)' }, [
          h('input', { type: 'text', id: 'rn1', placeholder: 'Player 1', value: m.p1, maxlength: 30, autocapitalize: 'words', autocomplete: 'off',
            oninput: function (e) { m.p1 = e.target.value; }, onkeydown: function (e) { if (e.key === 'Enter') saveName(); } }),
          h('span', { class: 'amp' }, '&'),
          h('input', { type: 'text', id: 'rn2', placeholder: 'Player 2', value: m.p2, maxlength: 30, autocapitalize: 'words', autocomplete: 'off',
            oninput: function (e) { m.p2 = e.target.value; }, onkeydown: function (e) { if (e.key === 'Enter') saveName(); } })
        ]),
        ratingRow([['rt1', 'r1', m.p1 || 'Player 1'], ['rt2', 'r2', m.p2 || 'Player 2']]),
        h('div', { class: 'row end' }, [btn('Cancel', '', closeModal), btn('Save', 'primary', saveName, { id: 'saveNames' })])];
    } else if (m.type === 'voice') {
      var vs = E.isSolo(s), vw = words(s);
      if (m.step === 'idle' || m.step === 'asking') {
        body = [h('h3', null, 'Speak the names'),
          h('p', { style: 'margin:0;font-size:17px;line-height:1.45' }, vs ? 'Press Start, then say the players’ names one after another, first and last name: “Ana Lopez, Bruno Diaz, Carla Ruiz…”. Up to a minute.'
            : 'Press Start, then say the couples one after another: “Carter and Kasey Maclean. Lexi and Spencer Mecham…”. Up to a minute.'),
          h('p', { class: 'hint', style: 'margin:0' }, 'You will see the list and can correct it before anything is added.'),
          h('div', { class: 'row end' }, [btn('Cancel', '', closeVoice), btn(m.step === 'asking' ? 'Waiting for the microphone…' : 'Start', 'primary', voiceStart, { id: 'voiceStart', disabled: m.step === 'asking' })])];
      } else if (m.step === 'rec') {
        body = [h('h3', null, 'Listening…'),
          h('div', { class: 'voicerec' }, [h('span', { class: 'dot', 'aria-hidden': 'true' }), h('span', { id: 'voiceClock', class: 'num' }, voiceClock(m))]),
          h('p', { class: 'hint', style: 'margin:0;text-align:center' }, 'Say the names clearly, then press Stop.'),
          h('div', { class: 'row end' }, [btn('Cancel', '', closeVoice), btn('Stop and read the names', 'primary', voiceStop, { id: 'voiceStop' })])];
      } else if (m.step === 'work') {
        body = [h('h3', null, 'Writing down the names…'), h('p', { style: 'margin:0;font-size:17px;line-height:1.45' }, 'This takes a few seconds.'),
          h('div', { class: 'row end' }, btn('Cancel', '', closeVoice))];
      } else if (m.step === 'error') {
        body = [h('h3', null, 'That did not work'), h('div', { class: 'notice err' }, m.msg),
          h('div', { class: 'row end' }, [btn('Close', '', closeVoice), btn('Try again', 'primary', function () { m.step = 'idle'; voiceStart(); }, { id: 'voiceRetry' })])];
      } else {
        var have = {};
        E.teamList(s).forEach(function (t) { if (!t.left) have[E.entityKey(t.players)] = true; });
        var count = m.items.filter(function (it) { return (it.p1 + it.p2).trim(); }).length;
        body = [h('h3', null, 'Check the names'),
          h('p', { style: 'margin:0;font-size:17px;line-height:1.45' }, 'Correct any spelling, remove what should not be there, then add them.'),
          h('div', { class: 'voicelist' }, m.items.map(function (it, i) {
            var dup = have[E.entityKey(vs ? [it.p1] : [it.p1, it.p2])];
            var field = function (k, ph) { return h('input', { type: 'text', id: 'vn' + i + k, placeholder: ph, value: it[k], maxlength: 30, autocapitalize: 'words', autocomplete: 'off', oninput: function (e) { it[k] = e.target.value; } }); };
            return h('div', { class: 'voicerow' + (vs ? ' solo' : '') + (dup ? ' dup' : '') }, [
              field('p1', vs ? 'Player' : 'Player 1'), vs ? null : h('span', { class: 'amp' }, '&'), vs ? null : field('p2', 'Player 2'),
              btn('\u00d7', 'small', function () { m.items.splice(i, 1); render(); }, { 'aria-label': 'Remove this line' }),
              dup ? h('span', { class: 'hint dupnote' }, 'already on the list') : null]);
          })),
          h('div', { class: 'row end' }, [btn('Cancel', '', closeVoice), btn('Record again', '', function () { m.step = 'idle'; m.items = []; voiceStart(); }),
            btn('Add ' + count + ' ' + (count === 1 ? vw.one : vw.many), 'primary', voiceAdd, { id: 'voiceAdd', disabled: !count })])];
      }
    } else if (m.type === 'look') {
      var lk = (state.series[m.id] || {}).look || {}, busy = state.ui.lookBusy, has = !!(lk.wide || lk.tall);
      var setLook = function (patch) { var next = lookOf(m.id); Object.keys(patch).forEach(function (k) { next[k] = patch[k]; }); saveLook(m.id, next); };
      var slot = function (kind, title, text, thumb) {
        var on = !!lk[kind];
        return h('div', { class: 'flyslot', 'data-slot': kind }, [
          h('div', { class: 'pic ' + kind }, thumb ? h('img', { src: thumb, alt: '' }) : h('span', null, kind === 'wide' ? 'Wide' : 'Tall')),
          h('div', { class: 'txt' }, [h('b', null, title), h('p', { class: 'hint', style: 'margin:2px 0 8px' }, text),
            h('div', { class: 'row' }, [
              h('label', { class: 'btn small flypick' + (busy ? ' off' : ''), for: 'flyer-' + kind }, on ? 'Replace' : 'Choose photo'),
              h('input', { type: 'file', id: 'flyer-' + kind, accept: 'image/*', hidden: true, disabled: !!busy,
                onchange: function (e) { var f = e.target.files && e.target.files[0]; e.target.value = ''; addFlyer(m.id, kind, f); } }),
              on ? btn('Remove', 'small danger', function () { removeFlyer(m.id, kind); }, { disabled: !!busy, 'data-remove': kind }) : null
            ])])
        ]);
      };
      var bar = h('div', { class: 'lookbar', id: 'lookbar' }, [h('img', { src: S.asset('logo-p.png'), alt: '' }),
        h('div', { class: 'c' }, [h('b', null, state.series[m.id].name), h('span', null, (function (f) { return f.charAt(0).toUpperCase() + f.slice(1).toLowerCase(); })(E.formatOf(state.series[m.id].format).name))]),
        h('img', { class: 'w', src: S.asset('conquer-wordmark-white.png'), alt: '' })]);
      L.paint(bar, has || lk.pattern ? lk : null);
      body = [h('h3', null, 'Flyer and look'),
        h('p', { style: 'margin:0;font-size:17px;line-height:1.45' }, 'For ' + state.series[m.id].name + '. The TV shows the wide flyer between rounds, phones show the flyer for a few seconds when players scan the QR code, and the TV’s top banner takes its colours from it.'),
        slot('wide', 'Wide flyer (landscape)', 'For the TV. Its colours are used for the banner.', lk.thumbW),
        slot('tall', 'Tall flyer (portrait), optional', 'For players’ phones. Without it, phones show the wide flyer.', lk.thumbT),
        h('div', null, [h('b', null, 'TV banner'), h('p', { class: 'hint', style: 'margin:2px 0 8px' }, has ? 'The colours come from the flyer. Pick the pattern you like.' : 'Add a flyer first: the banner takes its colours from it.')]),
        bar,
        has ? h('div', { class: 'patchips' }, L.PATTERNS.map(function (p) {
          return h('button', { type: 'button', class: 'chip' + ((lk.pattern || 'confetti') === p.id ? ' on' : ''), 'data-pattern': p.id, disabled: !!busy, onclick: function () { setLook({ pattern: p.id }); } }, p.name);
        })) : null,
        has && L.candidates(lk).length > 1 ? h('div', { class: 'row' }, [btn('Try other colours', 'small', function () { setLook({ variant: ((Number(lk.variant) || 0) + 1) % L.candidates(lk).length }); }, { disabled: !!busy, id: 'otherColours' }),
          h('span', { class: 'hint', style: 'margin:0' }, 'Steps through the flyer’s main colours.')]) : null,
        has ? h('div', null, [h('b', null, 'Whole TV screen'),
          h('p', { class: 'hint', style: 'margin:2px 0 8px' }, 'Normally only the top banner takes the flyer’s colours. “Flyer’s colours” turns the whole screen into tones of the flyer’s main colour. Yellow lettering, the white “Enter your score” box and the green of a court whose score is in stay as they are.'),
          h('div', { class: 'seg' }, [
            h('button', { type: 'button', class: lk.theme === 'flyer' ? '' : 'on', 'data-theme': 'club', disabled: !!busy, onclick: function () { if (lk.theme) setLook({ theme: null }); } }, 'Club colours'),
            h('button', { type: 'button', class: lk.theme === 'flyer' ? 'on' : '', 'data-theme': 'flyer', disabled: !!busy, onclick: function () { if (lk.theme !== 'flyer') setLook({ theme: 'flyer' }); } }, 'Flyer’s colours')
          ])]) : null,
        h('div', { class: 'row end' }, [busy ? h('span', { class: 'hint', style: 'margin:0 auto 0 0' }, busy) : null, btn('Done', 'primary', closeModal, { id: 'lookDone' })])];
    } else if (m.type === 'renameSeries') {
      var saveSeries = function () {
        var nm = m.name.replace(/\s+/g, ' ').trim();
        if (!nm) return;
        if (nm === state.series[m.id].name) return closeModal();
        var up = {}; up['pub/series/' + m.id + '/name'] = nm;
        S.write(up).then(function () {
          state.series[m.id].name = nm;
          state.ui.modal = null; toast('Now called ' + nm + '. The TVs follow within half a minute.'); render();
        }).catch(function (err) {
          if (err.status === 401 || err.status === 403) { state.ui.modal = { type: 'key', wrong: !!S.getKey(), then: function () { state.ui.modal = m; saveSeries(); } }; render(); }
          else { toast('Could not save: ' + err.message); render(); }
        });
      };
      body = [h('h3', null, 'Rename event'),
        h('p', { style: 'margin:0;font-size:17px;line-height:1.45' }, 'The new name shows on the TVs, on players’ phones and here. Scores and the monthly leaderboard stay as they are.'),
        h('input', { type: 'text', id: 'seriesName', placeholder: 'Event name', value: m.name, maxlength: 60, autocapitalize: 'words', autocomplete: 'off',
          oninput: function (e) { m.name = e.target.value; }, onkeydown: function (e) { if (e.key === 'Enter') saveSeries(); } }),
        h('div', { class: 'row end' }, [btn('Cancel', '', closeModal), btn('Save name', 'primary', saveSeries, { id: 'saveSeriesName' })])];
    } else if (m.type === 'pair') {
      var evIds = Object.keys(state.series).sort(function (a, b) { return state.series[a].name < state.series[b].name ? -1 : 1; });
      var pick = function (id) {
        saveScreen(m.code, { seriesId: id }, function () { state.ui.modal = null; state.pairTv = null; toast('TV ' + m.code + ' now shows ' + showName(id) + '.'); render(); });
      };
      body = [h('h3', null, 'TV ' + m.code),
        h('p', { style: 'margin:0;font-size:17px;line-height:1.45' }, 'What should this screen show?'),
        h('div', { class: 'serieslist' }, evIds.map(function (id) { return btn(state.series[id].name, '', function () { pick(id); }, { 'data-pick': id }); })
          .concat([btn('Club flyers', '', function () { pick(FLYERS); }, { 'data-pick': FLYERS }), btn('Special event flyers', '', function () { pick(SPECIAL); }, { 'data-pick': SPECIAL })])),
        h('p', { class: 'hint' }, 'To put a new social on this screen: close this, create it below, then come back to Events and add TV ' + m.code + ' under TVs.'),
        h('div', { class: 'row end' }, btn('Close', '', function () { state.pairTv = null; closeModal(); }))];
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
        for (var v = 0; v <= E.roundSetTo(s, r); v++) (function (v) {
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
        else if (out.regenerated) toast(E.isWheel(s) ? 'The next matches have been redone with the corrected result.' : 'Round ' + (n + 1) + ' has been redone with the corrected result.');
        else if (out.tooLate) toast('Points corrected. Court positions stay as they were played.');
        else if (out.advanced && wasLast) toast((E.isWheel(s) ? roundTitle(E.currentRound(state.session)) : 'Round ' + (n + 1)) + ' is up on the TV.');
        else if (wasLast && E.wheelState(state.session) === 'spin') toast('That set is done. Time to spin the wheel.');
        render();
      };
      body = [
        h('h3', null, roundTitle(r) + ' · Court ' + c.court + (c.label ? ' · ' + c.label : !E.isWheel(s) && E.isKingsCourt(s, r, c) ? ' · King’s Court' : '')),
        h('p', { class: 'hint', style: 'margin:-8px 0 0' }, 'Sets to ' + E.roundSetTo(s, r) + ' games. A point for every game won.'),
        h('div', { class: 'scoreteam' }, [h('div', { class: 'nm' }, sideNameOf(c, 'a')), h('div', { class: 'digits' }, digits('sa'))]),
        h('div', { class: 'scoreteam' }, [h('div', { class: 'nm' }, sideNameOf(c, 'b')), h('div', { class: 'digits' }, digits('sb'))]),
        level ? h('div', { class: 'notice' }, [h('div', { style: 'margin-bottom:8px;font-weight:600' }, E.isWheel(s) ? 'Level on games. Which pair won?' : E.isSolo(s) ? 'Level on games. Which pair moves up?' : 'Level on games. Which team moves up?'), h('div', { class: 'row' }, [
          btn(sideNameOf(c, 'a'), m.w === 'a' ? 'primary small' : 'small', function () { m.w = 'a'; render(); }),
          btn(sideNameOf(c, 'b'), m.w === 'b' ? 'primary small' : 'small', function () { m.w = 'b'; render(); })])]) : null,
        h('div', { class: 'row end' }, [
          c.w ? btn('Clear score', 'danger', function () { commit(function (x) { E.setScore(x, m.n, m.i, null, null); }); closeModal(); }) : null,
          btn('Cancel', '', closeModal),
          btn('Save score', 'primary', saveScore, { disabled: !ready, id: 'saveScore' })
        ])
      ];
    }
    return h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', onclick: function (e) { if (e.target === e.currentTarget && m.type !== 'key' && m.type !== 'voice') closeModal(); } }, h('div', { class: 'sheet' }, body));
  }

  // ---------------------------------------------------------------- go
  setInterval(watch, 2000);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) { watch(); flush(); } });
  window.addEventListener('online', flush);
  window.addEventListener('beforeunload', function (e) { if (state.dirty) { e.preventDefault(); e.returnValue = ''; } });
  window.Awake.start();      // the iPad screen stays on while this page is open
  boot();
})();
