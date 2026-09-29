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
- Both Port Isabel bay spots now use atlas GPS. The wind and phase tags were not
  changed. They were set for the old station position and have not been re-checked
  against this shoreline's orientation.
