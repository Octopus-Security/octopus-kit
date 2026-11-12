#!/usr/bin/env node
/**
 * octopus-check-layout — static check of an app's CSS and page templates against docs/layout.md
 * "Layout & text rules", plus the layout bugs that overlap text at 320-420px. No browser, no dependencies.
 *
 *   node bin/octopus-check-layout.mjs <dir...> [--json] [--strict] [--ignore RULE,RULE]
 *
 * Reads *.css, <style> blocks in *.html / *.ejs / *.jsx / *.tsx, and the page heads of those templates.
 * Skips node_modules, .git, dist, build, .next, coverage, test, public/vendor.
 * Exit 0 clean (or warnings only), 1 on any error (any finding with --strict), 2 usage.
 * The runtime half (does anything actually overflow or overlap) is octopus-check-overflow.
 *
 * Severity: ERROR is a rule from layout.md that is unambiguous. WARN is a pattern that CAN break at 320px and
 * needs a human look; a deliberate use is silenced with a CSS comment containing `layout-ok: RULE` on that line or the line above.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const SKIP = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'coverage', 'test', 'tests', '__tests__', 'vendor', '.output']);
const CSS_EXT = new Set(['.css']);
const TPL_EXT = new Set(['.html', '.ejs', '.jsx', '.tsx', '.vue', '.svelte', '.astro']);

export const RULES = {
  'viewport-cover': ['error', 'viewport meta must be exactly width=device-width, initial-scale=1, viewport-fit=cover'],
  'viewport-zoom': ['error', 'viewport meta blocks zoom (maximum-scale / user-scalable=no) or fixes a width'],
  'break-all': ['error', 'word-break: break-all splits words mid-letter; use overflow-wrap: anywhere on the one element that needs it'],
  'vh-no-dvh': ['warn', '100vh without 100dvh in the same file: the phone URL bar covers the bottom'],
  'neg-margin': ['warn', 'negative margin can pull a block over its neighbour at 320px'],
  'fixed-width': ['warn', 'fixed width/min-width above 300px; use min(Npx, 100%), minmax(0, 1fr) or flex-wrap'],
  'grid-fixed-tracks': ['warn', 'grid-template-columns with fixed tracks summing above 320px and no media query'],
  'grid-auto-track': ['warn', 'a grid with an `auto` track next to a flexible one: the auto track takes its max-content width and can squeeze the other column to 0 (name/detail rows). Place every child in an explicit column, add min-width: 0, or stack on phones'],
  'nowrap': ['warn', 'white-space: nowrap on a text block can force the row wider than the screen; allow it only on short labels'],
  'input-font': ['warn', 'input/select/textarea font-size under 16px makes iOS Safari zoom on focus'],
  'tw-fixed': ['warn', 'Tailwind arbitrary width above 300px (w-[Npx] / min-w-[Npx])'],
  'p-body-clip': ['warn', 'no `overflow-x: clip` on body anywhere (kit rule 2)'],
  'p-html-bg': ['warn', 'no background on html (rule 1: overscroll paints html)'],
  'p-wrap': ['warn', 'no `overflow-wrap: break-word` / anywhere on body text (rule 4)'],
  'p-code-wrap': ['warn', 'no `overflow-wrap: anywhere` on code/kbd (rule 5)'],
  'p-media-max': ['warn', 'no `max-width: 100%` on img/video/svg (rule 7/13)'],
  'p-dvh': ['warn', 'no `100dvh` anywhere (rule 3)'],
};

function walk(dir, out = []) {
  let ents; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of ents) {
    if (e.name.startsWith('.') && e.name !== '.') { if (e.isDirectory()) continue; }
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP.has(e.name)) walk(p, out); }
    else if (e.isFile() && !/\.min\.(css|js)$/.test(e.name)) out.push(p);
  }
  return out;
}

const lineOf = (text, idx) => text.slice(0, idx).split('\n').length;

/** Blank out comments but keep newlines and length, so offsets still map to lines. */
const blank = (s) => s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));

