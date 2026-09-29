# Verification — live API contracts and first real run

Run 2026-09-19 on the user's Windows machine (browser timezone America/Chicago),
using `curl.exe` and Chrome. First session with real network access to NOAA and
Open-Meteo.

## Result

Two of the three load-bearing assumptions held. The third exposed one real bug,
now fixed: two of 14 spots showed "Data unavailable".

## Priority 1 — live API contracts

### 1a. Open-Meteo multi-location batching — PASS
Two comma-joined coordinates returned a top-level JSON **array** of 2 objects, in
request order (Galveston first, Port Aransas second). Each has 48 hourly rows and
its own `daily.sunrise`. `fetchGridBatched()` works as designed; the per-spot
fallback did not fire.

Two behaviours worth knowing (neither is a bug):
- Returned `latitude`/`longitude` are **snapped to the model grid** (requested
  29.3385 came back 29.325). Matching by index is correct; matching by exact
  coordinate would not be.
- Default wind unit is km/h. The app displays mph, so it must request mph
  explicitly. Rendered values (7–13 mph) are consistent with that.

### 1b. Marine coverage for bay points — PASS, with a caveat
Baffin Bay and Port O'Connor coordinates batched together returned HTTP 200, an
array of 2, and non-null wave height and sea-surface temperature for all 24 hours.
Requested each point alone, and Galveston: also 200 with full data. No bad
coordinate poisoned a batch, so no splitting is needed.

Caveat: the marine grid is coarse and snaps inland/bay points to the nearest
open-water cell. Baffin (requested -97.44) came back at -97.29, about 9 mi east.
So the "Water" temperature shown for bay spots is a nearby Gulf-side value, not
bay water. Wave data for bay spots is not scored, so scores are unaffected.
Port Mansfield renders with no water temperature, which is the intended
degradation.

### 1c. NOAA tide stations — one BUG found and fixed
- Station list still returns `lat` and `lng` (not `lon`). 86 Texas stations after
  the app's bounding box.
- Station 8771341 as given in the handoff returned **HTTP 200 with 216 hourly
  predictions**.
- For all 14 spots I replicated the app's nearest-station match and requested
  hilo and hourly:

| Result | Stations |
| --- | --- |
| Hourly and hilo both work | 10 of 12 unique stations, all type R |
| Hilo only (reconstructed curve) | 1: South Bay entrance 8779768 (Boca Chica) |
| **Neither, "No Predictions data was found"** | **2: Baffin Bay 8776604, Port Mansfield 8778490** |

So the reconstructed curve is rare here: 1 of 12 stations.

**Root cause of the bug:** `fetchTideStations()` merged the `waterlevels` station
list into the `tidepredictions` list. `waterlevels` contains observation-only
gauges, and Baffin Bay and Port Mansfield exist *only* there (confirmed: absent
from `tidepredictions`; predictions return an error under MLLW, MSL and STND).
They were the geographically nearest stations, so they won `nearestStation()` and
the spot failed with "Data unavailable".

## Priority 2 — running the app

| Check | Result |
| --- | --- |
| `node tools/verify-astronomy.js` | 11/11 pass. Also 11/11 under `TZ=Asia/Tokyo`, `Pacific/Auckland`, `UTC` |
| All 14 spots score | **Failed before fix (12/14), passes after (14/14)** |
| Zero console errors | Pass (before and after) |
| Request count | 28 before fix, 27 after. **Not ~4 as the handoff said** — see below |
| Sunrise/sunset | Galveston sunrise 7:05 AM matches the Open-Meteo response; sunset 7:18 PM plausible |
| Tide times vs NOAA | Galveston South Jetty (8771416) app shows H 1:10a / L 4:30p; NOAA API returns 01:10 H 2.371 ft and 16:30 L 0.44 ft. Exact match |
| Scores differ across spots and days | Pass. Range 71–80 today; day bests 80, 81, 75, 62, 69, 71, 75, 74 |
| Score arithmetic | Galveston 17+16+14+10+6+14 = 77, matches the total |
| Expand row, toggle "i", star, reload | Pass. Star persisted across reload |
| Dark theme | Body background switched to rgb(7,26,33) with `data-theme="dark"`; screenshot legible |

