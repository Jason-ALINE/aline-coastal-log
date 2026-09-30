# Coastal Log

Fishing conditions for 55 spots on the Texas Gulf Coast, scored 0–100 from live
tide, weather, marine, and lunar data. 43 of them are around Port Isabel and
have a **Port Isabel** filter chip.

The 39 `pi-*` spots are the Lower Laguna Madre hotspots from the *Texas Lakes &
Bays Fishing Atlas* 2025-26 (tables p.223, map p.222), in `ATLAS_PI` in
`index.html`. GPS is typed as printed and converted in code. Hotspots with the
same GPS, or the same name within about half a mile, share one spot. Each spot's
detail view has an **Atlas hotspots** panel with the atlas key, GPS and grid.
The atlas's bait and tactic notes are the publisher's text and are kept out of this
public repository: they live in the private catch log's database (`atlas`
collection), which shows them for the selected spot. The source copy is
`tools/atlas-notes.local.json`, which is git-ignored and stays on this computer.

Every row shows the spot's GPS in degrees and decimal minutes (the atlas format).
The detail view's **Location** panel repeats it alongside decimal degrees, each with
a Copy button, plus an Open in Google Maps link. Atlas spots store full-precision
coordinates, so the displayed minutes match the printed page exactly.

**Show map** opens a map of the spots that pass the Region, Type and Saved filters,
coloured by group (Upper, Middle, Lower, Port Isabel; Port Isabel spots are region
Lower, so the Lower filter shows both colours). Leaflet 1.9.4 and the map tiles
(OpenStreetMap streets, Esri satellite) load from the network only when the map is
first opened, so the list still works offline. **Track my location** uses the
browser's `watchPosition`: a blue dot with an accuracy ring, speed and heading when
moving, and the nearest visible spot. It follows you until you drag the map; tap the
button again to re-centre, and once more to stop. The position never leaves the
page: it is not stored or sent anywhere. Location needs https (GitHub Pages) or
localhost; browsers refuse it over plain http.

One self-contained HTML file. No build step, no dependencies, no server — open
`index.html` in a browser and it fetches everything it needs.

## Running it

Double-click `index.html`, or serve the directory if you prefer a real origin:

```sh
python3 -m http.server 8000   # then open http://localhost:8000
```

The page needs outbound access to three hosts:

| Host | Supplies |
| --- | --- |
| `api.tidesandcurrents.noaa.gov` | NOAA CO-OPS tide predictions (high/low and hourly) |
| `api.open-meteo.com` | Wind, pressure, precipitation, cloud, temperature, sunrise/sunset |
| `marine-api.open-meteo.com` | Wave height, swell period, sea-surface temperature |

No API keys. Nothing is sent anywhere except those three requests.

## Catch log

`catch-log.html` is a separate page, published privately on claude.ai at
https://claude.ai/artifact/CnEqPvmHQj4syBf728bMmA with a synced database, so the log
is the same on every device and survives clearing the browser. The app itself stays a
local file: hosted pages cannot request data from other sites, and the app needs
NOAA and Open-Meteo live. The app links to the log from the header (**Catch log**) and
from each spot (**Log a catch here**, which preselects the spot via `#<spot id>`).

Each catch is one document in the `catches` collection: spot, date, time, species,
count, length (in), bait or lure, kept or released, notes, and the logging person's
id. Conditions are not typed in: Claude reconstructs tide, current and wind for a
catch afterwards from NOAA and Open-Meteo history, then compares catches with the
scores. The log is private to its owner until shared from its Share menu; people
given Contributor access can add catches, and the page lets each person delete only
their own (the owner can delete any). After changing spots in the app, run
`node tools/sync-catch-log.js` and republish the log so its spot list matches.

## How the score works

Three questions carry 75 of the 100 points: is the spot protected from the wind, is
the water pushing bait in or pulling it out the way the spot needs, and how hard is
the water moving. **The score favours no time of day.** It describes the selected
day as a whole, every hour counted equally, or, if an hour is picked under **Time**,
that hour alone: bait, current, solunar periods and the wind used for exposure all
come from that hour. The app always opens on the whole day; the choice is not saved. Bay-only spots have
no sea state, so the other parts scale up by 100/95.

