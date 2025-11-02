# import argparse
# import time
# from typing import Dict, Any, Iterable

# import pandas as pd
# import firebase_admin
# from firebase_admin import credentials, firestore
# from google.oauth2 import service_account
# import json, os, sys

# def debug_sa(sa_path):
#     with open(sa_path, "r", encoding="utf-8") as f:
#         data = json.load(f)
#     print("SA email:      ", data.get("client_email"))
#     print("SA project_id: ", data.get("project_id"))
#     print("Private key id:", data.get("private_key_id"))
#     # Try creating creds explicitly (will raise if malformed)
#     service_account.Credentials.from_service_account_info(data, scopes=["https://www.googleapis.com/auth/datastore"])
#     print("Credentials object created OK (format looks valid)")

# # ----------------------------- Firestore helpers -----------------------------
# def init_db(sa_path: str):
#     if not firebase_admin._apps:
#         cred = credentials.Certificate(sa_path)
#         firebase_admin.initialize_app(cred)
#     return firestore.client()


# def chunked(iterable: Iterable, size: int):
#     buf = []
#     for x in iterable:
#         buf.append(x)
#         if len(buf) >= size:
#             yield buf
#             buf = []
#     if buf:
#         yield buf


# def upsert_state_doc(db, state: str, fields: Dict[str, Any]):
#     """
#     Upserts the state TLDR fields DIRECTLY on states/{STATE}.
#     No subcollection/subdocument.
#     """
#     state = state.upper()
#     state_ref = db.collection("states").document(state)
#     # ensure a simple 'state' field exists and then merge TLDR fields
#     state_ref.set({"state": state}, merge=True)
#     state_ref.set(fields, merge=True)


# def upsert_counties(db, state: str, rows: pd.DataFrame, batch_size: int = 450):
#     """Upserts all county docs under states/{STATE}/counties/{GEOID}."""
#     if rows is None or rows.empty:
#         return
#     state = state.upper()
#     coll = db.collection("states").document(state).collection("counties")

#     # guarantee strings for ids
#     rows = rows.copy()
#     rows["geoid"] = rows["geoid"].astype(str).str.zfill(5)

#     for chunk in chunked(rows.to_dict(orient="records"), batch_size):
#         batch = db.batch()
#         for rec in chunk:
#             geoid = rec.pop("geoid")

#             # normalize some helpful fields
#             rec["state"] = state
#             if "county_name" in rec:
#                 rec["county_name"] = str(rec["county_name"])

#             # explicit ints for numeric-ish fields if present
#             for k in (
#                 "last_week_count",
#                 "last_month_count",
#                 "next_week_forecast",
#                 "next_month_forecast",
#                 "total_to_date",
#                 "total_tilldate",
#             ):
#                 if k in rec and rec[k] is not None and rec[k] != "":
#                     try:
#                         rec[k] = int(rec[k])
#                     except Exception:
#                         pass

#             batch.set(coll.document(geoid), rec, merge=True)
#         batch.commit()


# # ----------------------------- CSV loading -----------------------------
# def _read_csv(path: str | None) -> pd.DataFrame | None:
#     if not path:
#         return None
#     df = pd.read_csv(path, dtype=str).fillna("")
#     return df


# def load_counties_csv(path: str) -> pd.DataFrame:
#     df = _read_csv(path)
#     if df is None:
#         raise ValueError("counties CSV path is required")

#     # Basic columns (we don't force all TLDR cols; we just pass through if present)
#     for need in ["state", "geoid"]:
#         if need not in df.columns:
#             raise ValueError(f"counties CSV missing required column: '{need}'")

#     # Coerce numeric-ish fields if present
#     for c in [
#         "last_week_count",
#         "last_month_count",
#         "next_week_forecast",
#         "next_month_forecast",
#         "total_to_date",
#         "total_tilldate",
#     ]:
#         if c in df.columns:
#             df[c] = pd.to_numeric(df[c], errors="coerce").fillna(0).astype(int)

#     return df


# def load_state_csv(path: str | None) -> pd.DataFrame | None:
#     df = _read_csv(path)
#     if df is None:
#         return None

#     # Nice-to-have coercions
#     for c in ["total_to_date", "total_tilldate"]:
#         if c in df.columns:
#             df[c] = pd.to_numeric(df[c], errors="coerce").fillna(0).astype(int)
#     return df


