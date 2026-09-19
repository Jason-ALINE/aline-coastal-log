# Handoff — Coastal Log

You are picking up a rebuilt single-file web app. The previous session ran in a
sandboxed cloud container whose egress proxy **blocked NOAA and Open-Meteo**, so
the astronomy, the time handling and the layout were verified, but **no live API
response was ever seen**. You are running on the user's machine with normal network
access. That is the whole reason you were brought in.

Read `README.md` first — it has the architecture, the scoring model, and the
invariants. This file covers only what is left to do.

---

## Priority 1 — Verify the live API contracts

Three assumptions are load-bearing and unverified. Check them **before** touching
any code, and do not "fix" anything until you have seen real responses.

Use `curl.exe`, not `curl` — in Windows PowerShell, bare `curl` is an alias for
`Invoke-WebRequest`, which returns a different object and will mislead you.

### 1a. Does Open-Meteo multi-location return a JSON array, in request order?

This is the highest-risk assumption. The app joins 14 coordinates with commas to
turn 28 requests into 2. If the response shape is wrong, batching silently
mis-assigns weather to the wrong spots — every score would be plausible and wrong.

```powershell
curl.exe -s "https://api.open-meteo.com/v1/forecast?latitude=29.3385,27.8339&longitude=-94.7058,-97.0464&hourly=wind_speed_10m&daily=sunrise,sunset&timezone=America%2FChicago&forecast_days=2" | ConvertFrom-Json | ConvertTo-Json -Depth 4 | Select-Object -First 40
```

- **Expect:** a top-level JSON **array** of 2 objects. Element 0 latitude ≈ 29.33
  (Galveston), element 1 ≈ 27.83 (Port Aransas) — i.e. *the order requested*.
- **If it is an object, not an array:** `asLocationArray()` in `index.html` returns
  `null` for n>1 and `fetchGridBatched()` falls back to per-spot calls. Confirm the
  fallback actually fires and all 14 spots still load, then tell the user — batching
  is dead and the request count goes back up.
- **If the array is out of order:** this is a real bug. The code assumes
  `arr[i]` corresponds to `spots[i]`. Match on `latitude`/`longitude` instead.

### 1b. Do the bay points have marine coverage?

Baffin Bay and Port O'Connor are the two most likely to sit outside the marine
grid. They must degrade to "no water temp" rather than failing the spot.

```powershell
curl.exe -s "https://marine-api.open-meteo.com/v1/marine?latitude=27.2967,28.45&longitude=-97.44,-96.4&hourly=wave_height,sea_surface_temperature&timezone=America%2FChicago&forecast_days=1" | ConvertFrom-Json | ConvertTo-Json -Depth 4 | Select-Object -First 40
```

- **Expect either** real numbers, **or** nulls, **or** an HTTP 400 for out-of-grid
  coordinates. All three are survivable — `fetchGridBatched` falls back per-spot and
  `computeDayModel` treats missing marine data as `null`.
- **What would be a bug:** one bad coordinate causing the *whole batch* to fail so
  that spots with good coverage also lose their wave data. If you see that, split
  the marine batch: request only surf/offshore spots together, and fetch bay spots
  individually.

### 1c. Which NOAA stations actually serve hourly tide data?

Stations that only publish high/low get a reconstructed curve (half-cosine between
turns). That is intended and labelled in the UI, but find out how common it is.

```powershell
# Galveston Bay Entrance - should return ~200 hourly predictions
curl.exe -s "https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?begin_date=20260919&end_date=20260927&station=8771341&product=predictions&datum=MLLW&time_zone=lst_ldt&interval=h&units=english&format=json&application=ALINE_CoastalLog" | ConvertFrom-Json | Select-Object -ExpandProperty predictions | Measure-Object
```

Also confirm the station-list endpoint still returns `lat` and `lng` (not `lon`)
for the Texas bounding box — `nearestStation()` reads `s.lat` and `s.lng`:

```powershell
curl.exe -s "https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations.json?type=tidepredictions&units=english" | ConvertFrom-Json | Select-Object -ExpandProperty stations | Where-Object { $_.lat -gt 25.5 -and $_.lat -lt 30.3 -and $_.lng -gt -97.8 -and $_.lng -lt -93.3 } | Measure-Object
```

- **Expect:** a non-zero count. Zero means either the field names changed or the
  endpoint moved, and `fetchTideStations()` throws with "returned no Texas Gulf
  Coast stations" — the app then shows an error and stops, by design.

---

## Priority 2 — Run the app for real

```powershell
node tools\verify-astronomy.js     # must print "All checks passed."
python -m http.server 8000         # then open http://localhost:8000
```

Open DevTools console and check all of the following:

| Check | Why it matters |
| --- | --- |
| All 14 spots score; none stuck on "Loading" or "Data unavailable" | Batching or station matching broken |
| Zero console errors | — |
| Network tab shows **~4 requests**, not 42 | Batching silently fell back |
| Sunrise/sunset look right for the Texas coast | Timezone handling regressed |
| Tide high/low times match [tidesandcurrents.noaa.gov](https://tidesandcurrents.noaa.gov) for one station | The single best end-to-end check |
| Scores differ across spots and days | All-identical scores means a data plumbing bug |
| Expand a row, toggle an "i" button, star a spot, reload | Favourites persist, explains stay open |
| Force dark mode in DevTools rendering panel | Both themes are defined |

Verify the tide times against NOAA's own website for **one** station. If those
match, the Central-time conversion is correct end to end — that is the check that
subsumes most others.

---

## Priority 3 — Report back

Write findings to `VERIFICATION.md` in the repo and commit. State plainly what
passed, what failed, and what you changed. If everything passes, say so — a clean
result is a useful result.

---

## Invariants — do not break these

**Every naive timestamp goes through `parseCT()`.** NOAA (`time_zone=lst_ldt`) and
Open-Meteo (`timezone=America/Chicago`) both return `"2026-09-19 06:00"` with no UTC
offset. `new Date()` on one of those resolves it in *the viewer's* timezone, which
silently shifts every tide turn and solunar window. This was the most serious bug in
the original and it is invisible if you test from Texas. If you add a data source,
route its timestamps through `parseCT()`.

**`findIndex` results must be guarded before use as an offset.** The original bug:
`wxIdx` of `-1` was not checked, so the 24-hour slice read `idx = -1 + i` and scored
the day using the *previous* day's weather. Silent and plausible.

**Do not add water temperature to the score** without the user deciding. It is
displayed deliberately and excluded deliberately; adding it changes every number.

**Keep it one file with no build step.** That is a product decision, not an
oversight. `index.html` runs by double-clicking. Do not introduce npm, a bundler,
or a framework. `tools/verify-astronomy.js` is the only Node script, it has no
dependencies, and it *extracts* functions from `index.html` rather than duplicating
them — if you move that code block, update the markers in that script.

**The astronomy is validated by a physical identity.** A full moon rises at sunset.
`tools/verify-astronomy.js` checks 29 June 2026 at Galveston: moonrise 8:36 PM
against sunset ~8:26 PM. If you touch `moonGeo()`, `moonState()` or
`moonTimesForDay()`, that check must still pass — it is the only thing standing
between you and plausible-looking wrong numbers.

---

## Known-good baseline

- `node tools/verify-astronomy.js` → 11 checks, all passing
- Renders correctly at 1000px and 390px, light and dark, against stubbed API data
- No live API response has ever been observed — that is your job
