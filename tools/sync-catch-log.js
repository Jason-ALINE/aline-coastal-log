// Copies Coastal Log's spot list (id, name, area) into catch-log.html, so the catch
// log offers exactly the app's spots. Run after adding, renaming or moving a spot,
// then republish the catch log.
//
//   node tools/sync-catch-log.js
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const a = html.indexOf('const SPOTS = ['), b = html.indexOf('/* FETCH:BEGIN');
const SPOTS = new Function(html.slice(a, b) + ';return SPOTS;')();
const list = SPOTS.map(s => ({id: s.id, name: s.name, group: s.area || s.region}));

const logPath = path.join(root, 'catch-log.html');
const log = fs.readFileSync(logPath, 'utf8');
const block = '/* SPOTS:BEGIN — copied from Coastal Log (index.html) by tools/sync-catch-log.js; do not edit by hand */\n'
  + 'const SPOTS = ' + JSON.stringify(list) + ';\n/* SPOTS:END */';
const out = log.replace(/\/\* SPOTS:BEGIN[\s\S]*?\/\* SPOTS:END \*\//, () => block);
if(out === log && !log.includes('SPOTS:BEGIN')) throw new Error('SPOTS markers not found in catch-log.html');
fs.writeFileSync(logPath, out);
console.log(`catch-log.html now lists ${list.length} spots.`);