# # ----------------------------- Main seeding flow -----------------------------
# def main():
#     ap = argparse.ArgumentParser(description="Seed Firestore with state + county TLDR data.")
#     ap.add_argument("--only-state", "-s", default=None,
#                     help="Seed a single state (e.g., CA). If omitted, seeds union of states from both CSVs.")
#     ap.add_argument("--dry-run", action="store_true", help="Load & summarize, but don't write to Firestore")
#     args = ap.parse_args()

#     # --- paths (adjust if you keep them elsewhere)
#     service_account = "keys/optimum-agent-305714-firebase-adminsdk-fbsvc-6f015e057a.json"
    
#     counties_csv = "data/counties_tldr.csv"
#     states_csv   = "data/states_tldr.csv"
#     debug_sa(service_account)

#     db = init_db(service_account)
#     counties_df = load_counties_csv(counties_csv)
#     states_df   = load_state_csv(states_csv)

#     # Filter counties by --only-state if set
#     if args.only_state:
#         only = args.only_state.upper()
#         counties_df = counties_df.loc[counties_df["state"].str.upper() == only].copy()

#     # Computed totals fallback per state (from county totals)
#     computed_totals = {}
#     if "total_to_date" in counties_df.columns:
#         computed_totals = (
#             counties_df.groupby(counties_df["state"].str.upper())["total_to_date"]
#             .sum(min_count=1).fillna(0).astype(int).to_dict()
#         )

#     # Union of states from both CSVs so states with no counties still get written
#     states_from_counties = set(counties_df["state"].str.upper().unique())
#     states_from_states   = set(states_df["state"].str.upper().unique()) if states_df is not None and "state" in states_df.columns else set()
#     all_states = states_from_counties | states_from_states
#     if args.only_state:
#         all_states = {args.only_state.upper()}

#     for state in sorted(all_states):
#         sub = counties_df.loc[counties_df["state"].str.upper() == state].copy()
#         print(f"\n=== Seeding {state} — {len(sub)} counties ===")

#         # pick state row if present
#         meta_row = None
#         if states_df is not None and "state" in states_df.columns:
#             m = states_df.loc[states_df["state"].str.upper() == state]
#             if not m.empty:
#                 meta_row = m.iloc[0].to_dict()

#         # Build TLDR fields to set on the STATE document
#         # Include your new fields: color, total_tilldate
#         def g(name, default=""):
#             return meta_row.get(name, default) if meta_row else default

#         # Prefer provided totals; fall back to computed totals from counties
        
#         total_till_date  = g("total_till_date", None)

#         state_fields = {
#             "state": state,
#             "state_name": g("state_name", ""),
#             "last_obs_week_start": g("last_obs_week_start", g("last_week_start", "")),
#             "last_obs_week_end":   g("last_obs_week_end",   g("last_week_end", "")),
#             "last_obs_week_count": int(g("last_obs_week_count", "0") or 0),
#             "last_obs_month_start": g("last_obs_month_start", g("last_month_start", "")),
#             "last_obs_month_end":   g("last_obs_month_end",   g("last_month_end", "")),
#             "last_obs_month_count": int(g("last_obs_month_count", "0") or 0),
#             "next_week_start": g("next_week_start", ""),
#             "next_week_end":   g("next_week_end", ""),
#             "next_week_forecast": int(g("next_week_forecast", "0") or 0),
#             "next_month_start": g("next_month_start", ""),
#             "next_month_end":   g("next_month_end", ""),
#             "next_month_forecast": int(g("next_month_forecast", "0") or 0),
#             "total_till_date": total_till_date,
#             "color": g("color", ""),                 # ← NEW
#             "updated_at": g("updated_at", int(time.time())),
#             "source": "seed_script_v2",
#         }

#         if args.dry_run:
#             print("  (dry-run) state fields:", state_fields)
#             if len(sub):
#                 print("  (dry-run) first county row:", sub.iloc[0].to_dict())
#         else:
#             upsert_state_doc(db, state, state_fields)
#             upsert_counties(db, state, sub)

#     print("\nDone.")


# if __name__ == "__main__":
#     main()
# seed_firestore_tldr.py
# Adds SPA seeding: writes rows under states/{STATE}/spas/{SPA_ID}

#!/usr/bin/env python3
# seed_firestore.py
# Seed Firestore with state, county, and SPA TLDR data.

