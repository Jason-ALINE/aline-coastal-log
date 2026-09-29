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

console.log('\nWind exposure, bait flow and current');
console.log('------------------------------------');
const s0 = html.indexOf('// Open water upwind'), s1 = html.indexOf('function pressureScore10');
if (s0 < 0 || s1 <= s0) {
  console.error('Could not locate the scoring block in index.html; update the markers in this script.');
  process.exit(2);
}
const sc = {};
new Function('exports', 'norm360', 'mean', html.slice(s0, s1) +
  '\nObject.assign(exports,{upwindFetch,exposureLabel,windExposureScore25,levelSamples,flowFraction,baitFlowScore25,windowSpeed,baitSegments,scoringWindows,currentScore25,usualPeak});')(
  sc, ctx.norm360, a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const { upwindFetch, exposureLabel, windExposureScore25, levelSamples, flowFraction, baitFlowScore25, windowSpeed, baitSegments, scoringWindows, currentScore25, usualPeak } = sc;
const L = c => levelSamples(c), TH = 0.08;

// Fetch: open to the east (10 mi), bank to the west (0).
const F = [2, 5, 10, 10, 10, 10, 10, 5, 2, 0, 0, 0, 0, 0, 0, 1];
ok('east wind reads the open side', upwindFetch(F, 90) === 10, String(upwindFetch(F, 90)));
ok('west wind reads the bank', upwindFetch(F, 270) === 0, String(upwindFetch(F, 270)));
ok('compass wraps at north', Math.abs(upwindFetch(F, 359.9) - upwindFetch(F, 0)) < 0.01);
ok('no fetch data gives null', upwindFetch(undefined, 90) === null);
ok('labels: 0.2 protected, 1 partly, 5 exposed',
   exposureLabel(0.2) === 'protected' && exposureLabel(1) === 'partly exposed' && exposureLabel(5) === 'exposed');
ok('20 mph off the bank is fishable (25)', windExposureScore25(20, 0) === 25);
ok('20 mph across 10 mi of bay is poor (3)', windExposureScore25(20, 10) === 3);
ok('12 mph exposed costs points (17), protected does not (25)',
   windExposureScore25(12, 10) === 17 && windExposureScore25(12, 0.3) === 25);
ok('over 25 mph is poor anywhere', windExposureScore25(30, 0) === 4);
ok('dead calm gives up a little', windExposureScore25(2, 5) === 18);

const HR = 3600000, T0 = Date.UTC(2026, 8, 19, 10);
const curve = f => Array.from({ length: 8 }, (_, i) => ({ ms: T0 + i * HR, v: f(i) }));
const win = [[T0, T0 + 7 * HR]];
ok('rising water is fully incoming', flowFraction(L(curve(i => i * 0.3)), win, 'incoming', TH) === 1);
ok('rising water is never outgoing', flowFraction(L(curve(i => i * 0.3)), win, 'outgoing', TH) === 0);
ok('falling water is fully outgoing', flowFraction(L(curve(i => 3 - i * 0.3)), win, 'outgoing', TH) === 1);
ok('"either" counts falling water too', flowFraction(L(curve(i => 3 - i * 0.3)), win, 'either', TH) === 1);
ok('slack water earns nothing, even for "either"', flowFraction(L(curve(() => 1)), win, 'either', TH) === 0);
ok('too few segments gives null, scored neutral 12.5',
   flowFraction(L(curve(i => i * 0.3)), [[T0, T0 + 0.5 * HR]], 'incoming', TH) === null && baitFlowScore25(null) === 12.5);
ok('null windows are tolerated', flowFraction(L(curve(i => i * 0.3)), [null, null], 'incoming', TH) === null);

ok('window rate of a 0.3 ft/h ramp is 0.3', Math.abs(windowSpeed(L(curve(i => i * 0.3)), win) - 0.3) < 1e-9);
ok('window rate ignores direction', Math.abs(windowSpeed(L(curve(i => 3 - i * 0.3)), win) - 0.3) < 1e-9);
ok('station reference is the median daily peak',
   Math.abs(usualPeak([L(curve(i => i * 0.1)), L(curve(i => i * 0.2)), L(curve(i => i * 0.3))]) - 0.2) < 1e-9);
ok('tide at its usual peak and 0.3 ft/h earns full current', Math.abs(currentScore25(0.3, 0.3, 0, true).score - 25) < 1e-9);
ok('small tide running at its own peak still earns 70%+', currentScore25(0.1, 0.1, 0, false).score >= 0.7 * 25);
ok('slack tide, 15 mph at a bay spot: wind stands in at 60%', Math.abs(currentScore25(0, 0.2, 15, true).score - 15) < 1e-9);
ok('wind does not stand in at a surf-only spot', currentScore25(0, 0.2, 15, false).score === 0);

ok('currents: flood 1 kt with a 1 kt absolute mark earns full current', Math.abs(currentScore25(1, 1, 0, false, 1.0).score - 25) < 1e-9);
const kt = f => Array.from({ length: 8 }, (_, i) => ({ ms: T0 + i * HR, s: f(i) }));
ok('flood current counts as incoming', flowFraction(kt(() => 0.8), win, 'incoming', 0.1) === 1);
ok('ebb current counts as outgoing', flowFraction(kt(() => -0.8), win, 'outgoing', 0.1) === 1);
// Bait timeline: 12 half-hour samples, flood, one slack sample (a 30 min turn), then ebb.
const k12 = f => Array.from({ length: 12 }, (_, i) => ({ ms: T0 + i * HR / 2, s: f(i) }));
const segs = baitSegments(k12(i => i < 5 ? 0.8 : i < 6 ? 0.05 : -0.8), [[T0, T0 + 5.5 * HR]], 0.1);
ok('bait timeline: in, then out, slack turn absorbed', segs.length === 2 && segs[0].dir === 'in' && segs[1].dir === 'out',
   segs.map(x => x.dir).join(','));
ok('bait timeline: turn lands mid-slack (2.5 h in)', Math.abs(segs[0].end - (T0 + 2.5 * HR)) < 1, String((segs[0].end - T0) / HR));
ok('bait timeline: covers the window edge to edge', segs[0].start === T0 && segs[1].end === T0 + 5.5 * HR);
ok('bait timeline: records the peak', segs[0].peak === 0.8);
const longSlack = baitSegments(k12(i => i < 3 ? 0.8 : i < 9 ? 0 : -0.8), [[T0, T0 + 5.5 * HR]], 0.1);
ok('bait timeline: a long slack is listed', longSlack.map(x => x.dir).join(',') === 'in,slack,out', longSlack.map(x => x.dir).join(','));
ok('bait timeline: no window gives nothing', baitSegments(k12(() => 1), [null], 0.1).length === 0);

const DAY0 = Date.UTC(2026, 8, 30, 5);
const whole = scoringWindows('day', DAY0);
ok('whole day: midnight to midnight, one window', whole.length === 1 && whole[0][0] === DAY0 && whole[0][1] === DAY0 + 24 * HR);
ok('one hour: 7 AM is 7:00-8:00', scoringWindows(7, DAY0)[0][0] === DAY0 + 7 * HR && scoringWindows(7, DAY0)[0][1] === DAY0 + 8 * HR);
ok('out-of-range hour falls back to the whole day', scoringWindows(24, DAY0)[0][1] === DAY0 + 24 * HR);
// In at 1 kt for 12 h, out at 1 kt for 12 h: no hour favoured, so exactly half is "incoming".
const dayPts = Array.from({ length: 24 }, (_, i) => ({ ms: DAY0 + i * HR + HR / 2, s: i < 12 ? 1 : -1 }));
ok('every hour counts equally (12 h in, 12 h out = 50%)', flowFraction(dayPts, whole, 'incoming', 0.1) === 0.5);
const halfHourly = Array.from({ length: 48 }, (_, i) => ({ ms: DAY0 + i * HR / 2, s: i < 24 ? 1 : -1 }));
ok('scoring 3 PM sees only the afternoon ebb',
   flowFraction(halfHourly, scoringWindows(15, DAY0), 'outgoing', 0.1) === 1 &&
   flowFraction(halfHourly, scoringWindows(15, DAY0), 'incoming', 0.1) === 0);

console.log(fails ? '\n' + fails + ' check(s) FAILED\n' : '\nAll checks passed.\n');
process.exit(fails ? 1 : 0);
