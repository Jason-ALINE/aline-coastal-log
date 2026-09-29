# Backlog — Coastal Log

Work HANDOFF.md first. Everything here assumes the live API contracts have been
verified; tuning a scoring model on top of unverified data plumbing wastes the work.

**A note on authority.** Tier 1 items are genuine modelling weaknesses — the code
provably ignores information it already has. But the *specific* thresholds and
weights are judgement calls that should come from someone who actually fishes the
Texas coast, not from an inherited heuristic. Where an item says "Jason decides",
it means the engineering is clear and the fishing knowledge is not ours to invent.

---

## Tier 1 — The model ignores data it already fetches

### 1. Wind direction is displayed but never scored

**Done (2026-09-29).** Scored as wind exposure: open water upwind of each spot in 16
directions, from OpenStreetMap (`FETCH`, `tools/compute-fetch.js`). See README.

**The gap.** `windScore14()` takes only `avgMph`. A 12 mph SE wind and a 12 mph N
wind score identically. On the Texas coast they are not remotely the same day: a
moderate onshore southeast wind is the classic pattern, while a post-frontal north
wind muddies the surf, pushes water out of the bays and drops levels by a foot or
more. The app computes `windDirAvg` correctly and then throws the information away.

**Why it is the biggest item.** This is the single largest divergence between the
score and reality, and it costs nothing in new data — the direction is already in
hand.

**Implementation sketch.** Each spot needs a shoreline orientation (the compass
bearing of open water from the bank). Add a `facing` degrees field to the `SPOTS`
array, compute the angle between `windDirAvg` and `facing`, and modify the wind
component: onshore moderate scores best at surf and jetty spots; offshore light
can be *good* in bays (clean water, calm lee) and bad in the surf. That asymmetry
between spot types matters.

**Jason decides:** the magnitude of the direction penalty and bonus, and whether a
light offshore wind should help or hurt at each spot type.

### 2. Tide range is a proxy for what actually matters — current

**Done (2026-09-29).** Current is scored from NOAA current predictions where a station
is within 1.5 mi, otherwise from the water-level rate, and bait direction (pushed in /
pulled out) is shown and scored per spot role. See README.

**The gap.** `tideScore30()` uses `max - min` across the day. Two days can share an
identical 1.8 ft range while one moves it in four hours (strong current) and the
other drags it over twelve (nearly slack). Fish respond to moving water, not to the
arithmetic difference between the day's extremes.

**Implementation sketch.** The hourly curve is already in `m.tide.dayCurve`. Compute
the maximum rate of change in ft/hr, and specifically the rate *during the best
window* rather than across the whole day. Score on that instead of, or alongside,
range. This is a strict improvement with no new data.

### 3. Tide and solunar are summed independently when coincidence is the point

**Open, with a constraint.** The user asked for no time-of-day bias, so any
coincidence bonus must not favour dawn or dusk; it could reward a solunar period
landing on strong flow within the time being scored.

**The gap.** The score adds tide movement and solunar separately. But a major
solunar period that lands *on* a strong outgoing tide at dawn is not the sum of
three good things — it is the specific alignment every experienced angler watches
for, and it should be worth more than its parts.

**Implementation sketch.** `computeDayModel()` already builds `hitWindows` and
`nearTurns`. Add a coincidence bonus when a major solunar window overlaps a tide
turn *and* a dawn/dusk window. Keep it capped so the total still tops out at 100.

**Note:** this changes the meaning of every score. Do it deliberately, and update
the modal copy and README table when you do.

---

## Tier 2 — Data the app does not yet pull

### 4. Freshwater inflow after rain

Heavy rain upstream drops bay salinity for days and pushes fish out of the upper
bays — a real and predictable effect the app is blind to. USGS has free gauge data
(`waterservices.usgs.gov`) for the Trinity, Brazos, Colorado, Guadalupe and Nueces.
No key required. Worth it mainly for the bay spots.

### 5. Water clarity

The most-asked question before a trip and the hardest to get programmatically.
There is no clean free API. Options: satellite turbidity (coarse, cloud-blocked),
or a manual "last known clarity" note per spot that Jason updates. **Recommend
deferring** — a wrong clarity reading is worse than none.

---

## Tier 3 — Product

### 6. The app is called a log and logs nothing

Name implies a catch record. Adding one — date, spot, species, count, conditions
auto-captured from that day's score — would build a personal dataset, and after a
season it could be checked against the score to see whether the heuristic actually
predicts anything. That is the feature that would turn this from a forecast into a
tool that learns. It also means real storage: `localStorage` is per-browser and
per-device, so a log that matters needs somewhere durable.

### 7. Score weights are hardcoded

Every threshold sits in a constant. A settings panel exposing the six component
weights would let Jason tune to his own experience instead of accepting the
inherited model. Pairs naturally with item 6 — log first, tune on evidence.

### 8. Deep links

No way to share "Freeport, Thursday". A URL hash carrying spot and day index is
maybe twenty lines and makes the app textable.

### 9. Forecast horizon honesty

The app shows 8 days uniformly, but marine forecast skill degrades badly past about
5. Consider visually de-emphasising days 6–8, or labelling them lower-confidence,
rather than presenting day 8 with the same authority as tomorrow.

---

## Explicitly not doing

- **Water temperature in the score.** Displayed deliberately, excluded
  deliberately. Adding it changes every number. Jason's call, not an oversight.
- **A build step.** One file that runs by double-clicking is a product decision.
  No npm, no bundler, no framework.
- **Rewriting the astronomy.** It is validated against a physical identity (a full
  moon rises at sunset) and that check must keep passing.
