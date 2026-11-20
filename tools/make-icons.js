'use strict';
// Draws the home-screen icon (a court seen from above with a gold crown bar) and saves it at two sizes.
const { chromium } = require('playwright');
const path = require('path');
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="#0a2f57"/>
  <rect x="96" y="72" width="320" height="368" rx="10" fill="#12508f" stroke="#fff" stroke-width="14"/>
  <line x1="96" y1="256" x2="416" y2="256" stroke="#fff" stroke-width="14"/>
  <line x1="256" y1="150" x2="256" y2="362" stroke="#fff" stroke-width="10"/>
  <line x1="96" y1="150" x2="416" y2="150" stroke="#fff" stroke-width="10"/>
  <line x1="96" y1="362" x2="416" y2="362" stroke="#fff" stroke-width="10"/>
  <path d="M176 128 L176 88 L216 112 L256 76 L296 112 L336 88 L336 128 Z" fill="#f4b63f"/>
</svg>`;
(async () => {
  const b = await chromium.launch();
  for (const size of [180, 512]) {
    const p = await (await b.newContext({ viewport: { width: size, height: size }, deviceScaleFactor: 1 })).newPage();
    await p.setContent(`<body style="margin:0">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body>`);
    await p.screenshot({ path: path.join(__dirname, '..', 'docs', `icon-${size}.png`) });
  }
  await b.close();
})();
