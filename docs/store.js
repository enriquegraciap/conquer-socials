/*
 * Padel Socials — data layer. Talks to the Firebase Realtime Database over its plain web (REST) interface,
 * so there is no SDK to load and it behaves the same on the iPad and on a TV browser.
 *
 * Layout in the database (everything lives under "pub"):
 *   pub/series/{seriesId}                       name, format, scoring, default courts
 *   pub/live/{seriesId}                         { sessionId, rev }   <- TVs watch "rev" and reload when it changes
 *   pub/sessions/{seriesId}/{sessionId}         the full night (teams, rounds, scores)
 *   pub/results/{seriesId}/{YYYY-MM}/{sessionId} per-night totals; the monthly table is the sum of these
 *
 *   pub/scores/{seriesId}/{sessionId}/r{round}/c{court}  a score sent from a player's phone (applied by the organizer's device)
 *   pub/screens/{tvCode}                        which event a paired TV shows
 *   pub/flyers/club/index/{id}                  one line per club flyer (name, order, small preview); rev changes when the set does
 *   pub/flyers/club/data/{id}                   the flyer itself, as a picture ready to show
 *
 * A second club (config.js, "clubs") has the same layout under its own name instead of "pub" (for example "tempe"),
 * with its own admin key. Its pages set window.SOCIALS_CLUB; the code everywhere else keeps saying "pub/..." and
 * this file sends it to the right place. Nothing one club's pages read or write is in the other club's part.
 *
 * Reading is open. Writing needs the admin key: every write also touches gate/{key}, and the database
 * rules only accept a write to "pub" when that happens (see database.rules.json). The two exceptions,
 * open to players' phones, are pub/scores/... (numbers 0 to 6 only) and pub/live/{seriesId}/ping.
 */
