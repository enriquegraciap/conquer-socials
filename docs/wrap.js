/*
 * Shows the socials app inside a page on another site (for example go.playcnqr.com/socials), so that the
 * address people see is that site's. Put one line on that page:
 *     <script src="https://.../conquer-socials/wrap.js"></script>
 * The page's address chooses what is shown:   (nothing) = admin,   ?v=tv = TV screen,   ?v=p = players' phones,   ?v=flyers = club flyers,   ?v=learn = intro to padel,   ?v=board = a social's leaderboard to share.
 * ?c=<club> shows another club's pages from the same page (?c=tempe), so every club has a short address.
 * ?<four characters> (for example ?k9f3) is the short link of one social's leaderboard, as texted to players: the code
 * is worked out from the club and the social's id (shortCode), and found again here among the clubs' socials.
 * Everything else in the address (?s=..., ?tv=...) is passed through.
 */
(function () {
  if (document.getElementById('cq-socials')) return;
  var me = document.currentScript && document.currentScript.src;
  if (!me) return;
  var app = me.replace(/[^\/]*(\?.*)?$/, '');
  var DB = 'https://conquer-socials-default-rtdb.firebaseio.com', CLUBS = [['lehi', 'pub', ''], ['tempe', 'tempe', 'tempe']];      // (as in config.js)
  function shortCode(c, s) { var t = c + '/' + s, h = 5381; for (var i = 0; i < t.length; i++) h = ((h * 33) ^ t.charCodeAt(i)) >>> 0; return ('0000' + h.toString(36)).slice(-4); }
  // Which social a short code stands for: { c: club for the address, s: the social }, or null.
  function findCode(code) {
    return Promise.all(CLUBS.map(function (cl) {
      return fetch(DB + '/' + cl[1] + '/series.json?shallow=true').then(function (r) { return r.json(); }).then(function (ids) {
        return Object.keys(ids || {}).filter(function (id) { return shortCode(cl[0], id) === code; }).map(function (id) { return { c: cl[2], s: id }; });
      }).catch(function () { return []; });
    })).then(function (found) { found = [].concat.apply([], found); return found[0] || null; });
  }
  function go(hit) {
    if (document.getElementById('cq-socials')) return;
    var q = new URLSearchParams(location.search), v = (q.get('v') || '').toLowerCase();
    var code = /^\?([a-z0-9]{4})$/.exec(location.search);
    if (code && hit === undefined) { findCode(code[1]).then(go, function () { go(null); }); return; }
    if (code) { q = new URLSearchParams(''); v = 'board'; if (hit) { q.set('s', hit.s); if (hit.c) q.set('c', hit.c); } }
    q.delete('v');
    var c = (q.get('c') || '').toLowerCase(), club = /^[a-z0-9-]{1,30}$/.test(c) && app.slice(-c.length - 2) !== '/' + c + '/' ? c + '/' : '';
    q.delete('c');
    var qs = q.toString();
    var frame = document.createElement('iframe');
    frame.id = 'cq-socials';
    frame.title = 'Conquer Padel socials';
    frame.setAttribute('allow', 'fullscreen; screen-wake-lock; microphone; web-share; clipboard-write');
    frame.setAttribute('allowfullscreen', '');
    frame.src = app + club + (v === 'tv' ? 'tv/' : v === 'p' ? 'p/' : v === 'flyers' ? 'flyers/' : v === 'learn' ? 'learn/' : v === 'board' ? 'board/' : '') + (qs ? '?' + qs : '') + location.hash;
    frame.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;border:0;z-index:2147483000;background:#071a30';
    document.body.appendChild(frame);
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
    document.title = v === 'tv' ? 'Conquer Padel socials TV' : v === 'p' ? 'Enter your score' : v === 'learn' ? 'Intro to padel · Conquer Padel Club' : v === 'board' ? 'Leaderboard · Conquer Padel Club' : 'Conquer Padel socials';
  }
  if (document.body) go(); else document.addEventListener('DOMContentLoaded', function () { go(); });
})();
