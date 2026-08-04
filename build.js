#!/usr/bin/env node
/**
 * Build step: psrd-app.html  ->  the APP_HTML literal at the bottom of psrd-worker.js
 *
 * psrd-worker.js stays a single paste-and-deploy Cloudflare Worker; psrd-app.html is the
 * editable source for everything the browser sees. Edit the HTML, run `node build.js`,
 * then paste psrd-worker.js into the Cloudflare editor.
 */
const fs = require('fs');
const path = require('path');

const APP = path.join(__dirname, 'psrd-app.html');
const WORKER = path.join(__dirname, 'psrd-worker.js');
const MARKER = 'const APP_HTML = ';

// Emit a pure-ASCII JS string literal so the worker file never depends on an
// encoding assumption when it is pasted into the Cloudflare dashboard.
function toLiteral(str) {
  return JSON.stringify(str).replace(/[-￿]/g, (c) =>
    '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0')
  );
}

function literalOf(worker) {
  const i = worker.indexOf(MARKER);
  if (i < 0) throw new Error('APP_HTML marker not found in psrd-worker.js');
  return { head: worker.slice(0, i), literal: worker.slice(i + MARKER.length).replace(/;\s*$/, '') };
}

try {
  const html = fs.readFileSync(APP, 'utf8');
  const { head } = literalOf(fs.readFileSync(WORKER, 'utf8'));

  fs.writeFileSync(WORKER, head + MARKER + toLiteral(html) + ';\n');

  // Round-trip check: the literal we just wrote must decode back to psrd-app.html exactly.
  const { literal } = literalOf(fs.readFileSync(WORKER, 'utf8'));
  if (eval(literal) !== html) throw new Error('round-trip mismatch — literal does not decode to psrd-app.html');

  console.log(
    'built psrd-worker.js <- psrd-app.html  (' +
    html.length.toLocaleString() + ' chars, ' + html.split('\n').length + ' lines, round-trip verified)'
  );
} catch (e) {
  console.error('build failed:', e.message);
  process.exit(1);
}
