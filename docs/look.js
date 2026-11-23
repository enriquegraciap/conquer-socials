/*
 * Padel Socials — each social's "look", taken from its flyer.
 *
 * When a flyer is uploaded for a social, its main colours are read from the picture. From those colours and a
 * chosen motif (hearts, confetti, stripes...) a repeating pattern is drawn for the TV's top banner. The pattern
 * is always kept dark enough for the white logo and white letters to stay readable.
 *
 * Stored with the social (pub/series/{id}/look):
 *   rev       changes whenever a picture changes, so TVs and phones know to fetch it again
 *   cands     up to six colours found in the flyer, most important first
 *   variant   which of them is used as the banner's main colour ("Try other colours" steps through them)
 *   pattern   the motif
 *   wide, tall  whether a landscape / portrait flyer has been uploaded; thumbW, thumbT small previews
 * The pictures themselves live under pub/eventflyers/{id}: "wide" (TV, between rounds) and "phone" (shown for a
 * few seconds when a player scans the QR code; made from the portrait flyer if there is one, else from the wide one).
 */
(function (root) {
  'use strict';

  var PATTERNS = [
    { id: 'hearts', name: 'Hearts' },
    { id: 'confetti', name: 'Confetti' },
    { id: 'stripes', name: 'Stripes' },
    { id: 'waves', name: 'Waves' },
    { id: 'diamonds', name: 'Diamonds' },
    { id: 'balls', name: 'Padel balls' },
    { id: 'plain', name: 'Plain' }
  ];
  var DEFAULT_CANDS = ['#0a2f41', '#f4b63f', '#12508f'];     // the club's own colours, used until a flyer is uploaded

  // ---------------------------------------------------------------- colour helpers
  function hex(r, g, b) {
    var p = function (v) { v = Math.max(0, Math.min(255, Math.round(v))); return (v < 16 ? '0' : '') + v.toString(16); };
    return '#' + p(r) + p(g) + p(b);
  }
  function rgb(h) {
    var m = /^#?([0-9a-f]{6})$/i.exec(String(h || ''));
    if (!m) return [10, 47, 65];
    var n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function toHsl(c) {
    var r = c[0] / 255, g = c[1] / 255, b = c[2] / 255, mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn, hh = 0, s = 0;
    if (d) {
      s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
      hh = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
      hh *= 60;
    }
    return [hh, s, l];
  }
  function fromHsl(hh, s, l) {
    var f = function (n) { var k = (n + hh / 30) % 12, a = s * Math.min(l, 1 - l); return 255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))); };
    return [f(0), f(8), f(4)];
  }
  function lum(c) {
    var f = function (v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
  }
  function hueGap(a, b) { var d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; }

  // ---------------------------------------------------------------- reading a flyer
  function readImage(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('That file could not be opened as a picture.')); };
      img.src = url;
    });
  }
  function fromDataUrl(data) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { reject(new Error('The stored picture could not be opened.')); };
      img.src = data;
    });
  }
  // A JPEG no larger than maxW x maxH (never enlarged). See-through areas become white.
  function shrink(img, maxW, maxH, quality) {
    var w = img.naturalWidth, hgt = img.naturalHeight, k = Math.min(1, maxW / w, maxH / hgt);
    var c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(hgt * k));
    var g = c.getContext('2d');
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, c.width, c.height);
    g.imageSmoothingQuality = 'high';
    g.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', quality);
  }
  // Same, but never heavier than about a megabyte.
  function fitted(img, maxW, maxH) {
    var q = [0.86, 0.72, 0.58], out = '';
    for (var i = 0; i < q.length; i++) { out = shrink(img, maxW, maxH, q[i]); if (out.length <= 1400000) break; }
    return out;
  }
  // The flyer's main colours, most important first: what covers the most area, with vivid colours counted extra.
  function palette(img) {
    var N = 72, c = document.createElement('canvas');
    c.width = N; c.height = N;
    var g = c.getContext('2d');
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, N, N);
    g.drawImage(img, 0, 0, N, N);
    var d = g.getImageData(0, 0, N, N).data, buckets = {};
    for (var i = 0; i < d.length; i += 4) {
      var key = (d[i] >> 5) + '.' + (d[i + 1] >> 5) + '.' + (d[i + 2] >> 5);
      var b = buckets[key] || (buckets[key] = { n: 0, r: 0, g: 0, b: 0 });
      b.n++; b.r += d[i]; b.g += d[i + 1]; b.b += d[i + 2];
    }
    var list = Object.keys(buckets).map(function (k) {
      var b = buckets[k], col = [b.r / b.n, b.g / b.n, b.b / b.n], hsl = toHsl(col);
      var vivid = hsl[1] * (1 - Math.abs(hsl[2] - 0.5) * 1.4);           // washed-out and near-black colours count less
      return { col: col, hsl: hsl, score: Math.sqrt(b.n) * (0.25 + Math.max(0, vivid) * 1.6) };
    }).sort(function (a, b) { return b.score - a.score; });
    var picked = [];
    list.forEach(function (x) {
      if (picked.length >= 6) return;
      var near = picked.some(function (p) {
        var grey = x.hsl[1] < 0.12 && p.hsl[1] < 0.12;
        return (grey || hueGap(x.hsl[0], p.hsl[0]) < 24) && Math.abs(x.hsl[2] - p.hsl[2]) < 0.2 && Math.abs(x.hsl[1] - p.hsl[1]) < 0.35;
      });
      if (!near) picked.push(x);
    });
    return picked.map(function (p) { return hex(p.col[0], p.col[1], p.col[2]); });
  }

  // ---------------------------------------------------------------- the banner
  // The flyer's colours as a plain list (the database may hand a list back as numbered entries).
  function candidates(look) {
    var c = look && look.cands;
    if (!c) return [];
    if (!Array.isArray(c)) c = Object.keys(c).sort(function (a, b) { return a - b; }).map(function (k) { return c[k]; });
    return c.filter(function (x) { return typeof x === 'string'; }).slice(0, 6);
  }
  // Three colours for the banner: a dark main colour (so white stays readable) and two accents for the motif.
  function colours(look) {
    var cands = candidates(look);
    if (!cands.length) cands = DEFAULT_CANDS;
    var v = ((look && Number(look.variant)) || 0) % cands.length;
    var main = toHsl(rgb(cands[v]));
    var greyMain = main[1] < 0.12;
    var base = fromHsl(main[0], greyMain ? main[1] : Math.min(0.78, Math.max(0.35, main[1])), Math.max(0.1, Math.min(0.2, main[2] * 0.55)));
    var rest = cands.filter(function (c, i) { return i !== v; }).map(function (c) { return toHsl(rgb(c)); })
      .sort(function (a, b) { return (b[1] * (1 - Math.abs(b[2] - 0.55))) - (a[1] * (1 - Math.abs(a[2] - 0.55))); });
    var accent = function (hsl, light) {
      if (!hsl) return fromHsl(main[0], greyMain ? 0 : 0.55, light);          // one-colour flyer: a lighter shade of the same colour
      return fromHsl(hsl[0], hsl[1] < 0.12 ? hsl[1] : Math.max(0.5, hsl[1]), Math.max(0.5, Math.min(0.68, hsl[2])));
    };
    var a1 = accent(rest[0], 0.55);
    var a2 = rest.length > 1 ? accent(rest[1], 0.75) : fromHsl(main[0], greyMain ? 0 : 0.35, 0.8);
    return { base: hex(base[0], base[1], base[2]), a1: hex(a1[0], a1[1], a1[2]), a2: hex(a2[0], a2[1], a2[2]) };
  }
  function tile(w, hgt, body) {
    return 'url("data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + hgt + '" viewBox="0 0 ' + w + ' ' + hgt + '">' + body + '</svg>') + '")';
  }
  var HEART = 'M0 -5.2C-2.6 -10.4 -11 -8.4 -11 -1.6C-11 3.6 -4.6 7.6 0 12C4.6 7.6 11 3.6 11 -1.6C11 -8.4 2.6 -10.4 0 -5.2Z';
  // The banner's background as CSS: { color, image, size }. Sizes are in vmin (the screen's shorter side) so the motif scales with the TV.
  function banner(look) {
    var c = colours(look), id = (look && look.pattern) || 'stripes', img, size;
    var o1 = 0.5, o2 = 0.38;
    if (id === 'hearts') {
      img = tile(80, 60,
        '<g fill="' + c.a1 + '" fill-opacity="' + o1 + '"><path transform="translate(20 17) rotate(-14) scale(1.15)" d="' + HEART + '"/><path transform="translate(60 47) rotate(12) scale(.8)" d="' + HEART + '"/></g>' +
        '<g fill="' + c.a2 + '" fill-opacity="' + o2 + '"><path transform="translate(60 14) rotate(16) scale(.62)" d="' + HEART + '"/><path transform="translate(22 46) rotate(-8) scale(.95)" d="' + HEART + '"/></g>');
      size = '13.3vmin 10vmin';
    } else if (id === 'confetti') {
      img = tile(120, 60,
        '<g fill="' + c.a1 + '" fill-opacity="' + o1 + '"><rect x="8" y="9" width="12" height="5" rx="1" transform="rotate(28 14 11)"/><circle cx="52" cy="15" r="4"/><rect x="92" y="33" width="13" height="5" rx="1" transform="rotate(-36 98 35)"/><path d="M30 42l7 3-6 5z"/><circle cx="74" cy="50" r="3"/></g>' +
        '<g fill="' + c.a2 + '" fill-opacity="' + o2 + '"><circle cx="30" cy="20" r="3"/><rect x="66" y="26" width="12" height="5" rx="1" transform="rotate(62 72 28)"/><path d="M100 10l8 2-5 7z"/><rect x="46" y="40" width="12" height="5" rx="1" transform="rotate(-18 52 42)"/><circle cx="110" cy="52" r="3.5"/><path d="M8 34l6 6-8 2z"/></g>');
      size = '20vmin 10vmin';
    } else if (id === 'waves') {
      img = tile(80, 40,
        '<path d="M0 10q10 -9 20 0t20 0t20 0t20 0" fill="none" stroke="' + c.a1 + '" stroke-opacity="' + o1 + '" stroke-width="4" stroke-linecap="round"/>' +
        '<path d="M-10 30q10 -9 20 0t20 0t20 0t20 0t20 0" fill="none" stroke="' + c.a2 + '" stroke-opacity="' + o2 + '" stroke-width="4" stroke-linecap="round"/>');
      size = '10vmin 5vmin';
    } else if (id === 'diamonds') {
      img = tile(48, 48,
        '<path d="M24 3L45 24L24 45L3 24Z" fill="' + c.a1 + '" fill-opacity="' + (o1 * 0.7) + '"/><path d="M24 14L34 24L24 34L14 24Z" fill="' + c.a2 + '" fill-opacity="' + o2 + '"/>' +
        '<path d="M0 0L48 48M48 0L0 48" stroke="' + c.a2 + '" stroke-opacity=".22" stroke-width="1.5"/>');
      size = '5vmin 5vmin';
    } else if (id === 'balls') {
      var ball = function (x, y, r, col, op) {
        return '<g transform="translate(' + x + ' ' + y + ')"><circle r="' + r + '" fill="' + col + '" fill-opacity="' + op + '"/>' +
          '<path d="M' + (-r * 0.86) + ' ' + (-r * 0.5) + 'q' + (r * 0.86) + ' ' + (r * 0.9) + ' ' + (r * 1.72) + ' 0" fill="none" stroke="' + c.base + '" stroke-opacity=".7" stroke-width="1.6"/>' +
          '<path d="M' + (-r * 0.86) + ' ' + (r * 0.5) + 'q' + (r * 0.86) + ' ' + (-r * 0.9) + ' ' + (r * 1.72) + ' 0" fill="none" stroke="' + c.base + '" stroke-opacity=".7" stroke-width="1.6"/></g>';
      };
      img = tile(90, 60, ball(20, 18, 11, c.a1, o1) + ball(66, 44, 9, c.a2, o2) + ball(70, 10, 5, c.a2, o2 * 0.8) + ball(22, 50, 5, c.a1, o1 * 0.8));
      size = '15vmin 10vmin';
    } else if (id === 'plain') {
      img = 'linear-gradient(100deg, ' + c.base + ' 0%, ' + c.base + ' 40%, ' + c.a1 + ' 140%)';
      size = '100% 100%';
    } else {
      img = 'repeating-linear-gradient(118deg, transparent 0 2.2vmin, ' + rgba(c.a1, o1 * 0.8) + ' 2.2vmin 3.4vmin, transparent 3.4vmin 5.4vmin, ' + rgba(c.a2, o2 * 0.8) + ' 5.4vmin 6vmin)';
      size = 'auto';
    }
    return { color: c.base, image: img, size: size, line: c.a1, colours: c };
  }
  function rgba(h, a) { var c = rgb(h); return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')'; }
  // The whole TV screen in tones of the flyer's main colour (look.theme === 'flyer'): from a very dark shade for
  // the background to a very pale one for the courts still to be played. Null when the social does not ask for it.
  function theme(look) {
    if (!look || look.theme !== 'flyer' || !candidates(look).length) return null;
    var m = toHsl(rgb(colours(look).base)), hue = m[0], s = m[1] < 0.12 ? m[1] : Math.max(0.5, Math.min(0.82, m[1]));
    var t = function (sat, l) { var c = fromHsl(hue, s * sat, l); return hex(c[0], c[1], c[2]); };
    var ink = t(0.85, 0.17), pale = t(0.9, 0.93);
    return { bg: t(0.85, 0.12), blob1: t(0.9, 0.2), blob2: t(0.8, 0.16), panel: t(0.85, 0.26), deep: t(0.9, 0.21), main: t(1, 0.53), mid: t(0.95, 0.74), pale: pale,
      soft: t(0.85, 0.85), ink: ink, dim: t(0.55, 0.62),
      wheel: [[t(1, 0.53), '#ffffff'], [pale, ink], [t(0.95, 0.38), '#ffffff'], [t(0.95, 0.77), ink], [t(0.85, 0.23), '#ffffff'], [t(1, 0.64), '#ffffff']] };
  }
  // A logo for the banner, from a picture the organizer chose: made small, kept as PNG so a see-through background
  // stays see-through. Also read from it: the colour of its background (bg; null when see-through) so the banner
  // can take the same one and the logo sits in it without a box around it, and its main dark colour (ink) for the
  // lettering beside it.
  function logo(img) {
    var w = img.naturalWidth, hgt = img.naturalHeight, k = Math.min(1, 900 / w, 260 / hgt);
    var c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(hgt * k));
    var g = c.getContext('2d');
    g.imageSmoothingQuality = 'high';
    g.drawImage(img, 0, 0, c.width, c.height);
    var d = g.getImageData(0, 0, c.width, c.height).data, W = c.width, H = c.height;
    var px = function (x, y) { var i = (Math.max(0, Math.min(H - 1, Math.round(y))) * W + Math.max(0, Math.min(W - 1, Math.round(x)))) * 4; return [d[i], d[i + 1], d[i + 2], d[i + 3]]; };
    // the background: what the middle of each edge shows (corners may be rounded off)
    var edge = [px(W / 2, 2), px(W / 2, H - 3), px(2, H / 2), px(W - 3, H / 2), px(W * 0.25, 2), px(W * 0.75, H - 3)];
    var solid = edge.filter(function (p) { return p[3] > 200; }), bg = null;
    if (solid.length >= 4) {
      var mid = function (i) { return solid.map(function (p) { return p[i]; }).sort(function (a, b) { return a - b; })[Math.floor(solid.length / 2)]; };
      bg = hex(mid(0), mid(1), mid(2));
    }
    // the lettering colour: the dark, strong colour there is most of
    var buckets = {}, step = Math.max(1, Math.floor(Math.sqrt(W * H / 6000)));
    for (var y = 0; y < H; y += step) for (var x = 0; x < W; x += step) {
      var p = px(x, y);
      if (p[3] < 200) continue;
      var hs = toHsl(p);
      if (hs[2] > 0.42 || hs[2] < 0.06 || hs[1] < 0.35) continue;
      var key = Math.round(hs[0] / 12) + ':' + Math.round(hs[2] * 8), b = buckets[key] || (buckets[key] = { n: 0, r: 0, g: 0, b: 0 });
      b.n++; b.r += p[0]; b.g += p[1]; b.b += p[2];
    }
    var top = Object.keys(buckets).map(function (k2) { return buckets[k2]; }).sort(function (a, b2) { return b2.n - a.n; })[0];
    return { data: c.toDataURL('image/png'), bg: bg, ink: top && top.n > 20 ? hex(top.r / top.n, top.g / top.n, top.b / top.n) : null };
  }
  // The same part of the flyer for a taller header (the shareable leaderboard picture): as wide as the strip, and as
  // much higher as the header needs, around the same middle (moved up or down where the flyer ends).
  function bandTall(img, band, outW, outH, quality) {
    var w = Math.min(band.w, img.naturalWidth), hh = Math.min(img.naturalHeight, Math.round(w * outH / outW));
    if (hh === img.naturalHeight) w = Math.min(img.naturalWidth, Math.round(hh * outW / outH));
    var x = Math.max(0, Math.min(img.naturalWidth - w, Math.round(band.x + band.w / 2 - w / 2))), y = Math.max(0, Math.min(img.naturalHeight - hh, Math.round(band.y + band.h / 2 - hh / 2)));
    var c = document.createElement('canvas'); c.width = outW; c.height = outH;
    var g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, outW, outH);
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
    g.drawImage(img, x, y, w, hh, 0, 0, outW, outH);
    return c.toDataURL('image/jpeg', quality || 0.86);
  }
  // ---------------------------------------------------------------- a strip of the flyer itself as the banner
  // The banner is a very wide, low strip (about 12 to 1). bands() looks over the flyer for strips worth blowing up:
  // colourful, with big shapes rather than small print, and different from one another. Each is { x, y, w, h } in
  // the picture's own pixels, plus ink: 'dark' when lettering on it has to be dark to be read.
  var BAND_RATIO = 12;
  function bands(img, count) {
    var W = 200, H = Math.max(BAND_RATIO, Math.round(W * img.naturalHeight / img.naturalWidth));
    var c = document.createElement('canvas'); c.width = W; c.height = H;
    var g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, W, H); g.drawImage(img, 0, 0, W, H);
    var d = g.getImageData(0, 0, W, H).data, n = W * H, lumA = new Float32Array(n), chr = new Float32Array(n), i, x, y;
    for (i = 0; i < n; i++) {
      var r = d[i * 4] / 255, gg = d[i * 4 + 1] / 255, b = d[i * 4 + 2] / 255, mx = Math.max(r, gg, b), mn = Math.min(r, gg, b);
      lumA[i] = 0.2126 * r + 0.7152 * gg + 0.0722 * b; chr[i] = mx - mn;
    }
    // running totals, so any rectangle's average is four look-ups
    var sum = function (src, fn) {
      var t = new Float64Array((W + 1) * (H + 1));
      for (y = 0; y < H; y++) for (x = 0; x < W; x++) t[(y + 1) * (W + 1) + x + 1] = fn(src, y * W + x, x, y) + t[y * (W + 1) + x + 1] + t[(y + 1) * (W + 1) + x] - t[y * (W + 1) + x];
      return function (x0, y0, x1, y1) { return t[y1 * (W + 1) + x1] - t[y0 * (W + 1) + x1] - t[y1 * (W + 1) + x0] + t[y0 * (W + 1) + x0]; };
    };
    var sL = sum(lumA, function (s, k) { return s[k]; }), sL2 = sum(lumA, function (s, k) { return s[k] * s[k]; }), sC = sum(chr, function (s, k) { return s[k]; });
    var sE = sum(lumA, function (s, k, px, py) { return (px + 1 < W ? Math.abs(s[k] - s[k + 1]) : 0) + (py + 1 < H ? Math.abs(s[k] - s[k + W]) : 0); });
    var sInk = sum(lumA, function (s, k) { return (s[k] < 0.45 || chr[k] > 0.3) ? 1 : 0; });       // not the paper: paint, ink, colour
    var out = [];
    [1, 0.72, 0.5].forEach(function (scale) {
      var w = Math.round(W * scale), hh = Math.max(3, Math.round(w / BAND_RATIO));
      for (var y0 = 0; y0 + hh <= H; y0 += Math.max(1, Math.round(hh / 3))) for (var x0 = 0; x0 + w <= W; x0 += Math.max(1, Math.round(w / 5))) {
        var a = w * hh, mL = sL(x0, y0, x0 + w, y0 + hh) / a, sd = Math.sqrt(Math.max(0, sL2(x0, y0, x0 + w, y0 + hh) / a - mL * mL));
        var colour = sC(x0, y0, x0 + w, y0 + hh) / a, edge = sE(x0, y0, x0 + w, y0 + hh) / a, cover = sInk(x0, y0, x0 + w, y0 + hh) / a;
        // paint that fills the strip counts most; fine print (many edges for little paint) counts against
        var score = cover * 1.2 + colour * 1.4 + sd * 0.5 - edge * (scale < 1 ? 1.6 : 2.4) + (scale < 1 ? 0.05 : 0);
        out.push({ x: x0, y: y0, w: w, h: hh, score: score, lum: mL, colour: colour, cover: cover });
      }
    });
    out.sort(function (p, q) { return q.score - p.score; });
    var over = function (p, q) {
      var ix = Math.max(0, Math.min(p.x + p.w, q.x + q.w) - Math.max(p.x, q.x)), iy = Math.max(0, Math.min(p.y + p.h, q.y + q.h) - Math.max(p.y, q.y));
      return ix * iy / Math.min(p.w * p.h, q.w * q.h);
    };
    var picked = [], k = img.naturalWidth / W, ky = img.naturalHeight / H;
    out.forEach(function (p) {
      if (picked.length >= (count || 6)) return;
      // different parts of the flyer: no two from the same height on the page, unless they look clearly different
      if (picked.some(function (q) {
        var dy = Math.abs((p.y + p.h / 2) - (q.y + q.h / 2)), alike = Math.abs(p.lum - q.lum) < 0.12 && Math.abs(p.colour - q.colour) < 0.12;
        return over(p, q) > 0.2 || dy < H * 0.07 || (alike && dy < H * 0.16);
      })) return;
      picked.push(p);
    });
    return picked.map(function (p) {
      return { x: Math.round(p.x * k), y: Math.round(p.y * ky), w: Math.round(p.w * k), h: Math.round(p.h * ky), ink: p.lum > 0.58 ? 'dark' : 'light' };
    });
  }
  // One of those strips as a picture: a JPEG outW wide (the TV's banner is drawn from a 1920-wide one).
  function bandImage(img, band, outW, quality) {
    var w = outW || 1920, hh = Math.round(w / BAND_RATIO), c = document.createElement('canvas');
    c.width = w; c.height = hh;
    var g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, w, hh);
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
    g.drawImage(img, band.x, band.y, band.w, band.h, 0, 0, w, hh);
    return c.toDataURL('image/jpeg', quality || 0.86);
  }

  // Paint an element as the banner (or back to the stylesheet's own look when there is nothing to show).
  // look.bar: a plain banner in that colour, for a social that brings its own logos (data-own; lettering in look.barInk).
  // look.band + picture (the strip chosen in Flyer and look, a data: URL): that strip of the flyer itself fills the banner
  // (data-band says whether the lettering on it is light or dark). Without the picture yet, the pattern shows meanwhile.
  function paint(el, look, picture) {
    if (!el) return;
    el.removeAttribute('data-own'); el.removeAttribute('data-band'); el.style.removeProperty('--bar-ink'); el.style.backgroundPosition = ''; el.style.backgroundRepeat = '';
    if (!look) { el.style.backgroundColor = ''; el.style.backgroundImage = ''; el.style.backgroundSize = ''; el.style.borderBottomColor = ''; el.removeAttribute('data-pattern'); return; }
    if (look.bar) {
      var ink = look.barInk || (lum(rgb(look.bar)) > 0.45 ? '#0e2238' : '#ffffff');
      el.style.backgroundColor = look.bar; el.style.backgroundImage = 'none'; el.style.backgroundSize = ''; el.style.borderBottomColor = ink;
      el.removeAttribute('data-pattern'); el.setAttribute('data-own', '1'); el.style.setProperty('--bar-ink', ink);
      return;
    }
    var b = banner(look);
    if (look.band && typeof picture === 'string' && /^data:image\//.test(picture)) {
      el.style.backgroundColor = b.color; el.style.backgroundImage = 'url("' + picture + '")'; el.style.backgroundSize = 'cover';
      el.style.backgroundPosition = 'center'; el.style.backgroundRepeat = 'no-repeat'; el.style.borderBottomColor = b.line;
      el.removeAttribute('data-pattern'); el.setAttribute('data-band', look.bandInk === 'dark' ? 'dark' : 'light');
      return;
    }
    el.style.backgroundColor = b.color;
    el.style.backgroundImage = b.image;
    el.style.backgroundSize = b.size;
    el.style.borderBottomColor = b.line;
    el.setAttribute('data-pattern', (look && look.pattern) || 'stripes');
  }

  root.Look = { PATTERNS: PATTERNS, readImage: readImage, fromDataUrl: fromDataUrl, shrink: shrink, fitted: fitted, palette: palette,
    colours: colours, candidates: candidates, banner: banner, bands: bands, bandImage: bandImage, bandTall: bandTall, paint: paint, theme: theme, logo: logo, luminance: function (h) { return lum(rgb(h)); } };
})(typeof self !== 'undefined' ? self : this);
