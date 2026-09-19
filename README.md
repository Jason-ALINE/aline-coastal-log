# Coastal Log

Fishing conditions for 16 spots on the Texas Gulf Coast, scored 0–100 from live
tide, weather, marine, and lunar data. Four of them are around Port Isabel and
have a **Port Isabel** filter chip.

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

## How the score works

Five components, weighted. Bay-only spots have no meaningful wave data, so their
sea-state weight is redistributed proportionally across the rest and the total
still tops out at 100.

| Component | Points | Basis |
| --- | --- | --- |
| Tide movement | 30 | Daily range (18) plus a bonus for a turn near dawn or dusk (12) |
| Solunar | 25 | Major (moon overhead/underfoot) and minor (moonrise/set) periods overlapping dawn or dusk, plus a new/full moon bonus |
| Wind | 14 | 5–15 mph is the sweet spot; calm and >20 mph both give up points |
| Pressure | 10 | Least-squares trend across all 24 hourly readings, in mb/day |
| Rain chance | 6 | Mean probability through the day |
| Sea state | 15 | 1–3 ft with a 7s+ swell period, surf/jetty/offshore only |

### Per-spot wind exposure and tide phase

Spots may carry two optional fields in `SPOTS`. A spot without them is scored
exactly as in the table above.

```js
wind:  {exposed:["E","SE"], sheltered:["SW","W","NW"]},   // 8-point compass, wind FROM
phase: "incoming"                                          // or "outgoing"
```

- **Wind:** the day's speed-weighted mean wind direction is rounded to the nearest
  of eight compass points. Sheltered scales the effective speed by 0.7, exposed by
  1.25, then the usual 14-point wind curve applies. It only changes the score when
  that scaling crosses a bracket edge (5, 15, 20 or 25 mph), so on light days it does
  nothing. The `FRONT` / `BLOWN OUT` flags still use the real wind.
- **Phase:** the share of the dawn and dusk windows (sunrise/sunset ±90 min) in which
  the tide moves the preferred way, at more than 0.08 ft/h, earns up to 6 of the 30
  tide points. For these spots the dawn/dusk turn bonus drops from 12 to 6, so the
  tide component still tops out at 30. Slack water earns nothing.
- The detail view says whenever an adjustment applied.

**The values are judgments, not measurements.** The four Port Isabel-area spots
(Isla Blanca Jetties, Boca Chica, Port Isabel Shoreline, Queen Isabella Causeway)
were tagged from coastline geometry and general practice (jetties on the make, bay
shorelines on the fall), not from the atlas. Review them, and add the two fields to
any other spot to opt it in. Port Isabel-area coordinates for the two new spots are
NOAA station positions, to be replaced by real hotspot GPS.

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
per location and turns 28 requests into 2. `fetchGridBatched()` falls back to
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
