/*
 * Keeps the screen on while the page is open, so the TV and the iPad never dim or go to sleep.
 * It asks the browser for a "screen wake lock" and asks again whenever the lock is dropped: when the page
 * comes back into view, on any touch or key press, and every 20 seconds as a safety net.
 *
 * Limits a web page cannot get around:
 *  - It cannot change screen brightness; that is a device setting.
 *  - A browser without wake-lock support ignores this. On the iPad set Auto-Lock to Never as well, and on
 *    the TV turn off the screensaver / ambient mode.
 */
(function (root) {
  'use strict';
  var lock = null, supported = !!(root.navigator && root.navigator.wakeLock);

  function request() {
    if (!supported || lock || document.hidden) return;
    root.navigator.wakeLock.request('screen').then(function (l) {
      lock = l;
      l.addEventListener('release', function () { lock = null; });
    }).catch(function () { /* refused for now (page not visible, low battery mode): tried again shortly */ });
  }

  root.Awake = {
    supported: supported,
    isOn: function () { return !!lock; },
    start: function () {
      request();
      document.addEventListener('visibilitychange', request);
      ['pointerdown', 'keydown'].forEach(function (ev) { document.addEventListener(ev, request, { passive: true }); });
      setInterval(request, 20000);
    }
  };
})(typeof self !== 'undefined' ? self : this);
