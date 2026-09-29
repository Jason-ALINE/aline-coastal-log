// Measures the bottom around every spot from NOAA NCEI's coastal elevation model
// (CUDEM, 1/9 arc-second, about 3 m) and writes the DEPTH table into index.html.
//
//   node tools/compute-depth.js            # sample NCEI, update index.html
//   node tools/compute-depth.js --dry      # print the table, change nothing
//
// For each spot, a grid every 25 m out to 300 m is sampled. Water cells are those below
// 0 m NAVD88. Recorded, in feet: the depth at the spot, the typical (median) depth
// around it, and the deep water nearby (mean of the deepest 5% of cells) with its
// distance and bearing. Relief = deep - typical: how much a hole or channel drops below
// the water around it. Depths are relative to NAVD88, close to mean water on this coast,
// so they read roughly as depth at mid tide; relief does not depend on the datum.
//
// The model is checked against the official nautical chart: every NOAA ENC sounding
// within 1 km (harbour-scale charts, else approach) is compared with the model at the
// same point. Within 3 ft on at least 75% of them (and 3 or more soundings) is
// "agrees"; less is "conflict"; fewer than 3 soundings is "unchecked". The app gives
// no hole bonus where they conflict. The charts win: they are surveyed, often more
// recently, and parts of the model in the Laguna Madre (e.g. along the ICW near
// 26.10-26.15 N) show 11-33 ft where the chart shows 1-3 ft.
'use strict';
const fs = require('fs');
const path = require('path');

const HTML = path.join(__dirname, '..', 'index.html');
const SERVICE = 'https://gis.ngdc.noaa.gov/arcgis/rest/services/DEM_mosaics/DEM_all/ImageServer/getSamples';
const ENC = 'https://encdirect.noaa.gov/arcgis/rest/services/encdirect';
const RADIUS_M = 300, STEP_M = 25, FT = 3.28084, CHECK_M = 1000, TOL_FT = 3, AGREE = 0.75;
const DRY = process.argv.includes('--dry');

const html = fs.readFileSync(HTML, 'utf8');
const a = html.indexOf('const SPOTS = [');
const fetchStart = html.indexOf('/* FETCH:BEGIN');
const SPOTS = new Function(html.slice(a, fetchStart) + ';return SPOTS;')();

async function samples(points){
  const body = new URLSearchParams({
    geometry: JSON.stringify({points, spatialReference:{wkid:4326}}),
    geometryType: 'esriGeometryMultipoint', returnFirstValueOnly: 'true',
    interpolation: 'RSP_NearestNeighbor', f: 'json'
  });
  let lastErr;
  for(let attempt = 0; attempt < 4; attempt++){
    try{
      const r = await fetch(SERVICE, {method:'POST', body});
      const j = await r.json();
      if(j.error) throw new Error(JSON.stringify(j.error));
      return j.samples.map(s => +s.value);
    }catch(e){ lastErr = e; await new Promise(r => setTimeout(r, 3000 * (attempt + 1))); }
  }
  throw lastErr;
}

const R_EARTH = 6371000, RAD = Math.PI / 180;
const metres = (la1, lo1, la2, lo2) => {
  const x = Math.sin((la2 - la1) * RAD / 2) ** 2 + Math.cos(la1 * RAD) * Math.cos(la2 * RAD) * Math.sin((lo2 - lo1) * RAD / 2) ** 2;
  return R_EARTH * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
};
// Chart soundings (metres below MLLW) within CHECK_M of the spot.
async function soundings(spot){
  const d = 0.009, env = `${spot.lon - d},${spot.lat - d},${spot.lon + d},${spot.lat + d}`;
  for(const [svc, layer] of [['enc_harbour', 76], ['enc_approach', 80]]){
    const url = `${ENC}/${svc}/MapServer/${layer}/query?where=1%3D1&geometry=${env}&geometryType=esriGeometryEnvelope&inSR=4326&outSR=4326&spatialRel=esriSpatialRelIntersects&outFields=Z&returnGeometry=true&returnZ=true&f=json`;
    const j = await (await fetch(url)).json();
    if(j.error) throw new Error(JSON.stringify(j.error));
    const pts = [];
    (j.features || []).forEach(f => {
      const g = f.geometry;
      (g.points || (g.x != null ? [[g.x, g.y, g.z]] : [])).forEach(p => pts.push({lon:p[0], lat:p[1], z:p[2] ?? f.attributes.Z}));
    });
    const near = pts.filter(p => Number.isFinite(p.z) && metres(spot.lat, spot.lon, p.lat, p.lon) <= CHECK_M);
    if(near.length) return near;
  }
  return [];
}
async function chartCheck(spot){
  const pts = await soundings(spot);
  if(pts.length < 3) return {check:'unchecked', n:pts.length};
  const model = await samples(pts.map(p => [p.lon, p.lat]));
  const ok = pts.filter((p, i) => Number.isFinite(model[i]) && Math.abs(-model[i] * FT - p.z * FT) <= TOL_FT).length;
  return {check: ok / pts.length >= AGREE ? 'agrees' : 'conflict', n:pts.length, ok};
}

