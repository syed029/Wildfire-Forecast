#!/usr/bin/env python3
"""
Merge LACoFD battalions into 4 parts.

Inputs (either):
  A) geo/lacofd_battalions.geojson (or any vector format readable by GeoPandas)
     with a column like "battalion" or "BATTALION".
  B) Fallback: None -> we will generate 4 polygons from the incidents themselves
     (handy for testing before you have the battalion file).

Outputs:
  geo/la_parts.geojson   (4 dissolved polygons with: part_id=1..4, name)
"""
import sys, json
from pathlib import Path
import numpy as np
import pandas as pd
import geopandas as gpd
from shapely.ops import unary_union
from sklearn.cluster import KMeans

ROOT = Path(__file__).resolve().parents[1]
INC_CSV = ROOT / "assets" / "incidents.csv"                # <- your big WFIGS dump
BATTALION_PATH = ROOT / "geo" / "lacofd_battalions.geojson"  # <- optional
OUT_PATH = ROOT / "geo" / "la_parts.geojson"


def load_la_points():
    df = pd.read_csv(INC_CSV, low_memory=False)
    # WFIGS uses "US-CA" for CA; LA county text varies consistently as 'Los Angeles'
    df = df[(df["POOState"] == "US-CA") & (df["POOCounty"].str.contains("Los Angeles", case=False, na=False))]
    # Use InitialLatitude/InitialLongitude (present in your file)
    df["lat"] = df.get("lat", df.get("InitialLatitude"))
    df["lon"] = df.get("lon", df.get("InitialLongitude"))
    df = df[np.isfinite(df["lat"]) & np.isfinite(df["lon"])]
    return gpd.GeoDataFrame(df, geometry=gpd.points_from_xy(df["lon"], df["lat"]), crs="EPSG:4326")

def kmeans_4_parts_from_points(gdf):
    # cluster on lon/lat
    coords = np.c_[gdf.geometry.x.values, gdf.geometry.y.values]
    km = KMeans(n_clusters=4, n_init=10, random_state=42)
    gdf = gdf.copy()
    gdf["part_id"] = km.fit_predict(coords) + 1
    rows = []
    for pid, sub in gdf.groupby("part_id"):
        hull = unary_union(sub.geometry).convex_hull.buffer(0)
        rows.append({"part_id": int(pid), "name": f"LA Part {pid}", "geometry": hull})
    return gpd.GeoDataFrame(rows, crs="EPSG:4326")

def dissolve_battalions_to_4_parts(battalions_gdf, mapping=None):
    """
    mapping: dict[int|str -> int]   e.g. { '1':1, '2':1, '3':2, ... }  -> 4 labels only
    If mapping is None, we auto-cluster battalion centroids to 4 groups.
    """
    g = battalions_gdf.to_crs(4326).copy()
    # choose id column
    idcol = None
    for c in ["battalion","BATTALION","Battalion","BATTLION","BAT_ID"]:
        if c in g.columns: idcol = c; break
    if idcol is None:  # best effort
        g[idcol := "battalion"] = range(1, len(g)+1)

    if mapping is None:
        # Auto 4 groups from centroids
        xy = np.c_[g.geometry.centroid.x, g.geometry.centroid.y]
        lab = KMeans(n_clusters=4, n_init=10, random_state=42).fit_predict(xy) + 1
        g["part_id"] = lab
    else:
        g["part_id"] = g[idcol].astype(str).map(lambda x: mapping.get(x, np.nan))
        if g["part_id"].isna().any():
            raise ValueError("Mapping missing some battalions")

    parts = (
        g.groupby("part_id")
         .agg({"geometry":"unary_union"})
         .reset_index()
         .assign(name=lambda d: d["part_id"].map(lambda x: f"LA Part {int(x)}"))
    )
    return gpd.GeoDataFrame(parts, crs="EPSG:4326")

def main():
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    if BATTALION_PATH.exists():
        batt = gpd.read_file(BATTALION_PATH)
        # (Option 1) provide an explicit mapping here when you know which battalions roll up together:
        # battalion_to_part = {'1':'1','2':'1','3':'2','4':'2','5':'3','6':'3','7':'4','8':'4', ...}
        battalion_to_part = None
        parts = dissolve_battalions_to_4_parts(batt, mapping=battalion_to_part)
    else:
        # Fallback so you can test now
        la_pts = load_la_points()
        if la_pts.empty:
            raise RuntimeError("No LA incidents found; check the CSV path/columns.")
        parts = kmeans_4_parts_from_points(la_pts)

    parts.to_file(OUT_PATH, driver="GeoJSON")
    print(f"[OK] wrote {OUT_PATH}")

if __name__ == "__main__":
    main()