(function (root) {
  'use strict';
  var cfg = root.SOCIALS_CONFIG || {};
  var params = new URLSearchParams(root.location ? root.location.search : '');
  var base = String(params.get('db') || cfg.databaseURL || '').replace(/\/+$/, '');
  // Which club these pages belong to: none named = the first club, whose data lives under "pub".
  var clubId = String(root.SOCIALS_CLUB || ''), club = clubId && cfg.clubs && cfg.clubs[clubId] ? cfg.clubs[clubId] : null;
  if (!club) clubId = '';
  var dataRoot = club ? String(club.root || clubId) : 'pub', clubDir = club ? String(club.dir || '') : '';
  function place(path) { return dataRoot === 'pub' ? path : path === 'pub' ? dataRoot : path.indexOf('pub/') === 0 ? dataRoot + path.slice(3) : path; }
  function placeAll(updates) { var out = {}; Object.keys(updates).forEach(function (p) { out[place(p)] = updates[p]; }); return out; }
  // Where the site lives: the folder this file was loaded from, or the public address set in config.js.
  var here = (root.document && root.document.currentScript && root.document.currentScript.src) || '';
  var home = here ? here.replace(/[^\/]*(\?.*)?$/, '') : '';
  // The public address is not used with a test database (?db=...), so tests never hand out real links.
  var pub = params.get('db') ? '' : String((club ? club.publicURL : cfg.publicURL) || '').replace(/\/+$/, '');
  // Is this page being shown inside another site's page (see wrap.js)?
  var framed = false;
  try { framed = root.top !== root.self; } catch (e) { framed = true; }
  // The address of one of the pages. viaPublic: through the public address (config.js) rather than this site's own.
  function address(kind, query, viaPublic) {
    var parts = [];
    if (params.get('db')) parts.push('db=' + encodeURIComponent(params.get('db')));   // a test database stays a test database
    if (viaPublic && kind === 'tv') parts.push('v=tv');
    if (viaPublic && kind === 'player') parts.push('v=p');
    if (viaPublic && kind === 'flyers') parts.push('v=flyers');
    if (viaPublic && kind === 'learn') parts.push('v=learn');
    if (viaPublic && kind === 'board') parts.push('v=board');
    Object.keys(query || {}).forEach(function (k) { parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(query[k])); });
    var qs = parts.length ? '?' + parts.join('&') : '';
    if (viaPublic) return pub.indexOf('?') >= 0 ? pub + (qs ? '&' + qs.slice(1) : '') : pub + qs;      // (a club's address may carry ?c=<club> already)
    return home + clubDir + (kind === 'tv' ? 'tv/' : kind === 'player' ? 'p/' : kind === 'flyers' ? 'flyers/' : kind === 'learn' ? 'learn/' : kind === 'board' ? 'board/' : '') + qs;
  }

  function request(method, path, body) {
    var url = base + '/' + path + '.json';
    return fetch(url, { method: method, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store' })
      .then(function (res) {
        return res.text().then(function (txt) {
          var data = null;
          try { data = txt ? JSON.parse(txt) : null; } catch (e) { data = null; }
          if (!res.ok) {
            var err = new Error((data && data.error) || ('The database answered ' + res.status));
            err.status = res.status;
            throw err;
          }
          return data;
        });
      });
  }

  // what a device remembers (the admin key, which TV it is, who a player is) is kept apart per club as well
  var PREF = 'socials.' + (clubId ? clubId + '.' : ''), KEY_STORE = PREF + 'adminKey';
  // The admin key is typed once per device and then has to stay: a night must never stop saving because the browser
  // forgot it. So it is kept in several places and read back from whichever still has it:
  //   - in memory, for as long as the page is open (the browser clearing its storage cannot take that away);
  //   - localStorage, sessionStorage and a cookie of this site;
  //   - and, when the app is shown inside the club's own page (wrap.js), with THAT page as well. An iPad's Safari does
  //     not keep the storage of a framed page: it is gone whenever the tab is reloaded or the browser restarted. The
  //     club's page hands the key back in the address (#k=...) each time it opens the app.
  var memKey = '', cookiePath = '/';
  try { cookiePath = new URL(home || root.location.href).pathname.replace(/[^\/]*$/, '') || '/'; } catch (e) { /* stays "/" */ }
  function cookieGet(name) {
    try {
      var all = String(root.document.cookie || '').split(/;\s*/);
      for (var i = 0; i < all.length; i++) { var eq = all[i].indexOf('='); if (eq > 0 && decodeURIComponent(all[i].slice(0, eq)) === name) return decodeURIComponent(all[i].slice(eq + 1)); }
    } catch (e) { /* no cookies here */ }
    return '';
  }
  function cookieSet(name, value) {
    try {
      root.document.cookie = encodeURIComponent(name) + '=' + encodeURIComponent(value || '') + '; path=' + cookiePath + '; max-age=' + (value ? 400 * 86400 : 0) + '; SameSite=Lax' + (root.location.protocol === 'https:' ? '; Secure' : '');
    } catch (e) { /* no cookies here */ }
  }
  // The club's page this app is shown in (see wrap.js): only that address is ever told the key.
  var wrapOrigin = '';
  try { wrapOrigin = new URL(params.get('db') ? (params.get('wrapper') || 'x:') : (cfg.publicURL || 'x:')).origin; } catch (e) { wrapOrigin = ''; }
  if (!/^https?:/.test(wrapOrigin)) wrapOrigin = '';
  function tellWrapper(k) {
    if (!framed || !wrapOrigin) return;
    try { root.parent.postMessage({ cqSocials: 'key', club: clubId || '', key: k || '' }, wrapOrigin); } catch (e) { /* not in the club's page */ }
  }
  function getKey() {
    if (memKey) return memKey;
    var k = '';
    try { k = root.localStorage.getItem(KEY_STORE) || ''; } catch (e) { k = ''; }
    if (!k) { try { k = root.sessionStorage.getItem(KEY_STORE) || ''; } catch (e2) { k = ''; } }
    if (!k) k = cookieGet(KEY_STORE);
    memKey = k;
    return k;
  }
  function setKey(k) {
    k = k ? String(k) : '';
    memKey = k;
    try { if (k) root.localStorage.setItem(KEY_STORE, k); else root.localStorage.removeItem(KEY_STORE); } catch (e) { /* private mode */ }
    try { if (k) root.sessionStorage.setItem(KEY_STORE, k); else root.sessionStorage.removeItem(KEY_STORE); } catch (e2) { /* private mode */ }
    cookieSet(KEY_STORE, k);
    tellWrapper(k);
  }
  // A key in the address (#k=...): from a staff link, or handed back by the club's page. Taken in and removed from the address.
  (function () {
    var m = root.location ? /[#&]k=([^&]+)/.exec(root.location.hash || '') : null;
    if (!m) { if (getKey()) tellWrapper(getKey()); return; }      // (a key this device already had: the club's page learns it too)
    try { setKey(decodeURIComponent(m[1])); } catch (e) { return; }
    try { root.history.replaceState(null, '', root.location.pathname + root.location.search); } catch (e2) { /* stays in the address */ }
  })();

  root.Store = {
    configured: !!base,
    base: base,
    club: { id: clubId || 'lehi', name: club ? String(club.name || clubId) : '', formats: club && Array.isArray(club.formats) ? club.formats.slice() : null, courts: club && club.courts > 0 ? Math.floor(club.courts) : 0, root: dataRoot,
      intro: club ? !!club.intro : cfg.intro !== false },      // the "Intro to padel" slides and phone page
    get: function (path) { return request('GET', place(path)); },
    // updates: { "pub/some/path": value-or-null, ... } applied together
    write: function (updates) {
      var key = getKey();
      if (!key) { var e = new Error('Admin key needed'); e.status = 401; return Promise.reject(e); }
      var body = {};
      Object.keys(updates).forEach(function (p) { body[place(p)] = updates[p]; });
      body['gate/' + key] = Date.now() * 1000 + Math.floor(Math.random() * 1000);
      return request('PATCH', '', body);
    },
    // A player's phone: no admin key. The database only accepts this for a court's score and the "something
    // changed" counter; everything else is refused.
    writePublic: function (updates) { return request('PATCH', '', placeAll(updates)); },
    // An address for OTHER people to open: players scanning the TV's QR code, an address read out or sent on.
    // Uses the public address from config.js when one is set. kind: 'admin', 'tv', 'player' or 'flyers'.
    link: function (kind, query) { return address(kind, query, !!pub); },
    // The short link of a social's leaderboard, as texted to players: the first club's page and a four-character code
    // that stands for the club and the social (wrap.js finds the social again from it).
    shortCode: function (club, series) { var t = club + '/' + series, hh = 5381; for (var i = 0; i < t.length; i++) hh = ((hh * 33) ^ t.charCodeAt(i)) >>> 0; return ('0000' + hh.toString(36)).slice(-4); },
    short: function (series) {
      var first = String(cfg.publicURL || '').replace(/\/+$/, '');
      if (params.get('db') || !first) return address('board', { s: series }, !!pub);
      return first + '?' + this.shortCode(clubId || 'lehi', series);
    },
    // An address for moving around on THIS device (buttons and links between the pages, staff QR codes). Stays on
    // the site the page was opened on, where this device's admin key is remembered.
    here: function (kind, query) { return address(kind, query, !!pub && framed); },
    framed: framed,
    // A picture that ships with the site (the logo), whichever folder the page is in.
    asset: function (name) { return home + name; },
    // Where "Speak the names" sends its recording (never the real service while on a test database).
    voiceURL: params.get('voice') || (params.get('db') ? '' : String(cfg.voiceURL || '')),
    signupURL: String(cfg.signupURL || ''),                   // where the TV sign's sign-up QR codes point (+ the event's program id)
    // Go to another page. Inside another site's page the whole window moves, not just the frame.
    go: function (url) {
      if (framed) { try { root.top.location.href = url; return; } catch (e) { /* not allowed: move the frame instead */ } }
      root.location.href = url;
    },
    // Is this the admin key? Touches only the key's own counter; nothing else changes.
    checkKey: function (key) {
      var body = {};
      body['gate/' + key] = Date.now() * 1000 + Math.floor(Math.random() * 1000);
      return request('PATCH', '', body).then(function () { return true; }, function (err) { if (err.status === 401 || err.status === 403) return false; throw err; });
    },
    getKey: getKey,
    setKey: setKey,
    pref: function (name, value) {
      try {
        if (value === undefined) return root.localStorage.getItem(PREF + name);
        if (value === null) root.localStorage.removeItem(PREF + name); else root.localStorage.setItem(PREF + name, value);
      } catch (e) { /* ignore */ }
      return value;
    }
  };
})(typeof self !== 'undefined' ? self : this);