const COMPASS = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];

async function depthFor(spot){
  const ky = 111320, kx = 111320 * Math.cos(spot.lat * Math.PI / 180);
  const cells = [];
  const n = Math.round(RADIUS_M / STEP_M);
  for(let i = -n; i <= n; i++) for(let j = -n; j <= n; j++){
    const dx = j * STEP_M, dy = i * STEP_M;
    if(Math.hypot(dx, dy) > RADIUS_M) continue;
    cells.push({dx, dy, lon: spot.lon + dx / kx, lat: spot.lat + dy / ky});
  }
  const vals = await samples(cells.map(c => [c.lon, c.lat]));
  cells.forEach((c, k) => { c.z = vals[k]; });
  const water = cells.filter(c => Number.isFinite(c.z) && c.z < 0);
  const at = cells.find(c => c.dx === 0 && c.dy === 0);
  if(water.length < 20) return {waterCells: water.length};
  const chart = await chartCheck(spot);
  const depths = water.map(c => -c.z * FT).sort((p, q) => p - q);
  const median = depths[Math.floor(depths.length / 2)];
  const top = water.slice().sort((p, q) => p.z - q.z).slice(0, Math.max(3, Math.ceil(water.length * 0.05)));
  const deep = top.reduce((s, c) => s - c.z * FT, 0) / top.length;
  const cx = top.reduce((s, c) => s + c.dx, 0) / top.length, cy = top.reduce((s, c) => s + c.dy, 0) / top.length;
  const bearing = (Math.atan2(cx, cy) * 180 / Math.PI + 360) % 360;
  return {
    waterCells: water.length,
    at: at && at.z < 0 ? +(-at.z * FT).toFixed(1) : null,
    median: +median.toFixed(1), deep: +deep.toFixed(1), relief: +(deep - median).toFixed(1),
    dist: Math.round(Math.hypot(cx, cy)), dir: COMPASS[Math.round(bearing / 22.5) % 16],
    check: chart.check, chartN: chart.n, chartOk: chart.ok ?? 0
  };
}

(async () => {
  const rows = [];
  for(const s of SPOTS){
    const d = await depthFor(s);
    rows.push({id:s.id, ...d});
    console.log(s.id.padEnd(20), d.median == null ? `too little water (${d.waterCells} cells)` :
      `at ${String(d.at ?? 'bank').padStart(5)} ft  typical ${String(d.median).padStart(5)}  deep ${String(d.deep).padStart(5)}  relief ${String(d.relief).padStart(5)}  ${d.dist} m ${d.dir}  chart: ${d.check} (${d.chartOk}/${d.chartN})`);
  }
  if(DRY) return;
  const table = rows.map(r => r.median == null ? `  ${JSON.stringify(r.id)}:null,`
    : `  ${JSON.stringify(r.id)}:{at:${r.at}, typical:${r.median}, deep:${r.deep}, relief:${r.relief}, dist:${r.dist}, dir:"${r.dir}", check:"${r.check}", chartN:${r.chartN}, chartOk:${r.chartOk}},`).join('\n');
  const block = `/* DEPTH:BEGIN — generated by tools/compute-depth.js from NOAA NCEI CUDEM; do not edit by hand.
   Feet below NAVD88 (about mean water) within ${RADIUS_M} m of each spot. relief = deep - typical.
   check: model vs nautical-chart soundings within ${CHECK_M} m (agrees / conflict / unchecked). */
const DEPTH = {
${table}
};
/* DEPTH:END */
`;
  const cur = fs.readFileSync(HTML, 'utf8');
  const ds = cur.indexOf('/* DEPTH:BEGIN');
  let out;
  if(ds >= 0){
    const de = cur.indexOf('/* DEPTH:END */') + '/* DEPTH:END */\n'.length;
    out = cur.slice(0, ds) + block + cur.slice(de);
  }else{
    const fe = cur.indexOf('/* FETCH:END */') + '/* FETCH:END */\n'.length;
    out = cur.slice(0, fe) + block + cur.slice(fe);
  }
  fs.writeFileSync(HTML, out);
  console.log(`\nWrote DEPTH for ${rows.length} spots.`);
})().catch(e => { console.error(e); process.exit(1); });
