#!/usr/bin/env node
// Builds cabinet-optimizer.html: the whole app (markup, styles, scripts) in
// one file that opens with a double-click.
// Only this script needs esbuild; the app itself has no dependencies.

import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'cabinet-optimizer.html');

const bundle = await build({
  entryPoints: [path.join(root, 'src/ui/app.js')],
  bundle: true, format: 'iife', minify: true, target: 'es2020', write: false, legalComments: 'none',
});
const js = bundle.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

const swap = (from, to) => {
  if (!html.includes(from)) throw new Error(`index.html no longer contains: ${from}`);
  html = html.replace(from, () => to);
};
swap('<link rel="stylesheet" href="styles.css">', `<style>\n${css}</style>`);
swap('<script type="module" src="src/ui/app.js"></script>', `<script>\n${js}</script>`);

fs.writeFileSync(out, html);
console.log(`Wrote ${path.relative(process.cwd(), out)} (${(html.length / 1024).toFixed(0)} kB)`);
