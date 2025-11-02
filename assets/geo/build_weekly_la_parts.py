#!/usr/bin/env python3
# Build weekly incident counts for Los Angeles County split into 4 parts.
# Robust to different date column names and epoch units (s/ms/us/ns).

import argparse
from pathlib import Path
from typing import List, Optional

import pandas as pd

try:
    import geopandas as gpd
except Exception as e:
    gpd = None

DATE_CANDIDATES: List[str] = [
    # common in WFIGS exports
    "FireDiscoveryDateTime",
    "CreatedOnDateTime",
    "CreatedOnDateTime_dt",
    # other seen variants
    "DiscoveryDateTime",
    "IncidentCreateDate",
    "IncidentCreated",
    "Date",
    "date",
]

STATE_CANDIDATES = ["POOState", "IncidentState", "State", "STATE"]
COUNTY_CANDIDATES = ["POOCounty", "IncidentCounty", "County", "COUNTY"]

def parse_dates(series: pd.Series) -> pd.Series:
    """Try to parse dates. If numeric, guess epoch unit by range."""
    s = series.dropna()
    if s.empty:
        return pd.to_datetime(series, errors="coerce", utc=True)

    # If strings, just let pandas parse
    if series.dtype == object:
        return pd.to_datetime(series, errors="coerce", utc=True)

    # If numeric-ish
    if pd.api.types.is_numeric_dtype(series):
        # Try s/ms/us/ns by plausibility of resulting year range (1990..2035).
        for unit in ["s", "ms", "us", "ns"]:
            dt = pd.to_datetime(series, unit=unit, errors="coerce", utc=True)
            nonnull = dt.dropna()
            if nonnull.empty:
                continue
            yr_min = nonnull.dt.year.min()
            yr_max = nonnull.dt.year.max()
            if 1990 <= yr_min <= 2035 and 1990 <= yr_max <= 2035:
                print(f"[INFO] Detected epoch unit '{unit}'")
                return dt
        # Fallback: let pandas guess (may be wrong)
        print("[WARN] Could not confidently detect epoch unit; letting pandas infer")
        return pd.to_datetime(series, errors="coerce", utc=True)

    # Fallback
    return pd.to_datetime(series, errors="coerce", utc=True)

def first_existing(df: pd.DataFrame, candidates: List[str]) -> Optional[str]:
    for c in candidates:
        if c in df.columns:
            return c
    return None

def load_la_incidents(inc_path: str) -> pd.DataFrame:
    df = pd.read_csv(inc_path, low_memory=False)
    # State/County filters
    s_col = first_existing(df, STATE_CANDIDATES)
    c_col = first_existing(df, COUNTY_CANDIDATES)
    if not s_col or not c_col:
        raise ValueError(f"Missing state/county columns. Have: {list(df.columns)[:20]}...")

    df[c_col] = df[c_col].astype(str)
    mask = df[s_col].isin(["US-CA", "CA"]) & df[c_col].str.contains("Los Angeles", case=False, na=False)
    df = df.loc[mask].copy()
    print(f"[INFO] Filtered to LA County, CA: {len(df):,} rows")

    # Coords
    lat_col = "lat" if "lat" in df.columns else "InitialLatitude" if "InitialLatitude" in df.columns else None
    lon_col = "lon" if "lon" in df.columns else "InitialLongitude" if "InitialLongitude" in df.columns else None
    if not lat_col or not lon_col:
        raise ValueError("Latitude/Longitude columns not found (looked for lat/lon or InitialLatitude/InitialLongitude).")

    df["lat"] = pd.to_numeric(df[lat_col], errors="coerce")
    df["lon"] = pd.to_numeric(df[lon_col], errors="coerce")
    df = df[df["lat"].notna() & df["lon"].notna()].copy()
    print(f"[INFO] After coord cleanup: {len(df):,} rows")

    # Dates
    d_col = first_existing(df, DATE_CANDIDATES)
    if not d_col:
        raise ValueError(f"Could not find a date column among {DATE_CANDIDATES}")
    dt = parse_dates(df[d_col])
    df = df.loc[dt.notna()].copy()
    dt = dt.loc[dt.notna()]
    print(f"[INFO] Parsed dates ({d_col}). Range: {dt.min()} -> {dt.max()}")

    # Monday-anchored weeks
    df["week_start"] = dt.dt.to_period("W-MON").dt.start_time.dt.date
    return df

def aggregate_weekly(df: pd.DataFrame, parts_geojson: str) -> pd.DataFrame:
    if gpd is None:
        raise RuntimeError("geopandas is required for spatial join but is not installed in this environment.")
    gparts = gpd.read_file(parts_geojson).to_crs(4326)
    expect = {"part_id", "geometry"}
    if not expect.issubset(set(gparts.columns)):
        raise ValueError(f"Parts geojson must contain columns {expect}, found {set(gparts.columns)}")
    print(f"[INFO] Loaded parts: {len(gparts)} polygons")

    g = gpd.GeoDataFrame(df, geometry=gpd.points_from_xy(df["lon"], df["lat"]), crs=4326)
    joined = g.sjoin(gparts[["part_id", "geometry"]], predicate="within", how="left")
    n_none = joined["part_id"].isna().sum()
    print(f"[INFO] Spatial join: matched={len(joined)-n_none:,} unmatched={n_none:,}")
    joined = joined.dropna(subset=["part_id"]).copy()
    joined["part_id"] = joined["part_id"].astype(int)

    weekly = joined.groupby(["week_start", "part_id"]).size().unstack("part_id", fill_value=0)
    # guarantee 4 cols
    for pid in (1,2,3,4):
        if pid not in weekly.columns:
            weekly[pid] = 0
    weekly = weekly[[1,2,3,4]]

    # Full weekly range
    weeks = pd.period_range(weekly.index.min(), weekly.index.max(), freq="W-MON").start_time.date
    weekly = weekly.reindex(weeks, fill_value=0)
    weekly.columns = [f"CA|Los Angeles|Part{pid}" for pid in (1,2,3,4)]
    weekly = weekly.reset_index(names="week_start")
    weekly["week_start"] = weekly["week_start"].astype(str)

    print(f"[OK] weekly matrix shape = {weekly.shape}, weeks={weekly['week_start'].nunique()}")
    return weekly

def build(inc: str, parts: str, out_csv: str):
    df = load_la_incidents(inc)
    weekly = aggregate_weekly(df, parts)
    Path(out_csv).parent.mkdir(parents=True, exist_ok=True)
    weekly.to_csv(out_csv, index=False)
    print(f"[OK] wrote {out_csv}")

def main():
    inc="incidents.csv"
    parts="la_parts.geojson"
    out="weekly_matrix_la_parts.csv"
    build(inc, parts, out)

if __name__ == "__main__":
    main()