| Component | Points | Basis |
| --- | --- | --- |
| Wind exposure | 25 | Wind speed × √(open water upwind, miles, capped at 10). Low chop scores 25, then 17 / 9 / 3; under 4 mph 18; over 25 mph 4 |
| Bait flow | 25 | Share of the windows the water flows the way the spot's role wants (see below); slack earns nothing |
| Current | 25 | NOAA predicted current (kt) where a station is within 1.5 mi, else water-level speed (ft/h). 70% against the station's usual peak, 30% against 1 kt (or 0.3 ft/h). Bay spots: a 5–15 mph wind can stand in, up to 60% |
| Solunar | 10 | Major and minor moon periods overlapping dawn or dusk |
| Pressure | 6 | Least-squares trend across all 24 hourly readings, in mb/day |
| Rain chance | 4 | Mean probability through the day |
| Sea state | 5 | 1–3 ft with a 7s+ swell period, surf/jetty/offshore only |
| Slack-water holes | bonus, up to 10 | Deep water within 300 m (NOAA depth), earned only for the slack share of the time scored |

### Best hours

Each spot's detail view and the Best bet banner show the best stretch of the day by
the app's own score: the model is run for each of the 24 hours, and the top hour plus
any neighbours within 3 points is reported with the reason (bait direction and speed,
wind exposure, slack over deep water). It replaces the old dawn/dusk "best window",
which favoured those times by assumption. It is computed only for what is on screen.

### Wind exposure: open water upwind

`FETCH` in `index.html` holds, for every spot, the miles of open water in 16
compass directions. It is generated by `node tools/compute-fetch.js` from
OpenStreetMap coastline (which traces bay and lagoon shores and spoil islands), so
rerun it after adding or moving a spot. A spot up to 150 m inland is treated as
standing on the bank, since atlas GPS for wade spots often lands there. The day's
speed-weighted wind direction is read from the table, blended with the two
neighbouring directions because the wind wanders. Under 0.5 mi is labelled
protected, under 3 mi partly exposed, otherwise exposed.

### Bait flow: spot roles

Every spot has a role in `SPOT_ROLES`, which sets the tide direction that brings
bait to the fish:

| Role | Wants | Why |
| --- | --- | --- |
| `pass` | incoming | a rising tide carries bait in from the Gulf |
| `surf` | incoming | a rising tide pushes bait into the guts along the beach |
| `flat` | incoming | rising water pushes bait up onto the flats and shoreline |
| `mouth` | outgoing | a falling tide flushes bait out of the cove or marsh past the mouth |
| `dropoff` | outgoing | a falling tide pulls bait off the flats onto the edge |
| `cut` | either | bait funnels through on either tide |
| `structure` | either | pilings, spoils and rocks hold fish while the water moves |

**The roles are drafted judgments**, from spot names and atlas notes, and need
review against local knowledge. The detail view explains each spot's wind, bait-flow
and current score in plain words.

### Pushed in or pulled out: NOAA current predictions

Every row has a **Bait** line with the time ranges, inside the time being scored, when
water flows in (bait pushed in), flows out (bait pulled out) or is slack, with ✓ when
that is what the spot's role wants and ✗ when it is not. A slack spell under 45 min
between two flows is the turn itself and is split between them. The detail view
lists the whole day, with each flow's peak. Where a NOAA current-prediction
station is within 1.5 mi (`CURRENT_MAX_MI`), this comes from its predicted flood and
ebb every 30 minutes, and the detail view charts it. That covers 12 stations and
about half the spots, including every pass, bridge and channel around Port Isabel.
Elsewhere it comes from the water level: rising reads as in, falling as out. Tide
data is fetched from the day before, so stations that publish only high/low times
have a curve from midnight and the dawn window is never blank.

### Slack-water holes: NOAA depth

`DEPTH` in `index.html` holds, for every spot, the bottom within 300 m, generated by
`node tools/compute-depth.js` from NOAA NCEI's coastal elevation model (CUDEM, about 3 m
detail) through its public ImageServer. A grid every 25 m is sampled; below 0 m
NAVD88 counts as water. Recorded in feet: depth at the spot, typical (median) depth,
the deep water nearby (mean of the deepest 5% of cells) and where it is, and relief =
deep − typical. Rerun it after adding or moving a spot.