**Request count.** The handoff's "~4 requests" was wrong, not the app. Open-Meteo
is batched to exactly 2 requests (1 forecast, 1 marine), as intended. NOAA tide
data is per station and needs hilo plus hourly for each, so 12 stations is 24
requests, plus the station list. After the fix: 1 + 24 + 2 = 27.

### Not covered
- **Timezone from a non-Central browser.** This machine is in Central time, so
  the live page cannot show a `parseCT()` regression. Mitigation: the Node check
  passes under three other timezones, but the live NOAA-to-page path was only
  seen from Central.
- **Tide times vs the NOAA website.** Compared against the NOAA API instead (same
  source, so it validates the app's conversion, not NOAA's data itself).
- **OS-level dark mode.** I set `data-theme="dark"`; I did not toggle the
  `prefers-color-scheme` media query.
- **The "reconstructed" label for Boca Chica.** The hilo-only path returned data
  but I did not inspect that row's chart label.
- **One unexplained observation:** early on, an expanded row appeared collapsed
  after a scripted star click. Repeated cleanly it did not reproduce (row and
  info panel stay open on star). No code path collapses rows other than clicking
  the row. Treated as test-harness noise.

## What I changed

One edit, in `index.html` `fetchTideStations()`: fetch only the `tidepredictions`
station list and drop the `waterlevels` one. It also removes one request.

After the change: 14/14 spots load, no console errors.

## Decision for you

Baffin Bay now borrows tide from **Corpus Christi, Bob Hall Pier, 23.9 mi away**
(the nearest station that publishes predictions). Port Mansfield uses Port
Mansfield Channel Entrance at 9.5 mi. The detail view shows the distance, but
Laguna Madre tides are heavily damped relative to the Gulf side, so the Baffin
tide score is a weak proxy. Options: accept as is, cap the match distance and show
"no tide data", or add a tide-less scoring path for that spot. I have not chosen.

---

## Addendum — Port Isabel focus and per-spot scoring (2026-09-19)

Added at the user's request after the verification above. Two new spots (Port
Isabel Shoreline, Queen Isabella Causeway west end), a "Port Isabel" filter chip,
and optional per-spot `wind` exposure and tide `phase` fields. See the README
section "Per-spot wind exposure and tide phase" for the rules.

| Check | Result |
| --- | --- |
| 16 of 16 spots load, no app console errors | Pass (one extension-channel exception from Chrome, not the app) |
| Untagged spots keep their earlier scores | Pass: Matagorda 80, Rollover 79, Galveston 77, Port O'Connor 77, Freeport 75, Bob Hall 75, Sabine 74, Mansfield 73, Rockport 72, Port Aransas 72, San Luis 71, Baffin 71 |
| Tagged spots change and say why | Pass: Isla Blanca 73 to 76, Boca Chica 72 to 75; both show the wind and phase notes |
| Phase fraction varies with real data | Pass: 0% to 100% across the 8-day forecast, complementary for incoming vs outgoing spots |
| Unit checks for the new functions | 15 added to `tools/verify-astronomy.js`; 26/26 pass, also under Asia/Tokyo and UTC |
| Astronomy checks | Still 11/11 |

Limitations:
- **Sheltered wind was not seen live.** The week's forecast is easterly, so every
  live note was "exposed". The sheltered branch is covered by unit tests only.
- **The wind adjustment rarely moves a score.** At the 7 to 11 mph seen this week,
  a 1.25x factor stays inside the 5 to 15 mph bracket. It matters on 13+ mph days.
- **The tags are my judgment**, listed in the README. The Isla Blanca and Boca Chica
  changes (+3 each) come mostly from tide phase.
- **Coordinates for the two new spots are NOAA station positions**, not atlas
  hotspots. The atlas photos supplied so far contained no readable Port Isabel
  hotspot table, so no atlas data was loaded.
- **The causeway's tide is a reconstructed curve** (hilo-only station 8779739), and
  has no phase preference, so phase does not apply there.

## Addendum — Causeway spot moved to atlas GPS (2026-09-29)

