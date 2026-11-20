/*
 * Shows the socials app inside a page on another site (for example go.playcnqr.com/socials), so that the
 * address people see is that site's. Put one line on that page:
 *     <script src="https://.../conquer-socials/wrap.js"></script>
 * The page's address chooses what is shown:   (nothing) = admin,   ?v=tv = TV screen,   ?v=p = players' phones.
 * Everything else in the address (?s=..., ?tv=...) is passed through.
 */
(function () {
  if (document.getElementById('cq-socials')) return;
  var me = document.currentScript && document.currentScript.src;
  if (!me) return;
  var app = me.replace(/[^\/]*(\?.*)?$/, '');
  function go() {
    if (document.getElementById('cq-socials')) return;
    var q = new URLSearchParams(location.search), v = (q.get('v') || '').toLowerCase();
    q.delete('v');
    var qs = q.toString();
    var frame = document.createElement('iframe');
    frame.id = 'cq-socials';
    frame.title = 'Conquer Padel socials';
    frame.setAttribute('allow', 'fullscreen; screen-wake-lock');
    frame.setAttribute('allowfullscreen', '');
    frame.src = app + (v === 'tv' ? 'tv/' : v === 'p' ? 'p/' : '') + (qs ? '?' + qs : '') + location.hash;
    frame.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;border:0;z-index:2147483000;background:#071a30';
    document.body.appendChild(frame);
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
    document.title = v === 'tv' ? 'Conquer Padel socials TV' : v === 'p' ? 'Enter your score' : 'Conquer Padel socials';
  }
  if (document.body) go(); else document.addEventListener('DOMContentLoaded', go);
})();