import argparse
import time
from typing import Dict, Any, Iterable
import re
import json
import os
import sys

import pandas as pd
import firebase_admin
from firebase_admin import credentials, firestore
from google.oauth2 import service_account


# ----------------------------- Utilities -----------------------------
def debug_sa(sa_path: str):
    with open(sa_path, "r", encoding="utf-8") as f:
        data = json.load(f)
    print("SA email:      ", data.get("client_email"))
    print("SA project_id: ", data.get("project_id"))
    print("Private key id:", data.get("private_key_id"))
    # Try creating creds explicitly (will raise if malformed)
    service_account.Credentials.from_service_account_info(
        data,
        scopes=["https://www.googleapis.com/auth/datastore"],
    )
    print("Credentials object created OK (format looks valid)")


def init_db(sa_path: str):
    if not firebase_admin._apps:
        cred = credentials.Certificate(sa_path)
        firebase_admin.initialize_app(cred)
    return firestore.client()


def chunked(iterable: Iterable, size: int):
    buf = []
    for x in iterable:
        buf.append(x)
        if len(buf) >= size:
            yield buf
            buf = []
    if buf:
        yield buf


def _slugify(name: str) -> str:
    """Make a safe SPA id from spa_name."""
    if not isinstance(name, str):
        name = str(name or "")
    s = name.strip().lower()
    s = re.sub(r"[^a-z0-9]+", "-", s)
    s = re.sub(r"-{2,}", "-", s).strip("-")
    return s or "spa"


# ----------------------------- Firestore upserters -----------------------------
def upsert_state_doc(db, state: str, fields: Dict[str, Any]):
    """
    Upserts the state TLDR fields DIRECTLY on states/{STATE}.
    No subcollection/subdocument.
    """
    state = state.upper()
    state_ref = db.collection("states").document(state)
    state_ref.set({"state": state}, merge=True)  # ensure exists
    state_ref.set(fields, merge=True)


def upsert_counties(db, state: str, rows: pd.DataFrame, batch_size: int = 450):
    """Upserts all county docs under states/{STATE}/counties/{GEOID}."""
    if rows is None or rows.empty:
        return
    state = state.upper()
    coll = db.collection("states").document(state).collection("counties")

    # guarantee strings for ids
    rows = rows.copy()
    rows["geoid"] = rows["geoid"].astype(str).str.zfill(5)

    for chunk in chunked(rows.to_dict(orient="records"), batch_size):
        batch = db.batch()
        for rec in chunk:
            geoid = rec.pop("geoid")

            # normalize some helpful fields
            rec["state"] = state
            if "county_name" in rec:
                rec["county_name"] = str(rec["county_name"])

            # explicit ints for numeric-ish fields if present
            for k in (
                "last_week_count",
                "last_month_count",
                "next_week_forecast",
                "next_month_forecast",
                "total_to_date",
                "total_tilldate",
            ):
                if k in rec and rec[k] is not None and rec[k] != "":
                    try:
                        rec[k] = int(rec[k])
                    except Exception:
                        pass

            rec.setdefault("updated_at", int(time.time()))
            batch.set(coll.document(geoid), rec, merge=True)
        batch.commit()


def upsert_spas(db, state: str, spa_rows: pd.DataFrame, batch_size: int = 450):
    """
    Writes each SPA row to: states/{state}/spas/{spa_id}
    NOTE: Per your request, SPA rows are always forced to state='CA' and county_name='Losangles'.
    """
    if spa_rows is None or spa_rows.empty:
        return

    # Force CA + Losangles regardless of input
    spa_rows = spa_rows.copy()
    spa_rows["state"] = "CA"
    if "county_name" not in spa_rows.columns or spa_rows["county_name"].eq("").all():
        spa_rows["county_name"] = "Losangles"

    coll = db.collection("states").document("CA").collection("spas")

    for chunk in chunked(spa_rows.to_dict(orient="records"), batch_size):
        batch = db.batch()
        for rec in chunk:
            spa_id = rec.get("spa_id") or _slugify(rec.get("spa_name", "spa"))

            # Normalize types for numericish fields
            for k in (
                "total_till_date",
                "last_obs_week_count",
                "last_obs_month_count",
                "next_week_forecast",
                "next_month_forecast",
            ):
                if k in rec and rec[k] not in (None, ""):
                    try:
                        rec[k] = int(rec[k])
                    except Exception:
                        pass

            rec["state"] = "CA"
            rec.setdefault("county_name", "Losangles")
            rec.setdefault("updated_at", int(time.time()))
            batch.set(coll.document(spa_id), rec, merge=True)
        batch.commit()


