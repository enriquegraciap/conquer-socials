/* Club flyers — the page where staff add the photos the TVs show as a slideshow (TV main menu -> Club flyers).
 *
 * A photo is made TV-sized in the browser before it is sent (at most 1920 x 1080, saved as a JPEG), so a big
 * phone photo or a print-size flyer does not slow the TVs down. Each flyer is stored in the database in two
 * parts: a line in the list (name, order, a small preview) and the picture itself. Changing anything bumps
 * "rev", which is what the TVs watch.
 */
(function () {
  'use strict';
  var S = window.Store, root = document.getElementById('app');
  // Two sets of flyers, each its own slideshow on the TVs: the club's everyday flyers, and those for a special event.
  var SPECIAL = new URLSearchParams(location.search).get('set') === 'special';
  var SET = SPECIAL ? { id: 'special', title: 'Special event flyers', menu: 'Special event flyers' } : { id: 'club', title: 'Club flyers', menu: 'Club flyers' };
  var PATH = 'pub/flyers/' + SET.id, MAX_W = 1920, MAX_H = 1080, THUMB_W = 360, SLIDE_SECONDS = 15;
  var state = { phase: 'boot', index: {}, error: '', busy: '', askKey: false, keyWrong: false, keyInput: '', after: null, toast: '', confirm: null };
  var toastTimer = null;

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
    state.toast = msg;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { state.toast = ''; render(); }, 4500);
  }
  function list() {
    return Object.keys(state.index).map(function (id) { var f = state.index[id]; return { id: id, name: f.name || 'Flyer', order: Number(f.order) || 0, thumb: f.thumb || '', video: f.video || '', vk: f.vk || '', dur: Number(f.dur) || 0 }; })
      .sort(function (a, b) { return a.order - b.order || (a.id < b.id ? -1 : 1); });
  }

  // ---------------------------------------------------------------- loading and saving
  function load() {
    if (!S.configured) { state.phase = 'nodb'; return render(); }
    // (where staff upload videos: the club's own media library; its address is kept with the club's data, not in this code)
    S.get('pub/settings/videoUpload').then(function (u) { if (typeof u === 'string' && /^https:\/\//.test(u)) { state.uploadURL = u; render(); } }).catch(function () { /* the steps are shown without the button */ });
    S.get(PATH + '/index').then(function (idx) { state.index = idx || {}; state.phase = 'ready'; render(); })
      .catch(function (err) { state.phase = 'error'; state.error = (err && err.message) || String(err); render(); });
  }
  // Every change also bumps "rev", so the TVs know to look again.
  function save(updates, again) {
    var up = {};
    Object.keys(updates).forEach(function (k) { up[PATH + '/' + k] = updates[k]; });
    up[PATH + '/rev'] = Date.now();
    return S.write(up).catch(function (err) {
      if (err.status === 401 || err.status === 403) { state.askKey = true; state.keyWrong = !!S.getKey(); state.after = again || null; state.busy = ''; render(); }
      else { state.busy = ''; toast('Could not save: ' + err.message); render(); }
      throw err;
    });
  }

  // ---------------------------------------------------------------- photos
  function readImage(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('not a picture this browser can open')); };
      img.src = url;
    });
  }
  function shrink(img, maxW, maxH, quality) {
    var w = img.naturalWidth, hgt = img.naturalHeight, k = Math.min(1, maxW / w, maxH / hgt);
    var c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(hgt * k));
    var g = c.getContext('2d');
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, c.width, c.height);     // see-through areas become white, not black
    g.imageSmoothingQuality = 'high';
    g.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', quality);
  }
  function prepare(file) {
    return readImage(file).then(function (img) {
      var full = shrink(img, MAX_W, MAX_H, 0.86);
      if (full.length > 1400000) full = shrink(img, MAX_W, MAX_H, 0.72);     // keep every flyer around a megabyte or less
      if (full.length > 1400000) full = shrink(img, MAX_W, MAX_H, 0.58);
      var out = { full: full, thumb: shrink(img, THUMB_W, THUMB_W, 0.7), w: img.naturalWidth, h: img.naturalHeight };
      URL.revokeObjectURL(img.src);
      return out;
    });
  }
  function addFiles(files) {
    files = Array.prototype.slice.call(files || []);
    if (!files.length || state.busy) return;
    if (!S.getKey()) {                                   // the photos wait while the key is typed, then they are added
      state.askKey = true; state.keyWrong = false; state.waiting = files.length; state.after = function () { state.waiting = 0; addFiles(files); };
      render();
      var box = document.getElementById('keyInput'); if (box) { box.focus(); box.scrollIntoView({ block: 'center' }); }
      return;
    }
    var done = 0, skipped = [];
    var order = list().reduce(function (m, f) { return Math.max(m, f.order); }, 0);
    var next = function (i) {
      if (i >= files.length) {
        state.busy = '';
        toast(done ? (done === 1 ? '1 flyer added.' : done + ' flyers added.') + (skipped.length ? ' Skipped: ' + skipped.join(', ') + '.' : '') + ' The TVs pick it up within half a minute.'
          : 'Nothing was added' + (skipped.length ? ': ' + skipped.join(', ') + ' could not be opened as a picture.' : '.'));
        return render();
      }
      var file = files[i];
      state.busy = 'Adding ' + (i + 1) + ' of ' + files.length + '…'; render();
      prepare(file).then(function (pic) {
        var id = 'f' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
        var meta = { name: String(file.name || 'Flyer').replace(/\.[a-z0-9]+$/i, '').slice(0, 60) || 'Flyer', order: ++order, at: Date.now(), w: pic.w, h: pic.h, thumb: pic.thumb };
        var up = {}; up['index/' + id] = meta; up['data/' + id] = pic.full;
        return save(up, function () { addFiles(files.slice(i)); }).then(function () { state.index[id] = meta; done++; next(i + 1); });
      }, function () { skipped.push(file.name || 'a file'); next(i + 1); }).catch(function () { /* save() has already said why */ });
    };
    next(0);
  }
  // ---------------------------------------------------------------- videos (by link)
  // A video is not stored here (far too heavy for this database): it stays where it is kept, and the slideshow plays
  // it from its link. A link to the file itself is best (HighLevel media library, Dropbox); YouTube links work too.
  // Gives back { url, vk: 'file' or 'yt', thumb } or null when the text is not a usable link.
  function videoLink(text) {
    var t = String(text || '').trim(), u;
    if (t && !/^https?:\/\//i.test(t)) t = 'https://' + t;
    try { u = new URL(t); } catch (e) { return null; }
    if (u.protocol !== 'https:') return null;
    var host = u.hostname.replace(/^www\./, '').toLowerCase(), m;
    if (host === 'youtu.be') m = /^\/([A-Za-z0-9_-]{6,})/.exec(u.pathname);
    else if (/(^|\.)youtube\.com$/.test(host)) m = u.searchParams.get('v') ? [0, u.searchParams.get('v')] : /^\/(?:shorts|embed|live)\/([A-Za-z0-9_-]{6,})/.exec(u.pathname);
    if (m && /^[A-Za-z0-9_-]{6,}$/.test(m[1])) return { url: 'https://www.youtube.com/watch?v=' + m[1], vk: 'yt', yt: m[1], thumb: 'https://i.ytimg.com/vi/' + m[1] + '/hqdefault.jpg' };
    if (/(^|\.)youtube\.com$/.test(host) || host === 'youtu.be') return null;
    if (/(^|\.)dropbox\.com$/.test(host)) { u.searchParams.delete('dl'); u.searchParams.set('raw', '1'); }           // the file itself, not its page
    if (host === 'drive.google.com' && (m = /\/file\/d\/([A-Za-z0-9_-]+)/.exec(u.pathname))) u = new URL('https://drive.google.com/uc?export=download&id=' + m[1]);
    return { url: u.toString(), vk: 'file', thumb: '' };
  }
  // Does the link really play as a video here? Gives its length and, when the place it is kept allows, a small picture of it.
  function probeVideo(url) {
    var open = function (cors) {
      return new Promise(function (ok, no) {
        var v = document.createElement('video'), timer = setTimeout(function () { v.removeAttribute('src'); no(new Error('timeout')); }, 20000);
        v.muted = true; v.playsInline = true; v.preload = 'auto';
        if (cors) v.crossOrigin = 'anonymous';
        v.onloadeddata = function () { clearTimeout(timer); ok(v); };
        v.onerror = function () { clearTimeout(timer); no(new Error('not a video')); };
        v.src = url;
      });
    };
    var snap = function (v) {
      return new Promise(function (ok) {
        var grab = function () {
          try { var c = document.createElement('canvas'), k = Math.min(1, THUMB_W / (v.videoWidth || THUMB_W)); c.width = Math.round((v.videoWidth || 16) * k); c.height = Math.round((v.videoHeight || 9) * k);
            c.getContext('2d').drawImage(v, 0, 0, c.width, c.height); ok(c.toDataURL('image/jpeg', 0.72)); } catch (e) { ok(''); }
        };
        v.onseeked = grab; setTimeout(function () { ok(''); }, 6000);
        try { v.currentTime = Math.min(1, (v.duration || 2) / 2); } catch (e) { grab(); }
      });
    };
    return open(true).then(function (v) { return snap(v).then(function (thumb) { return { dur: isFinite(v.duration) ? Math.round(v.duration) : 0, thumb: thumb }; }); },
      function () { return open(false).then(function (v) { return { dur: isFinite(v.duration) ? Math.round(v.duration) : 0, thumb: '' }; }); });
  }
  function addVideo() {
    if (state.busy) return;
    var link = videoLink(state.vurl), again = function () { addVideo(); };
    if (!link) return toast(/youtu/i.test(state.vurl || '') ? 'That YouTube link is not one of a single video.' : 'Paste the link to the video first (it starts with https://).');
    if (!S.getKey()) { state.askKey = true; state.keyWrong = false; state.after = again; render(); var box = document.getElementById('keyInput'); if (box) box.focus(); return; }
    state.busy = 'Checking the video…'; render();
    (link.vk === 'yt' ? Promise.resolve({ dur: 0, thumb: link.thumb }) : probeVideo(link.url)).then(function (info) {
      var id = 'v' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), order = list().reduce(function (m, f) { return Math.max(m, f.order); }, 0) + 1;
      var name = String(state.vname || '').replace(/\s+/g, ' ').trim().slice(0, 60) || (link.vk === 'yt' ? 'YouTube video' : 'Video');
      var meta = { name: name, order: order, at: Date.now(), video: link.url, vk: link.vk };
      if (link.yt) meta.yt = link.yt;
      if (info.dur) meta.dur = info.dur;
      if (info.thumb) meta.thumb = info.thumb;
      var up = {}; up['index/' + id] = meta;
      state.busy = 'Saving…'; render();
      return save(up, again).then(function () { state.index[id] = meta; state.busy = ''; state.vurl = ''; state.vname = ''; toast('Video added. The TVs pick it up within half a minute.'); render(); });
    }, function () {
      state.busy = '';
      toast('That link does not open as a video. Use the link to the video file itself (it usually ends in .mp4), or a YouTube link.'); render();
    }).catch(function () { /* save() has already said why */ });
  }
  function move(id, dir) {
    var all = list(), at = -1;
    all.forEach(function (f, i) { if (f.id === id) at = i; });
    var to = at + dir;
    if (at < 0 || to < 0 || to >= all.length || state.busy) return;
    var a = all[at], b = all[to], oa = a.order, ob = b.order;
    if (oa === ob) { oa = at + 1; ob = to + 1; }
    var up = {}; up['index/' + a.id + '/order'] = ob; up['index/' + b.id + '/order'] = oa;
    save(up, function () { move(id, dir); }).then(function () { state.index[a.id].order = ob; state.index[b.id].order = oa; render(); }).catch(function () {});
  }
  function remove(id) {
    var up = {}; up['index/' + id] = null; up['data/' + id] = null;
    save(up, function () { remove(id); }).then(function () { delete state.index[id]; toast('Flyer removed.'); render(); }).catch(function () {});
  }

  // ---------------------------------------------------------------- page
  function keyPanel() {
    var saveKey = function () {
      var k = state.keyInput.trim();
      if (!k) return;
      state.busy = 'Checking…'; render();
      S.checkKey(k).then(function (ok) {
        state.busy = '';
        if (!ok) { state.keyWrong = true; return render(); }
        S.setKey(k); state.keyInput = ''; state.askKey = false; state.keyWrong = false;
        var then = state.after; state.after = null;
        render();
        if (then) then();
      }).catch(function (err) { state.busy = ''; toast('Could not check the key: ' + err.message); render(); });
    };
    var club = S.club.name ? S.club.name + ' ' : '', n = state.waiting || 0;
    return h('div', { class: 'panel' + (n ? ' keywait' : ''), id: 'keyPanel' }, [
      h('h2', null, n ? 'One more step: the admin key' : 'Admin key'),
      n ? h('div', { class: 'notice', style: 'margin:0 0 10px' }, (n === 1 ? 'Your photo is waiting.' : 'Your ' + n + ' photos are waiting.') + ' Type the ' + club + 'admin key below and press Save key: ' + (n === 1 ? 'it is' : 'they are') + ' added straight away.') : null,
      h('p', { class: 'hint', style: 'margin:0 0 10px' }, state.keyWrong ? 'That key was not accepted. Check it and try again.' : 'Type the ' + club + 'admin key once on this device. It is the same key as for the ' + club + 'socials.'),
      h('div', { class: 'row' }, [
        h('input', { type: 'text', id: 'keyInput', placeholder: 'Admin key', value: state.keyInput, autocapitalize: 'none', autocomplete: 'off', autocorrect: 'off', spellcheck: 'false', style: 'flex:1',
          oninput: function (e) { state.keyInput = e.target.value; }, onkeydown: function (e) { if (e.key === 'Enter') saveKey(); } }),
        btn('Save key', 'primary', saveKey, { id: 'saveKey' })
      ])
    ]);
  }
  function render() {
    var active = document.activeElement, focusId = active && active.id;
    var kids = [h('div', { class: 'topbar' }, [h('h1', null, SET.title + (S.club.name ? ' · ' + S.club.name : '')), h('span', { class: 'spacer' }), h('span', { class: 'sync' }, state.busy),
      h('a', { class: 'linkbtn', href: S.here('admin'), target: S.framed ? '_top' : null }, 'Socials')])];
    var body = [];
    if (state.phase === 'boot') body.push(h('p', { class: 'hint' }, 'Loading…'));
    else if (state.phase === 'nodb') body.push(h('div', { class: 'notice err' }, 'No database address is set yet. Open config.js and fill in databaseURL.'));
    else if (state.phase === 'error') body.push(h('div', { class: 'notice err' }, 'Could not reach the database: ' + state.error), btn('Try again', 'primary', function () { state.phase = 'boot'; render(); load(); }));
    else {
      var all = list();
      body.push(h('div', { class: 'settabs', role: 'navigation', 'aria-label': 'Which slideshow' }, [
        h('a', { href: S.here('flyers'), target: S.framed ? '_top' : null, class: SPECIAL ? '' : 'on', id: 'setClub' }, 'Club flyers'),
        h('a', { href: S.here('flyers', { set: 'special' }), target: S.framed ? '_top' : null, class: SPECIAL ? 'on' : '', id: 'setSpecial' }, 'Special event flyers')
      ]));
      if (state.askKey) body.push(keyPanel());
      body.push(h('div', { class: 'panel' }, [
        h('h2', null, ['Add flyers', h('small', null, 'photos from this device')]),
        h('p', { class: 'hint', style: 'margin:0 0 12px' }, 'Choose one photo or several. Wide (landscape) flyers fill the TV; tall ones show with black bars at the sides. Each flyer stays up for ' + SLIDE_SECONDS + ' seconds.'),
        h('div', { class: 'row' }, [
          h('label', { class: 'btn primary flypick' + (state.busy ? ' off' : ''), for: 'pick' }, state.busy || 'Add photos'),
          h('input', { type: 'file', id: 'pick', accept: 'image/*', multiple: true, hidden: true, disabled: !!state.busy,
            onchange: function (e) { var f = Array.prototype.slice.call(e.target.files || []); e.target.value = ''; addFiles(f); } })
        ]),
        h('h2', { style: 'margin-top:18px' }, ['Add a video', h('small', null, 'by its link')]),
        h('ol', { class: 'vidsteps' }, [
          h('li', null, ['Upload the video to the HighLevel media library. ', state.uploadURL ? h('a', { class: 'btn small', id: 'openMedia', href: state.uploadURL, target: '_blank', rel: 'noopener' }, 'Open the media library') : null]),
          h('li', null, 'There, open the video\u2019s menu (the three dots) and choose Copy link.'),
          h('li', null, 'Come back here, paste the link below and press Add video.')
        ]),
        h('p', { class: 'hint', style: 'margin:0 0 12px' }, 'The video stays in the media library; the TVs play it from there, once from start to end, without sound, and then the next flyer follows. A YouTube or Dropbox link works too.'),
        h('div', { class: 'vidform' }, [
          h('input', { type: 'url', id: 'vurl', placeholder: 'Link to the video (https://…)', value: state.vurl || '', autocomplete: 'off', autocapitalize: 'none', inputmode: 'url', disabled: !!state.busy, oninput: function (e) { state.vurl = e.target.value; } }),
          h('input', { type: 'text', id: 'vname', placeholder: 'A name for it (optional)', value: state.vname || '', maxlength: 60, autocomplete: 'off', disabled: !!state.busy, oninput: function (e) { state.vname = e.target.value; } }),
          btn(state.busy || 'Add video', 'primary', addVideo, { id: 'addVideo', disabled: !!state.busy })
        ]),
        h('p', { class: 'hint' }, 'To show them: on the TV press Main menu, then ' + SET.menu + '. New flyers appear on the TVs within half a minute.' +
          (SPECIAL ? ' This slideshow shows only these flyers; the everyday club flyers and leaderboards are in the other one.' : ''))
      ]));
      body.push(h('div', { class: 'panel' }, [
        h('h2', null, ['On the TVs now', h('small', null, all.length ? all.length + (all.length === 1 ? ' slide' : ' slides') + ', in this order' : '')]),
        all.length ? h('div', { class: 'flygrid' }, all.map(function (f, i) {
          return h('div', { class: 'flycard', 'data-flyer': f.id }, [
            h('div', { class: 'pic' + (f.video ? ' vid' : '') }, [f.thumb ? h('img', { src: f.thumb, alt: '' }) : null, h('span', { class: 'no' }, String(i + 1)),
              f.video ? h('span', { class: 'play', 'aria-hidden': 'true' }, '\u25B6') : null, f.video ? h('span', { class: 'len' }, f.vk === 'yt' ? 'YouTube' : f.dur ? Math.floor(f.dur / 60) + ':' + ('0' + f.dur % 60).slice(-2) : 'Video') : null]),
            h('div', { class: 'nm' }, f.name),
            h('div', { class: 'row' }, [
              btn('Earlier', 'small', function () { move(f.id, -1); }, { disabled: i === 0 || !!state.busy, 'aria-label': 'Show ' + f.name + ' earlier' }),
              btn('Later', 'small', function () { move(f.id, 1); }, { disabled: i === all.length - 1 || !!state.busy, 'aria-label': 'Show ' + f.name + ' later' }),
              h('span', { class: 'spacer' }),
              btn('Remove', 'small danger', function () { state.confirm = f; render(); }, { disabled: !!state.busy, 'aria-label': 'Remove ' + f.name })
            ])
          ]);
        })) : h('p', { class: 'hint' }, 'No flyers yet. Add the first one above.')
      ]));
    }
    kids.push(h('div', { class: 'wrap' }, body));
    if (state.confirm) {
      var f = state.confirm, close = function () { state.confirm = null; render(); };
      kids.push(h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', onclick: function (e) { if (e.target === e.currentTarget) close(); } }, h('div', { class: 'sheet' }, [
        h('h3', null, 'Remove this flyer?'),
        h('p', { style: 'margin:0;font-size:17px;line-height:1.45' }, '“' + f.name + '” comes off every TV. ' + (f.video ? 'The video itself stays where it is kept.' : 'The photo itself stays on your device.')),
        h('div', { class: 'row end' }, [btn('Cancel', '', close), btn('Remove', 'danger', function () { state.confirm = null; remove(f.id); }, { id: 'modalOk' })])
      ])));
    }
    if (state.toast) kids.push(h('div', { class: 'toast', role: 'status' }, state.toast));
    root.replaceChildren.apply(root, kids);
    if (focusId) { var el = document.getElementById(focusId); if (el) el.focus(); }
  }

  render();
  load();
})();
