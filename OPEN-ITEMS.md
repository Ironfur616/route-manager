# Route IQ: open items

Things that still need deciding, testing in the field, or building. Newest notes at the end of
each section. When an item is done, move it to **Done** at the bottom with the date.

## Map Lens (Routing → Map Lens)

- [ ] **Road-test navigation.** Drive a route with Navigate and Voice on, tablet mounted. Note
      missed or wrong turns, prompts too early or late, and whether "Head to … on the right"
      makes sense.
- [ ] **Navigation order follows one recorded GPS day.** Since 2026-10-22 each GPS point counts
      for one street only, the order uses the pass where the truck spent the most time, and the
      blocks between points are inferred along highlighted streets (M-1-2: 86 of 91 blocks in
      order, jumps 16 → 11). Remaining jumps are where the truck really drove other streets. If
      the recorded day isn't how the route should be run, add a way to set the order by hand.
- [ ] **Check arrows and Start/End pins** on a real route. M-1-2: 82 of 91 blocks got a driving
      direction from the GPS; the rest need Arrows mode or stay without arrows.
- [ ] **Print a handout on real 11x17 paper**, both "1 sheet, zoomed out" and "2 sheets, closer
      in", and pick which reads better for drivers.
- [ ] **Rebuild the routes whose screenshot maps were retired** (needs a Lytx Location History
      export for each): M-2-1, M-2-2, M-2-3, M-2-4, M-5-1 (Canton Recycle), MR-56 (Canton
      Recycle Side 2).
- [ ] **Street downloads depend on one free public server** (Overpass, overpass-api.de): 30-45 s
      per route on a normal day, sometimes failing (it now retries once and shows a timer; the
      mirrors tried were down). The real fix is a different street source, e.g. free vector map
      tiles from a fast CDN, which needs its own street-cutting since tiles have no OSM way IDs.
- [ ] **Printing pulls many map tiles from OpenStreetMap.** Fine at today's volume; if printing
      gets heavy, switch to a tile provider meant for it (OSM's usage policy).

## Service Requests (formerly Missed Collections)

- [ ] **"Under RCA Investigation" doesn't link to the RCA tracker.** Choosing it could offer to
      open an RCA case filled in with the address and request details.
- [ ] **Reason list is built for missed pickups.** Add reasons for other customer call-ins as they
      come up.
- [ ] **Bulk Pickup Requests could become a request type** here instead of its own page.
- [ ] **Default view:** consider showing only open requests, with resolved ones tucked away like
      Archived.

## Route Sheets / house lists (route sequencing groundwork)

- [ ] **RouteSmart values for commercial rear-load stops** (they share routes with residential).
- [ ] **RouteSmart Frequency_Code value** to use (unconfirmed).
- [ ] **Navusoft/Zigenx export:** column headings still needed.
- [ ] **Washington city house list:** plan to come (MR-56 only covers East Washington).
- [ ] **Import cleanup rules** (capitalization, spelled-out road types on screen / short in exports,
      N/S/E/W directions) and **RouteSmart/Navusoft exports:** confirm what's built and what's left.

## Whole app

- [ ] **Shared data across tablets (Firestore).** On hold while only one tablet runs the app.
      Would let published maps, and later Service Requests and Route Sheets, sync to every tablet.
- [ ] **Google Drive sign-in is in Testing mode** in the Cloud project: anyone else who backs up or
      publishes to Drive must be added as a test user, or the app published.

## Done

- 2026-10-22: Map Lens: delete a map (card trash icon or ⋯ → Delete Map); route list search and
  sort; GPS exports shared to Route IQ go to Map Lens; old screenshot drafts cleared; street
  download retries once with a timer.
- 2026-10-22: GPS trail visible on every part of the map; street taps pick the right street;
  Rename / Label for maps; Publish on the tablet without Drive.
- 2026-10-22: New PIN, kept only as a fingerprint (hash) in the code; earlier PINs no longer work.
  The PIN screen is a convenience lock for a shared tablet, not real security.