# ----------------------------- CSV loading -----------------------------
def _read_csv(path: str | None) -> pd.DataFrame | None:
    if not path:
        return None
    df = pd.read_csv(path, dtype=str).fillna("")
    return df


def load_counties_csv(path: str) -> pd.DataFrame:
    df = _read_csv(path)
    if df is None:
        raise ValueError("counties CSV path is required")

    # Basic columns (we don't force all TLDR cols; we just pass through if present)
    for need in ["state", "geoid"]:
        if need not in df.columns:
            raise ValueError(f"counties CSV missing required column: '{need}'")

    # Coerce numeric-ish fields if present
    for c in [
        "last_week_count",
        "last_month_count",
        "next_week_forecast",
        "next_month_forecast",
        "total_to_date",
        "total_tilldate",
    ]:
        if c in df.columns:
            df[c] = pd.to_numeric(df[c], errors="coerce").fillna(0).astype(int)

    return df


def load_state_csv(path: str | None) -> pd.DataFrame | None:
    df = _read_csv(path)
    if df is None:
        return None

    # Nice-to-have coercions
    for c in ["total_to_date", "total_tilldate"]:
        if c in df.columns:
            df[c] = pd.to_numeric(df[c], errors="coerce").fillna(0).astype(int)
    return df


def load_spa_csv(path: str | None) -> pd.DataFrame:
    """
    Expected columns (strings are fine):
      spa_name,color,total_till_date,
      last_obs_week_start,last_obs_week_end,last_obs_week_count,
      last_obs_month_start,last_obs_month_end,last_obs_month_count,
      next_week_start,next_week_end,next_week_forecast,
      next_month_start,next_month_end,next_month_forecast
    We DO NOT require 'state' or 'county_name' in the CSV; we force CA/Losangles.
    """
    df = _read_csv(path)
    if df is None:
        return pd.DataFrame(columns=["spa_id", "spa_name", "state", "county_name"])

    # Ensure spa_name is present (allow some aliases)
    if "spa_name" not in df.columns:
        for alt in ("spa", "name", "spaid", "spa_id"):
            if alt in df.columns:
                df = df.rename(columns={alt: "spa_name"})
                break
    if "spa_name" not in df.columns:
        raise ValueError("SPA CSV missing required column: 'spa_name'")

    # Build safe spa_id from spa_name
    df["spa_id"] = df["spa_name"].map(_slugify)

    # Coerce numeric-ish fields if present
    for c in [
        "total_till_date",
        "last_obs_week_count",
        "last_obs_month_count",
        "next_week_forecast",
        "next_month_forecast",
    ]:
        if c in df.columns:
            df[c] = pd.to_numeric(df[c], errors="coerce").fillna(0).astype(int)

    # Keep everything else as-is (dates stay strings)
    wanted_order = [
        "spa_id",
        "spa_name",
        "state",          # will be forced to "CA" in upsert
        "county_name",    # will be forced to "Losangles" in upsert
        "color",
        "total_till_date",
        "last_obs_week_start",
        "last_obs_week_end",
        "last_obs_week_count",
        "last_obs_month_start",
        "last_obs_month_end",
        "last_obs_month_count",
        "next_week_start",
        "next_week_end",
        "next_week_forecast",
        "next_month_start",
        "next_month_end",
        "next_month_forecast",
    ]
    for col in wanted_order:
        if col not in df.columns:
            df[col] = ""
    return df[wanted_order]


