// Fits and tests a wind "setup" model per NOAA water-level station: how much the wind
// raises or lowers the water compared with the tide table.
//
//   node tools/fit-wind-setup.js
//
// For each station with observed water levels: a year of hourly observed level
// (hourly_height), tide-table level (predictions) and wind (Open-Meteo archive at the
// station). The residual (observed - predicted) is regressed on wind stress, the
// speed-squared wind vector averaged over the previous 6, 24 and 72 hours. A slow
// offset (seasonal sea level, anything not wind) is taken from the last 24 hours of
// observed residual at forecast time, which the app can fetch live.
//
// Tested on November-February, never used for fitting, from forecast start times every
// 24 h: the model gets the actual wind (so this is an upper bound; forecast wind is
// worse) and is scored on whether the water's direction each hour (rising = in,
// falling = out) matches what really happened, 1-72 h ahead, against the tide table
// alone and against tide table + a constant last-known offset.
'use strict';
const fs = require('fs');
const path = require('path');

const STATIONS = process.argv.slice(2).length ? process.argv.slice(2)
  : ['8779770','8779748','8779749','8779280','8774770','8773701','8775241','8772471','8771972','8770971','8770822'];
const START = '20250901', END = '20260831';
// Held-out test months: November-February, when cold fronts drive the big wind events.
const TEST_FROM = '2025-11-01', TEST_TO = '2026-03-01';
const inTest = k => k >= TEST_FROM && k < TEST_TO;
const CACHE = path.join(__dirname, '.wind-setup-cache.json');
const MOVE_FTH = 0.03;                  // below this the water counts as not moving
const FEATS = [6, 24, 72];

const cache = fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE, 'utf8')) : {};
const save = () => fs.writeFileSync(CACHE, JSON.stringify(cache));
async function getJSON(url){
  if(cache[url]) return cache[url];
  for(let i = 0; i < 4; i++){
    try{
      const r = await fetch(url); const j = await r.json();
      if(j.error && !j.data && !j.predictions) throw new Error(JSON.stringify(j.error));
      cache[url] = j; save(); return j;
    }catch(e){ if(i === 3) throw e; await new Promise(r => setTimeout(r, 4000 * (i + 1))); }
  }
}
const NOAA = 'https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?application=ALINE_CoastalLog&units=english&time_zone=lst_ldt&format=json&datum=MLLW';
const key = t => t.slice(0, 13);        // "YYYY-MM-DD HH"

async function load(id){
  const meta = await getJSON(`https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations/${id}.json`);
  const st = meta.stations[0];
  const obs = await getJSON(`${NOAA}&product=hourly_height&station=${id}&begin_date=${START}&end_date=${END}`);
  const pred = await getJSON(`${NOAA}&product=predictions&interval=h&station=${id}&begin_date=${START}&end_date=${END}`);
  const s = `${START.slice(0,4)}-${START.slice(4,6)}-${START.slice(6)}`, e = `${END.slice(0,4)}-${END.slice(4,6)}-${END.slice(6)}`;
  const wx = await getJSON(`https://archive-api.open-meteo.com/v1/archive?latitude=${st.lat}&longitude=${st.lng}&start_date=${s}&end_date=${e}&hourly=wind_speed_10m,wind_direction_10m&timezone=America%2FChicago`);
  const O = new Map((obs.data || []).filter(d => d.v !== '').map(d => [key(d.t), +d.v]));
  const P = new Map((pred.predictions || []).map(d => [key(d.t), +d.v]));
  const W = new Map();
  wx.hourly.time.forEach((t, i) => {
    const sp = wx.hourly.wind_speed_10m[i], dir = wx.hourly.wind_direction_10m[i];
    if(sp == null || dir == null) return;
    const mph = sp * 0.621371, rad = dir * Math.PI / 180;
    W.set(key(t.replace('T', ' ')), [mph * mph * Math.sin(rad) / 100, mph * mph * Math.cos(rad) / 100]);
  });
  // Hourly series in time order over the prediction timeline.
  const hours = [...P.keys()].sort();
  const rows = hours.map(k => ({k, p:P.get(k), o:O.get(k), w:W.get(k)}));
  return {id, name: st.name, lat: st.lat, lon: st.lng, rows};
}

// Trailing means of wind stress for each hour; null where the window is incomplete.
function features(rows){
  return rows.map((_, i) => {
    const f = [];
    for(const n of FEATS){
      if(i < n) return null;
      let x = 0, y = 0;
      for(let j = i - n + 1; j <= i; j++){ const w = rows[j].w; if(!w) return null; x += w[0]; y += w[1]; }
      f.push(x / n, y / n);
    }
    return f;
  });
}
// Ordinary least squares via normal equations (small system).
function ols(X, y){
  const k = X[0].length, A = Array.from({length:k}, () => new Array(k).fill(0)), b = new Array(k).fill(0);
  X.forEach((x, n) => { for(let i = 0; i < k; i++){ b[i] += x[i] * y[n]; for(let j = 0; j < k; j++) A[i][j] += x[i] * x[j]; } });
  for(let i = 0; i < k; i++){                // Gauss-Jordan
    let p = i; for(let r = i + 1; r < k; r++) if(Math.abs(A[r][i]) > Math.abs(A[p][i])) p = r;
    [A[i], A[p]] = [A[p], A[i]]; [b[i], b[p]] = [b[p], b[i]];
    for(let r = 0; r < k; r++){ if(r === i) continue; const f = A[r][i] / A[i][i]; for(let c = i; c < k; c++) A[r][c] -= f * A[i][c]; b[r] -= f * b[i]; }
  }
  return b.map((v, i) => v / A[i][i]);
}

