// Measures open-water fetch (miles) in 16 compass directions from every spot, using
// OpenStreetMap shorelines, and writes the FETCH table into index.html.
//
//   node tools/compute-fetch.js            # fetch from Overpass, update index.html
//   node tools/compute-fetch.js --dry      # print the table, change nothing
//
// Water in OSM comes two ways, and the Texas coast uses both:
//  - natural=coastline ways: land on the left, sea on the right. Covers the Gulf, and
//    bays the coastline wraps into (Galveston Bay, Matagorda).
//  - natural=water areas (ways and multipolygons): the Laguna Madre, South Bay and the
//    Brownsville Ship Channel are mapped this way, outside the coastline.
// A point is water if it is on the sea side of the coastline or inside a water area.
// Each ray from a spot walks every boundary crossing in order, toggling that state.
// Ponds, basins and anything smaller than ~400 m across are ignored. A spot up to
// 400 m inside land is treated as standing on the bank (atlas GPS for wade spots
// often lands there).
'use strict';
const fs = require('fs');
const path = require('path');

const HTML = path.join(__dirname, '..', 'index.html');
const CACHE = path.join(__dirname, '.coastline-cache.json');
const CAP_M = 16093;        // 10 mi: past this, extra fetch changes little for bay chop
const SHORE_M = 400;
const DIRS = 16;
const DRY = process.argv.includes('--dry');

const html = fs.readFileSync(HTML, 'utf8');
const a = html.indexOf('const SPOTS = ['), b = html.indexOf('/* ============================== GEO / DATE UTILS');
const genStart = html.indexOf('/* FETCH:BEGIN');
const spotsSrc = html.slice(a, genStart > a && genStart < b ? genStart : b);
const SPOTS = new Function(spotsSrc + ';return SPOTS;')();

// One bbox per cluster of nearby spots, padded past the fetch cap.
function clusters(spots){
  const out = [];
  for(const s of spots){
    let c = out.find(c => Math.abs(c.lat - s.lat) < 0.3 && Math.abs(c.lon - s.lon) < 0.3);
    if(!c){ c = {lat:s.lat, lon:s.lon, s:s.lat, n:s.lat, w:s.lon, e:s.lon}; out.push(c); }
    c.s = Math.min(c.s, s.lat); c.n = Math.max(c.n, s.lat);
    c.w = Math.min(c.w, s.lon); c.e = Math.max(c.e, s.lon);
  }
  return out.map(c => [c.s - 0.17, c.w - 0.19, c.n + 0.17, c.e + 0.19]);
}

async function overpass(q){
  const ENDPOINTS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
  let lastErr = null;
  for(let attempt = 0; attempt < 6; attempt++){
    const url = ENDPOINTS[attempt % ENDPOINTS.length];
    try{
      const res = await fetch(url, {
        method:'POST', body:'data=' + encodeURIComponent(q),
        headers:{'Content-Type':'application/x-www-form-urlencoded', 'User-Agent':'ALINE_CoastalLog fetch builder'}
      });
      if(!res.ok) throw new Error(`${url} HTTP ${res.status}`);
      return await res.json();
    }catch(e){ lastErr = e; await new Promise(r => setTimeout(r, 5000 * (attempt + 1))); }
  }
  throw lastErr;
}

const SKIP_WATER = new Set(['pond', 'wastewater', 'basin', 'reservoir', 'reflecting_pool', 'fishpond', 'moat', 'swimming_pool']);
const usableWater = t => t && !SKIP_WATER.has(t.water) && t.intermittent !== 'yes' && !t.golf;

