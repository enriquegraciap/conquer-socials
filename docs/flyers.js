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
  var PATH = 'pub/flyers/club', MAX_W = 1920, MAX_H = 1080, THUMB_W = 360, SLIDE_SECONDS = 15;
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
    return Object.keys(state.index).map(function (id) { var f = state.index[id]; return { id: id, name: f.name || 'Flyer', order: Number(f.order) || 0, thumb: f.thumb || '' }; })
      .sort(function (a, b) { return a.order - b.order || (a.id < b.id ? -1 : 1); });
  }

  // ---------------------------------------------------------------- loading and saving
  function load() {
    if (!S.configured) { state.phase = 'nodb'; return render(); }
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
    if (!S.getKey()) { state.askKey = true; state.keyWrong = false; state.after = function () { addFiles(files); }; return render(); }
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
    return h('div', { class: 'panel' }, [
      h('h2', null, 'Admin key'),
      h('p', { class: 'hint', style: 'margin:0 0 10px' }, state.keyWrong ? 'That key was not accepted. Check it and try again.' : 'Type the admin key once on this device. It is the same key as for the socials.'),
      h('div', { class: 'row' }, [
        h('input', { type: 'text', id: 'keyInput', placeholder: 'Admin key', value: state.keyInput, autocapitalize: 'none', autocomplete: 'off', autocorrect: 'off', spellcheck: 'false', style: 'flex:1',
          oninput: function (e) { state.keyInput = e.target.value; }, onkeydown: function (e) { if (e.key === 'Enter') saveKey(); } }),
        btn('Save key', 'primary', saveKey, { id: 'saveKey' })
      ])
    ]);
  }
  function render() {
    var active = document.activeElement, focusId = active && active.id;
    var kids = [h('div', { class: 'topbar' }, [h('h1', null, 'Club flyers'), h('span', { class: 'spacer' }), h('span', { class: 'sync' }, state.busy),
      h('a', { class: 'linkbtn', href: S.link('admin') }, 'Socials')])];
    var body = [];
    if (state.phase === 'boot') body.push(h('p', { class: 'hint' }, 'Loading…'));
    else if (state.phase === 'nodb') body.push(h('div', { class: 'notice err' }, 'No database address is set yet. Open config.js and fill in databaseURL.'));
    else if (state.phase === 'error') body.push(h('div', { class: 'notice err' }, 'Could not reach the database: ' + state.error), btn('Try again', 'primary', function () { state.phase = 'boot'; render(); load(); }));
    else {
      var all = list();
      if (state.askKey) body.push(keyPanel());
      body.push(h('div', { class: 'panel' }, [
        h('h2', null, ['Add flyers', h('small', null, 'photos from this device')]),
        h('p', { class: 'hint', style: 'margin:0 0 12px' }, 'Choose one photo or several. Wide (landscape) flyers fill the TV; tall ones show with black bars at the sides. Each flyer stays up for ' + SLIDE_SECONDS + ' seconds.'),
        h('div', { class: 'row' }, [
          h('label', { class: 'btn primary flypick' + (state.busy ? ' off' : ''), for: 'pick' }, state.busy || 'Add photos'),
          h('input', { type: 'file', id: 'pick', accept: 'image/*', multiple: true, hidden: true, disabled: !!state.busy,
            onchange: function (e) { var f = Array.prototype.slice.call(e.target.files || []); e.target.value = ''; addFiles(f); } })
        ]),
        h('p', { class: 'hint' }, 'To show them: on the TV press Main menu, then Club flyers. New flyers appear on the TVs within half a minute.')
      ]));
      body.push(h('div', { class: 'panel' }, [
        h('h2', null, ['On the TVs now', h('small', null, all.length ? all.length + (all.length === 1 ? ' flyer' : ' flyers') + ', in this order' : '')]),
        all.length ? h('div', { class: 'flygrid' }, all.map(function (f, i) {
          return h('div', { class: 'flycard', 'data-flyer': f.id }, [
            h('div', { class: 'pic' }, [f.thumb ? h('img', { src: f.thumb, alt: '' }) : null, h('span', { class: 'no' }, String(i + 1))]),
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
        h('p', { style: 'margin:0;font-size:17px;line-height:1.45' }, '“' + f.name + '” comes off every TV. The photo itself stays on your device.'),
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
