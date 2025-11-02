#!/usr/bin/env python3
# clip_to_lacounty.py
# Read an existing GeoJSON (your old la_parts.geojson) and clip it to the
# Los Angeles County boundary so nothing extends outside the county.

import argparse
from pathlib import Path
import json
import urllib.request

import geopandas as gpd
from shapely.geometry import shape
from shapely.ops import unary_union

# Census counties GeoJSON (we'll pick FIPS 06037 = Los Angeles County)
CENSUS_COUNTIES_URL = "https://raw.githubusercontent.com/plotly/datasets/master/geojson-counties-fips.json"

def load_la_boundary_geom(local_path: str | None = None):
    """Return a shapely (Multi)Polygon for LA County in EPSG:4326."""
    if local_path and Path(local_path).exists():
        b = gpd.read_file(local_path).to_crs(4326)
        return unary_union(b.geometry).buffer(0)

    with urllib.request.urlopen(CENSUS_COUNTIES_URL) as f:
        gj = json.load(f)
    for feat in gj["features"]:
        fid = str(feat.get("id") or feat.get("properties", {}).get("GEOID") or "")
        if fid == "06037":  # Los Angeles County
            return shape(feat["geometry"])
    raise RuntimeError("Could not find LA County boundary (FIPS 06037).")

def clip_gdf_to_geom(gdf: gpd.GeoDataFrame, geom):
    g = gdf.to_crs(4326).copy()
    # fix invalids first, then intersect with the county polygon
    g["geometry"] = g.geometry.buffer(0).intersection(geom).buffer(0)
    g = g[~g.is_empty & g.geometry.notna()].reset_index(drop=True)
    return g

def main():
    ap = argparse.ArgumentParser(description="Clip an existing GeoJSON to LA County boundary.")
    ap.add_argument("--in", dest="inp", default="la_parts.geojson", help="Input GeoJSON (old file).")
    ap.add_argument("--out", dest="out", default="la_parts_clipped.geojson", help="Output GeoJSON.")
    ap.add_argument("--la-boundary", dest="la_boundary", default="",
                    help="Optional local LA County boundary GeoJSON; if omitted, uses Census FIPS 06037.")
    args = ap.parse_args()

    inp = Path(args.inp)
    if not inp.exists():
        raise FileNotFoundError(f"Input not found: {inp}")

    parts = gpd.read_file(inp)
    try:
        parts = parts.to_crs(4326)
    except Exception:
        pass

    la_geom = load_la_boundary_geom(args.la_boundary or None)

    clipped = clip_gdf_to_geom(parts, la_geom)

    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    clipped.to_file(args.out, driver="GeoJSON")

    # small summary
    orig_area = parts.to_crs(3857).area.sum()
    new_area  = clipped.to_crs(3857).area.sum()
    print(f"[OK] Wrote {args.out}")
    print(f"     Features: {len(clipped)}   Area trimmed: {(orig_area - new_area):,.0f} m²")

if __name__ == "__main__":
    main()