function cssBlocks(text) {
  // Returns [{sel, body, start, inMedia}] for every declaration block (flattened one level of @media).
  const out = []; const t = blank(text);
  const re = /([^{}]+)\{([^{}]*)\}/g; let m;
  while ((m = re.exec(t))) {
    const sel = m[1].trim(); if (!sel || sel.startsWith('@')) continue;
    const before = t.slice(0, m.index);
    const opens = (before.match(/@media[^{]*\{/g) || []).length;
    // crude: inside a media block when more @media-opens than the closes that follow them; good enough for a lint
    let depth = 0; for (const ch of before) { if (ch === '{') depth++; else if (ch === '}') depth--; }
    out.push({ sel, body: m[2], start: m.index + m[1].length - m[1].trimStart().length, inMedia: depth > 0 && opens > 0 });
  }
  return out;
}

export function checkCss(text, file, { findings, summary }) {
  const raw = text;
  const add = (rule, idx, extra = '') => {
    const ln = lineOf(raw, idx);
    const lines = raw.split('\n');
    const near = (lines[ln - 1] || '') + (lines[ln - 2] || '');
    if (new RegExp(`layout-ok:[^*]*\\b${rule}\\b`).test(near)) return;
    findings.push({ file, line: ln, rule, severity: RULES[rule][0], message: RULES[rule][1] + (extra ? ` [${extra}]` : '') });
  };
  const t = blank(raw);
  for (const m of t.matchAll(/word-break\s*:\s*break-all/g)) add('break-all', m.index);
  if (/100vh/.test(t) && !/dvh/.test(t)) add('vh-no-dvh', t.indexOf('100vh'));
  for (const b of cssBlocks(raw)) {
    const off = (s) => b.start + b.body.indexOf(s);
    for (const m of b.body.matchAll(/margin(?:-(?:left|right|top|inline|inline-start|inline-end))?\s*:\s*([^;]+)/g)) {
      if (/(^|\s)-(\d+(?:\.\d+)?)(px|rem|em)/.test(m[1])) {
        const n = parseFloat(m[1].match(/-(\d+(?:\.\d+)?)(px|rem|em)/)[1]); const u = m[1].match(/-(\d+(?:\.\d+)?)(px|rem|em)/)[2];
        if ((u === 'px' ? n : n * 16) >= 8) add('neg-margin', off(m[0]), `${b.sel.split('\n')[0].slice(0, 50)}: ${m[0].trim()}`);
      }
    }
    for (const m of b.body.matchAll(/(?<![\w-])(width|min-width|flex-basis)\s*:\s*(\d+(?:\.\d+)?)px/g)) {
      if (+m[2] > 300 && !/(^|;)\s*max-width\s*:\s*100%/.test(b.body)) {
        if (/@page|\bprint\b/.test(b.sel)) continue;
        add('fixed-width', off(m[0]), `${b.sel.split('\n')[0].slice(0, 50)}: ${m[0].trim()}`);
      }
    }
    const g = b.body.match(/grid-template-columns\s*:\s*([^;]+)/);
    if (g) {
      const v = g[1].trim();
      const tracks = v.replace(/minmax\([^)]*\)|repeat\([^)]*\)/g, (s) => (/auto-(fit|fill)/.test(s) ? 'F' : s));
      if (!b.inMedia && !/minmax|fr|%|auto|F/.test(tracks)) {
        const sum = [...v.matchAll(/(\d+(?:\.\d+)?)px/g)].reduce((a, x) => a + +x[1], 0);
        if (sum > 320) add('grid-fixed-tracks', off(g[0]), `${b.sel.split('\n')[0].slice(0, 50)}: ${v}`);
      }
      if (/(^|\s)auto(\s|$)/.test(v.replace(/minmax\([^)]*\)/g, 'M')) && /fr|minmax/.test(v) && !/repeat\(/.test(v))
        add('grid-auto-track', off(g[0]), `${b.sel.split('\n')[0].slice(0, 50)}: ${v}`);
    }
    if (/white-space\s*:\s*nowrap/.test(b.body) && /(^|[\s,>])(p|li|td|dd|span|a|label|h[1-6]|\.[\w-]*(name|title|desc|text|meta|detail|label|msg)[\w-]*)\s*($|[,:.\s{>])/i.test(b.sel) && !/text-overflow\s*:\s*ellipsis/.test(b.body))
      add('nowrap', off('white-space'), b.sel.split('\n')[0].slice(0, 60));
    if (/(^|[\s,>])(input|select|textarea)\b/.test(b.sel) && !/type=["']?(checkbox|radio|range|color|file)/.test(b.sel)) {
      const f = b.body.match(/(?<![\w-])font-size\s*:\s*(\d+(?:\.\d+)?)(px|rem|em)/);
      if (f && (f[2] === 'px' ? +f[1] : +f[1] * 16) < 16) add('input-font', off(f[0]), `${b.sel.split('\n')[0].slice(0, 50)}: ${f[0]}`);
    }
    // project-level signals
    const s = b.sel.replace(/\s+/g, ' ');
    if (/(^|,\s*)body(\s*,|$)/.test(s) && /overflow-x\s*:\s*clip/.test(b.body)) summary.bodyClip = true;
    if (/(^|,\s*)html(\s*,|$)/.test(s) && /background(-color)?\s*:/.test(b.body)) summary.htmlBg = true;
    if (/(^|,\s*)(html|body|:root)(\s*,|$)/.test(s) && /overflow-wrap\s*:\s*(break-word|anywhere)/.test(b.body)) summary.wrap = true;
    if (/\b(code|kbd)\b/.test(s) && /overflow-wrap\s*:\s*anywhere/.test(b.body)) summary.codeWrap = true;
    if (/\b(img|video|svg)\b/.test(s) && /max-width\s*:\s*100%/.test(b.body)) summary.mediaMax = true;
  }
  if (/100dvh/.test(t)) summary.dvh = true;
}

export function checkTemplate(text, file, { findings }) {
  const add = (rule, idx, extra = '') => findings.push({ file, line: lineOf(text, idx), rule, severity: RULES[rule][0], message: RULES[rule][1] + (extra ? ` [${extra}]` : '') });
  for (const m of text.matchAll(/<meta\b[^>]*name\s*=\s*["']viewport["'][^>]*>/gi)) {
    const tag = m[0];
    const c = (tag.match(/content\s*=\s*["']([^"']*)["']/i) || [])[1] || '';
    const norm = c.split(',').map((x) => x.trim().replace(/\s*=\s*/, '=').replace(/^initial-scale=1\.0+$/, 'initial-scale=1')).filter(Boolean).sort().join(',');
    if (/maximum-scale|user-scalable\s*=\s*(no|0)/i.test(c) || /width\s*=\s*\d+/.test(c)) add('viewport-zoom', m.index, c);
    else if (norm !== 'initial-scale=1,viewport-fit=cover,width=device-width') add('viewport-cover', m.index, c);
  }
  for (const m of text.matchAll(/(?<![\w-])(?:min-)?w-\[(\d+)px\]/g)) if (+m[1] > 300) add('tw-fixed', m.index, m[0]);
  for (const sm of text.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) {
    const pad = text.slice(0, sm.index + sm[0].indexOf(sm[1])).replace(/[^\n]/g, '');
    const sub = pad + sm[1];
    checkCss(sub, file, { findings, summary: {} });
  }
}

export function checkDir(dir) {
  const findings = []; const summary = {}; const stats = { css: 0, templates: 0, viewportPages: 0 };
  for (const f of walk(dir)) {
    const ext = path.extname(f); const rel = path.relative(dir, f);
    if (CSS_EXT.has(ext)) { let t; try { t = fs.readFileSync(f, 'utf8'); } catch { continue; } stats.css++; checkCss(t, rel, { findings, summary }); }
    else if (TPL_EXT.has(ext)) {
      let t; try { t = fs.readFileSync(f, 'utf8'); } catch { continue; }
      stats.templates++; if (/name\s*=\s*["']viewport["']/i.test(t)) stats.viewportPages++;
      checkTemplate(t, rel, { findings });
      for (const sm of t.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) checkCss(sm[1], rel, { findings: [], summary }); // signals only
    }
  }
  // Project-level: only meaningful when the app has CSS at all, and not satisfied by linking the kit's base.css.
  const kit = (() => { try { return /octopus-kit|\/kit\/ui\/base\.css|\/v0\/base\.css/.test(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')) || walk(dir).some((f) => TPL_EXT.has(path.extname(f)) && /\/(kit|v0)\/(ui\/)?base\.css/.test(fs.readFileSync(f, 'utf8'))); } catch { return false; } })();
  summary.kit = kit;
  if (stats.css + stats.templates > 0 && !kit) {
    const P = (rule, ok) => { if (!ok) findings.push({ file: '(project)', line: 0, rule, severity: RULES[rule][0], message: RULES[rule][1] }); };
    P('p-body-clip', summary.bodyClip); P('p-html-bg', summary.htmlBg); P('p-wrap', summary.wrap);
    P('p-code-wrap', summary.codeWrap); P('p-media-max', summary.mediaMax); P('p-dvh', summary.dvh);
  }
  return { dir, stats, summary, findings };
}

export async function main(argv = process.argv.slice(2)) {
  const dirs = []; let json = false; let strict = false; let ignore = new Set();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') json = true; else if (a === '--strict') strict = true;
    else if (a === '--ignore') ignore = new Set(String(argv[++i]).split(','));
    else if (a === '-h' || a === '--help') { dirs.length = 0; break; } else dirs.push(a);
  }
  if (!dirs.length) { console.error('usage: octopus-check-layout <dir...> [--json] [--strict] [--ignore RULE,RULE]'); return 2; }
  const results = dirs.map((d) => { const r = checkDir(path.resolve(d)); r.findings = r.findings.filter((f) => !ignore.has(f.rule)); return r; });
  let bad = false;
  if (json) console.log(JSON.stringify(results, null, 2));
  for (const r of results) {
    const errs = r.findings.filter((f) => f.severity === 'error'); const warns = r.findings.filter((f) => f.severity !== 'error');
    if (errs.length || (strict && warns.length)) bad = true;
    if (json) continue;
    console.log(`${errs.length || (strict && warns.length) ? 'FAIL' : 'OK  '} ${r.dir}  (${r.stats.css} css, ${r.stats.templates} templates; ${errs.length} errors, ${warns.length} warnings)`);
    for (const f of r.findings.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'error' ? -1 : 1))) console.log(`  ${f.severity.toUpperCase().padEnd(5)} ${f.file}${f.line ? ':' + f.line : ''}  ${f.rule}: ${f.message}`);
  }
  return bad ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  main().then((c) => { process.exitCode = c; });
}