// Cache: {coast:{bbox:[[id, geom]]}, water:{bbox:[[key, [lines...]]]}}, resumable per bbox.
async function loadShores(){
  const cache = fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE, 'utf8')) : {};
  if(!cache.coast){
    // Older caches held only coastline, keyed by bbox at the top level.
    const old = Array.isArray(cache) ? {} : {...cache};
    Object.keys(cache).forEach(k => delete cache[k]);
    cache.coast = old; cache.water = {};
  }
  const coast = new Map(), water = new Map();
  for(const bb of clusters(SPOTS)){
    const key = bb.map(v => v.toFixed(4)).join(',');
    if(!cache.coast[key]){
      const d = await overpass(`[out:json][timeout:180];way["natural"="coastline"](${key});out geom;`);
      cache.coast[key] = d.elements.filter(e => e.type === 'way' && e.geometry).map(e => [e.id, e.geometry.map(p => [p.lat, p.lon])]);
      fs.writeFileSync(CACHE, JSON.stringify(cache));
    }
    if(!cache.water[key]){
      const d = await overpass(`[out:json][timeout:300];(way["natural"="water"](${key});relation["natural"="water"](${key}););out geom;`);
      cache.water[key] = d.elements.filter(e => usableWater(e.tags)).map(e => {
        const lines = e.type === 'way'
          ? [e.geometry.map(p => [p.lat, p.lon])]
          : (e.members || []).filter(m => m.type === 'way' && m.geometry && (m.role === 'outer' || m.role === 'inner' || m.role === ''))
                             .map(m => m.geometry.map(p => [p.lat, p.lon]));
        return [e.type + e.id, lines];
      }).filter(([, lines]) => {
        // Plain loop: the Laguna Madre outline is too many points to spread into Math.max.
        let s = Infinity, n = -Infinity, w = Infinity, e = -Infinity;
        for(const g of lines) for(const [la, lo] of g){ s = Math.min(s, la); n = Math.max(n, la); w = Math.min(w, lo); e = Math.max(e, lo); }
        return n - s > 0.004 || e - w > 0.004;
      });
      fs.writeFileSync(CACHE, JSON.stringify(cache));
    }
    cache.coast[key].forEach(([id, g]) => coast.set(id, g));
    cache.water[key].forEach(([id, lines]) => water.set(id, lines));
    console.error(`bbox ${key}: ${coast.size} coastline ways, ${water.size} water areas`);
  }
  return {coast:[...coast.values()], water:[...water.values()]};
}

// Local flat projection around a spot, metres. Fine over 16 km.
function projector(lat0, lon0){
  const ky = 111320, kx = 111320 * Math.cos(lat0 * Math.PI / 180);
  return (lat, lon) => [(lon - lon0) * kx, (lat - lat0) * ky];
}
const toSegs = (lines, P) => {
  const out = [];
  for(const g of lines) for(let i = 0; i < g.length - 1; i++) out.push([P(g[i][0], g[i][1]), P(g[i + 1][0], g[i + 1][1])]);
  return out;
};
// Ray (origin, unit dir) against a segment: distance along the ray, and the cross sign.
function hit(rx, ry, [[ax, ay], [bx, by]]){
  const sx = bx - ax, sy = by - ay;
  const den = rx * sy - ry * sx;
  if(Math.abs(den) < 1e-12) return null;
  const t = (ax * sy - ay * sx) / den, u = (ax * ry - ay * rx) / den;
  if(t <= 0 || u < 0 || u >= 1) return null;
  return {t, side: sx * ry - sy * rx};    // > 0: ray moves from the segment's right to its left
}