- The causeway spot now uses Pirates Landing Pier from the *Texas Lakes & Bays Fishing
  Atlas* 2025-26, p.222 facilities table: N 26 04.734, W 97 12.402 (26.0789, -97.2067).
- Its nearest NOAA station is still 8779739 (about 1.1 mi, vs 1.3 mi to 8779770), so
  its tide source did not change.
- Port Isabel Shoreline is still a NOAA station position. Page 222 holds the map and
  facilities only. The GPS table for its numbered hotspots is on another page, which
  has not been supplied yet.

## Addendum — Shoreline spot moved to atlas GPS (2026-09-29)

- The Port Isabel shoreline spot is now High School Shoreline, from the atlas p.223
  hotspot table: N 26 04.830, W 97 14.870 (26.0805, -97.2478). It is listed there for
  sheepshead and as trout hotspot #88 ("park on Highway 100 and wade shore").
- Checked against the live NOAA tidepredictions list: its nearest station is still
  8779770 Port Isabel (2.41 mi), so its tide source did not change. The causeway spot
  still resolves to 8779739 (1.06 mi).
- Both Port Isabel bay spots now use atlas GPS. The wind tags (exposed E/SE,
  sheltered SW/W/NW) were confirmed by the user: the shoreline faces east/southeast.

## Addendum — All Port Isabel-area atlas hotspots added (2026-09-29)

- Every hotspot in the atlas p.223 tables (map p.222) is in: redfish 69-78, trout
  80-93, flounder 40-46, snook 7-15, and Best Bank & Wade 1-10. That is 50 hotspots:
  47 in 39 new `pi-*` spots, plus 3 attached to the existing shoreline and
  causeway spots. Arroyo Colorado (pp.220-221) is not included.
- Snook 7-10 (Texaco Channel, High School Shoreline, South Side of Bridge, Old Queen
  Isabella Causeway): the table header is cropped in the photo. The species comes from
  key colour and numbering (snook 1-6 are on p.221, 11-15 on p.223).
- Printed "118/4 oz" jig head sizes were read as 1/8-1/4 oz.
- Checked in code: 55 spots, 0 duplicate ids, and all Port Isabel spots fall inside
  26.0-26.19 N, 97.14-97.31 W.
- Checked live (2026-09-29): Open-Meteo weather and marine batch calls with all 55
  coordinates returned 200 with 55 locations each (URL about 1.06 KB). The four newly
  used NOAA stations (8779280 Realitos Peninsula, 8779749 Brazos Santiago Pass,
  8779750 Padre Island south end, 8779748 SPI C.G. Station) return hilo predictions.
- Airport Cove resolves to 8779280 Realitos Peninsula (6.4 mi north), not Port
  Isabel. It is still the closest prediction station. The Holly Beach and Laguna
  Vista spots use Port Isabel 8779770 at 4.4-7.8 mi.
- Browser check: with the Port Isabel filter on, all 43 rows scored with no error
  rows, and the Atlas hotspots panel renders in the detail view.
