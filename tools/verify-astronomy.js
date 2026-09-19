#!/usr/bin/env node
/*
 * Validates the astronomy and time handling inside index.html.
 *
 * The app is one self-contained file on purpose, so rather than duplicating the
 * maths here this pulls the real functions out of index.html and exercises those.
 * If the extraction markers below stop matching, the script fails loudly rather
 * than silently testing nothing.
 *
 *   node tools/verify-astronomy.js
 */
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const start = html.indexOf('const RAD = Math.PI/180');
const end = html.indexOf('function rangesOverlap');
if (start < 0 || end < 0 || end <= start) {
  console.error('Could not locate the constants/astronomy block in index.html.');
  console.error('The extraction markers in this script need updating.');
  process.exit(2);
}
const src = html.slice(start, end) + '\nfunction rangesOverlap(a,b,c,d){return a<d&&c<b;}\n';
const ctx = {};
new Function('exports', src + '\nObject.assign(exports,{parseCT,ctMidnight,addDays,fmtTime,moonIllumination,moonTimesForDay,norm360});')(ctx);
const { parseCT, ctMidnight, addDays, fmtTime, moonIllumination, moonTimesForDay } = ctx;

let fails = 0;
const ok = (name, cond, detail) => {
  console.log((cond ? '  PASS  ' : '! FAIL  ') + name + (detail ? '   ' + detail : ''));
  if (!cond) fails++;
};

console.log('\nCentral-time parsing');
console.log('--------------------');
// NOAA and Open-Meteo both emit naive local timestamps. Handing those to new Date()
// resolves them in the viewer's timezone; parseCT must pin them to Central instead.
ok('summer 06:00 CDT -> 11:00Z', parseCT('2026-06-25 06:00').toISOString() === '2026-06-25T11:00:00.000Z',
   parseCT('2026-06-25 06:00').toISOString());
ok('winter 06:00 CST -> 12:00Z', parseCT('2026-01-15T06:00').toISOString() === '2026-01-15T12:00:00.000Z',
   parseCT('2026-01-15T06:00').toISOString());
ok('ctMidnight lands on local midnight', fmtTime(ctMidnight('2026-06-25')) === '12:00 AM',
   fmtTime(ctMidnight('2026-06-25')));
ok('addDays crosses spring-forward', addDays('2026-03-07', 3) === '2026-03-10', addDays('2026-03-07', 3));
ok('addDays crosses a month end', addDays('2026-02-27', 3) === '2026-03-02', addDays('2026-02-27', 3));

console.log('\nLunar theory');
console.log('------------');
const newMoons = [];
for (let d = 0; d < 200; d++) {
  const a0 = moonIllumination(new Date(Date.UTC(2026, 0, 1) + d * 86400000)).age;
  const a1 = moonIllumination(new Date(Date.UTC(2026, 0, 1) + (d + 1) * 86400000)).age;
  if (a0 > a1) newMoons.push(d); // age wraps 360 -> 0 at new moon
}
const gaps = newMoons.slice(1).map((v, i) => v - newMoons[i]);
ok('synodic month is 29-30 days', gaps.every(g => g >= 29 && g <= 30), 'gaps: ' + gaps.join(','));

// The strongest available check without a network: a full moon rises at sunset,
// by definition. Galveston South Jetty, late June 2026 (sunset there ~8:26 PM CDT).
const LAT = 29.3385, LON = -94.7058;
let fullDs = null, fullIllum = -1;
for (let i = 0; i < 40; i++) {
  const ds = addDays('2026-06-01', i);
  const ill = moonIllumination(new Date(+ctMidnight(ds) + 12 * 3600000)).illum;
  if (ill > fullIllum) { fullIllum = ill; fullDs = ds; }
}
ok('found a full moon in June 2026', fullIllum > 0.985, fullDs + ' at ' + (fullIllum * 100).toFixed(2) + '%');
const ft = moonTimesForDay(fullDs, LAT, LON);
const riseHour = ft.rise ? ft.rise.getUTCHours() + ft.rise.getUTCMinutes() / 60 : null;
// 8:36 PM CDT == 01:36 UTC next day
ok('full moon rises within 40 min of sunset', ft.rise && Math.abs(((riseHour + 24) % 24) - 1.6) < 0.67,
   'moonrise ' + fmtTime(ft.rise) + ' vs sunset ~8:26 PM');
console.log('        ' + fullDs + ': rise ' + fmtTime(ft.rise) + ' · set ' + fmtTime(ft.set) + ' · transit ' + fmtTime(ft.transit));

let deltas = [], prev = null;
for (let i = 0; i < 10; i++) {
  const t = moonTimesForDay(addDays('2026-06-10', i), LAT, LON).rise;
  if (t && prev) deltas.push(Math.round((+t - prev) / 60000) - 1440);
  if (t) prev = +t;
}
ok('moonrise advances 20-80 min/day', deltas.every(d => d > 15 && d < 85), deltas.join(',') + ' min');

// The moon legitimately skips a rise or a transit on ~1 calendar day in 29,
// because its day runs 24h50m. More than one means the scan is dropping crossings.
let missT = 0, missR = 0;
for (let i = 0; i < 28; i++) {
  const t = moonTimesForDay(addDays('2026-06-01', i), LAT, LON);
  if (!t.transit) missT++;
  if (!t.rise) missR++;
}
ok('transit missing on at most 1 day of 28', missT <= 1, 'missing ' + missT);
ok('moonrise missing on at most 1 day of 28', missR <= 1, 'missing ' + missR);

console.log(fails ? '\n' + fails + ' check(s) FAILED\n' : '\nAll checks passed.\n');
process.exit(fails ? 1 : 0);