When the water goes slack, fish drop into holes, pockets and channels. The bonus is
10 × (share of the scored time that is slack) × hole value, where hole value is 0 below
1 ft of relief and 1 at 5 ft or more. Capping it at 5 ft keeps a spot next to a 40 ft
ship channel from outranking a good 5 ft pocket. It is not scaled for bay spots, and
since it is only earned while bait flow and current score nothing, the total stays
within 100 (and is clamped). NAVD88 sits close to mean water here, so depths read as
roughly mid tide; the model is built from surveys up to about 2020, and holes shift.

**The model is checked against the nautical chart.** For each spot the tool compares
the model with every NOAA ENC chart sounding within 1 km. Where fewer than 75% agree
within 3 ft the spot is marked `conflict` and earns no hole bonus: the chart is the
surveyed record, and parts of the model in the Laguna Madre are plainly wrong (11-33 ft
where the chart shows 1-3 ft along the ICW near 26.10-26.15 N). Spots with fewer than 3
soundings nearby are `unchecked` and say so in the detail view.

### Current: why relative to the station

Laguna Madre tides are often under a foot, while Gulf passes run several. Scoring
only absolute speed would bury every Laguna spot, so most of the current score
compares the day's speed with that station's median daily peak over the forecast.
In a bay a steady wind moves water too, so for bay spots a 5 mph wind counts as 0
and 15 mph as 60% of full current, whichever of tide and wind is larger.

Two signals sit **outside** the score, because they're go/no-go calls rather than
gradients: `FRONT` (pressure falling faster than 4 mb/day) and `BLOWN OUT`
(averaging over 22 mph).

Water temperature is displayed but **not scored** — adding it would change every
number in the model, and that's a deliberate decision to make rather than drift into.

## Things worth knowing before you change anything

**All times are US Central, everywhere, regardless of where the page is opened.**
NOAA (`time_zone=lst_ldt`) and Open-Meteo (`timezone=America/Chicago`) both return
timestamps with no UTC offset — `"2026-09-19 06:00"`. Passing one of those to
`new Date()` resolves it in *the viewer's* timezone, which silently shifts every
tide turn and solunar window by the difference. Everything goes through
`parseCT()` instead. If you add a new data source, route its timestamps through
`parseCT()` too.

**The lunar maths is an abridged theory, not a toy.** `moonGeo()` carries the 13
main periodic terms in longitude and 8 in latitude from Meeus' *Astronomical
Algorithms*. Rise and set are interpolated between scan steps and corrected for
horizontal parallax and refraction. Expect a few minutes of error — not
navigation-grade, but far better than the single-term approximation it replaced.

**Open-Meteo is called with comma-joined coordinates**, which returns one object
per location and turns 110 requests into 2. `fetchGridBatched()` falls back to
per-spot requests if the batched call is rejected or comes back the wrong shape.

**Tide data is fetched per station, not per spot** — nearby spots share a NOAA
station. Subordinate stations that publish only high/low times get their curve
reconstructed by half-cosine interpolation between turns, and the chart says so.

Responses cache in `sessionStorage` for 30 minutes; failures retry with
exponential backoff.

## Verifying the astronomy

```sh
node tools/verify-astronomy.js
```

This pulls the real functions out of `index.html` rather than duplicating them,
so it can't drift from the app. It checks Central-time parsing across both DST
states, the synodic month, and moonrise cadence.

The load-bearing check is physical: **a full moon rises at sunset, by definition.**
For 29 June 2026 at Galveston South Jetty the app computes moonrise at 8:36 PM
against a sunset of roughly 8:26 PM. Ten minutes of agreement there exercises the
lunar terms, the hour-angle maths, and the Central-time conversion all at once —
if any one of them were wrong, that number would not land.

## Not yet verified against live APIs

The environment this was rebuilt in blocks outbound access to NOAA and Open-Meteo,
so the astronomy and layout were verified but the live responses were not. The
assumptions to check on first real run, highest risk first:

1. **Open-Meteo multi-location returns a JSON array** in location order. There's a
   fallback if not, but it has not been exercised against the real API.
2. **`sea_surface_temperature` coverage for bay points.** Baffin Bay and Port
   O'Connor may sit outside the marine grid; they should degrade to no water temp
   rather than failing the spot.
3. **Which stations return hourly tide data** versus high/low only, and therefore
   how often the reconstructed curve is used.