- No wind/phase tags on the new spots. Two atlas notes mention tide: Airport Cove
  (trout: "wade mouth on outgoing tide") and Laguna Vista Cove (redfish: "cove mouth
  outgoing tide, back incoming"). These are not applied.

## Addendum — Wind exposure, bait flow and current scoring (2026-09-29)

- Score reweighted: wind exposure 25, bait flow 25, current 25, solunar 10, pressure 6,
  rain 4, sea state 5 (surf spots only; bay spots scale by 100/95). The old tide-range,
  speed-only wind and hand-tagged wind/phase fields are gone.
- Fetch table (`FETCH`) generated by `tools/compute-fetch.js` from OpenStreetMap on
  2026-09-29. Coastline alone was not enough: the Laguna Madre (relation 5121863),
  South Bay (16809273) and the Brownsville Ship Channel (4856043) are natural=water
  areas outside the coastline, and a coastline-only first pass read every Laguna
  spot as on land. The script now combines both, and applies crossings within 2 m
  together so shared edges (Laguna Madre / South Bay, channel / coastline) don't
  read as a strip of land.
- Traced the east ray from the Isla Blanca spot by hand: it leaves the ship channel
  area at 80 m and reaches the Gulf coastline at 703 m, so the land between is real in
  OSM. The spot's coordinates (26.0606, -97.1581) sit on the south edge of the channel,
  about half a mile south of the jetties.
- Port Mansfield has no water within 400 m in any direction; it is left out of FETCH
  and scored as moderately exposed. Boca Chica reads as water only to the north, which
  does not fit a Gulf beach; its coordinates look inland.
- High School Shoreline: the map gives open water N through E (3.4-10 mi) and almost
  none ESE through W, so a SE wind scores as protected. This disagrees with the user's
  earlier description (faces east/southeast) and needs a decision.
- 24 new unit checks cover fetch lookup, the chop brackets, bait-flow fractions
  (including "either"), window rate, station reference and the wind stand-in. All pass.
- Browser check (live data): all 43 Port Isabel rows scored, exposure labels shown
  in the rows, and the detail view explains wind, bait flow and current in plain words.
- Bait-flow roles in `SPOT_ROLES` are drafted and not yet reviewed by the user.

## Addendum — NOAA currents, pushed in / pulled out, coordinates (2026-09-29)

- NOAA current predictions (`currents_predictions`, interval 30) checked live for
  STX1813, STX1814 and STX1821: 384 half-hourly rows each for the 8-day range. Positive
  Velocity_Major is flood, negative ebb. All 11 Port Isabel-area current stations in the
  NOAA list are harmonic (type H).
- Browser check (live): 12 current stations loaded. All 43 Port Isabel rows show dawn and
  dusk direction; 0 errors. The Causeway spot uses STX1814 Queen Isabella Causeway Bridge
  (0.6 mi): ebb at dawn, flood at dusk, 0.87 kt average in the windows, 74% of its usual
  peak. The current chart renders in the detail view.
- Before the tide range started a day early, 12 spots on hilo-only stations had no dawn
  reading (no curve before the first turn of the day). After: none.
- 7 new unit checks (flood/ebb as incoming/outgoing, window direction including turning
  and slack, the 1 kt absolute mark). 31 scoring checks pass in total.
- Isla Blanca Jetties moved to 26.0666, -97.1494: pass side of the north jetty (OSM
  breakwater 342184661 starts at 26.0676, -97.1543), beside current station STX1820.
  OSM does not treat jetty rock as land, so a north wind there reads as exposed.
- Boca Chica Beach moved to 25.9975, -97.1500: the OSM Gulf coastline at that latitude
  is at -97.1505; the old point was about 560 m inland. Fetch now open NNE to SSE.
- High School Shoreline: web research found no angler source naming the spot. OSM
  (Laguna Madre relation 5121863) shows the shore running about 100°/280° with open water
  to the N-NNE; Port Isabel High School is about 420 m south, across TX 100. The map
  measurement stands: SE winds are mostly blocked.

## Addendum — Slack-water hole bonus from NOAA depth (2026-09-29)

- NCEI DEM_all ImageServer identify returned CUDEM 1/9 arc-second tiles
  (ncei19_n26X25_w097X25_2020v1 around Port Isabel, ncei19_n29x50_w094x75_2021v2 at
  Galveston). getSamples took 441 points in about 0.6 s.
- Spot checks: Laguna flats 0.3-3 ft; ICW spots 9-13 ft (project depth 12 ft); Brazos
  Santiago Pass 40-52 ft (ship channel). Port Mansfield has no water within 300 m of its
  coordinates and gets no bonus. Pirates Landing, High School Shoreline and Port Aransas
  sit on the bank; the typical and deep values come from the water around them.
- Browser check, Wednesday 2-3 AM (live): Turning Basin fully slack, 28.7 ft relief ->
  10 / 10 bonus; Bridgepoint (2.6 ft relief) earns 0 because its water is moving; Holly
  Beach (0.3 ft) is flagged as no hole. Whole-day bonuses stay small (0-1 pt) because
  slack is a small share of a day.
- 8 new unit checks for slack share, hole value and the bonus.
