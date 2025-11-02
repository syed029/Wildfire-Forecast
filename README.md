
# Wildfire Frontend (Static Preview)

This is a lightweight, computation-free preview. It reads precomputed JSON and renders
a U.S. map (states) with a county drilldown for selected states.

## Run locally
```bash
python -m http.server 8000
# then open http://localhost:8000
```

## Files
- `index.html` — main page
- `assets/css/styles.css` — styles
- `assets/js/config.js` — runtime config (switch to Firebase later)
- `assets/js/app.js` — Leaflet logic
- `data/sample_states.json` — sample state-level TLDR
- `data/sample_counties_CA.json`, `data/sample_counties_OR.json` — sample county data

## Notes
- States GeoJSON is loaded from GitHub raw (internet required).
- County GeoJSON is fetched from U.S. Census TIGERweb (internet required).

Replace the sample JSONs with your exported ESN forecasts when ready.
