/*
 * Padel Socials — the leaderboard to share (phones).
 *
 * One address per social (board/?s=<social>), the same every week: it always shows the latest night that was
 * played and that month's table. The leaderboard is drawn as one tall picture (1080 x 1920, a phone's shape) in
 * the social's own look: its banner colours and pattern, or its own logos. "Share" hands that picture to the
 * phone's share sheet (Instagram, WhatsApp, Messages...); a screenshot of the page gives the same picture.
 * Under it is the whole list; tapping a name marks it in the picture.
 */
(function () {
  'use strict';
  var S = window.Store, E = window.Engine, L = window.Look;
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var W = 1080, H = 1920, GOLD = '#f4b63f', DISPLAY = '"Barlow Condensed", "Arial Narrow", Arial, sans-serif', SCRIPT = 'Knewave, "Barlow Condensed", Arial, sans-serif';
  var app = document.getElementById('app'), params = new URLSearchParams(location.search), id = params.get('s') || '';
  var st = { series: null, night: null, nightRows: [], table: '', month: '', monthRows: [], nights: 0, view: params.get('view') === 'month' ? 'month' : 'night', me: '', imgs: {}, tile: null, sig: '', busy: false };
  try { st.me = localStorage.getItem('socials.board.me') || ''; } catch (e) { /* private mode */ }

  function h(tag, attrs, kids) {
    var el = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'class') el.className = attrs[k]; else if (k.slice(0, 2) === 'on') el[k] = attrs[k]; else if (attrs[k] !== null && attrs[k] !== undefined && attrs[k] !== false) el.setAttribute(k, attrs[k]);
    });
    (Array.isArray(kids) ? kids : [kids]).forEach(function (c) { if (c !== null && c !== undefined && c !== false) el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return el;
  }
  function ordinal(n) { var v = n % 100, s = ['th', 'st', 'nd', 'rd']; return n + (s[(v - 20) % 10] || s[v] || s[0]); }
  function longDate(d) { var x = new Date(d + 'T12:00:00'); return DAYS[x.getDay()] + ', ' + MONTHS[x.getMonth()] + ' ' + ordinal(x.getDate()); }
  function shortDate(d) { var x = new Date(d + 'T12:00:00'); return DAYS[x.getDay()].slice(0, 3) + ', ' + MONTHS[x.getMonth()].slice(0, 3) + ' ' + x.getDate(); }
  // a night that is being played now (not one that was simply never closed)
  function onNow(doc) { return !!doc && doc.status !== 'ended' && Math.abs(Date.now() - new Date(doc.date + 'T12:00:00').getTime()) < 36 * 3600000; }
  function monthName(m) { return st.table || MONTHS[Number(String(m).slice(5, 7)) - 1] || ''; }      // the table's own name ("Fall Series"), or the month
  function clubLine() { return 'Conquer Padel Club · ' + (S.club.name || 'Lehi'); }
  function image(src) {
    return new Promise(function (ok) {
      if (!src) return ok(null);
      var img = new Image();
      img.onload = function () { ok(img); }; img.onerror = function () { ok(null); };
      img.src = src;
    });
  }

  // ---------------------------------------------------------------- data
  function load() {
    return Promise.all([S.get('pub/series/' + id), S.get('pub/results/' + id)]).then(function (got) {
      var series = got[0], res = got[1] || {};
      if (!series) { st.series = null; return; }
      st.series = series;
      var best = null;                                                   // the latest night that was really played
      Object.keys(res).forEach(function (m) {
        Object.keys(res[m] || {}).forEach(function (sid) {
          var d = res[m][sid];
          if (!d || !d.entries || !(Number(d.rounds) > 0)) return;
          if (!best || String(d.date) > String(best.doc.date) || (d.date === best.doc.date && sid > best.sid)) best = { doc: d, sid: sid, month: m };
        });
      });
      var months = Object.keys(res).sort();
      st.night = best ? best.doc : null;
      var stayed = {};                                                   // the night's table leaves out whoever was removed during it
      if (best) Object.keys(best.doc.entries).forEach(function (k) { if (!best.doc.entries[k].left) stayed[k] = best.doc.entries[k]; });
      st.nightRows = best ? E.monthlyBoard({ n: { date: best.doc.date, entries: stayed } }) : [];
      st.month = best ? best.month : (months[months.length - 1] || '');
      st.monthRows = st.month ? E.monthlyBoard(res[st.month]) : [];
      st.nights = st.month ? Object.keys(res[st.month] || {}).filter(function (k) { return !!(res[st.month][k] || {}).entries; }).length : 0;
      // a social with one table for all its nights (a "Fall Series"): every month counts, and the points brought along
      var table = E.tableOf(series);
      st.table = table ? (table.name || 'Series') : '';
      if (table) {
        st.monthRows = E.monthlyBoard(E.tableDocs(series, res)); if (!st.month) st.month = E.localDate(new Date()).slice(0, 7);
        if (table.present && best) { var here = {}; Object.keys(best.doc.entries).forEach(function (k) { here[k] = true; }); st.monthRows = E.tableHere(st.monthRows, here); }   // only whoever played that night
      }
      if (!st.night) st.view = 'month';
    });
  }
  // The pictures the card needs: the social's own logos when it has them, else the club's; and the banner's motif.
  function loadLook() {
    var look = st.series.look || {}, own = !!(look.bar && (look.logoL || look.logoR));
    var band = !own && look.band ? (look.bandTall ? 'bandTall' : 'band') : '';       // a piece of the flyer itself as the banner (Flyer and look)
    var sig = JSON.stringify([own, look.logoRev, look.cands, look.variant, look.pattern, band, look.bandRev]);
    if (sig === st.sig) return Promise.resolve();
    st.sig = sig;
    var get = function (k) { return look[k] || k === band ? S.get('pub/eventflyers/' + id + '/' + k).then(function (d) { return typeof d === 'string' && /^data:image\//.test(d) ? image(d) : null; }).catch(function () { return null; }) : Promise.resolve(null); };
    var tile = function () {
      var b = look.cands && !look.bar ? L.banner(look) : null, m = b && /^url\("(data:image\/svg\+xml,[^"]+)"\)$/.exec(b.image);
      return m ? image(m[1]).then(function (img) { return img ? { img: img, size: b.size } : null; }) : Promise.resolve(null);
    };
    return Promise.all([own ? get('logoL') : image(S.asset('logo-p.png')), own ? get('logoR') : image(S.asset('conquer-wordmark-white.png')), tile(),
      document.fonts && document.fonts.load ? Promise.all([document.fonts.load('700 60px "Barlow Condensed"'), document.fonts.load('600 60px "Barlow Condensed"'), document.fonts.load('500 60px "Barlow Condensed"'), document.fonts.load('60px Knewave')]).catch(function () {}) : null
      , band ? get(band) : Promise.resolve(null)
    ]).then(function (got) { st.imgs = { l: got[0], r: got[1], own: own }; st.tile = got[2]; st.band = got[got.length - 1] || null; });
  }

  // ---------------------------------------------------------------- the picture
  function fitText(ctx, text, weight, family, size, min, maxW) {
    for (; size > min; size -= 2) { ctx.font = weight + ' ' + size + 'px ' + family; if (ctx.measureText(text).width <= maxW) return size; }
    ctx.font = weight + ' ' + min + 'px ' + family;
    return min;
  }
  function clip(ctx, text, maxW) {
    if (ctx.measureText(text).width <= maxW) return text;
    while (text.length > 2 && ctx.measureText(text + '…').width > maxW) text = text.slice(0, -1);
    return text.replace(/\s+$/, '') + '…';
  }
  function box(ctx, x, y, w, hgt, r) {
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + hgt, r); ctx.arcTo(x + w, y + hgt, x, y + hgt, r); ctx.arcTo(x, y + hgt, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  function palette() {
    var look = st.series.look || {}, th = L.theme(look), own = st.imgs.own, c = look.cands ? L.colours(look) : null;
    var p = th ? { bg: th.bg, panel: th.panel, row: th.deep, text: '#ffffff', dim: th.soft, line: th.main }
      : { bg: '#071a30', panel: '#12304f', row: '#0d2440', text: '#ffffff', dim: '#9fb6d0', line: GOLD };
    p.bar = own ? look.bar : c ? c.base : '#0a2f41';
    p.barInk = own ? (look.barInk || (L.luminance(look.bar) > 0.45 ? '#0e2238' : '#ffffff')) : st.band && look.bandInk === 'dark' ? '#0e2238' : '#ffffff';
    p.barLine = own ? p.barInk : c ? c.a1 : GOLD;
    p.grad = c && !own && look.pattern === 'plain' ? c.a1 : null;
    p.stripes = c && !own && (!look.pattern || look.pattern === 'stripes') ? [c.a1, c.a2] : null;
    return p;
  }
  function draw(cv) {
    var ctx = cv.getContext('2d'), p = palette(), night = st.view === 'night', rows = night ? st.nightRows : st.monthRows;
    cv.width = W; cv.height = H;
    ctx.fillStyle = p.bg; ctx.fillRect(0, 0, W, H);
    // ---- banner: the social's colours and motif (or its own logos on its own colour), its name in the club's script
    var BH = 372;
    ctx.fillStyle = p.bar; ctx.fillRect(0, 0, W, BH);
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, W, BH); ctx.clip();
    if (st.band) {                                   // the chosen piece of the flyer, filling the banner in its own colours
      var bk = Math.max(W / st.band.naturalWidth, BH / st.band.naturalHeight), bw = st.band.naturalWidth * bk, bh = st.band.naturalHeight * bk;
      ctx.drawImage(st.band, (W - bw) / 2, (BH - bh) / 2, bw, bh);
    } else if (st.tile) {
      var m = /^([\d.]+)vmin ([\d.]+)vmin$/.exec(st.tile.size) || [0, 13, 10], tw = Math.round(Number(m[1]) * 10.8), thh = Math.round(Number(m[2]) * 10.8), t = document.createElement('canvas');
      t.width = tw; t.height = thh; t.getContext('2d').drawImage(st.tile.img, 0, 0, tw, thh);
      ctx.fillStyle = ctx.createPattern(t, 'repeat'); ctx.fillRect(0, 0, W, BH);
    } else if (p.grad) {
      var g = ctx.createLinearGradient(0, 0, W, BH); g.addColorStop(0, p.bar); g.addColorStop(0.45, p.bar); g.addColorStop(1, p.grad);
      ctx.globalAlpha = 0.75; ctx.fillStyle = g; ctx.fillRect(0, 0, W, BH); ctx.globalAlpha = 1;
    } else if (p.stripes) {
      ctx.translate(W / 2, BH / 2); ctx.rotate(28 * Math.PI / 180);
      for (var sx = -900; sx < 900; sx += 58) {
        ctx.globalAlpha = 0.4; ctx.fillStyle = p.stripes[0]; ctx.fillRect(sx + 24, -700, 13, 1400);
        ctx.globalAlpha = 0.3; ctx.fillStyle = p.stripes[1]; ctx.fillRect(sx + 50, -700, 6, 1400);
      }
      ctx.globalAlpha = 1;
    }
    ctx.restore();
    ctx.fillStyle = p.barLine; ctx.fillRect(0, BH, W, 8);
    var onBand = !!st.band, darkInk = onBand && p.barInk !== '#ffffff', glow = darkInk ? 'rgba(255,255,255,.95)' : 'rgba(0,0,0,.8)';
    var logo = function (img, right, maxH, maxW) {
      if (!img) return;
      var k = Math.min(maxH / img.naturalHeight, maxW / img.naturalWidth), w = img.naturalWidth * k, hh = img.naturalHeight * k, src = img;
      if (onBand) {                                   // on a piece of the flyer: the club's logos in the lettering's colour, with a soft halo
        src = document.createElement('canvas'); src.width = Math.ceil(w); src.height = Math.ceil(hh);
        var lc = src.getContext('2d'); lc.drawImage(img, 0, 0, src.width, src.height); lc.globalCompositeOperation = 'source-in'; lc.fillStyle = p.barInk; lc.fillRect(0, 0, src.width, src.height);
        ctx.save(); ctx.shadowColor = glow; ctx.shadowBlur = 16; ctx.shadowOffsetY = darkInk ? 0 : 3;
        ctx.drawImage(src, right ? W - 56 - w : 56, 40 + (maxH - hh) / 2, w, hh); ctx.drawImage(src, right ? W - 56 - w : 56, 40 + (maxH - hh) / 2, w, hh); ctx.restore();
        return;
      }
      ctx.drawImage(src, right ? W - 56 - w : 56, 40 + (maxH - hh) / 2, w, hh);
    };
    var LH = st.imgs.own ? 118 : 86;
    logo(st.imgs.l, false, LH, 400); logo(st.imgs.r, true, st.imgs.own ? LH : 62, 400);
    // The name on the picture. A social can give its public name in two parts (Flyer and look): a small line above
    // (with a crown if wished), the name itself, and a very small line under it.
    var sh = st.series.share || {}, over = String(sh.over || '').replace(/\s+/g, ' ').trim().toUpperCase(), under = String(sh.note || '').replace(/\s+/g, ' ').trim().toUpperCase();
    var name = String(sh.title || st.series.name || 'Padel social').toUpperCase(), top0 = 40 + LH + (over || under ? 4 : 22), room0 = BH - top0 - (under ? 18 : 26);
    var overH = over ? 62 : 0, underH = under ? 40 : 0, top = top0 + overH, room = room0 - overH - underH;
    ctx.fillStyle = p.barInk; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    if (onBand) { ctx.shadowColor = glow; ctx.shadowBlur = 22; ctx.shadowOffsetY = darkInk ? 0 : 4; }
    else if (!st.imgs.own) { ctx.shadowColor = 'rgba(0,0,0,.45)'; ctx.shadowBlur = 10; ctx.shadowOffsetY = 3; }
    var size = fitText(ctx, name, '400', SCRIPT, Math.min(96, Math.floor(room * 0.98)), Math.min(58, Math.floor(room * 0.6)), W - 96), lines = [name];
    if (ctx.measureText(name).width > W - 96) {                         // two lines, broken as evenly as the words allow
      var words = name.split(' '), bestAt = 1, bestGap = Infinity;
      for (var i = 1; i < words.length; i++) { var gap = Math.abs(words.slice(0, i).join(' ').length - words.slice(i).join(' ').length); if (gap < bestGap) { bestGap = gap; bestAt = i; } }
      lines = [words.slice(0, bestAt).join(' '), words.slice(bestAt).join(' ')];
      size = Math.min(fitText(ctx, lines[0], '400', SCRIPT, 84, 36, W - 96), fitText(ctx, lines[1], '400', SCRIPT, 84, 36, W - 96), Math.floor(room / 2.2));
      ctx.font = '400 ' + size + 'px ' + SCRIPT;
    }
    for (var pass = 0; pass < (onBand ? 2 : 1); pass++) lines.forEach(function (ln, i) { ctx.fillText(ln, W / 2, top + room / 2 + (i - (lines.length - 1) / 2) * size * 1.12); });   // (twice on a picture: a fuller halo)
    if (over) {
      var os = fitText(ctx, over, '400', SCRIPT, 50, 30, W - 240), ow = ctx.measureText(over).width, cw = sh.crown ? os * 1.25 : 0, gapC = sh.crown ? 16 : 0, ox = (W - (cw + gapC + ow)) / 2, oy = top0 + overH / 2 + 2;
      ctx.textAlign = 'left';
      for (pass = 0; pass < (onBand ? 2 : 1); pass++) ctx.fillText(over, ox + cw + gapC, oy);
      if (sh.crown) crown(ctx, ox + cw / 2, oy - os * 0.06, cw);
      ctx.textAlign = 'center'; ctx.fillStyle = p.barInk;
    }
    if (under) {
      fitText(ctx, under, '600', DISPLAY, 27, 18, W - 110);
      for (pass = 0; pass < (onBand ? 2 : 1); pass++) caps(ctx, under, W / 2, BH - (onBand ? 30 : 30), 3);
    }
    ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;

    // ---- what this is
    var label = night ? longDate(st.night.date) : st.table ? st.monthRows.length + (st.monthRows.length === 1 ? ' player' : ' players') : st.nights + (st.nights === 1 ? ' night played' : ' nights played');
    var head = night ? (st.night.status === 'ended' ? 'Final standings' : onNow(st.night) ? 'Standings so far' : 'Standings') : monthName(st.month) + ' leaderboard';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = GOLD; ctx.font = '600 38px ' + DISPLAY; caps(ctx, label.toUpperCase(), W / 2, 448, 5);
    ctx.fillStyle = p.text; fitText(ctx, head.toUpperCase(), '700', DISPLAY, 92, 60, W - 120); ctx.fillText(head.toUpperCase(), W / 2, 536);

    // ---- the top three
    var y = 572, medal = [GOLD, '#d5dde8', '#d08a55'];
    rows.slice(0, 3).forEach(function (r, i) {
      var hh = i === 0 ? 150 : 124, mine = r.name === st.me;
      box(ctx, 48, y, W - 96, hh, 22); ctx.fillStyle = mine ? GOLD : p.panel; ctx.fill();
      if (i === 0 && !mine) { ctx.lineWidth = 5; ctx.strokeStyle = GOLD; ctx.stroke(); }
      var cy = y + hh / 2, rad = i === 0 ? 50 : 42;
      ctx.beginPath(); ctx.arc(48 + 34 + rad, cy, rad, 0, Math.PI * 2); ctx.fillStyle = mine ? '#0e2238' : medal[r.rank - 1] || medal[i]; ctx.fill();
      ctx.fillStyle = mine ? GOLD : '#0e2238'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = '700 ' + (i === 0 ? 64 : 54) + 'px ' + DISPLAY; ctx.fillText(String(r.rank), 48 + 34 + rad, cy + 3);
      ctx.fillStyle = mine ? '#0e2238' : p.text; ctx.textAlign = 'right'; ctx.font = '700 ' + (i === 0 ? 88 : 72) + 'px ' + DISPLAY;
      var pts = String(r.points), pw = ctx.measureText(pts).width; ctx.fillText(pts, W - 48 - 34, cy + 4);
      ctx.textAlign = 'left'; var nx = 48 + 34 + rad * 2 + 30, nw = W - 48 - 34 - pw - 30 - nx;
      fitText(ctx, r.name, '600', DISPLAY, i === 0 ? 74 : 62, 34, nw); ctx.fillText(clip(ctx, r.name, nw), nx, cy + 3);
      y += hh + 16;
    });
    ctx.textBaseline = 'alphabetic';

    // ---- everyone else: one column, or two when the list is long (a very long list ends with "+ N more",
    // and whoever marked their own name is always in the picture)
    var rest = rows.slice(3), topY = y + 14, botY = H - 124, FULL = 32;
    if (rest.length > FULL) {
      var hidden = rest.slice(FULL - 1), mineAt = hidden.map(function (r) { return r.name; }).indexOf(st.me);
      rest = rest.slice(0, FULL - 1);
      if (mineAt >= 0) rest[rest.length - 1] = hidden[mineAt];
      rest.push({ more: hidden.length });
    }
    var cols = rest.length > 13 ? 2 : 1, per = Math.ceil(rest.length / cols), rh = Math.min(64, (botY - topY) / Math.max(per, 1)), colW = (W - 96 - (cols - 1) * 28) / cols;
    var fs = Math.round(Math.min(46, rh * 0.68));
    ctx.textBaseline = 'middle';
    rest.forEach(function (r, i) {
      var k = i % per, x = 48 + Math.floor(i / per) * (colW + 28), yy = topY + k * rh, mid = yy + rh / 2, mine = !r.more && r.name === st.me;
      if (r.more) { ctx.textAlign = 'center'; ctx.fillStyle = p.dim; ctx.font = '500 ' + Math.round(fs * 0.9) + 'px ' + DISPLAY; ctx.fillText('+ ' + r.more + ' more', x + colW / 2, mid + 2); return; }
      if (mine || k % 2 === 0) { box(ctx, x, yy + 2, colW, rh - 4, 10); ctx.fillStyle = mine ? GOLD : p.row; ctx.fill(); }
      ctx.fillStyle = mine ? '#0e2238' : p.dim; ctx.textAlign = 'right'; ctx.font = '600 ' + Math.round(fs * 0.8) + 'px ' + DISPLAY; ctx.fillText(String(r.rank), x + fs * 1.5, mid + 2);
      ctx.fillStyle = mine ? '#0e2238' : p.text; ctx.font = '700 ' + fs + 'px ' + DISPLAY; var pw = ctx.measureText(String(r.points)).width; ctx.fillText(String(r.points), x + colW - 16, mid + 2);
      ctx.textAlign = 'left'; var nx = x + fs * 1.5 + 18, nw = x + colW - 16 - pw - 16 - nx;
      fitText(ctx, r.name, '500', DISPLAY, fs, Math.round(fs * 0.62), nw); ctx.fillText(clip(ctx, r.name, nw), nx, mid + 2);
    });
    ctx.textBaseline = 'alphabetic';
    if (!rows.length) { ctx.textAlign = 'center'; ctx.fillStyle = p.dim; ctx.font = '500 46px ' + DISPLAY; ctx.fillText('No results yet', W / 2, 760); }

    // ---- foot
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = p.line; ctx.fillRect(W / 2 - 60, H - 112, 120, 5);
    ctx.fillStyle = p.text; fitText(ctx, clubLine().toUpperCase(), '700', DISPLAY, 58, 40, W - 220); caps(ctx, clubLine().toUpperCase(), W / 2, H - 38, 7);      // the club's name, large: this picture travels
    cv.setAttribute('aria-label', (st.series.name || 'Social') + ': ' + head + '. ' + rows.slice(0, 3).map(function (r) { return r.rank + '. ' + r.name + ', ' + r.points + ' points'; }).join('; '));
    cv.setAttribute('data-view', st.view); cv.setAttribute('data-rows', String(rows.length)); cv.setAttribute('data-top', rows.slice(0, 3).map(function (r) { return r.name + ':' + r.points; }).join('|'));
  }
  // a line of small capitals with space between the letters (where the browser's canvas cannot space letters: thin spaces)
  // A king's crown in the club's yellow, w wide, around (cx, cy).
  function crown(ctx, cx, cy, w) {
    var hh = w * 0.7, x0 = cx - w / 2, y0 = cy - hh / 2, pt = function (fx, fy) { return [x0 + fx * w, y0 + fy * hh]; };
    var path = [[0.04, 0.98], [0, 0.22], [0.27, 0.56], [0.5, 0.06], [0.73, 0.56], [1, 0.22], [0.96, 0.98]].map(function (q) { return pt(q[0], q[1]); });
    ctx.save();
    ctx.beginPath(); path.forEach(function (q, i) { if (i) ctx.lineTo(q[0], q[1]); else ctx.moveTo(q[0], q[1]); }); ctx.closePath();
    ctx.fillStyle = GOLD; ctx.fill();
    ctx.shadowColor = 'transparent'; ctx.lineJoin = 'round'; ctx.lineWidth = Math.max(2, w * 0.05); ctx.strokeStyle = '#0e2238'; ctx.stroke();
    [[0, 0.22], [0.5, 0.06], [1, 0.22]].forEach(function (q) { var c = pt(q[0], q[1]); ctx.beginPath(); ctx.arc(c[0], c[1], w * 0.075, 0, 7); ctx.fillStyle = GOLD; ctx.fill(); ctx.stroke(); });
    ctx.fillStyle = '#0e2238'; ctx.fillRect(x0 + w * 0.1, y0 + hh * 0.74, w * 0.8, Math.max(2, hh * 0.07));
    ctx.restore();
  }
  function caps(ctx, text, x, y, px) {
    if ('letterSpacing' in ctx) { ctx.letterSpacing = px + 'px'; ctx.fillText(text, x + px / 2, y); ctx.letterSpacing = '0px'; }
    else ctx.fillText(text.split('').join('\u200a'), x, y);
  }

  // ---------------------------------------------------------------- the page
  var card = null;
  function fileName() { return String(st.series.name || 'leaderboard').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '-' + (st.view === 'night' ? st.night.date : st.month) + '.png'; }
  function shareText() {
    var rows = st.view === 'night' ? st.nightRows : st.monthRows, top = rows.slice(0, 3).map(function (r) { return r.rank + '. ' + r.name + ' (' + r.points + ')'; }).join(', ');
    return (st.series.name || 'Padel social') + (st.view === 'night' ? ', ' + longDate(st.night.date) : ', ' + monthName(st.month) + ' leaderboard') + (top ? ': ' + top : '') + '. ' + clubLine();
  }
  function note(msg) { var n = document.getElementById('bdnote'); if (n) { n.textContent = msg; n.hidden = !msg; clearTimeout(note.t); note.t = setTimeout(function () { n.hidden = true; }, 5000); } }
  function share() {
    if (!card || st.busy) return;
    st.busy = true;
    card.toBlob(function (blob) {
      st.busy = false;
      var url = S.short(id), file = blob && typeof File === 'function' ? new File([blob], fileName(), { type: 'image/png' }) : null;
      var done = function () {}, fail = function (err) { if (err && err.name !== 'AbortError') save(blob); };
      if (file && navigator.canShare && navigator.canShare({ files: [file] })) navigator.share({ files: [file], title: st.series.name || 'Leaderboard' }).then(done, fail);
      else if (navigator.share) navigator.share({ title: st.series.name || 'Leaderboard', text: shareText(), url: url }).then(done, fail);
      else save(blob);
    }, 'image/png');
  }
  function save(blob) {
    if (!blob) return note('The picture could not be made on this phone. Take a screenshot instead.');
    var a = h('a', { href: URL.createObjectURL(blob), download: fileName() });
    document.body.appendChild(a); a.click(); a.remove();
    note('Picture saved. Share it from your photos.');
  }
  function copyLink() {
    var url = S.short(id);
    var ok = function () { note('Link copied.'); }, no = function () { note(url); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(ok, no); else no();
  }
  function pickMe(name) {
    st.me = st.me === name ? '' : name;
    try { if (st.me) localStorage.setItem('socials.board.me', st.me); else localStorage.removeItem('socials.board.me'); } catch (e) { /* private mode */ }
    render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function render() {
    if (!st.series) {
      app.replaceChildren(h('div', { class: 'bd-msg' }, [h('h1', null, 'Leaderboard'), h('p', null, id ? 'This social was not found. Check the link.' : 'This link needs to say which social it is for.')]));
      return;
    }
    document.title = (st.series.name || 'Leaderboard') + ' · leaderboard';
    var night = st.view === 'night', rows = night ? st.nightRows : st.monthRows;
    card = h('canvas', { class: 'bd-card', id: 'card', role: 'img' });
    draw(card);
    var tab = function (v, text) { return h('button', { type: 'button', class: 'bd-tab' + (st.view === v ? ' on' : ''), 'data-view': v, 'aria-pressed': st.view === v ? 'true' : 'false', onclick: function () { st.view = v; render(); } }, text); };
    app.replaceChildren(
      h('div', { class: 'bd-top' }, [st.night ? tab('night', onNow(st.night) ? E.dayWord(st.night) : shortDate(st.night.date)) : null, tab('month', monthName(st.month) || 'Month')]),
      h('div', { class: 'bd-stage' }, card),
      h('div', { class: 'bd-acts' }, [h('button', { type: 'button', class: 'bd-share', id: 'share', onclick: share }, 'Share'), h('button', { type: 'button', class: 'bd-link', id: 'copy', onclick: copyLink }, 'Copy link')]),
      h('p', { class: 'bd-note', id: 'bdnote', hidden: true, role: 'status' }, ''),
      h('div', { class: 'bd-list' }, [
        h('h2', null, [night ? 'Everyone who played' : monthName(st.month) + ': everyone', h('small', null, 'Tap your name to mark it in the picture')]),
        h('ol', null, rows.map(function (r) {
          return h('li', null, h('button', { type: 'button', class: r.name === st.me ? 'me' : '', 'data-name': r.name, 'aria-pressed': r.name === st.me ? 'true' : 'false', onclick: function () { pickMe(r.name); } },
            [h('span', { class: 'rk' }, String(r.rank)), h('span', { class: 'nm' }, r.name), h('span', { class: 'dt' }, night ? r.wins + ' won of ' + r.played : st.table ? '' : r.nights + (r.nights === 1 ? ' night' : ' nights')), h('b', null, String(r.points))]));
        }))
      ])
    );
  }
  function refresh() {
    return load().then(function () { return st.series ? loadLook() : null; }).then(render);
  }
  if (!S.configured || !id) { st.series = null; render(); }
  else {
    app.replaceChildren(h('div', { class: 'bd-msg' }, h('p', null, 'Loading the leaderboard…')));
    refresh().catch(function () { app.replaceChildren(h('div', { class: 'bd-msg' }, [h('h1', null, 'Leaderboard'), h('p', null, 'No connection. Check the phone’s internet and reload.')])); });
    // a night still being played: the table follows it
    setInterval(function () { if (onNow(st.night) && !document.hidden) refresh().catch(function () {}); }, 30000);
  }
})();
