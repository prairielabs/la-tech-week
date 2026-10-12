# Fieldtrip · LA Tech Week

An event browser and an optional Semantic Field Cartographer view of LA Tech Week. Made by Prairie Labs. Independent of a16z and Tech Week.

- [Browse events](https://prairielabs.ai/latechweek)
- [Explore Cartographer](https://prairielabs.ai/latechweek/cartographer)

Choose one day at a time, search individual event descriptions, sort events, filter municipalities, LA neighborhoods and places listed elsewhere, or find approximate locations near a US ZIP. Save a week locally, inspect conflicts, export a tentative calendar or share a plan. The builder compares three possibilities for your selected day with adjustable spacing and no fixed stop-count cap.

Events without a listed municipality remain accessible under Elsewhere; structured published address localities appear by name. Virtual events are separate. The 3D Cartographer lives on its own full-screen page with overlaid event controls, a day/time dock and a collapsible event list. A persistent Events / 3D Cartographer switch connects both views. Unknown map coordinates remain unknown.

## Run

Node.js 22 or newer. No dependency installation, account or API key required.

```sh
npm test
npm run fetch-data
npm start
```

Open http://127.0.0.1:8374. Cartographer is at /cartographer/.

`fetch-data` downloads only the already-public Fieldtrip event snapshot and map layers over HTTPS. These data files are deliberately not committed or relicensed as MIT. Review upstream source terms before redistributing data. The app keeps working offline after that download except for external host links and ZIP lookup. To bring your own event data, use the same public JSON shape and preserve source provenance. Scripts validate expected JavaScript assignment prefixes before storing downloaded data, which remains untrusted external content.

## Data and privacy

The hosted snapshot contains 814 events refreshed October 10, 2026 Pacific. Descriptions mostly date to October 7. Host links are the authority for current time, admission and venue. No RSVP is sent by the app. Unknown durations are not invented; multi-day listings are excluded from timed plans.

ZIP lookup uses Zippopotam.us. It sends the entered ZIP, not saved events. Results are straight-line distances to approximate event coordinates, which may be municipality centers. Flexible spacing uses 10 minutes at the same published address, 30 in one municipality and 60 between municipalities; these are editable planning assumptions, not traffic estimates.

Plans stay in browser localStorage. Shared URLs contain public event IDs only. No credentials, accounts, provider clients, payments, private company records, engine prompt programs or company database are part of this repository.

## Source and license

MIT applies to the code in this repository, including the dependency-free Cartographer artifact. Fonts retain their SIL Open Font License notices. See THIRD_PARTY_NOTICES.md. Prairie Labs names are attribution and do not grant trademark rights. This repository has a new, independent history and contains only this app's public code and licensed fonts.

`dist/browser-core.js` handles filtering; `dist/routes-core.js` handles planning; `dist/browse.js` owns the primary interface. `dist/cartographer/` contains the optional map/3D interface. No hosted backend or proprietary engine is needed.
