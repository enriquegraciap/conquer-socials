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

  var KEY_STORE = 'socials.adminKey';
  function getKey() {
    try { return root.localStorage.getItem(KEY_STORE) || ''; } catch (e) { return ''; }
  }
  function setKey(k) {
    try { if (k) root.localStorage.setItem(KEY_STORE, k); else root.localStorage.removeItem(KEY_STORE); } catch (e) { /* private mode */ }
  }

  root.Store = {
    configured: !!base,
    base: base,
    get: function (path) { return request('GET', path); },
    // updates: { "pub/some/path": value-or-null, ... } applied together
    write: function (updates) {
      var key = getKey();
      if (!key) { var e = new Error('Admin key needed'); e.status = 401; return Promise.reject(e); }
      var body = {};
      Object.keys(updates).forEach(function (p) { body[p] = updates[p]; });
      body['gate/' + key] = Date.now() * 1000 + Math.floor(Math.random() * 1000);
      return request('PATCH', '', body);
    },
    // A player's phone: no admin key. The database only accepts this for a court's score and the "something
    // changed" counter; everything else is refused.
    writePublic: function (updates) { return request('PATCH', '', updates); },
    getKey: getKey,
    setKey: setKey,
    pref: function (name, value) {
      try {
        if (value === undefined) return root.localStorage.getItem('socials.' + name);
        if (value === null) root.localStorage.removeItem('socials.' + name); else root.localStorage.setItem('socials.' + name, value);
      } catch (e) { /* ignore */ }
      return value;
    }
  };
})(typeof self !== 'undefined' ? self : this);