function fetchFor(spot, shores){
  const P = projector(spot.lat, spot.lon);
  const near = g => g.some(([la, lo]) => Math.abs(la - spot.lat) < 0.3 && Math.abs(lo - spot.lon) < 0.3);
  const coastSegs = toSegs(shores.coast.filter(near), P);
  const polys = shores.water.filter(lines => lines.some(near)).map(lines => toSegs(lines, P));

  // Origin state. Sea: the side of the nearest coastline segment. Water areas: even-odd
  // parity along a ray due east, over the whole polygon.
  let sea = false, best = Infinity;
  for(const [[ax, ay], [bx, by]] of coastSegs){
    const sx = bx - ax, sy = by - ay, L2 = sx * sx + sy * sy || 1;
    const f = Math.max(0, Math.min(1, -(ax * sx + ay * sy) / L2));
    const px = ax + f * sx, py = ay + f * sy, d = Math.hypot(px, py);
    if(d < best){ best = d; sea = (sx * (0 - ay) - sy * (0 - ax)) < 0; }   // origin right of segment = sea
  }
  const inside = polys.map(segs => segs.filter(s => hit(1, 0, s)).length % 2 === 1);
  const isWater = () => sea || inside.some(Boolean);
  const originWater = isWater();

  const miles = [];
  for(let k = 0; k < DIRS; k++){
    const th = k * 2 * Math.PI / DIRS, rx = Math.sin(th), ry = Math.cos(th);
    const events = [];
    coastSegs.forEach(s => { const h = hit(rx, ry, s); if(h && h.t <= CAP_M) events.push({t:h.t, coast:true, entersSea: h.side < 0}); });
    polys.forEach((segs, i) => segs.forEach(s => { const h = hit(rx, ry, s); if(h && h.t <= CAP_M) events.push({t:h.t, poly:i}); }));
    events.sort((p, q) => p.t - q.t);
    // Reset per ray to the origin state.
    let s0 = sea; const in0 = inside.slice();
    let wet = originWater, start = 0, result = null;
    // Boundaries often coincide (Laguna Madre meets South Bay, a channel meets the
    // coastline). Apply every crossing within 2 m before judging, or the ray reads a
    // false instant of land between two waters.
    for(let j = 0; j < events.length; ){
      const e = events[j];
      while(j < events.length && events[j].t - e.t < 2){
        const x = events[j++];
        if(x.coast) s0 = x.entersSea; else in0[x.poly] = !in0[x.poly];
      }
      const nowWet = s0 || in0.some(Boolean);
      if(wet && !nowWet){ result = e.t - start; break; }
      if(!wet && nowWet){
        if(e.t > SHORE_M && start === 0){ result = 0; break; }   // real land between the spot and this water
        wet = true; start = e.t;
      }
    }
    if(result == null) result = wet ? CAP_M - start : 0;
    miles.push(result / 1609.34);
  }
  return {miles, onLand: !originWater};
}

(async () => {
  const shores = await loadShores();
  const rows = SPOTS.map(s => ({id:s.id, name:s.name, ...fetchFor(s, shores)}));
  const LABELS = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
  for(const r of rows){
    console.log(r.id.padEnd(20), (r.onLand ? 'bank' : 'water').padEnd(5),
      r.miles.map((m, i) => `${LABELS[i]}:${m.toFixed(1)}`).join(' '));
  }
  if(DRY) return;
  // A spot with no water within reach in any direction has coordinates too far inland to
  // judge. Leave it out (null) so the app scores it as moderately exposed, not as protected.
  const unusable = r => r.miles.every(m => m < 0.2);
  rows.filter(unusable).forEach(r => console.log(`!! ${r.id}: no water within ${SHORE_M} m in any direction; left out, check its GPS`));
  const table = rows.map(r => unusable(r)
    ? `  ${JSON.stringify(r.id)}:null,`
    : `  ${JSON.stringify(r.id)}:[${r.miles.map(m => +m.toFixed(1)).join(',')}],`).join('\n');
  const block = `/* FETCH:BEGIN — generated by tools/compute-fetch.js from OpenStreetMap shorelines; do not edit by hand.
   Open water (miles, capped at 10) in 16 directions starting at N, clockwise. */
const FETCH = {
${table}
};
/* FETCH:END */
`;
  let out;
  if(genStart >= 0){
    const end = html.indexOf('/* FETCH:END */') + '/* FETCH:END */\n'.length;
    out = html.slice(0, genStart) + block + html.slice(end);
  }else{
    out = html.slice(0, b) + block + '\n' + html.slice(b);
  }
  fs.writeFileSync(HTML, out);
  console.log(`\nWrote FETCH for ${rows.length} spots.`);
})().catch(e => { console.error(e); process.exit(1); });
