# Route IQ: open items

Things that still need deciding, testing in the field, or building. Newest notes at the end of
each section. When an item is done, move it to **Done** at the bottom with the date.

## Map Lens (Routing → Map Lens)

- [ ] **Road-test navigation.** Drive a route with Navigate and Voice on, tablet mounted. Note
      missed or wrong turns, prompts too early or late, and whether "Head to … on the right"
      makes sense.
- [ ] **Check arrows and Start/End pins** on a real route. M-1-2: 82 of 91 blocks got a driving
      direction from the GPS; the rest need Arrows mode or stay without arrows.
- [ ] **Print a handout on real 11x17 paper**, both "1 sheet, zoomed out" and "2 sheets, closer
      in", and pick which reads better for drivers.
- [ ] **Rebuild the routes whose screenshot maps were retired** (needs a Lytx Location History
      export for each): M-2-1, M-2-2, M-2-3, M-2-4, M-5-1 (Canton Recycle), MR-56 (Canton
      Recycle Side 2).
- [ ] **No way to delete a map** (draft or published on the tablet). Also needed to clear the
      old copy after renaming a map that's in the app's library.
- [ ] **Street downloads depend on a free public server** (Overpass, overpass-api.de): about
      30 s per route, sometimes much slower or failing. Watch how often it fails; options are
      a paid/self-hosted server or shipping street data with the app.
- [ ] **Sharing a Lytx .xlsx to Route IQ from the share sheet** goes to Route Sheets' import, not
      Map Lens. Use Map Lens' Import button for now; could route by the file's columns.
- [ ] **Route list will need search/sort** (by route, driver, service day) once there are many maps.
- [ ] **Old screenshot-map drafts** may still sit in the tablet's storage (fleetMgrMapLens). Harmless;
      clear them sometime.
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

- 2026-10-22: GPS trail visible on every part of the map; street taps pick the right street;
  Rename / Label for maps; Publish on the tablet without Drive.
- 2026-10-22: New PIN, kept only as a fingerprint (hash) in the code; earlier PINs no longer work.
  The PIN screen is a convenience lock for a shared tablet, not real security.