# ----------------------------- Main seeding flow -----------------------------
def main():
    ap = argparse.ArgumentParser(description="Seed Firestore with state + county + SPA TLDR data.")
    ap.add_argument("--only-state", "-s", default=None,
                    help="Seed a single state (e.g., CA) for states/counties. SPA writes are always to CA.")
    ap.add_argument("--dry-run", action="store_true",
                    help="Load & summarize, but don't write to Firestore")
    ap.add_argument("--service-account", default="keys/optimum-agent-305714-firebase-adminsdk-fbsvc-6f015e057a.json",
                    help="Path to Firebase Admin SDK service account JSON")
    ap.add_argument("--counties-csv", default="data/counties_tldr.csv",
                    help="Path to counties TLDR CSV")
    ap.add_argument("--states-csv", default="data/states_tldr.csv",
                    help="Path to states TLDR CSV")
    ap.add_argument("--spa-csv", default="data/spa_tldr.csv",
                    help="Path to SPA TLDR CSV (no state/county required)")
    args = ap.parse_args()

    # --- SA, DB
    debug_sa(args.service_account)
    db = init_db(args.service_account)

    # --- Load CSVs
    counties_df = load_counties_csv(args.counties_csv)
    states_df   = load_state_csv(args.states_csv)
    spa_df      = load_spa_csv(args.spa_csv)

    # --- Filter counties/states by --only-state if set
    if args.only_state:
        only = args.only_state.upper()
        counties_df = counties_df.loc[counties_df["state"].str.upper() == only].copy()

    # Computed totals fallback per state (from county totals)
    computed_totals = {}
    if "total_to_date" in counties_df.columns:
        computed_totals = (
            counties_df.groupby(counties_df["state"].str.upper())["total_to_date"]
            .sum(min_count=1).fillna(0).astype(int).to_dict()
        )

    # Union of states from both CSVs so states with no counties still get written
    states_from_counties = set(counties_df["state"].str.upper().unique())
    states_from_states   = set(states_df["state"].str.upper().unique()) if states_df is not None and "state" in states_df.columns else set()
    all_states = states_from_counties | states_from_states
    if args.only_state:
        all_states = {args.only_state.upper()}

    # --- Seed states + counties
    for state in sorted(all_states):
        sub = counties_df.loc[counties_df["state"].str.upper() == state].copy()
        print(f"\n=== Seeding {state} — {len(sub)} counties ===")

        # pick state row if present
        meta_row = None
        if states_df is not None and "state" in states_df.columns:
            m = states_df.loc[states_df["state"].str.upper() == state]
            if not m.empty:
                meta_row = m.iloc[0].to_dict()

        # Build TLDR fields to set on the STATE document
        def g(name, default=""):
            return meta_row.get(name, default) if meta_row else default

        # Optional total fields
        total_till_date = g("total_till_date", None)
        total_to_date   = g("total_to_date", None)
        if (total_till_date is None or total_till_date == "") and state in computed_totals:
            total_till_date = int(computed_totals[state])

        state_fields = {
            "state": state,
            "state_name": g("state_name", ""),
            "last_obs_week_start": g("last_obs_week_start", g("last_week_start", "")),
            "last_obs_week_end":   g("last_obs_week_end",   g("last_week_end", "")),
            "last_obs_week_count": int(g("last_obs_week_count", "0") or 0),
            "last_obs_month_start": g("last_obs_month_start", g("last_month_start", "")),
            "last_obs_month_end":   g("last_obs_month_end",   g("last_month_end", "")),
            "last_obs_month_count": int(g("last_obs_month_count", "0") or 0),
            "next_week_start": g("next_week_start", ""),
            "next_week_end":   g("next_week_end", ""),
            "next_week_forecast": int(g("next_week_forecast", "0") or 0),
            "next_month_start": g("next_month_start", ""),
            "next_month_end":   g("next_month_end", ""),
            "next_month_forecast": int(g("next_month_forecast", "0") or 0),
            "total_till_date": total_till_date if total_till_date not in ("", None) else 0,
            "total_to_date": int(total_to_date) if str(total_to_date).strip().isdigit() else 0,
            "color": g("color", ""),
            "updated_at": int(time.time()),
            "source": "seed_script_v2",
        }

        if args.dry_run:
            print("  (dry-run) state fields:", state_fields)
            if len(sub):
                print("  (dry-run) first county row:", sub.iloc[0].to_dict())
        else:
            upsert_state_doc(db, state, state_fields)
            upsert_counties(db, state, sub)

    # --- Seed SPAs (always to CA/Losangles as requested)
    if spa_df is not None and not spa_df.empty:
        print(f"\n=== Seeding SPAs for CA — {len(spa_df)} rows ===")
        if args.dry_run:
            print("  (dry-run) first SPA row:", spa_df.iloc[0].to_dict())
        else:
            upsert_spas(db, "CA", spa_df)

    print("\nDone.")


if __name__ == "__main__":
    main()