function evaluate(st){
  const F = features(st.rows);
  const res = st.rows.map(r => r.o != null ? r.o - r.p : null);
  const train = [], ytrain = [];
  st.rows.forEach((r, i) => { if(!inTest(r.k) && F[i] && res[i] != null){ train.push([1, ...F[i]]); ytrain.push(res[i]); } });
  if(train.length < 2000) return {skip: `only ${train.length} training hours`};
  const beta = ols(train, ytrain);
  const windPart = i => F[i] ? F[i].reduce((s, v, j) => s + v * beta[j + 1], 0) : null;
  // Forecasts from each midnight in the test period.
  const tally = {tide:[0,0], persist:[0,0], model:[0,0]}, rmse = {tide:0, persist:0, model:0}; let rn = 0;
  // The same tally for wind-event hours only: the residual changing faster than 0.05 ft/h.
  const ev = {tide:[0,0], persist:[0,0], model:[0,0]};
  const starts = st.rows.map((r, i) => i).filter(i => inTest(st.rows[i].k) && st.rows[i].k.endsWith(' 00'));
  for(const t0 of starts){
    const past = [];
    for(let j = t0 - 24; j < t0; j++) if(j >= 0 && res[j] != null && windPart(j) != null) past.push({r:res[j], w:windPart(j)});
    if(past.length < 12) continue;
    const lastRes = past[past.length - 1].r;
    const offset = past.reduce((s, p) => s + (p.r - p.w), 0) / past.length;
    for(let h = 1; h <= 72; h++){
      const i = t0 + h;
      if(i >= st.rows.length || st.rows[i].o == null || st.rows[i - 1].o == null || windPart(i) == null || windPart(i - 1) == null) continue;
      const obsRate = st.rows[i].o - st.rows[i - 1].o;
      if(Math.abs(obsRate) < MOVE_FTH) continue;     // judge direction only when the water really moved
      const lvl = {
        tide:    j => st.rows[j].p,
        persist: j => st.rows[j].p + lastRes,
        model:   j => st.rows[j].p + offset + windPart(j)
      };
      for(const m of Object.keys(lvl)){
        const rate = lvl[m](i) - lvl[m](i - 1);
        const hit = Math.sign(rate) === Math.sign(obsRate) ? 1 : 0;
        tally[m][0] += hit; tally[m][1]++;
        if(res[i] != null && res[i - 1] != null && Math.abs(res[i] - res[i - 1]) > 0.05){ ev[m][0] += hit; ev[m][1]++; }
        rmse[m] += (lvl[m](i) - st.rows[i].o) ** 2;
      }
      rn++;
    }
  }
  const pct = m => (100 * tally[m][0] / tally[m][1]).toFixed(1);
  const epct = m => ev[m][1] ? (100 * ev[m][0] / ev[m][1]).toFixed(1) : 'n/a';
  const rm = m => Math.sqrt(rmse[m] / rn).toFixed(2);
  return {beta, trainHours: train.length, testHours: rn,
    direction: {tide: pct('tide'), persist: pct('persist'), model: pct('model')},
    eventDirection: {tide: epct('tide'), model: epct('model'), hours: ev.tide[1]},
    rmseFt: {tide: rm('tide'), persist: rm('persist'), model: rm('model')}};
}

(async () => {
  const out = {};
  for(const id of STATIONS){
    try{
      const st = await load(id);
      const ev = evaluate(st);
      out[id] = {name: st.name, ...ev};
      if(ev.skip){ console.log(id, st.name, '-', ev.skip); continue; }
      console.log(`${id} ${st.name.slice(0,34).padEnd(34)} direction right: tide ${ev.direction.tide}%  last-offset ${ev.direction.persist}%  wind model ${ev.direction.model}%   |  level error ft: ${ev.rmseFt.tide} / ${ev.rmseFt.persist} / ${ev.rmseFt.model}   (${ev.testHours} test hours)
${' '.repeat(43)}wind-event hours only (${ev.eventDirection.hours}): tide ${ev.eventDirection.tide}%  wind model ${ev.eventDirection.model}%`);
    }catch(e){ console.log(id, 'failed:', e.message.slice(0, 120)); }
  }
  fs.writeFileSync(path.join(__dirname, '.wind-setup-results.json'), JSON.stringify(out, null, 1));
})();
