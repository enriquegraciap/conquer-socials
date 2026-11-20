/* Padel Socials — iPad admin page. */
(function () {
  'use strict';
  var E = window.Engine, S = window.Store, L = window.Look;
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
  var FLYERS = '@flyers';     // a TV can show the club flyers instead of a social
  function showName(id) { return id === FLYERS ? 'the club flyers' : (state.series[id] || {}).name || 'that social'; }
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
      h('h1', null, state.phase === 'night' ? (meta.name || 'Padel Socials') : 'Padel Socials'),
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
        h('p', { class: 'hint' }, 'One event per weekly social and club, for example “Lehi Date Night”. Each event keeps its own monthly leaderboard.'),
        h('div', { class: 'row', style: 'margin-top:10px' }, [
          h('input', { type: 'text', id: 'newSeries', placeholder: 'Event name', value: state.ui.newSeries, maxlength: 60, style: 'flex:1',
            oninput: function (e) { state.ui.newSeries = e.target.value; }, onkeydown: function (e) { if (e.key === 'Enter') create(); } }),
          btn('Create', 'primary', create)
        ]),
        h('div', { style: 'margin-top:12px;font-weight:600' }, 'Format'),
        h('div', { class: 'fmtpick' }, Object.keys(E.FORMATS).map(function (f) {
          var on = state.ui.newFormat === f;
          return h('button', { type: 'button', class: 'fmt' + (on ? ' on' : ''), 'data-format': f, 'aria-pressed': on ? 'true' : 'false', onclick: function () { state.ui.newFormat = f; render(); } }, [
            h('b', null, E.FORMATS[f].name),
            h('span', null, f === 'kings-individual'
              ? 'Everyone signs up alone. After each round the pairs split: the two winners move up a court and face each other with new partners, the two losers move down and split. Points and the leaderboard are per player.'
              : 'Couples sign up together and stay together all night. Winners move up a court, losers move down. Points and the leaderboard are per couple.')
          ]);
        })),
        h('p', { class: 'hint' }, 'Both formats share the courts, sit-out and scoring rules. The format is chosen once, when the event is created.')
      ]),
      h('div', { class: 'panel' }, [
        h('h2', null, ['Club flyers', h('small', null, 'a slideshow for the TVs')]),
        h('p', { class: 'hint', style: 'margin:0 0 10px' }, 'Upload the club’s flyers and any TV can show them, a new one every 15 seconds. On the TV, choose Club flyers from its main menu.'),
        h('a', { class: 'btn', href: S.link('flyers'), id: 'openFlyers', style: 'display:inline-flex;align-items:center;text-decoration:none;color:inherit' }, 'Open club flyers')
      ]),
      ids.length ? tvsPanel(ids) : null
    ]);
  }

  function tvsPanel(ids) {
    var codes = Object.keys(state.screens).sort();
    var options = function (selected) {
      return [h('option', { value: '' }, 'Choose…')].concat(ids.map(function (id) {
        return h('option', { value: id, selected: id === selected }, state.series[id].name);
      })).concat([h('option', { value: FLYERS, selected: selected === FLYERS }, 'Club flyers')]);
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

  function setsControl(s) {
    var opt = function (n) {
      return h('button', { type: 'button', class: s.setTo === n ? 'on' : '', 'data-sets': n, 'aria-pressed': s.setTo === n ? 'true' : 'false',
        onclick: function () { commit(function (x) { x.setTo = n; }); } }, n + ' games');
    };
    return h('div', { class: 'seg' }, [opt(4), opt(6)]);
  }

  // The court buttons: tap from the bottom court up to King's Court. `courts` is the list being edited.
  function courtPicker(courts, onChange) {
    var chips = [];
    for (var n = 1; n <= MAX_COURT; n++) (function (n) {
      var i = courts.indexOf(n), king = i >= 0 && i === courts.length - 1;
      chips.push(h('button', { type: 'button', class: 'chip' + (i >= 0 ? ' on' : '') + (king ? ' king' : ''), 'aria-pressed': i >= 0 ? 'true' : 'false', 'data-court': n,
        onclick: function () { var next = courts.slice(), j = next.indexOf(n); if (j >= 0) next.splice(j, 1); else next.push(n); onChange(next); } },
        [String(n), i >= 0 ? h('span', { class: 'ord' }, king ? 'King' : String(i + 1)) : null]));
    })(n);
    return [
      h('div', { class: 'courtpick' }, chips),
      courts.length ? h('div', { class: 'ladder' }, ['Bottom: ' + courts.slice(0, -1).join(' → ') + (courts.length > 1 ? ' → ' : ''), h('b', null, courts[courts.length - 1] + ' King’s Court')]) : h('p', { class: 'hint' }, 'No courts picked yet.'),
      courts.length ? h('div', { class: 'row', style: 'margin-top:8px' }, [
        btn('Sort low to high', 'small', function () { onChange(courts.slice().sort(function (a, b) { return a - b; })); }),
        btn('Reverse order', 'small', function () { onChange(courts.slice().reverse()); }),
        btn('Clear', 'small', function () { onChange([]); })
      ]) : null
    ];
  }
  function courtsPanel(s) {
    return h('div', { class: 'panel' }, [
      h('h2', null, ['Courts', h('small', null, 'tap from the bottom court up to King’s Court')]),
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
      else { state.ui.p1 = ''; state.ui.p2 = ''; if (!setup) toast(res.name + ' joins from the next round.'); }
      state.ui.focus = 'p1'; render();
    };
    var status = function (t) {
      if (t.left) return 'Left';
      if (setup || !cur) return '';
      if (cur.sitting.indexOf(t.id) >= 0) return 'Sitting out';
      var c = cur.courts.filter(function (c) { return !!E.sideOf(c, t.id); })[0];
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
      regs.length ? h('div', null, [h('p', { class: 'hint' }, 'Played before (tap to add):'), h('div', { class: 'regulars' }, regs.map(function (r) {
        return h('button', { type: 'button', onclick: function () { var res = commit(function (x) { return E.addTeam(x, r.players); }); if (res && !setup) toast(res.name + ' joins from the next round.'); } }, '+ ' + r.name);
      }))]) : null,
      h('ul', { class: 'teamlist' }, teams.map(function (t, i) {
        return h('li', { class: t.left ? 'gone' : '' }, [
          setup && s.round1 === 'seeded' ? h('span', { class: 'seed' }, String(i + 1)) : null,
          h('button', { type: 'button', class: 'nm nmbtn', 'data-edit': t.name, 'aria-label': 'Edit the name of ' + t.name, onclick: function () { editTeam(t); } }, t.name),
          h('span', { class: 'st' }, status(t)),
          btn('Edit', 'small', function () { editTeam(t); }, { 'aria-label': 'Edit ' + t.name }),
          setup && s.round1 === 'seeded' ? btn('▲', 'small', function () { move(t, -1); }, { 'aria-label': 'Move ' + t.name + ' up', disabled: i === 0 }) : null,
          setup && s.round1 === 'seeded' ? btn('▼', 'small', function () { move(t, 1); }, { 'aria-label': 'Move ' + t.name + ' down', disabled: i === teams.length - 1 }) : null,
          t.left ? btn('Bring back', 'small', function () { commit(function (x) { x.teams[t.id].left = null; }); toast(t.name + ' rejoins from the next round.'); render(); })
            : btn('Remove', 'small danger', function () { removeTeam(t); }, { 'aria-label': 'Remove ' + t.name })
        ]);
      })),
      !teams.length ? h('p', { class: 'hint' }, W.solo ? 'No players yet. Type a name and press Add player.' : 'No teams yet. Type the two players and press Add team.') : null
    ]);
  }
  function editTeam(t) {
    state.ui.modal = { type: 'rename', id: t.id, was: t.name, p1: t.players[0] || '', p2: t.players[1] || '' };
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
      else if (out.voided) toast('Court ' + out.voided + (E.isSolo(s) ? ': nobody is free to step in, so that match is called off. The other three keep their court.' : ': the other team keeps its place, no points for that match.'));
      render();
    };
    if (s.status === 'setup') return go();
    state.ui.modal = { type: 'confirm', title: 'Remove ' + t.name + '?', text: 'They keep the points they have won tonight but are left out of the next rounds. If they are on court right now, a ' + words(s).one + ' that is sitting out takes their place.', ok: 'Remove ' + words(s).one, danger: true, onOk: go };
    render();
  }

  // ---- Live
  function courtCard(s, r, c, i, small) {
    var king = E.isKingsCourt(s, r, c);
    var done = !!c.w && !c.void;
    var open = function () { state.ui.modal = { type: 'score', n: r.n, i: i, sa: c.sa, sb: c.sb, w: c.sa === c.sb ? c.w : null }; render(); };
    return h('button', { type: 'button', class: 'courtcard' + (king ? ' king' : '') + (c.void ? ' void' : done ? '' : ' todo'), disabled: c.void, 'data-court': c.court, 'data-round': r.n, onclick: open,
      'aria-label': 'Court ' + c.court + ': ' + sideNameOf(c, 'a') + ' against ' + sideNameOf(c, 'b') + (done ? ', ' + c.sa + ' to ' + c.sb + '. Tap to correct.' : '. Tap to enter the score.') }, [
      h('div', { class: 'cn' }, [h('b', null, String(c.court)), h('span', null, king ? 'King’s' : 'Court')]),
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
    return h('div', { class: 'wrap' }, [
      h('div', { class: 'cols' }, [
        h('div', { class: 'stack' }, [
          h('div', { class: 'panel' }, [
            h('div', { class: 'roundhead' }, [
              h('span', { class: 'big' }, 'Round ' + (cur ? cur.n : 1)),
              h('span', { class: 'hint' }, !cur ? 'Add ' + words(s).many + ' and courts to begin.' : left ? left + (left === 1 ? ' court' : ' courts') + ' still to score. The next round appears when the last score goes in.' : '')
            ]),
            cur ? h('div', { class: 'courtcards' }, cur.courts.map(function (c, i) { return courtCard(s, cur, c, i, false); })) : null,
            cur && cur.sitting.length ? h('p', { class: 'sitlist' }, [h('b', null, 'Sitting out: '), cur.sitting.map(teamNameOf).join(', ')]) : null,
            waiting.length ? h('p', { class: 'sitlist' }, [h('b', null, 'Joining next round: '), waiting.map(function (t) { return t.name; }).join(', ')]) : null,
            h('div', { class: 'row end', style: 'margin-top:8px' }, [
              h('span', { class: 'hint', style: 'margin:0' }, 'Sets to'), setsControl(s), h('span', { style: 'flex:1' }),
              btn('Change courts', 'small', function () { state.ui.modal = { type: 'courts', courts: s.courts.slice() }; render(); }, { id: 'changeCourts' }),
              cur && !E.roundHasScores(cur) ? btn('Re-draw this round', 'small', function () {
                state.ui.modal = { type: 'confirm', title: 'Re-draw round ' + cur.n + '?', text: cur.n === 1 ? 'Makes a new draw for round 1.' : 'Chooses again who sits out and where everyone plays, following the same rules. Use it after adding or removing a ' + words(s).one + '.', ok: 'Re-draw', onOk: function () { commit(function (x) { E.redrawRound(x); }); render(); } };
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
      body = [h('h3', null, 'TV screen'),
        h('p', { style: 'margin:0;font-size:17px;line-height:1.45' }, 'Open this address in the browser on each club TV, then press Full screen:'), h('div', { class: 'tvlink' }, S.link('tv')),
        h('p', { style: 'margin:0;font-size:17px;line-height:1.45' }, 'With one social the TV shows it by itself. With several, the TV opens on its main menu: choose there with the remote, or from this device under Events \u2192 TVs. The Main menu button is beside Full screen whenever the TV is not in full screen.'),
        h('p', { style: 'margin:0;font-size:17px;line-height:1.45' }, 'Players’ score page (the TV shows it as a QR code during a round):'), h('div', { class: 'tvlink' }, S.link('player', { s: state.seriesId })),
        h('div', { class: 'row end' }, btn('Close', 'primary', closeModal))];
    } else if (m.type === 'courts') {
      var curR = E.currentRound(s), same = JSON.stringify(m.courts) === JSON.stringify(s.courts);
      var teamsN = E.activeTeams(s).length, Wc = words(s), kk = Math.min(m.courts.length, Math.floor(teamsN / Wc.per));
      var effect = !m.courts.length ? 'Pick at least one court.' : same ? 'These are the courts in use now.' :
        (curR && !E.roundHasScores(curR)) ? 'Round ' + curR.n + ' has no scores yet, so it will be drawn again on these courts.' :
        m.courts.length === s.courts.length ? 'Matches in round ' + (curR ? curR.n : 1) + ' that are not scored yet move to the new court numbers now. Every later round uses them too.' :
        'Round ' + (curR ? curR.n : 1) + ' finishes on the courts it is on. The new courts start with the next round.';
      var applyCourts = function () {
        var out = commit(function (x) { return E.setCourts(x, m.courts); });
        state.ui.modal = null;
        toast(out.redrawn ? 'Round redrawn on the new courts.' : out.moved ? out.moved + (out.moved === 1 ? ' match' : ' matches') + ' moved to the new court numbers.' : 'New courts start with the next round.');
        render();
      };
      body = [h('h3', null, 'Courts for tonight'),
        h('p', { style: 'margin:0;font-size:17px;line-height:1.45' }, 'Tap from the bottom court up to King’s Court. You can change the numbers, or use more or fewer courts.'),
        courtPicker(m.courts, function (next) { m.courts = next; render(); }),
        h('div', { class: 'notice' }, [effect, m.courts.length ? h('div', { style: 'margin-top:6px' }, teamsN + ' ' + Wc.many + ' on ' + kk + (kk === 1 ? ' court' : ' courts') + ': ' + (Wc.per * kk) + ' play, ' + (teamsN - Wc.per * kk) + ' sit out each round.') : null]),
        h('div', { class: 'row end' }, [btn('Cancel', '', closeModal), btn('Use these courts', 'primary', applyCourts, { disabled: same || !m.courts.length, id: 'applyCourts' })])];
    } else if (m.type === 'rename') {
      var saveName = function () {
        var out = commit(function (x) { return E.renameTeam(x, m.id, E.isSolo(s) ? [m.p1] : [m.p1, m.p2]); });
        if (!out.ok) { toast(out.error); return render(); }
        state.ui.modal = null;
        toast('Now ' + out.name + ', in every round and on the leaderboard.');
        render();
        carryRename(out);
      };
      body = E.isSolo(s) ? [h('h3', null, 'Edit name'),
        h('p', { style: 'margin:0;font-size:17px;line-height:1.45' }, 'Was “' + m.was + '”. The change shows in every round tonight, on the leaderboards, and on this player’s earlier nights.'),
        h('input', { type: 'text', id: 'rn1', placeholder: 'Player name', value: m.p1, maxlength: 30, autocapitalize: 'words', autocomplete: 'off',
          oninput: function (e) { m.p1 = e.target.value; }, onkeydown: function (e) { if (e.key === 'Enter') saveName(); } }),
        h('div', { class: 'row end' }, [btn('Cancel', '', closeModal), btn('Save name', 'primary', saveName, { id: 'saveNames' })])]
      : [h('h3', null, 'Edit names'),
        h('p', { style: 'margin:0;font-size:17px;line-height:1.45' }, 'Was “' + m.was + '”. The change shows in every round tonight, on the leaderboards, and on this team’s earlier nights.'),
        h('div', { class: 'addteam', style: 'grid-template-columns:minmax(0,1fr) auto minmax(0,1fr)' }, [
          h('input', { type: 'text', id: 'rn1', placeholder: 'Player 1', value: m.p1, maxlength: 30, autocapitalize: 'words', autocomplete: 'off',
            oninput: function (e) { m.p1 = e.target.value; }, onkeydown: function (e) { if (e.key === 'Enter') saveName(); } }),
          h('span', { class: 'amp' }, '&'),
          h('input', { type: 'text', id: 'rn2', placeholder: 'Player 2', value: m.p2, maxlength: 30, autocapitalize: 'words', autocomplete: 'off',
            oninput: function (e) { m.p2 = e.target.value; }, onkeydown: function (e) { if (e.key === 'Enter') saveName(); } })
        ]),
        h('div', { class: 'row end' }, [btn('Cancel', '', closeModal), btn('Save names', 'primary', saveName, { id: 'saveNames' })])];
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
      var bar = h('div', { class: 'lookbar', id: 'lookbar' }, [h('img', { src: 'logo-p.png', alt: '' }),
        h('div', { class: 'c' }, [h('b', null, state.series[m.id].name), h('span', null, E.formatOf(state.series[m.id].format).name)]),
        h('img', { class: 'w', src: 'conquer-wordmark-white.png', alt: '' })]);
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
          .concat([btn('Club flyers', '', function () { pick(FLYERS); }, { 'data-pick': FLYERS })])),
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
        for (var v = 0; v <= (s.setTo || 4); v++) (function (v) {
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
        h('h3', null, 'Round ' + m.n + ' · Court ' + c.court + (E.isKingsCourt(s, r, c) ? ' · King’s Court' : '')),
        h('p', { class: 'hint', style: 'margin:-8px 0 0' }, 'Sets to ' + (s.setTo || 4) + ' games. A point for every game won.'),
        h('div', { class: 'scoreteam' }, [h('div', { class: 'nm' }, sideNameOf(c, 'a')), h('div', { class: 'digits' }, digits('sa'))]),
        h('div', { class: 'scoreteam' }, [h('div', { class: 'nm' }, sideNameOf(c, 'b')), h('div', { class: 'digits' }, digits('sb'))]),
        level ? h('div', { class: 'notice' }, [h('div', { style: 'margin-bottom:8px;font-weight:600' }, E.isSolo(s) ? 'Level on games. Which pair moves up?' : 'Level on games. Which team moves up?'), h('div', { class: 'row' }, [
          btn(sideNameOf(c, 'a'), m.w === 'a' ? 'primary small' : 'small', function () { m.w = 'a'; render(); }),
          btn(sideNameOf(c, 'b'), m.w === 'b' ? 'primary small' : 'small', function () { m.w = 'b'; render(); })])]) : null,
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
  setInterval(watch, 2000);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) { watch(); flush(); } });
  window.addEventListener('online', flush);
  window.addEventListener('beforeunload', function (e) { if (state.dirty) { e.preventDefault(); e.returnValue = ''; } });
  window.Awake.start();      // the iPad screen stays on while this page is open
  boot();
})();
