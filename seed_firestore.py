import argparse
import time
from typing import Dict, Any, Iterable

import pandas as pd
import firebase_admin
from firebase_admin import credentials, firestore


# ----------------------------- Firestore helpers -----------------------------
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


def upsert_state_doc(db, state: str, fields: Dict[str, Any]):
    """
    Upserts the state TLDR fields DIRECTLY on states/{STATE}.
    No subcollection/subdocument.
    """
    state = state.upper()
    state_ref = db.collection("states").document(state)
    # ensure a simple 'state' field exists and then merge TLDR fields
    state_ref.set({"state": state}, merge=True)
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

            batch.set(coll.document(geoid), rec, merge=True)
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


# ----------------------------- Main seeding flow -----------------------------
def main():
    ap = argparse.ArgumentParser(description="Seed Firestore with state + county TLDR data.")
    ap.add_argument("--only-state", "-s", default=None,
                    help="Seed a single state (e.g., CA). If omitted, seeds union of states from both CSVs.")
    ap.add_argument("--dry-run", action="store_true", help="Load & summarize, but don't write to Firestore")
    args = ap.parse_args()

    # --- paths (adjust if you keep them elsewhere)
    service_account = "keys/optimum-agent-305714-firebase-adminsdk-fbsvc-4dcb9bfb9d.json"
    counties_csv = "data/counties_tldr.csv"
    states_csv   = "data/states_tldr.csv"

    db = init_db(service_account)
    counties_df = load_counties_csv(counties_csv)
    states_df   = load_state_csv(states_csv)

    # Filter counties by --only-state if set
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
        # Include your new fields: color, total_tilldate
        def g(name, default=""):
            return meta_row.get(name, default) if meta_row else default

        # Prefer provided totals; fall back to computed totals from counties
        
        total_till_date  = g("total_till_date", None)

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
            "total_till_date": total_till_date,
            "color": g("color", ""),                 # ← NEW
            "updated_at": g("updated_at", int(time.time())),
            "source": "seed_script_v2",
        }

        if args.dry_run:
            print("  (dry-run) state fields:", state_fields)
            if len(sub):
                print("  (dry-run) first county row:", sub.iloc[0].to_dict())
        else:
            upsert_state_doc(db, state, state_fields)
            upsert_counties(db, state, sub)

    print("\nDone.")


if __name__ == "__main__":
    main()
