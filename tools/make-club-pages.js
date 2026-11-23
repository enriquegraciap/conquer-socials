'use strict';
/*
 * Makes each other club's pages (docs/<club>/...) from the first club's: the same pages one folder deeper, with a
 * line that says which club they belong to. Run it after changing any index.html or the version number:
 *   node tools/make-club-pages.js
 */
const fs = require('fs');
const path = require('path');
const DOCS = path.join(__dirname, '..', 'docs');
const CLUBS = { tempe: 'Tempe' };                       // folder: name (the same ids as "clubs" in docs/config.js)
const PAGES = ['index.html', 'tv/index.html', 'p/index.html', 'flyers/index.html', 'board/index.html'];

for (const [id, name] of Object.entries(CLUBS)) {
  for (const page of PAGES) {
    let html = fs.readFileSync(path.join(DOCS, page), 'utf8');
    // every file of the site is one folder further up
    html = html.replace(/\b(href|src)="(?!https?:|data:|#|\/)([^"]+)"/g, (m, attr, url) => `${attr}="../${url}"`);
    html = html.replace('href="../manifest.webmanifest"', 'href="manifest.webmanifest"');           // the club's own (see below)
    html = html.replace(/<title>([^<]*)<\/title>/, (m, t) => `<title>${t} · ${name}</title>`);
    html = html.replace(/(<script src="[^"]*config\.js)/, `<script>window.SOCIALS_CLUB = '${id}';</script>\n$1`);
    if (!html.includes('SOCIALS_CLUB')) throw new Error('no config.js in ' + page);
    const out = path.join(DOCS, id, page);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, html);
  }
  // "Add to Home Screen" on a staff iPad has to open this club's pages, not the first club's
  const man = JSON.parse(fs.readFileSync(path.join(DOCS, 'manifest.webmanifest'), 'utf8'));
  man.name = 'Padel Socials ' + name; man.short_name = 'Socials ' + name;
  man.icons = man.icons.map(i => Object.assign({}, i, { src: '../' + i.src }));
  fs.writeFileSync(path.join(DOCS, id, 'manifest.webmanifest'), JSON.stringify(man, null, 2) + '\n');
  // the club's own wrap.js: a page on the club's site that loads it shows this club's pages
  fs.copyFileSync(path.join(DOCS, 'wrap.js'), path.join(DOCS, id, 'wrap.js'));
  console.log('made docs/' + id + '/ (' + PAGES.length + ' pages)');
}
