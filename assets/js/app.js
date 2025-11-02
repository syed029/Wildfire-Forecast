// /* assets/js/app.js — ESN in-browser + colors + legend + chart (deterministic, gated forecasts) */

// const WEEKLY_CSV_URL = new URL("../weekly_matrix_by_county.csv", import.meta.url).href;
// const HYPER_STATES_URL = new URL("../esn_hyperparams_state_dashboard.csv", import.meta.url).href;
// // const HYPER_GENERIC_URL  = new URL("../esn_hyperparams.csv", import.meta.url).href;
// // Optional county-level tuning (FIPS or state+county)
// const HYPER_COUNTY_URL = new URL("../esn_hyperparams.csv", import.meta.url).href;
// // If you want counties to fall back to the state’s row when no county row exists:
// const ALLOW_COUNTY_FALLBACK_TO_STATE = false;   // set true if you want auto-fallback
// import { ESNRunner } from "./esn.js";
// const ESN = new ESNRunner(new URL("./esn_worker.js", import.meta.url).href);

// const TRIM_THRESHOLD = 10;
// const FALLBACK_TAIL = 52;

// // Reuse ESN results across hovers / view flips
// const forecastCache = new Map(); // key -> { yfit, yhat, H }

// /* UI handles */
// const $stateRow = document.querySelector("#stateName")?.closest(".metric");
// const $usTotal = document.querySelector("#usTotal");
// const $stateName = document.querySelector("#stateName");
// const $stateTotal = document.querySelector("#stateTotal");
// const $coverage = document.querySelector("#coverage");
// const $backButton = document.querySelector("#backButton");
// const $topTitle = document.querySelector("#topTitle");
// const $topTableTbody =
//   document.querySelector("#top10 tbody") || document.querySelector("#topTable tbody");

// /* Map + data globals */
// let map, statesLayer, countiesLayer, spasLayer, usGeoJSON = null;
// let weeklyRows = [], labelsAll = [];
// let stateColumns = {}, countyHeaderByNorm = {};
// let statesData = {}, usTotal = 0;
// let stateSeries = {}, countySeries = {};
// let viewLevel = "state", lastStateCode = null;
// let hoverChart, hoverChartContainer;          // "all" | "ytd"
// let _lastDrawPayload = null;           // { title, labels, datasets }
// let _lastObservedYear = null;          // e.g., "2025"
// /* Color mode (Rank default; YoY optional) */
// let COLOR_MODE = "rank"; // "rank" | "yoy"

// /* Debug */
// window.__WF_DEBUG__ = false;
// const D = (...a) => { if (window.__WF_DEBUG__) console.log("[WF]", ...a); };
// let HYP_LA_PARTS = Object.create(null); // key: "CA|Los Angeles|Part1" -> hyper


// function hasModelForLaPart(partKey /* "CA|Los Angeles|Part1" */){
//   return Boolean(HYP_LA_PARTS && HYP_LA_PARTS[partKey]);
// }
// function hyperForLaPart(partKey){
//   return HYP_LA_PARTS[partKey] || HYP_GENERIC;
// }


// function ensureModeCaption(){
//   const panel = document.querySelector("#top10")?.parentElement;
//   if (!panel) return;
//   let cap = document.getElementById("modeCaption");
//   if (!cap){
//     cap = document.createElement("div");
//     cap.id = "modeCaption";
//     panel.appendChild(cap);
//   }
//   if (COLOR_MODE === "yoy"){
//     cap.innerHTML = `<b>YoY</b> — Year over Year: compares the last 4 weeks to the same period 52 weeks earlier (red > +20%, yellow −5%…+20%, green < −5%).`;
//   } else {
//     cap.innerHTML = `<b>YtD</b> — Year to Date: ranks by cumulative incidents observed so far this year.`;
//   }
// }


// // One global toggle remembered between draws
// window.hoverChartMode = window.hoverChartMode || "all";  // "all" | "ytd"

// const MONTH_ABBR = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

// function deriveLastObservedYear(labels){
//   for (let i = labels.length - 1; i >= 0; i--) {
//     const y = String(labels[i] ?? "").slice(0,4);
//     if (/^\d{4}$/.test(y)) return y;
//   }
//   return String(new Date().getUTCFullYear());
// }

// function sliceToYearYTD(labels, datasets){
//   const yr = deriveLastObservedYear(labels);
//   const start = labels.findIndex(s => String(s).startsWith(`${yr}-`));
//   if (start <= 0) return { labels, datasets };
//   return {
//     labels: labels.slice(start),
//     datasets: datasets.map(ds => ({ ...ds, data: ds.data.slice(start) }))
//   };
// }

// function setYTDButtonLabel(yearStr){
//   const btn = hoverChartContainer?.querySelector("#ytdToggle");
//   if (btn) btn.textContent = `(${yearStr} YtD toggle)`;
// }


// /* ===== color-mode switch + recolor helpers ===== */
// function setColorMode(mode) {
//   COLOR_MODE = (mode === "yoy") ? "yoy" : "rank";
//   ensureLegend();
//   recolorActiveView();

//   // toggle active classes on the two pills
//   const rankBtn = document.getElementById("colorRank");
//   const yoyBtn  = document.getElementById("colorYoY");
//   rankBtn?.classList.toggle("is-active", COLOR_MODE === "rank");
//   yoyBtn?.classList.toggle("is-active",  COLOR_MODE === "yoy");

//   ensureModeCaption();  // (section 4)
// }

// window.setColorMode = setColorMode;
// document.getElementById("colorRank")?.addEventListener("click", () => setColorMode("rank"));
// document.getElementById("colorYoY")?.addEventListener("click", () => setColorMode("yoy"));
// window.addEventListener("keydown", (e) => { if (e.key.toLowerCase() === "r") setColorMode("rank"); if (e.key.toLowerCase() === "y") setColorMode("yoy"); });

// /* ===== YoY (single source of truth) ===== */
// const YOY_WINDOW_W = 4;   // compare last 4 weeks…
// const YOY_BASE_LAG = 52;  // …to the same period 52w earlier
// const YOY_THRESH = { red: 1.20, yellow: 0.95 }; // >+20%, -5%..+20%, < -5%

// function yoyBucketFromArray(arr) {
//   const v = (arr || []).map(x => Number(x || 0));
//   const n = v.length;
//   if (n < YOY_BASE_LAG + YOY_WINDOW_W + 1) return "gray";

//   // find last non-empty index
//   let end = n - 1;
//   while (end > 0 && !isFinite(v[end])) end--;

//   const start = Math.max(0, end - (YOY_WINDOW_W - 1));

//   let cur = 0; for (let i = start; i <= end; i++) cur += v[i] || 0;
//   const ps = start - YOY_BASE_LAG, pe = end - YOY_BASE_LAG;
//   if (ps < 0 || pe < 0) return "gray";
//   let prev = 0; for (let i = ps; i <= pe; i++)   prev += v[i] || 0;
//   if (prev <= 0) return "gray";

//   const r = cur / prev;
//   if (r > YOY_THRESH.red) return "r";
//   if (r >= YOY_THRESH.yellow) return "y";
//   return "g";
// }
// const yoyBucketFromSeries = (series) => yoyBucketFromArray(series?.values || series || []);
// const yoyBucketForState = (code) => stateSeries[code] ? yoyBucketFromArray(stateSeries[code].values) : "gray";

// function bucketToColor(bucket) {
//   if (bucket === "r") return "#ef4444";
//   if (bucket === "y") return "#facc15";
//   if (bucket === "g") return "#10b981";
//   return "#d1d5db";
// }


// function bucketForRank(idx) { if (idx >= 1 && idx <= 3) return "r"; if (idx <= 7) return "y"; if (idx <= 10) return "g"; return "gray"; }

// /* ===== recolor ===== */
// function recolorActiveView() { if (viewLevel === "state") recolorStatesLayerAndTable(); else if (viewLevel === "county") recolorCountiesLayerAndTable(); }

// function recolorStatesLayerAndTable() {
//   if (!statesLayer) return;

//   // Build rank index once
//   const ranked = Object.entries(statesData)
//     .map(([code, rec]) => ({ code, total: Number(rec?.total_till_date || 0) }))
//     .sort((a, b) => b.total - a.total);
//   const rankIndex = new Map(ranked.map((r, i) => [r.code, i + 1]));

//   // 1) Recolor MAP polygons
//   statesLayer.eachLayer(l => {
//     const code = (l.feature?.id || "").toUpperCase();
//     let fill;
//     if (COLOR_MODE === "rank") {
//       fill = bucketToColor(bucketForRank(rankIndex.get(code) || 999));
//     } else {
//       const bucket = hasModelForState(code) ? yoyBucketForState(code) : "gray";
//       fill = bucketToColor(bucket);
//     }
//     l.setStyle({ fillColor: fill });
//   });

//   // 2) Recolor TOP-10 TABLE rows
//   const tbody = document.querySelector("#top10 tbody");
//   if (!tbody) return;

//   Array.from(tbody.querySelectorAll("tr")).forEach((tr, i) => {
//     let bucket = "gray";
//     if (COLOR_MODE === "rank") {
//       bucket = bucketForRank(i + 1);
//     } else {
//       const stateCode = tr.children[1].textContent.split("—")[0].trim();
//       bucket = hasModelForState(stateCode) ? yoyBucketForState(stateCode) : "gray";
//     }
//     tr.style.background = bucketToColor(bucket);
//     tr.style.color = (bucket === "gray" ? "#111" : "#0b1220");
//   });
// }



// function recolorCountiesLayerAndTable() {
//   if (!countiesLayer) return;

//   // Build list with "ok" flag (has saved hyperparams for this county)
//   const items = Object.values(countiesLayer._layers).map(l => {
//     const rec  = l.feature?._tldrRec;
//     const name = l.feature?.properties?.NAME || "";
//     const raw  = l.feature?.id ?? l.feature?.properties?.GEOID ?? l.feature?.properties?.COUNTYFP;
//     const fid  = String(raw ?? "").padStart(5, "0");
//     const ok   = hasModelForCounty(lastStateCode, fid, name); // <- gate
//     return { fid, name, rec, total: Number(rec?.total_till_date || 0), ok };
//   });

//   // Rank **only** among counties that have saved models
//   const rankedOK = items.filter(x => x.ok).sort((a, b) => b.total - a.total);
//   const rankIndex = new Map(rankedOK.map((r, i) => [r.fid, i + 1]));

//   // Map polygons
//   countiesLayer.eachLayer(l => {
//     const name = l.feature?.properties?.NAME || "";
//     const raw  = l.feature?.id ?? l.feature?.properties?.GEOID ?? l.feature?.properties?.COUNTYFP;
//     const fid  = String(raw ?? "").padStart(5, "0");
//     const rec  = l.feature?._tldrRec;
//     const ok   = hasModelForCounty(lastStateCode, fid, name);

//     let fill = "#d1d5db"; // gray if no saved model
//     if (rec && ok) {
//       if (COLOR_MODE === "rank") {
//         fill = bucketToColor(bucketForRank(rankIndex.get(fid) || 999));
//       } else {
//         fill = bucketToColor(yoyBucketFromSeries(rec._series));
//       }
//     }
//     l.setStyle({ fillColor: fill });
//   });

//   // Top-10 table rows already filtered to saved models; just recolor rows
//   const tbody = document.querySelector("#top10 tbody");
//   if (!tbody) return;

//   Array.from(tbody.querySelectorAll("tr")).forEach((tr, i) => {
//     let bucket = "gray";
//     if (COLOR_MODE === "rank") bucket = bucketForRank(i + 1);
//     else {
//       const name = tr.children[1].textContent.replace(/ County$/, "").trim();
//       const layer = Object.values(countiesLayer._layers).find(L =>
//         (L.feature?.properties?.NAME || "").toLowerCase() === name.toLowerCase()
//       );
//       if (layer?.feature?._tldrRec) {
//         bucket = yoyBucketFromSeries(layer.feature._tldrRec._series);
//       }
//     }
//     tr.style.background = bucketToColor(bucket);
//     tr.style.color = (bucket === "gray" ? "#111" : "#0b1220");
//   });
// }




// /* ===== misc utils ===== */
// function fmt(n) { if (n === "…") return "…"; n = Number(n || 0); return isFinite(n) ? n.toLocaleString() : "0"; }
// function rng(a, b) { if (!a && !b) return "n/a"; if (a && b) return `${a} – ${b}`; return a || b || "n/a"; }
// const STATE_NAME = {
//   "AL": "Alabama", "AK": "Alaska", "AZ": "Arizona", "AR": "Arkansas", "CA": "California", "CO": "Colorado", "CT": "Connecticut",
//   "DE": "Delaware", "FL": "Florida", "GA": "Georgia", "HI": "Hawaii", "ID": "Idaho", "IL": "Illinois", "IN": "Indiana", "IA": "Iowa", "KS": "Kansas", "KY": "Kentucky",
//   "LA": "Louisiana", "ME": "Maine", "MD": "Maryland", "MA": "Massachusetts", "MI": "Michigan", "MN": "Minnesota", "MS": "Mississippi", "MO": "Missouri", "MT": "Montana",
//   "NE": "Nebraska", "NV": "Nevada", "NH": "New Hampshire", "NJ": "New Jersey", "NM": "New Mexico", "NY": "New York", "NC": "North Carolina", "ND": "North Dakota",
//   "OH": "Ohio", "OK": "Oklahoma", "OR": "Oregon", "PA": "Pennsylvania", "RI": "Rhode Island", "SC": "South Carolina", "SD": "South Dakota", "TN": "Tennessee",
//   "TX": "Texas", "UT": "Utah", "VT": "Vermont", "VA": "Virginia", "WA": "Washington", "WV": "West Virginia", "WI": "Wisconsin", "WY": "Wyoming", "DC": "District of Columbia"
// };
// function code2name(c) { return STATE_NAME[c] || c; }
// function slug(s) { return (s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "").trim(); }
// function stateCodeToFipsPrefix(code) {
//   const m = {
//     "AL": "01", "AK": "02", "AZ": "04", "AR": "05", "CA": "06", "CO": "08", "CT": "09", "DE": "10", "FL": "12", "GA": "13", "HI": "15",
//     "ID": "16", "IL": "17", "IN": "18", "IA": "19", "KS": "20", "KY": "21", "LA": "22", "ME": "23", "MD": "24", "MA": "25", "MI": "26", "MN": "27", "MS": "28", "MO": "29", "MT": "30",
//     "NE": "31", "NV": "32", "NH": "33", "NJ": "34", "NM": "35", "NY": "36", "NC": "37", "ND": "38", "OH": "39", "OK": "40", "OR": "41", "PA": "42", "RI": "44", "SC": "45", "SD": "46",
//     "TN": "47", "TX": "48", "UT": "49", "VT": "50", "VA": "51", "WA": "53", "WV": "54", "WI": "55", "WY": "56", "DC": "11"
//   }; return m[code] || "";
// }
// async function loadText(url) { const r = await fetch(url, { cache: "no-store" }); if (!r.ok) throw new Error(r.statusText); return r.text(); }
// function parseCSV(text) {
//   return new Promise((res, rej) => {
//     if (!window.Papa) return rej(new Error("Papa Parse missing"));
//     Papa.parse(text, { header: true, dynamicTyping: true, skipEmptyLines: true, complete: o => res(o), error: rej });
//   });
// }
// function addDaysISO(isoStr, days) { if (!isoStr) return ""; const d = new Date(isoStr); if (isNaN(d)) return ""; d.setUTCDate(d.getUTCDate() + Number(days || 0)); return d.toISOString().slice(0, 10); }
// function normalizeCountyName(s) { return (s || "").replace(/\b(County|Parish|Borough|Census Area|City|Municipality)\b/gi, "").trim(); }
// // function countyNameKey(stateCode, countyName){ return `${String(stateCode||"").toUpperCase()}|${slug(normalizeCountyName(countyName))}`; }
// const countyNameKey = (st, name) => `${st}|${slug(String(name).replace(/\b(County|Parish|Borough|Census Area|City|Municipality)\b/gi, ""))}`;
// function hasModelForState(code) {
//   return Boolean(HYP_STATE && HYP_STATE[code]);
// }

// function hasModelForCounty(st, fips, name) {
//   const f5 = fips ? String(fips).padStart(5, "0") : null;
//   const nkey = name ? countyNameKey(st, name) : null;

//   if (f5 && HYP_COUNTY_BY_FIPS && HYP_COUNTY_BY_FIPS[f5]) return true;
//   if (nkey && HYP_COUNTY_BY_NAME && HYP_COUNTY_BY_NAME[nkey]) return true;
//   if (typeof ALLOW_COUNTY_FALLBACK_TO_STATE !== "undefined" && ALLOW_COUNTY_FALLBACK_TO_STATE) {
//     return hasModelForState(st);
//   }
//   return false;
// }
// /* ===== Build indexes from weekly CSV ===== */
// function buildIndexes(papaOut) {
//   weeklyRows = papaOut.data;
//   labelsAll = weeklyRows.map(r => String(r.week_start));
//   const fields = papaOut.meta?.fields || [];
//   stateColumns = {}; countyHeaderByNorm = {};

//   for (const f of fields) {
//     if (f === "week_start") continue;
//     const [code, ...rest] = f.split("|");
//     if (!STATE_NAME[code]) continue;
//     const county = (rest.join("|") || "").trim();
//     (stateColumns[code] ||= []).push(f);
//     (countyHeaderByNorm[code] ||= {})[slug(county.replace(/\b(County|Parish|Borough|Census Area|City|Municipality)\b/gi, ""))] = f;
//     countyHeaderByNorm[code][slug(county)] = f;
//   }

//   stateSeries = {};
//   for (const code of Object.keys(stateColumns)) {
//     const cols = stateColumns[code];
//     const vals = weeklyRows.map(row => cols.reduce((s, c) => s + Number(row[c] || 0), 0));
//     stateSeries[code] = { labels: labelsAll, values: vals };
//   }
// }

// /* ===== Hyperparams ===== */

// function rowToHyper(r) {
//   const b2b = (v) => {
//     if (typeof v === "boolean") return v;
//     if (v === 1 || v === "1") return true;
//     if (typeof v === "string") return v.toLowerCase() === "true";
//     return false;
//   };
//   return {
//     // core ESN knobs
//     reservoir_size: Number(r.reservoir_size ?? r.n_res ?? r.Nh ?? 200),
//     spectral_radius: Number(r.spectral_radius ?? r.sr ?? 0.95),
//     leak_rate: Number(r.leak_rate ?? r.alpha ?? 1.0),
//     ridge: Number(r.ridge ?? r.ridge_lambda ?? r.l2 ?? 1e-2),
//     input_scale: Number(r.input_scale ?? r.input_scaling ?? r.scale ?? 0.5),
//     bias: Number(r.bias ?? 0.0),

//     // training windowing
//     washout: Number(r.washout ?? r.warmup_steps ?? 50),
//     horizon: Number(r.horizon ?? r.horizon_weeks ?? 4),
//     lag: Number(r.lag ?? 0),
//     trim_threshold: Number(r.trim_threshold ?? 0),

//     // reservoir topology / noise
//     sparsity: Number(r.sparsity ?? 0.10),
//     noise: Number(r.noise ?? 0),

//     // scaling choice (interpret your TRUE as log1p)
//     scale: (b2b(r.scale_option) ? "log1p" : (r.scale_name || "none")),

//     // reproducibility
//     seed: Number(r.seed ?? r.random_seed ?? 42),
//     deterministic: b2b(r.deterministic),
//   };
// }

// let HYP_STATE = {}, HYP_GENERIC = {};
// let HYP_COUNTY_BY_FIPS = Object.create(null);
// let HYP_COUNTY_BY_NAME = Object.create(null);

// async function loadHyperparams() {
//   // --- states
//   try {
//     const t1 = await loadText(HYPER_STATES_URL);
//     const p1 = await parseCSV(t1);
//     HYP_STATE = {};
//     for (const r of p1.data) {
//       const st = String(r.state || r.code || "").trim().toUpperCase();
//       if (STATE_NAME[st]) HYP_STATE[st] = rowToHyper(r);
//     }
//   } catch { }

//   // --- optional generic (one row)
//   try {
//     const t2 = await loadText(HYPER_GENERIC_URL);
//     const p2 = await parseCSV(t2);
//     HYP_GENERIC = rowToHyper(p2.data[0] || {});
//   } catch {
//     HYP_GENERIC = rowToHyper({});
//   }

//   // --- counties (your esn_hyperparams.csv)
//   try {
//     const t3 = await loadText(HYPER_COUNTY_URL);
//     const p3 = await parseCSV(t3);
//     HYP_COUNTY_BY_FIPS = Object.create(null);
//     HYP_COUNTY_BY_NAME = Object.create(null);

//     for (const r of p3.data) {
//       const st = String(r.state || r.st || "").trim().toUpperCase();
//       const nm = String(r.county || r.name || "").trim();
//       const fips = (r.fips != null ? String(r.fips) : (r.geoid != null ? String(r.geoid) : "")).padStart(5, "0");
//       if (!st || (!nm && !fips)) continue;

//       const hyp = rowToHyper(r);
//       if (/^\d{5}$/.test(fips)) HYP_COUNTY_BY_FIPS[fips] = hyp;
//       if (nm) HYP_COUNTY_BY_NAME[countyNameKey(st, nm)] = hyp;
//     }
//   } catch { }

//   // --- LA parts
//   try {
//     const t4 = await loadText(new URL("../esn_hyperparams_la_parts.csv", import.meta.url).href);
//     const p4 = await parseCSV(t4);
//     HYP_LA_PARTS = Object.create(null);
//     for (const r of p4.data) {
//       if ((r.level||"").toLowerCase() !== "la_part") continue;
//       const key = `CA|Los Angeles|${String(r.part).trim()}`;
//       HYP_LA_PARTS[key] = rowToHyper(r);
//     }
//   } catch { /* optional */ }

// }


// /* ===== ESN helper gates ===== */
// function hasSavedHyperparamsForKey(key, meta = {}) {
//   if (String(key).startsWith("S:")) {
//     const st = String(key).slice(-2);
//     return !!HYP_STATE[st];
//   }
//   if (String(key).startsWith("C:")) {
//     const fips = meta.countyFips ? String(meta.countyFips).padStart(5, "0") : null;
//     const st = meta.stateCode, nm = meta.countyName;
//     if (fips && HYP_COUNTY_BY_FIPS[fips]) return true;
//     if (st && nm && HYP_COUNTY_BY_NAME[countyNameKey(st, nm)]) return true;
//     return false;
//   }
//   return false;
// }
// function allowForecastForKey(key, meta = {}) {
//   if (String(key).startsWith("S:")) {
//     const sc = meta.stateCode || key.slice(2);
//     return Boolean(HYP_STATE[sc]);
//   }
//   if (String(key).startsWith("C:")) {
//     const st = meta.stateCode;
//     const fips = meta.countyFips ? String(meta.countyFips).padStart(5, "0") : null;
//     const nm = meta.countyName;
//     if (fips && HYP_COUNTY_BY_FIPS[fips]) return true;
//     if (st && nm && HYP_COUNTY_BY_NAME[countyNameKey(st, nm)]) return true;
//     if (ALLOW_COUNTY_FALLBACK_TO_STATE && st && HYP_STATE[st]) return true;
//     return false;
//   }
//   return false;
// }

// function hyperForKey(key, meta = {}) {
//   if (String(key).startsWith("S:")) {
//     const sc = meta.stateCode || key.slice(2);
//     return HYP_STATE[sc] || HYP_GENERIC;
//   }
//   if (String(key).startsWith("C:")) {
//     const st = meta.stateCode;
//     const fips = meta.countyFips ? String(meta.countyFips).padStart(5, "0") : null;
//     const nm = meta.countyName;
//     if (fips && HYP_COUNTY_BY_FIPS[fips]) return HYP_COUNTY_BY_FIPS[fips];
//     if (st && nm && HYP_COUNTY_BY_NAME[countyNameKey(st, nm)]) return HYP_COUNTY_BY_NAME[countyNameKey(st, nm)];
//     if (ALLOW_COUNTY_FALLBACK_TO_STATE && st && HYP_STATE[st]) return HYP_STATE[st];
//     return HYP_GENERIC;
//   }
//   return HYP_GENERIC;
// }
// function sumTail(a, n) { let s = 0; for (let i = Math.max(0, a.length - n); i < a.length; i++) s += Number(a[i] || 0); return s; }

// /* ===== TLDR records (no-ESN initially) ===== */
// function buildCountsTLDR(key, series, title, meta = {}) {
//   const labels = series.labels, vals = series.values;
//   const lwIdx = labels.length - 1;
//   const lastW = vals[lwIdx] || 0;
//   let lastM = 0; for (let i = Math.max(0, lwIdx - 3); i <= lwIdx; i++) lastM += Number(vals[i] || 0);
//   const nextStart = labels[lwIdx] || "";
//   const canFcst = hasSavedHyperparamsForKey(key, meta);

//   return {
//     title,
//     total_till_date: Math.round(vals.reduce((a, b) => a + (b || 0), 0)),
//     color: "",
//     last_obs_week: { start: labels[lwIdx - 1] || "", end: labels[lwIdx] || "", count: Math.round(lastW) },
//     last_obs_month: { start: labels[lwIdx - 4] || "", end: labels[lwIdx] || "", count: Math.round(lastM) },
//     next_week_forecast: { start: nextStart, end: addDaysISO(nextStart, 7), count: "…" },
//     next_month_forecast: { start: nextStart, end: addDaysISO(nextStart, 28), count: "…" },
//     _series: series,
//     _key: key,
//     _meta: meta,
//     _fit: null, _yhat: null, _H: 4,
//     _forecastReady: false,
//     _canForecast: canFcst
//   };
// }

// /* Compute ESN lazily and cache into the TLDR record (works for state + county) */
// async function ensureForecastForRec(rec) {
//   if (!rec) return rec;
//   if (!rec._canForecast) return rec;  // gated
//   if (rec._forecastReady) return rec;

//   const k = rec._key;
//   if (forecastCache.has(k)) {
//     const { yfit, yhat, H } = forecastCache.get(k);
//     rec._fit = yfit; rec._yhat = yhat; rec._H = H;
//   } else {
//     const hyper = hyperForKey(k, rec._meta);
//     const { yfit, yhat, H } = await ESN.fitPredict(k, rec._series.values, hyper);
//     forecastCache.set(k, { yfit, yhat, H });
//     rec._fit = yfit || []; rec._yhat = yhat || []; rec._H = H || 4;
//   }

//   rec.next_week_forecast.count = Math.round(rec._yhat[0] || 0);
//   rec.next_month_forecast.count = Math.round(rec._yhat.slice(0, 4).reduce((a, b) => a + (b || 0), 0));
//   rec._forecastReady = true;
//   return rec;
// }

// /* Tooltip HTML (forecasts rows only if _canForecast) */
// function tldrHTML(title, rec) {
//   if (!rec) return `<div class="tldr"><div class="tldr-title" style="padding-left:6px;padding-bottom:6px;font-weight:800;">${title}</div><div>No data</div></div>`;
//   const lastW = rec.last_obs_week || {}, lastM = rec.last_obs_month || {};
//   const nextW = rec.next_week_forecast || {}, nextM = rec.next_month_forecast || {};
//   const total = Number(rec.total_till_date || 0);

//   const rows = [
//     `<tr><td>Last observed week</td><td>${rng(lastW.start, lastW.end)}</td><td>${fmt(lastW.count)}</td></tr>`,
//     `<tr><td>Last observed month</td><td>${rng(lastM.start, lastM.end)}</td><td>${fmt(lastM.count)}</td></tr>`
//   ];
//   if (rec._canForecast) {
//     rows.push(
//       `<tr><td>Next week forecast</td><td>${rng(nextW.start, nextW.end)}</td><td>${fmt(nextW.count)}</td></tr>`,
//       `<tr><td>Next month forecast</td><td>${rng(nextM.start, nextM.end)}</td><td>${fmt(nextM.count)}</td></tr>`
//     );
//   }

//   return `
//     <div class="tldr">
//       <div class="tldr-title" style="padding-left:6px;padding-bottom:6px;display:flex;gap:6px;align-items:baseline;">
//         <span style="font-weight:800;">${title}</span><span style="font-weight:600;">(${fmt(total)} Incidents)</span>
//       </div>
//       <table class="tldr-table">${rows.join("")}</table>
//     </div>`;
// }

// /* Legend builder */
// function ensureLegend() {
//   const el = document.getElementById("mapLegend"); if (!el) return;
//   if (COLOR_MODE === "yoy") {
//     el.innerHTML = `
//       <div class="legend-title">YoY change (vs week -52)</div>
//       <div class="legend-row"><span class="swatch swatch-red"></span> +20% or higher</div>
//       <div class="legend-row"><span class="swatch swatch-yellow"></span> -5% to +20%</div>
//       <div class="legend-row"><span class="swatch swatch-green"></span> below -5%</div>
//       <div class="legend-row"><span class="swatch swatch-gray"></span> insufficient history</div>
//     `;
//   } else {
//     el.innerHTML = `
//       <div class="legend-title">Rank (total to date)</div>
//       <div class="legend-row"><span class="swatch swatch-red"></span> Top 1–3</div>
//       <div class="legend-row"><span class="swatch swatch-yellow"></span> Ranks 4–7</div>
//       <div class="legend-row"><span class="swatch swatch-green"></span> Ranks 8+</div>
//       <div class="legend-row"><span class="swatch swatch-gray"></span> No data</div>
//     `;
//   }
// }
// function rankColorFrom(sortedTotals, code) {
//   const idx = sortedTotals.findIndex(x => x.code === code);
//   if (idx === -1) return "#d1d5db";
//   const rank = idx + 1;
//   if (rank <= 3) return "#ef4444";
//   if (rank <= 7) return "#facc15";
//   if (rank <= 10) return "#10b981";
//   return "#d1d5db";
// }


// function ensureHoverChartControl() {
//   if (hoverChartContainer) return;
//   const container = map.getContainer();
//   const div = document.createElement("div");
//   div.className = "hover-chart-fixed";
//   div.innerHTML = `
//     <div class="bar">
//       <div id="chartTitle" style="font-weight:700">Weekly Incidents</div>
//       <div class="bar-actions">
//         <button id="ytdToggle" class="pill" aria-pressed="false" title="Toggle Year-to-Date view">(YYYY YtD toggle)</button>
//         <button id="chartCloseBtn" class="pill" title="Close">✕</button>
//       </div>
//     </div>
//     <canvas id="stateSpark"></canvas>
//   `;
//   container.appendChild(div);
//   hoverChartContainer = div;

//   // close
//   div.querySelector("#chartCloseBtn").addEventListener("click", () => { div.style.display = "none"; });

//   // YtD toggle
//   const ybtn = div.querySelector("#ytdToggle");
//   ybtn.addEventListener("click", () => {
//     window.hoverChartMode = (window.hoverChartMode === "all") ? "ytd" : "all";
//     ybtn.classList.toggle("is-on", window.hoverChartMode === "ytd");
//     ybtn.setAttribute("aria-pressed", window.hoverChartMode === "ytd" ? "true" : "false");
//     updateHoverChartFromCache();
//   });

//   // ✅ INIT LABEL HERE
//   setYTDButtonLabel(_lastObservedYear || String(new Date().getUTCFullYear()));

//   // sizing observers...
//   const ro = new ResizeObserver(() => {
//     if (!hoverChartContainer || hoverChartContainer.style.display === "none" || !hoverChart) return;
//     sizeAndGetCtx(); hoverChart.resize(); hoverChart.update("none");
//   });
//   ro.observe(div);
//   window.addEventListener("resize", () => {
//     if (!hoverChartContainer || hoverChartContainer.style.display === "none" || !hoverChart) return;
//     sizeAndGetCtx(); hoverChart.resize(); hoverChart.update("none");
//   });
// }


// function updateHoverChartFromCache() {
//   if (!_lastDrawPayload) return;
//   const { title, labels, datasets } = _lastDrawPayload;

//   if (window.hoverChartMode === "ytd") {
//     const y = deriveLastObservedYear(labels);
//     const sliced = sliceToYearYTD(labels, datasets);
//     setYTDButtonLabel(y);
//     _internalDraw(`${title} — YtD`, sliced.labels, sliced.datasets);
//   } else {
//     setYTDButtonLabel(deriveLastObservedYear(labels));
//     _internalDraw(title, labels, datasets);
//   }
// }


// function _internalDraw(title, labels, datasets) {
//   ensureHoverChartControl();
//   hoverChartContainer.style.display = "block";
//   void hoverChartContainer.offsetWidth;

//   const ctx = sizeAndGetCtx();
//   const LBL = labels.map(x => (typeof x === "string" ? x : String(x)));
//   const years = LBL.map(s => s.slice(0,4));
//   const titleEl = hoverChartContainer.querySelector("#chartTitle");
//   if (titleEl) titleEl.textContent = title;

//   const opts = {
//     responsive: false,
//     maintainAspectRatio: false,
//     animation: false,
//     layout: { padding: { top: 6, right: 8, bottom: 22, left: 8 } },
//     plugins: { legend: { display: true }, tooltip: { mode: "index", intersect: false } },
//     scales: {
//       x: {
//         type: "category",
//         grid: { display: false },
//         ticks: {
//           source: "labels",
//           autoSkip: false,
//           maxRotation: 0,
//           padding: 6,
//           callback: (_, i) => {
//             const y = years[i], prev = i > 0 ? years[i-1] : null;
//             return (y && y !== prev) ? y : "";
//           }
//         }
//       },
//       y: { ticks: { precision: 0 }, grid: { color: "rgba(255,255,255,.08)" } }
//     }
//   };

//   const data = { labels: LBL, datasets };
//   if (hoverChart) { hoverChart.data = data; hoverChart.options = opts; hoverChart.update("none"); }
//   else { hoverChart = new Chart(ctx, { type: "line", data, options: opts }); }

//   requestAnimationFrame(() => { sizeAndGetCtx(); hoverChart.resize(); hoverChart.update("none"); });
// }

// function sizeAndGetCtx() {
//   const c = hoverChartContainer.querySelector("#stateSpark");
//   const rect = hoverChartContainer.getBoundingClientRect();
//   // account for the title bar (~28px) and padding
//   const w = Math.max(320, Math.floor(rect.width));
//   const h = Math.max(150, Math.floor(rect.height - 28));
//   c.width = w;   // set bitmap size (important for crisp axes)
//   c.height = h;
//   return c.getContext("2d");
// }


// function datasetsFromRec(labelsTrim, seriesFull, rec, trimStartIdx, mainLabel) {
//   const Nfull = seriesFull.values.length;
//   const H = (rec?._yhat || []).length;
//   let labelsOut = labelsTrim.slice();
//   const actualTrim = seriesFull.values.slice(trimStartIdx, trimStartIdx + labelsTrim.length);

//   // palette
//   const COLOR_ACT = 'rgba(56, 189, 248, 1)';     // cyan
//   const COLOR_FIT = 'rgba(255, 115, 0, 0.9)';  // pink (visible)
//   const COLOR_FC  = 'rgba(255, 0, 200, 0.95)';  // amber

//   const sets = [
//     {
//       label: mainLabel,
//       data: actualTrim,
//       borderColor: COLOR_ACT,
//       borderWidth: 0.8,
//       pointRadius: 0,
//       tension: 0.2,
//       order: 3
//     }
//   ];

//   if (rec?._fit?.length) {
//     const padLeft = Math.max(0, Nfull - rec._fit.length);
//     const fitAlignedFull = Array(padLeft).fill(null).concat(rec._fit);
//     const fitTrim = fitAlignedFull.slice(trimStartIdx, trimStartIdx + labelsTrim.length);
//     sets.push({
//       label: "Training fit",
//       data: fitTrim,
//       borderColor: COLOR_FIT,
//       borderWidth: 2.6,
//       borderDash: [6, 4],
//       pointRadius: 0,
//       tension: 0.2,
//       order: 4
//     });
//   }

//   if (rec?._canForecast && H > 0) {
//     let last = labelsTrim[labelsTrim.length - 1] || "";
//     const future = [];
//     for (let i = 0; i < H; i++) { last = addDaysISO(last, 7); future.push(last); }
//     labelsOut = labelsOut.concat(future);

//     const forecastData = Array(labelsTrim.length).fill(null).concat(rec._yhat.slice(0, H));
//     sets[0].data = actualTrim.concat(Array(H).fill(null));
//     if (rec?._fit?.length) sets[1].data = sets[1].data.concat(Array(H).fill(null));
//     sets.push({
//       label: "Forecast",
//       data: forecastData,
//       borderColor: COLOR_FC,
//       borderWidth: 2.2,
//       borderDash: [2, 2],
//       pointRadius: 0,
//       tension: 0.2,
//       order: 2
//     });
//   }

//   return { labelsOut, sets };
// }



// function drawSeries(title, labels, datasets) {
//   ensureHoverChartControl();
//   hoverChartContainer.style.display = "block";
//   void hoverChartContainer.offsetWidth;

//   // cache for the toggle button to redraw
//   _lastDrawPayload = { title, labels, datasets };
//   _lastObservedYear = deriveLastObservedYear(labels);
//   setYTDButtonLabel(_lastObservedYear);

//   // Base (already includes Forecast from datasetsFromRec)
//   let LBL  = labels.map(String);
//   let SETS = datasets.map(d => ({ ...d }));

//   // Apply YtD slice (keeps forecast points)
//   if (window.hoverChartMode === "ytd") {
//     ({ labels: LBL, datasets: SETS } = sliceToYearYTD(LBL, SETS));
//     if (!/— YtD$/.test(title)) title += " — YtD";
//   }

//   const titleEl = hoverChartContainer.querySelector("#chartTitle");
//   if (titleEl) titleEl.textContent = title;

//   const YEARS  = LBL.map(s => s.slice(0,4));
//   const MONTHS = LBL.map(s => s.slice(5,7));

//   const ctx = sizeAndGetCtx();
//   const opts = {
//     responsive: false,
//     maintainAspectRatio: false,
//     animation: false,
//     layout: { padding: { top: 6, right: 8, bottom: 24, left: 8 } },
//     plugins: { legend: { display: true }, tooltip: { mode: "index", intersect: false } },
//     scales: {
//       x: {
//         type: "category",
//         grid: { display: false },
//         ticks: {
//           source: "labels",
//           autoSkip: false,
//           maxRotation: 0,
//           padding: 6,
//           callback: (_, i) => {
//             if (window.hoverChartMode === "ytd") {
//               const m = MONTHS[i], p = i>0 ? MONTHS[i-1] : null;
//               return (!p || m!==p) ? MONTH_ABBR[parseInt(m,10)-1] : "";
//             } else {
//               const y = YEARS[i], p = i>0 ? YEARS[i-1] : null;
//               return (!p || y!==p) ? y : "";
//             }
//           }
//         }
//       },
//       y: { ticks: { precision: 0 }, grid: { color: "rgba(255,255,255,.08)" } }
//     }
//   };

//   const data = { labels: LBL, datasets: SETS };
//   if (hoverChart) { hoverChart.data = data; hoverChart.options = opts; hoverChart.update("none"); }
//   else { hoverChart = new Chart(ctx, { type: "line", data, options: opts }); }

//   requestAnimationFrame(() => { sizeAndGetCtx(); hoverChart.resize(); hoverChart.update("none"); });
// }





// window.addEventListener("resize", () => {
//   if (!hoverChartContainer || hoverChartContainer.style.display === "none") return;
//   if (!hoverChart) return;
//   sizeAndGetCtx(); hoverChart.resize();
// });
// function trimUntilAtLeast(labels, values, threshold = TRIM_THRESHOLD, tail = FALLBACK_TAIL) {
//   let i = 0, n = values.length; while (i < n && Number(values[i] || 0) < threshold) i++;
//   if (i >= n) { const s = Math.max(0, n - tail); return { labels: labels.slice(s), values: values.slice(s), startIdx: s }; }
//   return { labels: labels.slice(i), values: values.slice(i), startIdx: i };
// }
// function getCountySeries(code, countyName) {
//   const key = `${code}|${slug(countyName)}`; if (countySeries[key]) return countySeries[key];
//   const header = countyHeaderByNorm[code]?.[slug(countyName)]; if (!header) return null;
//   const vals = weeklyRows.map(r => Number(r[header] || 0));
//   return (countySeries[key] = { labels: labelsAll, values: vals });
// }

// /* ===== STATES view ===== */
// async function renderStates() {
//   viewLevel = "state";
//   if (!usGeoJSON) { usGeoJSON = await (await fetch("https://cdn.jsdelivr.net/gh/python-visualization/folium/examples/data/us-states.json")).json(); }
//   if (statesLayer) map.removeLayer(statesLayer);
//   if (countiesLayer) { map.removeLayer(countiesLayer); countiesLayer = null; }
//   if (spasLayer) { map.removeLayer(spasLayer); spasLayer = null; }

//   statesData = {};
//   for (const code of Object.keys(stateSeries)) {
//     const key = `S:${code}`;
//     statesData[code] = buildCountsTLDR(key, stateSeries[code], `${code} — ${code2name(code)}`, { stateCode: code });
//   }
//   usTotal = Object.values(statesData).reduce((s, r) => s + Number(r?.total_till_date || 0), 0);
//   if ($usTotal) $usTotal.textContent = fmt(usTotal);

//   const sortedTotals = Object.entries(statesData).map(([code, rec]) => ({ code, total: Number(rec?.total_till_date || 0) })).sort((a, b) => b.total - a.total);

//   statesLayer = L.geoJSON(usGeoJSON, {
//     style: (feature) => {
//       const code = (feature?.id || "").toUpperCase();
//       const rec = statesData[code];
//       if (!rec) return { color: "#666", weight: 1, fillColor: "#d1d5db", fillOpacity: 0.6 };
//       // inside style:(feature)=>{...}
//       let fill;
//       if (COLOR_MODE === "yoy") {
//         const bucket = hasModelForState(code) ? yoyBucketFromSeries(rec._series) : "gray";
//         fill = bucketToColor(bucket);
//       } else {
//         fill = rankColorFrom(sortedTotals, code);
//       }

//       return { color: "#666", weight: 1, fillColor: fill, fillOpacity: 0.6 };
//     },
//     onEachFeature: (feature, layer) => {
//       const code = (feature?.id || "").toUpperCase();
//       const rec = statesData[code] || null;
//       layer.bindTooltip(tldrHTML(`${code} — ${code2name(code)}`, rec), { sticky: true, className: "tldr-tooltip" });

//       layer.on("tooltipopen", async (e) => { try { await ensureForecastForRec(rec); e.tooltip.setContent(tldrHTML(`${code} — ${code2name(code)}`, rec)); } catch { }; });

//       layer.on("mouseover", async () => {
//         layer.setStyle({ weight: 2 });
//         const s = stateSeries[code]; if (!s) return;
//         await ensureForecastForRec(rec);
//         const { labels, values, startIdx } = trimUntilAtLeast(s.labels, s.values, TRIM_THRESHOLD, FALLBACK_TAIL);
//         const { labelsOut, sets } = datasetsFromRec(labels, s, rec, startIdx, "State total");
//         drawSeries(`${code} — ${code2name(code)} (from ${labels[0] || "n/a"})`, labelsOut, sets);
//       });
//       layer.on("mouseout", () => layer.setStyle({ weight: 1 }));
//       layer.on("click", () => showCounties(code));
//     }
//   }).addTo(map);

//   map.setView([37.8, -96.9], 4);
//   if ($backButton) $backButton.style.display = "none";
//   if ($stateRow) $stateRow.style.display = "none";
//   $stateName.textContent = "United States";
//   $stateTotal.textContent = fmt(usTotal);
//   $coverage.textContent = "";
//   ensureLegend();
//   renderTop10States();
//   recolorStatesLayerAndTable();
// }
// function renderTop10States() {
//   if (!$topTableTbody) return;

//   // Title
//   if ($topTitle) $topTitle.textContent = "Top 10 States by Total Incidents";

//   // Only states that have a saved hyperparam row
//   const rows = Object.entries(statesData)
//     .filter(([code]) => hasModelForState(code))
//     .map(([code, rec]) => ({ code, total: Number(rec?.total_till_date || 0) }))
//     .sort((a, b) => b.total - a.total)
//     .slice(0, 10);

//   $topTableTbody.innerHTML = rows
//     .map((r, i) => `<tr><td>${i + 1}</td><td>${r.code} — ${code2name(r.code)}</td><td>${fmt(r.total)}</td></tr>`)
//     .join("");

//   // recolor immediately (respects YoY gating you already added)
//   recolorStatesLayerAndTable();
//   ensureModeCaption();
// }


// function ensureDataSourceLink(){
//   const url = "https://services3.arcgis.com/T4QMspbfLg3qTGWY/ArcGIS/rest/services/WFIGS_Incident_Locations/FeatureServer";
//   const host = document.querySelector(".topbar,.navbar,header,.titlebar") || document.body;
//   if (document.getElementById("dataSourceLink")) return;

//   const a = document.createElement("a");
//   a.id = "dataSourceLink";
//   a.href = url;
//   a.target = "_blank";
//   a.rel = "noopener";
//   a.textContent = "Data source: ArcGIS WFIGS";
//   host.appendChild(a);
// }
// ensureDataSourceLink();

// async function showLaParts(stateCode){
//   viewLevel = "la_parts";
//   lastStateCode = stateCode;

//   // 1) load 4-part polygons
//   const laPartsGeo = await (await fetch(new URL("../geo/la_parts.geojson", import.meta.url).href)).json();

//   // 2) build series for each part from weekly CSV loaded earlier
//   //    Your existing `weeklyRows` already holds the wide matrix. Ensure you
//   //    load ../data/weekly_matrix_la_parts.csv either (a) merged into your big CSV
//   //    or (b) parsed separately and appended to weeklyRows/field lists at init.
//   const partKeys = ["CA|Los Angeles|Part1", "CA|Los Angeles|Part2", "CA|Los Angeles|Part3", "CA|Los Angeles|Part4"];

//   const partSeries = {};
//   for (const k of partKeys){
//     const vals = weeklyRows.map(r => Number(r[k] || 0));
//     partSeries[k] = { labels: labelsAll, values: vals };
//   }

//   // 3) build TLDR records
//   const partRecs = {};
//   for (const f of laPartsGeo.features){
//     const key = `CA|Los Angeles|Part${String(f.properties?.part_id || "").trim()}`;
//     const s   = partSeries[key]; if (!s) continue;
//     const meta = { stateCode: "CA", countyName: "Los Angeles", partKey: key };
//     partRecs[key] = buildCountsTLDR(`L:${key}`, s, key.split("|").slice(-1)[0], meta);
//   }

//   // 4) layer styling
//   if (countiesLayer) { map.removeLayer(countiesLayer); countiesLayer = null; }
//   const layer = L.geoJSON(laPartsGeo, {
//     style: (feature) => {
//       const key = `CA|Los Angeles|Part${feature.properties.part_id}`;
//       const rec = partRecs[key];
//       let fill = "#d1d5db"; // gray by default
//       if (rec && hasModelForLaPart(key)){
//         fill = (COLOR_MODE === "yoy")
//           ? bucketToColor(yoyBucketFromSeries(rec._series))
//           : "#ef4444"; // we'll recolor by rank below
//       }
//       return { color: "#444", weight: 1, fillColor: fill, fillOpacity: 0.65 };
//     },
//     onEachFeature: (feature, l) => {
//       const key = `CA|Los Angeles|Part${feature.properties.part_id}`;
//       const rec = partRecs[key] || null;
//       l.bindTooltip(tldrHTML(key, rec), { sticky: true, className: "tldr-tooltip" });
//       l.on("tooltipopen", async (e) => { try { await ensureForecastForRec(rec); e.tooltip.setContent(tldrHTML(key, rec)); } catch {} });
//       l.on("mouseover", async () => {
//         l.setStyle({ weight: 2 });
//         await ensureForecastForRec(rec);
//         const { labels, startIdx } = trimUntilAtLeast(rec._series.labels, rec._series.values, TRIM_THRESHOLD, FALLBACK_TAIL);
//         const { labelsOut, sets } = datasetsFromRec(labels, rec._series, rec, startIdx, "LA part total");
//         drawSeries(`${key} (from ${labels[0]||"n/a"})`, labelsOut, sets);
//       });
//       l.on("mouseout", () => l.setStyle({ weight: 1 }));
//     }
//   }).addTo(map);
//   countiesLayer = layer; // reuse handle

//   // rank recolor among just the 4 parts (rank-mode)
//   if (COLOR_MODE === "rank"){
//     const totals = partKeys
//       .filter(k => hasModelForLaPart(k))
//       .map(k => ({ k, total: Number(partRecs[k]?.total_till_date || 0) }))
//       .sort((a,b) => b.total - a.total);
//     const idx = new Map(totals.map((o,i) => [o.k, i+1]));
//     countiesLayer.eachLayer(L => {
//       const key = `CA|Los Angeles|Part${L.feature.properties.part_id}`;
//       const rk  = idx.get(key) || 999;
//       L.setStyle({ fillColor: bucketToColor(bucketForRank(rk)) });
//     });
//   }

//   // side panel
//   $stateName.textContent = "Los Angeles County — 4 Parts";
//   $topTitle.textContent = "LA Parts by Total Incidents";
//   const rows = partKeys
//     .filter(k => hasModelForLaPart(k))
//     .map(k => ({ name: k.split("|").slice(-1)[0], total: Number(partRecs[k]?.total_till_date || 0) }))
//     .sort((a,b) => b.total - a.total);
//   $topTableTbody.innerHTML = rows.map((r,i)=>`<tr><td>${i+1}</td><td>${r.name}</td><td>${r.total.toLocaleString()}</td></tr>`).join("");

//   ensureLegend();
//   recolorCountiesLayerAndTable(); // re-use row recolor logic
// }


// /* ===== COUNTIES view ===== */
// async function showCounties(code) {
//   viewLevel = "county"; lastStateCode = code;

//   // Build counties GeoJSON (only the selected state's counties)
//   const usCountiesGeo = await (await fetch("https://raw.githubusercontent.com/plotly/datasets/master/geojson-counties-fips.json")).json();
//   const prefix = stateCodeToFipsPrefix(code);
//   const features = usCountiesGeo.features.filter(f => {
//     const raw = f.id ?? f.properties?.GEOID ?? f.properties?.COUNTYFP;
//     return String(raw ?? "").padStart(5, "0").startsWith(prefix);
//   });

//   // Build lightweight TLDR per county (counts only; ESN forecast is lazy)
//   const countyRecs = {};
//   for (const f of features) {
//     const fips = String(f.id ?? f.properties?.GEOID ?? f.properties?.COUNTYFP).padStart(5, "0");
//     const name = f.properties?.NAME || f.properties?.NAME10 || "";
//     const s = getCountySeries(code, `${name} County`) || getCountySeries(code, name);
//     if (!s) continue;
//     const key = `C:${code}|${fips}`;
//     const meta = { stateCode: code, countyFips: fips, countyName: name };
//     countyRecs[f.id] = buildCountsTLDR(key, s, `${name} County`, meta);
//   }

//   // Rank within the state for rank-mode coloring
//   const sortedTotals = Object.entries(countyRecs).map(([fid, rec]) => ({ fid, total: Number(rec?.total_till_date || 0) })).sort((a, b) => b.total - a.total);

//   if (countiesLayer) map.removeLayer(countiesLayer);

//   countiesLayer = L.geoJSON({ type: "FeatureCollection", features }, {
//   style: (feature) => {
//     const rec  = countyRecs[feature.id] || null;
//     const name = feature.properties?.NAME || "";
//     const fips = String(feature.id ?? feature.properties?.GEOID ?? feature.properties?.COUNTYFP).padStart(5, "0");
//     const ok   = hasModelForCounty(code, fips, name);

//     // default: gray if no saved hyperparams for this county
//     let fill = "#d1d5db";

//     if (rec && ok) {
//       if (COLOR_MODE === "yoy") {
//         fill = bucketToColor(yoyBucketFromSeries(rec._series));
//       } else {
//         // rank among ONLY ok counties
//         // (we compute this again here for first paint; recolor() will correct after)
//         // quick local rank:
//         const allOK = Object.entries(countyRecs)
//           .filter(([fid, r]) => {
//             const nm = r.title.replace(/ County$/, "");
//             const f  = String(fid).padStart(5, "0");
//             return hasModelForCounty(code, f, nm);
//           })
//           .map(([fid, r]) => ({ fid, total: Number(r?.total_till_date || 0) }))
//           .sort((a, b) => b.total - a.total);
//         const idx = allOK.findIndex(x => x.fid === feature.id);
//         const rk  = idx >= 0 ? idx + 1 : 999;
//         fill = bucketToColor(bucketForRank(rk));
//       }
//     }

//     return { color: "#444", weight: 1, fill: true, fillColor: fill, fillOpacity: 0.65 };
//   },

//     onEachFeature: (feature, layer) => {
//       const name = feature.properties?.NAME || "";
//       const rec = countyRecs[feature.id] || null;

//       feature._tldrRec = rec; // attach for recolor + tooltip refresh
//       layer.bindTooltip(tldrHTML(name, rec), { sticky: true, className: "tldr-tooltip" });

//       layer.on("tooltipopen", async (e) => { try { await ensureForecastForRec(feature._tldrRec); e.tooltip.setContent(tldrHTML(name, feature._tldrRec)); } catch { }; });

//       layer.on("mouseover", async () => {
//         layer.setStyle({ weight: 2 });
//         const s = getCountySeries(code, name) || getCountySeries(code, `${name} County`); if (!s) return;
//         const recNow = feature._tldrRec;
//         await ensureForecastForRec(recNow);
//         const { labels, values, startIdx } = trimUntilAtLeast(s.labels, s.values, TRIM_THRESHOLD, FALLBACK_TAIL);
//         const { labelsOut, sets } = datasetsFromRec(labels, s, recNow, startIdx, "County total");
//         drawSeries(`${name}, ${code} (from ${labels[0] || "n/a"})`, labelsOut, sets);
//       });
//       layer.on("mouseout", () => layer.setStyle({ weight: 1 }));

//       // inside showCounties("CA") onEachFeature click handler:
//       layer.on("click", () => {
//         const name = layer.feature?.properties?.NAME || "";
//         const isLA = name.toLowerCase() === "los angeles";
//         if (isLA) showLaParts("CA"); else showCountyDetail("CA", name /* ... if you keep county-by-county detail */);
//       });

//     }
//   }).addTo(map);

//   countiesLayer.eachLayer(l => l.bringToFront()); // on top

//   // Zoom to state counties and dim other states
//   map.fitBounds(countiesLayer.getBounds(), { padding: [10, 10] });
//   setStatesDimForCounty(code);

//   // Side panel numbers/titles
//   const srec = statesData[code] || buildCountsTLDR(`S:${code}`, stateSeries[code], code, { stateCode: code });
//   if ($stateRow) $stateRow.style.display = "";
//   $stateName.textContent = code2name(code) + " Total Incidents";
//   $stateTotal.textContent = fmt(srec.total_till_date || 0);
//   $coverage.textContent = srec?.last_obs_week?.end ? `Coverage through → ${srec.last_obs_week.end}` : "";

//   if ($backButton) { $backButton.style.display = "inline-block"; $backButton.textContent = "← Back to US"; }

//   // Top 8 table (only counties that have saved hyperparams)
//   if ($topTitle) $topTitle.textContent = `Top 8 Counties in ${code2name(code)} by Total Incidents`;

//   if ($topTableTbody) {
//     const rows = Object.values(countiesLayer._layers)
//       .map(l => {
//         const name = l.feature?.properties?.NAME || "";
//         const fips = String(
//           l.feature?.id ?? l.feature?.properties?.GEOID ?? l.feature?.properties?.COUNTYFP
//         ).padStart(5, "0");
//         const rec = l.feature?._tldrRec;
//         return { name, fips, total: Number(rec?.total_till_date || 0) };
//       })
//       // ✅ keep only counties that actually have a saved hyperparam row
//       .filter(r => hasModelForCounty(code, r.fips, r.name))
//       .sort((a, b) => b.total - a.total)
//       .slice(0, 10);

//     $topTableTbody.innerHTML = rows
//       .map((r, i) => `<tr><td>${i + 1}</td><td>${r.name} County</td><td>${fmt(r.total)}</td></tr>`)
//       .join("");
//   }

//   // after rebuilding the rows, recolor them according to the active mode
//   recolorCountiesLayerAndTable();


//   ensureLegend();
//   recolorCountiesLayerAndTable();
//   ensureModeCaption();
// }

// /* === State dimming when entering county view === */
// function setStatesDimForCounty(selectedCode) {
//   if (!statesLayer) return;
//   statesLayer.eachLayer(l => {
//     const code = (l.feature?.id || "").toUpperCase();
//     if (code === selectedCode) l.setStyle({ fillOpacity: 0, color: "#666", weight: 2 });
//     else l.setStyle({ fill: true, fillColor: "#d1d5db", fillOpacity: 0.15, color: "#666", weight: 1 });
//   });
// }
// function resetStatesDim() { if (!statesLayer) return; statesLayer.eachLayer(l => statesLayer.resetStyle(l)); }

// async function backToUSFast() {
//   viewLevel = "state";
//   if (countiesLayer) { map.removeLayer(countiesLayer); countiesLayer = null; }
//   resetStatesDim();
//   if ($backButton) $backButton.style.display = "none";
//   if ($stateRow) $stateRow.style.display = "none";
//   $stateName.textContent = "United States";
//   $stateTotal.textContent = fmt(usTotal);
//   $coverage.textContent = "";
//   map.setView([37.8, -96.9], 4);
//   ensureLegend(); renderTop10States(); recolorStatesLayerAndTable();
// }

// /* ===== init ===== */
// async function init() {
//   const Splash = window.Splash || { setProgress() {}, hide() {} };
//   Splash.setProgress(5);
//   map = L.map("map", { zoomControl: true });
//   const positron = L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
//     { attribution: "&copy; OpenStreetMap &copy; CARTO", subdomains: "abcd", maxZoom: 19 }).addTo(map);
//   const esriSat = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
//     { attribution: "Tiles © Esri" });
//   L.control.layers({ "Positron (light)": positron, "Satellite (Esri)": esriSat }, {}).addTo(map);

//   Splash.setProgress(25);
//   const [wText] = await Promise.all([loadText(WEEKLY_CSV_URL), loadHyperparams()]);
//   const parsed = await parseCSV(wText);
//   buildIndexes(parsed);
//   Splash.setProgress(75);

//   await renderStates();            // build layers AFTER constants are defined
//   setColorMode("rank");            // preselect YtD safely here
//   ensureModeCaption();             // update the caption under the table

//   Splash.setProgress(100);
//   Splash.hide();
// }

// $backButton?.addEventListener("click", async () => { if (viewLevel === "county") await backToUSFast(); });

// init().catch(e => { console.error("App init fatal:", e); alert("Failed to initialize app. Check console."); });

// // expose color mode switch
// window.setColorMode = setColorMode;



/* assets/js/app.js — ESN in-browser + colors + legend + chart
   Drill-down: US → State → Counties → (Los Angeles only) 4 Parts
   LA parts weekly CSV is loaded SEPARATELY (no merge). */

const WEEKLY_CSV_URL = new URL("../weekly_matrix_by_county.csv", import.meta.url).href;
const WEEKLY_LA_PARTS_URL = new URL("../geo/weekly_matrix_la_parts.csv", import.meta.url).href;
// Direct GeoJSON download (WGS84)
const LACOFD_BATTALIONS_GEOJSON =
  "https://opendata.arcgis.com/api/v3/datasets/dfd4ad2935cb448aae650f83c22b9cae_0/downloads/data?format=geojson&spatialRefId=4326";

const HYPER_STATES_URL = new URL("../esn_hyperparams_state_dashboard.csv", import.meta.url).href;
const HYPER_COUNTY_URL = new URL("../esn_hyperparams.csv", import.meta.url).href;     // county models
// const HYPER_GENERIC_URL = new URL("../esn_hyperparams.csv", import.meta.url).href;     // optional single-row fallback

// If you want counties to fall back to the state’s row when no county row exists:
const ALLOW_COUNTY_FALLBACK_TO_STATE = false;
let laBattalionOutlineLayer = null;   // handle so we can remove it

import { ESNRunner } from "./esn.js";
const ESN = new ESNRunner(new URL("./esn_worker.js", import.meta.url).href);

/* Tunables */
const TRIM_THRESHOLD = 10;
const FALLBACK_TAIL = 52;

/* Caches & globals */
const forecastCache = new Map(); // key -> { yfit, yhat, H }

/* UI handles */
const $stateRow = document.querySelector("#stateName")?.closest(".metric");
const $usTotal = document.querySelector("#usTotal");
const $stateName = document.querySelector("#stateName");
const $stateTotal = document.querySelector("#stateTotal");
const $coverage = document.querySelector("#coverage");
const $backButton = document.querySelector("#backButton");
const $topTitle = document.querySelector("#topTitle");
const $topTableTbody =
  document.querySelector("#top10 tbody") || document.querySelector("#topTable tbody");

/* Map + data globals */
let map, statesLayer, countiesLayer, spasLayer, usGeoJSON = null;
let weeklyRows = [], labelsAll = [];                   // states + counties (big matrix)
let laPartsRows = [], laPartsLabels = [];              // LA parts (separate CSV)
let stateColumns = {}, countyHeaderByNorm = {};
let statesData = {}, usTotal = 0;
let stateSeries = {}, countySeries = {};               // derived from big matrix
let viewLevel = "state", lastStateCode = null;
let hoverChart, hoverChartContainer;                   // "all" | "ytd"
let _lastDrawPayload = null;                           // { title, labels, datasets }
let _lastObservedYear = null;                          // e.g., "2025"

/* Color mode (Rank default; YoY optional) */
let COLOR_MODE = "rank"; // "rank" | "yoy"

/* Debug */
window.__WF_DEBUG__ = false;
const D = (...a) => { if (window.__WF_DEBUG__) console.log("[WF]", ...a); };

/* LA-part hyperparams */
let HYP_LA_PARTS = Object.create(null); // key: "CA|Los Angeles|Part1" -> hyper
function hasModelForLaPart(partKey) { return Boolean(HYP_LA_PARTS && HYP_LA_PARTS[partKey]); }
function hyperForLaPart(partKey) { return HYP_LA_PARTS[partKey] || HYP_GENERIC; }

/* One global toggle remembered between draws */
window.hoverChartMode = window.hoverChartMode || "all";  // "all" | "ytd"

const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// NEW: context to recolor LA parts on mode changes
let laPartsContext = { layer: null, recs: null, nameByKey: null };

// NEW: drop-in battalion outline remover
function removeLaBattalionOutline() {
  if (laBattalionOutlineLayer && map) {
    map.removeLayer(laBattalionOutlineLayer);
  }
  laBattalionOutlineLayer = null;
}

// NEW: recolor polygons + table when in LA-parts view
function recolorLaPartsLayerAndTable() {
  if (!laPartsContext.layer || !laPartsContext.recs) return;

  // rank among parts that have saved models
  const okKeys = Object.keys(laPartsContext.recs).filter(k => hasModelForLaPart(k));
  const totals = okKeys
    .map(k => ({ k, total: Number(laPartsContext.recs[k]?.total_till_date || 0) }))
    .sort((a, b) => b.total - a.total);
  const rankIndex = new Map(totals.map((o, i) => [o.k, i + 1]));

  // polygons
  laPartsContext.layer.eachLayer(L => {
    const key = `CA|Los Angeles|Part${L.feature.properties.part_id}`;
    const rec = laPartsContext.recs[key];
    let fill = "#d1d5db";
    if (rec && hasModelForLaPart(key)) {
      fill = (COLOR_MODE === "yoy")
        ? bucketToColor(yoyBucketFromSeries(rec._series))
        : bucketToColor(bucketForRank(rankIndex.get(key) || 999));
    }
    L.setStyle({ fillColor: fill });
  });

  // table rows (match by displayed name)
  const tbody = $topTableTbody; if (!tbody) return;
  Array.from(tbody.querySelectorAll("tr")).forEach((tr, i) => {
    let bucket = "gray";
    const dispName = tr.children?.[1]?.textContent?.trim() || "";
    const key = laPartsContext.nameByKey?.[dispName]; // "Northwest" -> "CA|Los Angeles|PartN"
    const rec = key ? laPartsContext.recs[key] : null;

    if (COLOR_MODE === "rank") {
      const rk = key ? (rankIndex.get(key) || 999) : 999;
      bucket = bucketForRank(rk);
    } else {
      bucket = rec ? yoyBucketFromSeries(rec._series) : "gray";
    }
    tr.style.background = bucketToColor(bucket);
    tr.style.color = (bucket === "gray" ? "#111" : "#0b1220");
  });
}


// NEW: very small centroid helper (Polygon/MultiPolygon)
function featureCentroidLL(geom) {
  const polys = (geom.type === "MultiPolygon") ? geom.coordinates : [geom.coordinates];
  let sx = 0, sy = 0, n = 0;
  for (const poly of polys) {
    // outer ring only is fine for a quick compass name
    const ring = poly[0] || [];
    for (const [x, y] of ring) { sx += x; sy += y; n++; }
  }
  if (!n) return { lon: 0, lat: 0 };
  return { lon: sx / n, lat: sy / n };
}

// NEW: assign NW/NE/SW/SE by centroid relative to overall center
function compassNamesForLaParts(geojson) {
  const cents = geojson.features.map(f => ({
    id: String(f.properties?.part_id ?? f.properties?.id ?? ""),
    ...featureCentroidLL(f.geometry)
  }));
  const cx = cents.reduce((s, c) => s + c.lon, 0) / cents.length;
  const cy = cents.reduce((s, c) => s + c.lat, 0) / cents.length;

  const tag = (c) => {
    const east = c.lon >= cx;
    const north = c.lat >= cy;
    if (north && !east) return "Northwest";
    if (north && east) return "Northeast";
    if (!north && !east) return "Southwest";
    return "Southeast";
  };

  const nameByPartId = {};
  const used = new Set();
  for (const c of cents) {
    let nm = tag(c);
    // Just in case two land in same quadrant, add a “(2)” suffix
    if (used.has(nm)) {
      let k = 2; while (used.has(`${nm} ${k}`)) k++;
      nm = `${nm} ${k}`;
    }
    used.add(nm);
    nameByPartId[c.id] = nm;
  }
  return nameByPartId; // { "1":"Northwest", ... }
}


function drawSeries(title, labels, datasets) {
  ensureHoverChartControl();
  hoverChartContainer.style.display = "block";
  void hoverChartContainer.offsetWidth;

  // cache for the toggle button to redraw
  _lastDrawPayload = { title, labels, datasets };
  _lastObservedYear = deriveLastObservedYear(labels);
  setYTDButtonLabel(_lastObservedYear);

  // Base (already includes Forecast from datasetsFromRec)
  let LBL = labels.map(String);
  let SETS = datasets.map(d => ({ ...d }));

  // Apply YtD slice (keeps forecast points)
  if (window.hoverChartMode === "ytd") {
    ({ labels: LBL, datasets: SETS } = sliceToYearYTD(LBL, SETS));
    if (!/— YtD$/.test(title)) title += " — YtD";
  }

  const titleEl = hoverChartContainer.querySelector("#chartTitle");
  if (titleEl) titleEl.textContent = title;

  const YEARS = LBL.map(s => s.slice(0, 4));
  const MONTHS = LBL.map(s => s.slice(5, 7));

  const ctx = sizeAndGetCtx();
  const opts = {
    responsive: false,
    maintainAspectRatio: false,
    animation: false,
    layout: { padding: { top: 6, right: 8, bottom: 24, left: 8 } },
    plugins: { legend: { display: true }, tooltip: { mode: "index", intersect: false } },
    scales: {
      x: {
        type: "category",
        grid: { display: false },
        ticks: {
          source: "labels",
          autoSkip: false,
          maxRotation: 0,
          padding: 6,
          callback: (_, i) => {
            if (window.hoverChartMode === "ytd") {
              const m = MONTHS[i], p = i > 0 ? MONTHS[i - 1] : null;
              return (!p || m !== p) ? MONTH_ABBR[parseInt(m, 10) - 1] : "";
            } else {
              const y = YEARS[i], p = i > 0 ? YEARS[i - 1] : null;
              return (!p || y !== p) ? y : "";
            }
          }
        }
      },
      y: { ticks: { precision: 0 }, grid: { color: "rgba(255,255,255,.08)" } }
    }
  };

  const data = { labels: LBL, datasets: SETS };
  if (hoverChart) { hoverChart.data = data; hoverChart.options = opts; hoverChart.update("none"); }
  else { hoverChart = new Chart(ctx, { type: "line", data, options: opts }); }

  requestAnimationFrame(() => { sizeAndGetCtx(); hoverChart.resize(); hoverChart.update("none"); });
}

/* ===== helpers: labels/years ===== */
function deriveLastObservedYear(labels) {
  for (let i = labels.length - 1; i >= 0; i--) {
    const y = String(labels[i] ?? "").slice(0, 4);
    if (/^\d{4}$/.test(y)) return y;
  }
  return String(new Date().getUTCFullYear());
}
function sliceToYearYTD(labels, datasets) {
  const yr = deriveLastObservedYear(labels);
  const start = labels.findIndex(s => String(s).startsWith(`${yr}-`));
  if (start <= 0) return { labels, datasets };
  return {
    labels: labels.slice(start),
    datasets: datasets.map(ds => ({ ...ds, data: ds.data.slice(start) }))
  };
}
function setYTDButtonLabel(yearStr) {
  const btn = hoverChartContainer?.querySelector("#ytdToggle");
  if (btn) btn.textContent = `(${yearStr} YtD toggle)`;
}

/* ===== color-mode switch + recolor helpers ===== */
function setColorMode(mode) {
  COLOR_MODE = (mode === "yoy") ? "yoy" : "rank";
  ensureLegend();
  recolorActiveView();

  // toggle active classes on the two pills
  const rankBtn = document.getElementById("colorRank");
  const yoyBtn = document.getElementById("colorYoY");
  rankBtn?.classList.toggle("is-active", COLOR_MODE === "rank");
  yoyBtn?.classList.toggle("is-active", COLOR_MODE === "yoy");

  ensureModeCaption();
}
window.setColorMode = setColorMode;
document.getElementById("colorRank")?.addEventListener("click", () => setColorMode("rank"));
document.getElementById("colorYoY")?.addEventListener("click", () => setColorMode("yoy"));
window.addEventListener("keydown", (e) => { if (e.key.toLowerCase() === "r") setColorMode("rank"); if (e.key.toLowerCase() === "y") setColorMode("yoy"); });

/* ===== YoY buckets ===== */
const YOY_WINDOW_W = 4;   // compare last 4 weeks…
const YOY_BASE_LAG = 52;  // …to the same period 52w earlier
const YOY_THRESH = { red: 1.20, yellow: 0.95 }; // >+20%, -5%..+20%, < -5%
// Only handle mouse events for the active view
function handleNow(view) { return viewLevel === view; }

function yoyBucketFromArray(arr) {
  const v = (arr || []).map(x => Number(x || 0));
  const n = v.length;
  if (n < YOY_BASE_LAG + YOY_WINDOW_W + 1) return "gray";
  let end = n - 1; while (end > 0 && !isFinite(v[end])) end--;
  const start = Math.max(0, end - (YOY_WINDOW_W - 1));
  let cur = 0; for (let i = start; i <= end; i++) cur += v[i] || 0;
  const ps = start - YOY_BASE_LAG, pe = end - YOY_BASE_LAG;
  if (ps < 0 || pe < 0) return "gray";
  let prev = 0; for (let i = ps; i <= pe; i++) prev += v[i] || 0;
  if (prev <= 0) return "gray";
  const r = cur / prev;
  if (r > YOY_THRESH.red) return "r";
  if (r >= YOY_THRESH.yellow) return "y";
  return "g";
}
const yoyBucketFromSeries = (series) => yoyBucketFromArray(series?.values || series || []);
const yoyBucketForState = (code) => stateSeries[code] ? yoyBucketFromArray(stateSeries[code].values) : "gray";
function bucketToColor(bucket) { if (bucket === "r") return "#ef4444"; if (bucket === "y") return "#facc15"; if (bucket === "g") return "#10b981"; return "#d1d5db"; }
function bucketForRank(idx) { if (idx >= 1 && idx <= 3) return "r"; if (idx <= 7) return "y"; if (idx <= 10) return "g"; return "gray"; }

/* ===== recolor ===== */
function recolorActiveView() {
  if (viewLevel === "state") recolorStatesLayerAndTable();
  else if (viewLevel === "county") recolorCountiesLayerAndTable();
  else if (viewLevel === "la_parts") recolorLaPartsLayerAndTable();   // NEW
}
function trimUntilAtLeast(labels, values, threshold = TRIM_THRESHOLD, tail = FALLBACK_TAIL) {
  let i = 0, n = values.length; while (i < n && Number(values[i] || 0) < threshold) i++;
  if (i >= n) { const s = Math.max(0, n - tail); return { labels: labels.slice(s), values: values.slice(s), startIdx: s }; }
  return { labels: labels.slice(i), values: values.slice(i), startIdx: i };
}
function recolorStatesLayerAndTable() {
  if (!statesLayer) return;
  const ranked = Object.entries(statesData)
    .map(([code, rec]) => ({ code, total: Number(rec?.total_till_date || 0) }))
    .sort((a, b) => b.total - a.total);
  const rankIndex = new Map(ranked.map((r, i) => [r.code, i + 1]));

  // 1) Map recolor
  statesLayer.eachLayer(l => {
    const code = (l.feature?.id || "").toUpperCase();
    let fill;
    if (COLOR_MODE === "rank") fill = bucketToColor(bucketForRank(rankIndex.get(code) || 999));
    else {
      const bucket = hasModelForState(code) ? yoyBucketForState(code) : "gray";
      fill = bucketToColor(bucket);
    }
    l.setStyle({ fillColor: fill });
  });

  // 2) Table recolor
  const tbody = document.querySelector("#top10 tbody"); if (!tbody) return;
  Array.from(tbody.querySelectorAll("tr")).forEach((tr, i) => {
    let bucket = "gray";
    if (COLOR_MODE === "rank") bucket = bucketForRank(i + 1);
    else {
      const stateCode = tr.children[1].textContent.split("—")[0].trim();
      bucket = hasModelForState(stateCode) ? yoyBucketForState(stateCode) : "gray";
    }
    tr.style.background = bucketToColor(bucket);
    tr.style.color = (bucket === "gray" ? "#111" : "#0b1220");
  });
}

function recolorCountiesLayerAndTable() {
  if (!countiesLayer) return;

  const items = Object.values(countiesLayer._layers).map(l => {
    const rec = l.feature?._tldrRec;
    const name = l.feature?.properties?.NAME || "";
    const raw = l.feature?.id ?? l.feature?.properties?.GEOID ?? l.feature?.properties?.COUNTYFP;
    const fid = String(raw ?? "").padStart(5, "0");
    const ok = hasModelForCounty(lastStateCode, fid, name);
    return { fid, name, rec, total: Number(rec?.total_till_date || 0), ok };
  });

  const rankedOK = items.filter(x => x.ok).sort((a, b) => b.total - a.total);
  const rankIndex = new Map(rankedOK.map((r, i) => [r.fid, i + 1]));

  // Polygons
  countiesLayer.eachLayer(l => {
    const name = l.feature?.properties?.NAME || "";
    const raw = l.feature?.id ?? l.feature?.properties?.GEOID ?? l.feature?.properties?.COUNTYFP;
    const fid = String(raw ?? "").padStart(5, "0");
    const rec = l.feature?._tldrRec;
    const ok = hasModelForCounty(lastStateCode, fid, name);

    let fill = "#d1d5db"; // gray if no saved model
    if (rec && ok) {
      if (COLOR_MODE === "rank") fill = bucketToColor(bucketForRank(rankIndex.get(fid) || 999));
      else fill = bucketToColor(yoyBucketFromSeries(rec._series));
    }
    l.setStyle({ fillColor: fill });
  });

  // Rows
  const tbody = document.querySelector("#top10 tbody"); if (!tbody) return;
  Array.from(tbody.querySelectorAll("tr")).forEach((tr, i) => {
    let bucket = "gray";
    if (COLOR_MODE === "rank") bucket = bucketForRank(i + 1);
    else {
      const name = tr.children[1].textContent.replace(/ County$/, "").trim();
      const layer = Object.values(countiesLayer._layers).find(L =>
        (L.feature?.properties?.NAME || "").toLowerCase() === name.toLowerCase()
      );
      if (layer?.feature?._tldrRec) bucket = yoyBucketFromSeries(layer.feature._tldrRec._series);
    }
    tr.style.background = bucketToColor(bucket);
    tr.style.color = (bucket === "gray" ? "#111" : "#0b1220");
  });
}

/* ===== misc utils ===== */
function fmt(n) { if (n === "…") return "…"; n = Number(n || 0); return isFinite(n) ? n.toLocaleString() : "0"; }
function rng(a, b) { if (!a && !b) return "n/a"; if (a && b) return `${a} – ${b}`; return a || b || "n/a"; }
const STATE_NAME = {
  "AL": "Alabama", "AK": "Alaska", "AZ": "Arizona", "AR": "Arkansas", "CA": "California", "CO": "Colorado", "CT": "Connecticut",
  "DE": "Delaware", "FL": "Florida", "GA": "Georgia", "HI": "Hawaii", "ID": "Idaho", "IL": "Illinois", "IN": "Indiana", "IA": "Iowa", "KS": "Kansas", "KY": "Kentucky",
  "LA": "Louisiana", "ME": "Maine", "MD": "Maryland", "MA": "Massachusetts", "MI": "Michigan", "MN": "Minnesota", "MS": "Mississippi", "MO": "Missouri", "MT": "Montana",
  "NE": "Nebraska", "NV": "Nevada", "NH": "New Hampshire", "NJ": "New Jersey", "NM": "New Mexico", "NY": "New York", "NC": "North Carolina", "ND": "North Dakota",
  "OH": "Ohio", "OK": "Oklahoma", "OR": "Oregon", "PA": "Pennsylvania", "RI": "Rhode Island", "SC": "South Carolina", "SD": "South Dakota", "TN": "Tennessee",
  "TX": "Texas", "UT": "Utah", "VT": "Vermont", "VA": "Virginia", "WA": "Washington", "WV": "West Virginia", "WI": "Wisconsin", "WY": "Wyoming", "DC": "District of Columbia"
};
function code2name(c) { return STATE_NAME[c] || c; }
function slug(s) { return (s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "").trim(); }
function stateCodeToFipsPrefix(code) {
  const m = {
    "AL": "01", "AK": "02", "AZ": "04", "AR": "05", "CA": "06", "CO": "08", "CT": "09", "DE": "10", "FL": "12", "GA": "13", "HI": "15",
    "ID": "16", "IL": "17", "IN": "18", "IA": "19", "KS": "20", "KY": "21", "LA": "22", "ME": "23", "MD": "24", "MA": "25", "MI": "26", "MN": "27", "MS": "28", "MO": "29", "MT": "30",
    "NE": "31", "NV": "32", "NH": "33", "NJ": "34", "NM": "35", "NY": "36", "NC": "37", "ND": "38", "OH": "39", "OK": "40", "OR": "41", "PA": "42", "RI": "44", "SC": "45", "SD": "46",
    "TN": "47", "TX": "48", "UT": "49", "VT": "50", "VA": "51", "WA": "53", "WV": "54", "WI": "55", "WY": "56", "DC": "11"
  }; return m[code] || "";
}
async function loadText(url) { const r = await fetch(url, { cache: "no-store" }); if (!r.ok) throw new Error(r.statusText); return r.text(); }
function parseCSV(text) {
  return new Promise((res, rej) => {
    if (!window.Papa) return rej(new Error("Papa Parse missing"));
    Papa.parse(text, { header: true, dynamicTyping: true, skipEmptyLines: true, complete: o => res(o), error: rej });
  });
}
function addDaysISO(isoStr, days) { if (!isoStr) return ""; const d = new Date(isoStr); if (isNaN(d)) return ""; d.setUTCDate(d.getUTCDate() + Number(days || 0)); return d.toISOString().slice(0, 10); }
function normalizeCountyName(s) { return (s || "").replace(/\b(County|Parish|Borough|Census Area|City|Municipality)\b/gi, "").trim(); }
const countyNameKey = (st, name) => `${st}|${slug(String(name).replace(/\b(County|Parish|Borough|Census Area|City|Municipality)\b/gi, ""))}`;

/* ===== Build indexes from weekly CSV (states + counties) ===== */
function buildIndexes(papaOut) {
  weeklyRows = papaOut.data;
  labelsAll = weeklyRows.map(r => String(r.week_start));
  const fields = papaOut.meta?.fields || [];
  stateColumns = {}; countyHeaderByNorm = {};

  for (const f of fields) {
    if (f === "week_start") continue;
    const [code, ...rest] = f.split("|");
    if (!STATE_NAME[code]) continue;
    const county = (rest.join("|") || "").trim();
    (stateColumns[code] ||= []).push(f);
    (countyHeaderByNorm[code] ||= {})[slug(county.replace(/\b(County|Parish|Borough|Census Area|City|Municipality)\b/gi, ""))] = f;
    countyHeaderByNorm[code][slug(county)] = f;
  }

  stateSeries = {};
  for (const code of Object.keys(stateColumns)) {
    const cols = stateColumns[code];
    const vals = weeklyRows.map(row => cols.reduce((s, c) => s + Number(row[c] || 0), 0));
    stateSeries[code] = { labels: labelsAll, values: vals };
  }
}

function rowToHyper(r) {
  const b2b = (v) => {
    if (typeof v === "boolean") return v;
    if (v === 1 || v === "1") return true;
    if (typeof v === "string") return v.toLowerCase() === "true";
    return false;
  };

  // normalize scale text
  let scaleTxt = String(r.scale ?? r.scale_name ?? "").toLowerCase().trim();
  if (scaleTxt === "log" || scaleTxt === "log1p") scaleTxt = "log1p";
  if (!scaleTxt) scaleTxt = b2b(r.scale_option) ? "log1p" : "none";

  return {
    reservoir_size: Number(r.reservoir_size ?? r.n_res ?? r.Nh ?? 200),
    spectral_radius: Number(r.spectral_radius ?? r.sr ?? 0.95),
    leak_rate: Number(r.leak_rate ?? r.alpha ?? 1.0),
    ridge: Number(r.ridge ?? r.ridge_lambda ?? r.l2 ?? 1e-2),
    input_scale: Number(r.input_scale ?? r.input_scaling ?? r.scale ?? 0.5),
    bias: Number(r.bias ?? 0.0),

    washout: Number(r.washout ?? r.warmup_steps ?? 50),
    horizon: Number(r.horizon ?? r.horizon_weeks ?? 4),
    lag: Number(r.lag ?? 0),
    trim_threshold: Number(r.trim_threshold ?? 0),

    sparsity: Number(r.sparsity ?? 0.10),
    noise: Number(r.noise ?? 0),

    scale: scaleTxt,                 // <-- now honors CSV "scale"
    seed: Number(r.seed ?? r.random_seed ?? 42),
    deterministic: b2b(r.deterministic),
  };
}


let HYP_STATE = {}, HYP_GENERIC = {};
let HYP_COUNTY_BY_FIPS = Object.create(null);
let HYP_COUNTY_BY_NAME = Object.create(null);

async function loadHyperparams() {
  // states
  try {
    const t1 = await loadText(HYPER_STATES_URL);
    const p1 = await parseCSV(t1);
    HYP_STATE = {};
    for (const r of p1.data) {
      const st = String(r.state || r.code || "").trim().toUpperCase();
      if (STATE_NAME[st]) HYP_STATE[st] = rowToHyper(r);
    }
  } catch { }

  // optional generic (single row)
  try {
    const t2 = await loadText(HYPER_GENERIC_URL);
    const p2 = await parseCSV(t2);
    HYP_GENERIC = rowToHyper(p2.data[0] || {});
  } catch { HYP_GENERIC = rowToHyper({}); }

  // counties
  try {
    const t3 = await loadText(HYPER_COUNTY_URL);
    const p3 = await parseCSV(t3);
    HYP_COUNTY_BY_FIPS = Object.create(null);
    HYP_COUNTY_BY_NAME = Object.create(null);
    for (const r of p3.data) {
      const st = String(r.state || r.st || "").trim().toUpperCase();
      const nm = String(r.county || r.name || "").trim();
      const fips = (r.fips != null ? String(r.fips) : (r.geoid != null ? String(r.geoid) : "")).padStart(5, "0");
      if (!st || (!nm && !fips)) continue;
      const hyp = rowToHyper(r);
      if (/^\d{5}$/.test(fips)) HYP_COUNTY_BY_FIPS[fips] = hyp;
      if (nm) HYP_COUNTY_BY_NAME[countyNameKey(st, nm)] = hyp;
    }
  } catch { }

  // LA parts
  try {
    const t4 = await loadText(new URL("../esn_hyperparams_la_parts.csv", import.meta.url).href);
    const p4 = await parseCSV(t4);
    HYP_LA_PARTS = Object.create(null);
    for (const r of p4.data) {
      if ((r.level || "").toLowerCase() !== "la_part") continue;
      const key = `CA|Los Angeles|${String(r.part).trim()}`;
      HYP_LA_PARTS[key] = rowToHyper(r);
    }
  } catch {
    window.console?.warn("Failed to load LA parts hyperparameters");
  }
}

function hasSavedHyperparamsForKey(key, meta = {}) {
  const ks = String(key);
  if (ks.startsWith("S:")) {
    const st = meta.stateCode || ks.slice(2);
    return !!HYP_STATE[st];
  }
  if (ks.startsWith("C:")) {
    const fips = meta.countyFips ? String(meta.countyFips).padStart(5, "0") : null;
    const st = meta.stateCode, nm = meta.countyName;
    if (fips && HYP_COUNTY_BY_FIPS[fips]) return true;
    if (st && nm && HYP_COUNTY_BY_NAME[countyNameKey(st, nm)]) return true;
    return ALLOW_COUNTY_FALLBACK_TO_STATE ? !!HYP_STATE[st] : false;
  }
  if (ks.startsWith("L:")) {
    // LA parts → meta.partKey is "CA|Los Angeles|PartN"
    const partKey = meta.partKey || ks.slice(2);
    return hasModelForLaPart(partKey);
  }
  return false;
}

function allowForecastForKey(key, meta = {}) {
  // same logic as hasSavedHyperparamsForKey (kept separate for clarity)
  return hasSavedHyperparamsForKey(key, meta);
}

function hyperForKey(key, meta = {}) {
  const ks = String(key);
  if (ks.startsWith("S:")) {
    const sc = meta.stateCode || ks.slice(2);
    return HYP_STATE[sc] || HYP_GENERIC;
  }
  if (ks.startsWith("C:")) {
    const st = meta.stateCode;
    const fips = meta.countyFips ? String(meta.countyFips).padStart(5, "0") : null;
    const nm = meta.countyName;
    if (fips && HYP_COUNTY_BY_FIPS[fips]) return HYP_COUNTY_BY_FIPS[fips];
    if (st && nm && HYP_COUNTY_BY_NAME[countyNameKey(st, nm)]) return HYP_COUNTY_BY_NAME[countyNameKey(st, nm)];
    if (ALLOW_COUNTY_FALLBACK_TO_STATE && st && HYP_STATE[st]) return HYP_STATE[st];
    return HYP_GENERIC;
  }
  if (ks.startsWith("L:")) {
    const partKey = meta.partKey || ks.slice(2);            // "CA|Los Angeles|PartN"
    return hyperForLaPart(partKey);                         // from HYP_LA_PARTS
  }
  return HYP_GENERIC;
}

function sumTail(a, n) { let s = 0; for (let i = Math.max(0, a.length - n); i < a.length; i++) s += Number(a[i] || 0); return s; }

/* ===== TLDR records (counts; ESN added lazily) ===== */
function buildCountsTLDR(key, series, title, meta = {}) {
  const labels = series.labels, vals = series.values;
  const lwIdx = labels.length - 1;
  const lastW = vals[lwIdx] || 0;
  let lastM = 0; for (let i = Math.max(0, lwIdx - 3); i <= lwIdx; i++) lastM += Number(vals[i] || 0);
  const nextStart = labels[lwIdx] || "";
  const canFcst = hasSavedHyperparamsForKey(key, meta);

  return {
    title,
    total_till_date: Math.round(vals.reduce((a, b) => a + (b || 0), 0)),
    color: "",
    last_obs_week: { start: labels[lwIdx - 1] || "", end: labels[lwIdx] || "", count: Math.round(lastW) },
    last_obs_month: { start: labels[lwIdx - 4] || "", end: labels[lwIdx] || "", count: Math.round(lastM) },
    next_week_forecast: { start: nextStart, end: addDaysISO(nextStart, 7), count: "…" },
    next_month_forecast: { start: nextStart, end: addDaysISO(nextStart, 28), count: "…" },
    _series: series, _key: key, _meta: meta,
    _fit: null, _yhat: null, _H: 4,
    _forecastReady: false, _canForecast: canFcst
  };
}

/* Compute ESN lazily and cache */
async function ensureForecastForRec(rec) {
  if (!rec) return rec;
  if (!rec._canForecast) return rec;
  if (rec._forecastReady) return rec;

  const k = rec._key;
  if (forecastCache.has(k)) {
    const { yfit, yhat, H } = forecastCache.get(k);
    rec._fit = yfit; rec._yhat = yhat; rec._H = H;
  } else {
    const hyper = hyperForKey(k, rec._meta);
    const { yfit, yhat, H } = await ESN.fitPredict(k, rec._series.values, hyper);
    forecastCache.set(k, { yfit, yhat, H });
    rec._fit = yfit || []; rec._yhat = yhat || []; rec._H = H || 4;
  }

  rec.next_week_forecast.count = Math.round(rec._yhat[0] || 0);
  rec.next_month_forecast.count = Math.round(rec._yhat.slice(0, 4).reduce((a, b) => a + (b || 0), 0));
  rec._forecastReady = true;
  return rec;
}

/* Tooltip HTML */
function tldrHTML(title, rec) {
  if (!rec) return `<div class="tldr"><div class="tldr-title" style="padding-left:6px;padding-bottom:6px;font-weight:800;">${title}</div><div>No data</div></div>`;
  const lastW = rec.last_obs_week || {}, lastM = rec.last_obs_month || {};
  const nextW = rec.next_week_forecast || {}, nextM = rec.next_month_forecast || {};
  const total = Number(rec.total_till_date || 0);

  const rows = [
    `<tr><td>Last observed week</td><td>${rng(lastW.start, lastW.end)}</td><td>${fmt(lastW.count)}</td></tr>`,
    `<tr><td>Last observed month</td><td>${rng(lastM.start, lastM.end)}</td><td>${fmt(lastM.count)}</td></tr>`
  ];
  if (rec._canForecast) {
    rows.push(
      `<tr><td>Next week forecast</td><td>${rng(nextW.start, nextW.end)}</td><td>${fmt(nextW.count)}</td></tr>`,
      `<tr><td>Next month forecast</td><td>${rng(nextM.start, nextM.end)}</td><td>${fmt(nextM.count)}</td></tr>`
    );
  }
  return `
    <div class="tldr">
      <div class="tldr-title" style="padding-left:6px;padding-bottom:6px;display:flex;gap:6px;align-items:baseline;">
        <span style="font-weight:800;">${title}</span><span style="font-weight:600;">(${fmt(total)} Incidents)</span>
      </div>
      <table class="tldr-table">${rows.join("")}</table>
    </div>`;
}

/* Legend builder + caption */
function ensureLegend() {
  const el = document.getElementById("mapLegend"); if (!el) return;

  // base text for rank/yoy
  const core =
    (COLOR_MODE === "yoy")
      ? `<div class="legend-title">YoY change (vs week -52)</div>
         <div class="legend-row"><span class="swatch swatch-red"></span> +20% or higher</div>
         <div class="legend-row"><span class="swatch swatch-yellow"></span> -5% to +20%</div>
         <div class="legend-row"><span class="swatch swatch-green"></span> below -5%</div>
         <div class="legend-row"><span class="swatch swatch-gray"></span> insufficient history</div>`
      : `<div class="legend-title">Rank (total to date)</div>
         <div class="legend-row"><span class="swatch swatch-red"></span> Top 1–3</div>
         <div class="legend-row"><span class="swatch swatch-yellow"></span> Ranks 4–7</div>
         <div class="legend-row"><span class="swatch swatch-green"></span> Ranks 8+</div>
         <div class="legend-row"><span class="swatch swatch-gray"></span> No data</div>`;

  // extra line when in LA parts view
  const extra =
    (viewLevel === "la_parts")
      ? `<div class="legend-row" style="margin-top:6px">
           <span class="swatch" style="display:inline-block;width:18px;height:0;border-top:3px solid #2563eb;margin-right:6px;transform:translateY(-3px)"></span>
           LACoFD battalion outlines
         </div>`
      : "";

  el.innerHTML = core + extra;
}

function ensureModeCaption() {
  const panel = document.querySelector("#top10")?.parentElement;
  if (!panel) return;
  let cap = document.getElementById("modeCaption");
  if (!cap) {
    cap = document.createElement("div");
    cap.id = "modeCaption";
    panel.appendChild(cap);
  }
  if (COLOR_MODE === "yoy") {
    cap.innerHTML = `<b>YoY</b> — Year over Year: compares the last 4 weeks to the same period 52 weeks earlier (red > +20%, yellow −5%…+20%, green < −5%).`;
  } else {
    cap.innerHTML = `<b>YtD</b> — Year to Date: ranks by cumulative incidents observed so far this year.`;
  }
}

/* Hover chart UI */
function ensureHoverChartControl() {
  if (hoverChartContainer) return;
  const container = map.getContainer();
  const div = document.createElement("div");
  div.className = "hover-chart-fixed";
  div.innerHTML = `
    <div class="bar">
      <div id="chartTitle" style="font-weight:700">Weekly Incidents</div>
      <div class="bar-actions">
        <button id="ytdToggle" class="pill" aria-pressed="false" title="Toggle Year-to-Date view">(YYYY YtD toggle)</button>
        <button id="chartCloseBtn" class="pill" title="Close">✕</button>
      </div>
    </div>
    <canvas id="stateSpark"></canvas>`;
  container.appendChild(div);
  hoverChartContainer = div;

  div.querySelector("#chartCloseBtn").addEventListener("click", () => { div.style.display = "none"; });

  const ybtn = div.querySelector("#ytdToggle");
  ybtn.addEventListener("click", () => {
    window.hoverChartMode = (window.hoverChartMode === "all") ? "ytd" : "all";
    ybtn.classList.toggle("is-on", window.hoverChartMode === "ytd");
    ybtn.setAttribute("aria-pressed", window.hoverChartMode === "ytd" ? "true" : "false");
    updateHoverChartFromCache();
  });

  setYTDButtonLabel(_lastObservedYear || String(new Date().getUTCFullYear()));

  const ro = new ResizeObserver(() => {
    if (!hoverChartContainer || hoverChartContainer.style.display === "none" || !hoverChart) return;
    sizeAndGetCtx(); hoverChart.resize(); hoverChart.update("none");
  });
  ro.observe(div);
  window.addEventListener("resize", () => {
    if (!hoverChartContainer || hoverChartContainer.style.display === "none" || !hoverChart) return;
    sizeAndGetCtx(); hoverChart.resize(); hoverChart.update("none");
  });
}
function updateHoverChartFromCache() {
  if (!_lastDrawPayload) return;
  const { title, labels, datasets } = _lastDrawPayload;
  if (window.hoverChartMode === "ytd") {
    const y = deriveLastObservedYear(labels);
    const sliced = sliceToYearYTD(labels, datasets);
    setYTDButtonLabel(y);
    _internalDraw(`${title} — YtD`, sliced.labels, sliced.datasets);
  } else {
    setYTDButtonLabel(deriveLastObservedYear(labels));
    _internalDraw(title, labels, datasets);
  }
}
function _internalDraw(title, labels, datasets) {
  ensureHoverChartControl();
  hoverChartContainer.style.display = "block";
  void hoverChartContainer.offsetWidth;

  const ctx = sizeAndGetCtx();
  const LBL = labels.map(x => (typeof x === "string" ? x : String(x)));
  const years = LBL.map(s => s.slice(0, 4));
  const titleEl = hoverChartContainer.querySelector("#chartTitle");
  if (titleEl) titleEl.textContent = title;

  const opts = {
    responsive: false, maintainAspectRatio: false, animation: false,
    layout: { padding: { top: 6, right: 8, bottom: 22, left: 8 } },
    plugins: { legend: { display: true }, tooltip: { mode: "index", intersect: false } },
    scales: {
      x: {
        type: "category", grid: { display: false },
        ticks: {
          source: "labels", autoSkip: false, maxRotation: 0, padding: 6,
          callback: (_, i) => { const y = years[i], p = i > 0 ? years[i - 1] : null; return (y && y !== p) ? y : ""; }
        }
      },
      y: { ticks: { precision: 0 }, grid: { color: "rgba(255,255,255,.08)" } }
    }
  };
  const data = { labels: LBL, datasets };
  if (hoverChart) { hoverChart.data = data; hoverChart.options = opts; hoverChart.update("none"); }
  else { hoverChart = new Chart(ctx, { type: "line", data, options: opts }); }
  requestAnimationFrame(() => { sizeAndGetCtx(); hoverChart.resize(); hoverChart.update("none"); });
}
function sizeAndGetCtx() {
  const c = hoverChartContainer.querySelector("#stateSpark");
  const rect = hoverChartContainer.getBoundingClientRect();
  const w = Math.max(320, Math.floor(rect.width));
  const h = Math.max(150, Math.floor(rect.height - 28));
  c.width = w; c.height = h;
  return c.getContext("2d");
}
function datasetsFromRec(labelsTrim, seriesFull, rec, trimStartIdx, mainLabel) {
  const Nfull = seriesFull.values.length;
  const H = (rec?._yhat || []).length;
  let labelsOut = labelsTrim.slice();
  const actualTrim = seriesFull.values.slice(trimStartIdx, trimStartIdx + labelsTrim.length);

  const COLOR_ACT = 'rgba(56, 189, 248, 1)';   // cyan
  const COLOR_FIT = 'rgba(255, 115, 0, 0.9)'; // orange-ish
  const COLOR_FC = 'rgba(255, 0, 200, 0.95)';// magenta

  const sets = [
    { label: mainLabel, data: actualTrim, borderColor: COLOR_ACT, borderWidth: 0.8, pointRadius: 0, tension: 0.2, order: 3 }
  ];

  if (rec?._fit?.length) {
    const padLeft = Math.max(0, Nfull - rec._fit.length);
    const fitAlignedFull = Array(padLeft).fill(null).concat(rec._fit);
    const fitTrim = fitAlignedFull.slice(trimStartIdx, trimStartIdx + labelsTrim.length);
    sets.push({ label: "Training fit", data: fitTrim, borderColor: COLOR_FIT, borderWidth: 2.6, borderDash: [6, 4], pointRadius: 0, tension: 0.2, order: 4 });
  }

// --- Forecast series (no visual gap) ---
if (rec?._canForecast && H > 0) {
  let last = labelsTrim[labelsTrim.length - 1] || "";
  const future = [];
  for (let i = 0; i < H; i++) { last = addDaysISO(last, 7); future.push(last); }
  labelsOut = labelsOut.concat(future);

  // Start with nulls for the history, then predicted values on future weeks
  const forecastData = Array(labelsTrim.length).fill(null).concat(rec._yhat.slice(0, H));

  // ⟵ ANCHOR: put a value at the last observed index to avoid a visible gap
  const lastActual = actualTrim[actualTrim.length - 1];
  const lastFit    = (rec?._fit || [])[rec._fit.length - 1];
  const anchor     = Number.isFinite(lastFit) ? lastFit :
                     Number.isFinite(lastActual) ? lastActual : null;
  if (anchor != null && labelsTrim.length > 0) {
    forecastData[labelsTrim.length - 1] = anchor;
  }

  // Keep actual and fit from extending into the future
  sets[0].data = actualTrim.concat(Array(H).fill(null));
  if (rec?._fit?.length) sets[1].data = sets[1].data.concat(Array(H).fill(null));

  sets.push({
    label: "Forecast",
    data: forecastData,
    borderColor: COLOR_FC,
    borderWidth: 2.2,
    borderDash: [2, 2],
    pointRadius: 0,
    tension: 0.2,
    order: 2,
    spanGaps: true // extra safety
  });
}

  return { labelsOut, sets };
}

/* ===== County/State series getters ===== */
function getCountySeries(code, countyName) {
  const key = `${code}|${slug(countyName)}`; if (countySeries[key]) return countySeries[key];
  const header = countyHeaderByNorm[code]?.[slug(countyName)]; if (!header) return null;
  const vals = weeklyRows.map(r => Number(r[header] || 0));
  return (countySeries[key] = { labels: labelsAll, values: vals });
}
function getLaPartSeries(partKey /* "CA|Los Angeles|Part1" */) {
  if (!laPartsRows?.length) return null;
  const vals = laPartsRows.map(r => Number(r[partKey] || 0));
  return { labels: laPartsLabels, values: vals };
}

/* ===== STATES view ===== */
function rankColorFrom(sortedTotals, code) {
  const idx = sortedTotals.findIndex(x => x.code === code);
  if (idx === -1) return "#d1d5db";
  const rank = idx + 1;
  if (rank <= 3) return "#ef4444";
  if (rank <= 7) return "#facc15";
  if (rank <= 10) return "#10b981";
  return "#d1d5db";
}

async function renderStates() {
  viewLevel = "state";
  if (!usGeoJSON) { usGeoJSON = await (await fetch("https://cdn.jsdelivr.net/gh/python-visualization/folium/examples/data/us-states.json")).json(); }
  if (statesLayer) map.removeLayer(statesLayer);
  if (countiesLayer) { map.removeLayer(countiesLayer); countiesLayer = null; }
  if (spasLayer) { map.removeLayer(spasLayer); spasLayer = null; }

  statesData = {};
  for (const code of Object.keys(stateSeries)) {
    const key = `S:${code}`;
    statesData[code] = buildCountsTLDR(key, stateSeries[code], `${code} — ${code2name(code)}`, { stateCode: code });
  }
  usTotal = Object.values(statesData).reduce((s, r) => s + Number(r?.total_till_date || 0), 0);
  if ($usTotal) $usTotal.textContent = fmt(usTotal);

  const sortedTotals = Object.entries(statesData).map(([code, rec]) => ({ code, total: Number(rec?.total_till_date || 0) })).sort((a, b) => b.total - a.total);

  statesLayer = L.geoJSON(usGeoJSON, {
    style: (feature) => {
      const code = (feature?.id || "").toUpperCase();
      const rec = statesData[code];
      if (!rec) return { color: "#666", weight: 1, fillColor: "#d1d5db", fillOpacity: 0.6 };
      let fill;
      if (COLOR_MODE === "yoy") {
        const bucket = hasModelForState(code) ? yoyBucketForState(code) : "gray";
        fill = bucketToColor(bucket);
      } else {
        fill = rankColorFrom(sortedTotals, code);
      }
      return { color: "#666", weight: 1, fillColor: fill, fillOpacity: 0.6 };
    },
    onEachFeature: (feature, layer) => {
      const code = (feature?.id || "").toUpperCase();
      const rec = statesData[code] || null;
      layer.bindTooltip(tldrHTML(`${code} — ${code2name(code)}`, rec), {
        sticky: true, className: "tldr-tooltip"
      });

      // Block tooltips when not in the states view
      layer.on("tooltipopen", async (e) => {
        if (!handleNow("state")) { layer.closeTooltip(); return; }
        try {
          await ensureForecastForRec(rec);
          e.tooltip.setContent(tldrHTML(`${code} — ${code2name(code)}`, rec));
        } catch { }
      });

      layer.on("mouseover", async () => {
        if (!handleNow("state")) return;
        layer.setStyle({ weight: 2 });
        const s = stateSeries[code]; if (!s) return;
        await ensureForecastForRec(rec);
        const { labels, startIdx } = trimUntilAtLeast(s.labels, s.values, TRIM_THRESHOLD, FALLBACK_TAIL);
        const { labelsOut, sets } = datasetsFromRec(labels, s, rec, startIdx, "State total");
        drawSeries(`${code} — ${code2name(code)} (from ${labels[0] || "n/a"})`, labelsOut, sets);
      });

      layer.on("mouseout", () => {
        if (!handleNow("state")) return;
        layer.setStyle({ weight: 1 });
      });

      layer.on("click", () => {
        if (!handleNow("state")) return;
        showCounties(code);
      });

    }
  }).addTo(map);

  map.setView([37.8, -96.9], 4);
  if ($backButton) $backButton.style.display = "none";
  if ($stateRow) $stateRow.style.display = "none";
  $stateName.textContent = "United States";
  $stateTotal.textContent = fmt(usTotal);
  $coverage.textContent = "";
  ensureLegend();
  renderTop10States();
  recolorStatesLayerAndTable();
}
function renderTop10States() {
  if (!$topTableTbody) return;
  if ($topTitle) $topTitle.textContent = "Top 10 States by Total Incidents";
  const rows = Object.entries(statesData)
    .filter(([code]) => hasModelForState(code))
    .map(([code, rec]) => ({ code, total: Number(rec?.total_till_date || 0) }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 10);

  $topTableTbody.innerHTML = rows
    .map((r, i) => `<tr><td>${i + 1}</td><td>${r.code} — ${code2name(r.code)}</td><td>${fmt(r.total)}</td></tr>`)
    .join("");

  recolorStatesLayerAndTable();
  ensureModeCaption();
}

/* ===== COUNTIES view ===== */
function hasModelForState(code) { return Boolean(HYP_STATE && HYP_STATE[code]); }
function hasModelForCounty(st, fips, name) {
  const f5 = fips ? String(fips).padStart(5, "0") : null;
  const nkey = name ? countyNameKey(st, name) : null;
  if (f5 && HYP_COUNTY_BY_FIPS && HYP_COUNTY_BY_FIPS[f5]) return true;
  if (nkey && HYP_COUNTY_BY_NAME && HYP_COUNTY_BY_NAME[nkey]) return true;
  if (ALLOW_COUNTY_FALLBACK_TO_STATE) return hasModelForState(st);
  return false;
}

async function showCounties(code) {
  viewLevel = "county"; lastStateCode = code;

  const usCountiesGeo = await (await fetch("https://raw.githubusercontent.com/plotly/datasets/master/geojson-counties-fips.json")).json();
  const prefix = stateCodeToFipsPrefix(code);
  const features = usCountiesGeo.features.filter(f => {
    const raw = f.id ?? f.properties?.GEOID ?? f.properties?.COUNTYFP;
    return String(raw ?? "").padStart(5, "0").startsWith(prefix);
  });

  const countyRecs = {};
  for (const f of features) {
    const fips = String(f.id ?? f.properties?.GEOID ?? f.properties?.COUNTYFP).padStart(5, "0");
    const name = f.properties?.NAME || f.properties?.NAME10 || "";
    const s = getCountySeries(code, `${name} County`) || getCountySeries(code, name);
    if (!s) continue;
    const key = `C:${code}|${fips}`;
    const meta = { stateCode: code, countyFips: fips, countyName: name };
    countyRecs[f.id] = buildCountsTLDR(key, s, `${name} County`, meta);
  }

  const sortedTotals = Object.entries(countyRecs).map(([fid, rec]) => ({ fid, total: Number(rec?.total_till_date || 0) })).sort((a, b) => b.total - a.total);

  if (countiesLayer) map.removeLayer(countiesLayer);

  countiesLayer = L.geoJSON({ type: "FeatureCollection", features }, {
    style: (feature) => {
      const rec = countyRecs[feature.id] || null;
      const name = feature.properties?.NAME || "";
      const fips = String(feature.id ?? feature.properties?.GEOID ?? feature.properties?.COUNTYFP).padStart(5, "0");
      const ok = hasModelForCounty(code, fips, name);

      let fill = "#d1d5db";
      if (rec && ok) {
        if (COLOR_MODE === "yoy") fill = bucketToColor(yoyBucketFromSeries(rec._series));
        else {
          const allOK = Object.entries(countyRecs)
            .filter(([fid, r]) => {
              const nm = r.title.replace(/ County$/, "");
              const f = String(fid).padStart(5, "0");
              return hasModelForCounty(code, f, nm);
            })
            .map(([fid, r]) => ({ fid, total: Number(r?.total_till_date || 0) }))
            .sort((a, b) => b.total - a.total);
          const idx = allOK.findIndex(x => x.fid === feature.id);
          const rk = idx >= 0 ? idx + 1 : 999;
          fill = bucketToColor(bucketForRank(rk));
        }
      }

      return { color: "#444", weight: 1, fill: true, fillColor: fill, fillOpacity: 0.65 };
    },
    onEachFeature: (feature, layer) => {
      const name = feature.properties?.NAME || "";
      const rec = countyRecs[feature.id] || null;
      feature._tldrRec = rec;
      layer.bindTooltip(tldrHTML(name + " County", rec), { sticky: true, className: "tldr-tooltip" });

      layer.on("tooltipopen", async (e) => {
        if (!handleNow("county")) { layer.closeTooltip(); return; }
        try {
          await ensureForecastForRec(feature._tldrRec);
          e.tooltip.setContent(tldrHTML(name + " County", feature._tldrRec));
        } catch { }
      });

      layer.on("mouseover", async () => {
        if (!handleNow("county")) return;
        layer.setStyle({ weight: 2 });
        const s = getCountySeries(code, name) || getCountySeries(code, `${name} County`); if (!s) return;
        const recNow = feature._tldrRec;
        await ensureForecastForRec(recNow);
        const { labels, startIdx } = trimUntilAtLeast(s.labels, s.values, TRIM_THRESHOLD, FALLBACK_TAIL);
        const { labelsOut, sets } = datasetsFromRec(labels, s, recNow, startIdx, "County total");
        drawSeries(`${name} County, ${code} (from ${labels[0] || "n/a"})`, labelsOut, sets);
      });

      layer.on("mouseout", () => {
        if (!handleNow("county")) return;
        layer.setStyle({ weight: 1 });
      });

      layer.on("click", () => {
        panZoomToLayer(layer, { padPct: 0.08, maxZoom: 10 });
        if (!handleNow("county")) return;
        const nm = layer.feature?.properties?.NAME || "";
        const isLA = nm.toLowerCase() === "los angeles";
        if (isLA) showLaParts("CA");
      });

    }
  }).addTo(map);

  countiesLayer.eachLayer(l => l.bringToFront());
  map.fitBounds(countiesLayer.getBounds(), { padding: [10, 10] });
  setStatesDimForCounty(code);

  const srec = statesData[code] || buildCountsTLDR(`S:${code}`, stateSeries[code], code, { stateCode: code });
  if ($stateRow) $stateRow.style.display = "";
  $stateName.textContent = code2name(code) + " Total Incidents";
  $stateTotal.textContent = fmt(srec.total_till_date || 0);
  $coverage.textContent = srec?.last_obs_week?.end ? `Coverage through → ${srec.last_obs_week.end}` : "";

  if ($backButton) { $backButton.style.display = "inline-block"; $backButton.textContent = "← Back"; }

  if ($topTitle) $topTitle.textContent = `Top 8 Counties in ${code2name(code)} by Total Incidents`;
  if ($topTableTbody) {
    const rows = Object.values(countiesLayer._layers)
      .map(l => {
        const name = l.feature?.properties?.NAME || "";
        const fips = String(l.feature?.id ?? l.feature?.properties?.GEOID ?? l.feature?.properties?.COUNTYFP).padStart(5, "0");
        const rec = l.feature?._tldrRec;
        return { name, fips, total: Number(rec?.total_till_date || 0) };
      })
      .filter(r => hasModelForCounty(code, r.fips, r.name))
      .sort((a, b) => b.total - a.total)
      .slice(0, 10);
    $topTableTbody.innerHTML = rows.map((r, i) => `<tr><td>${i + 1}</td><td>${r.name} County</td><td>${fmt(r.total)}</td></tr>`).join("");
  }

  recolorCountiesLayerAndTable();
  ensureLegend(); ensureModeCaption();
  removeLaBattalionOutline();
}

/* === State dimming when entering county view === */
function setStatesDimForCounty(selectedCode) {
  if (!statesLayer) return;
  statesLayer.eachLayer(l => {
    const code = (l.feature?.id || "").toUpperCase();
    if (code === selectedCode) l.setStyle({ fillOpacity: 0, color: "#666", weight: 2 });
    else l.setStyle({ fill: true, fillColor: "#d1d5db", fillOpacity: 0.15, color: "#666", weight: 1 });
  });
}
function resetStatesDim() { if (!statesLayer) return; statesLayer.eachLayer(l => statesLayer.resetStyle(l)); }
function panZoomToLayer(layer, { padPct = 0.08, maxZoom = 10 } = {}) {
  try {
    const b = layer.getBounds();
    const tighter = b.pad(-Math.max(0, Math.min(padPct, 0.3))); // clamp 0..0.3
    map.fitBounds(tighter, {
      paddingTopLeft: [20, 20],
      paddingBottomRight: [380, 20],   // room for the right info panel
      maxZoom,
      animate: true
    });
  } catch {}
}

/* ===== LA PARTS view (separate weekly CSV) ===== */
async function showLaParts(stateCode) {
  viewLevel = "la_parts";
  lastStateCode = stateCode;

  const laPartsGeo = await (await fetch(new URL("../geo/la_parts_clipped.geojson", import.meta.url).href)).json();

  // Assign compass names from geometry
  const nameByPartId = compassNamesForLaParts(laPartsGeo); // {"1":"Northwest", ...}
  const partKeys = ["CA|Los Angeles|Part1", "CA|Los Angeles|Part2", "CA|Los Angeles|Part3", "CA|Los Angeles|Part4"];
  const partSeries = Object.fromEntries(partKeys.map(k => [k, getLaPartSeries(k)]));

  // TLDR records per part
  const partRecs = {};
  for (const f of laPartsGeo.features) {
    const pid = String(f.properties?.part_id || "").trim();
    const key = `CA|Los Angeles|Part${pid}`;
    const s = partSeries[key]; if (!s) continue;
    const meta = { stateCode: "CA", countyName: "Los Angeles", partKey: key };
    partRecs[key] = buildCountsTLDR(`L:${key}`, s, nameByPartId[pid] || key.split("|").slice(-1)[0], meta);
  }

  if (countiesLayer) { map.removeLayer(countiesLayer); countiesLayer = null; }

  // colored parts
  const layer = L.geoJSON(laPartsGeo, {
    style: (feature) => {
      const key = `CA|Los Angeles|Part${feature.properties.part_id}`;
      const rec = partRecs[key];
      let fill = "#d1d5db";
      if (rec && hasModelForLaPart(key)) {
        fill = (COLOR_MODE === "yoy")
          ? bucketToColor(yoyBucketFromSeries(rec._series))
          : "#ef4444"; // initial; recolorLaPartsLayerAndTable() will refine to rank buckets
      }
      return { color: "#444", weight: 1, fillColor: fill, fillOpacity: 0.65 };
    },
    onEachFeature: (feature, l) => {
      const pid = String(feature.properties.part_id);
      const key = `CA|Los Angeles|Part${pid}`;
      const rec = partRecs[key] || null;
      l.bindTooltip(tldrHTML(nameByPartId[pid] || key + " LA County", rec), { sticky: true, className: "tldr-tooltip" });

      l.on("tooltipopen", async (e) => {
        if (!handleNow("la_parts")) { l.closeTooltip(); return; }
        try {
          await ensureForecastForRec(rec);
          e.tooltip.setContent(tldrHTML(nameByPartId[pid] || key + " LA County", rec));
        } catch { }
      });

      l.on("mouseover", async () => {
        if (!handleNow("la_parts")) return;
        l.setStyle({ weight: 2 });
        await ensureForecastForRec(rec);
        const { labels, startIdx } = trimUntilAtLeast(rec._series.labels, rec._series.values, TRIM_THRESHOLD, FALLBACK_TAIL);
        const { labelsOut, sets } = datasetsFromRec(labels, { labels: rec._series.labels, values: rec._series.values }, rec, startIdx, `${nameByPartId[pid] || key} total`);
        drawSeries(`${nameByPartId[pid] || key} LA County (from ${labels[0] || "n/a"})`, labelsOut, sets);
      });

      l.on("mouseout", () => {
        if (!handleNow("la_parts")) return;
        l.setStyle({ weight: 1 });
      });

    }
  }).addTo(map);
  countiesLayer = layer; // keep using this handle

  // battalion outlines (UNDER the fills)
  try {
    const gj = await (await fetch(LACOFD_BATTALIONS_GEOJSON, { cache: "no-store" })).json();
    removeLaBattalionOutline(); // ensure clean
    laBattalionOutlineLayer = L.geoJSON(gj, {
      pane: "pane-outline",
      interactive: false,
      style: { color: "#2563eb", weight: 1.5, opacity: 1, fill: false }
    }).addTo(map);
  } catch (e) { console.warn("Battalion outline fetch failed:", e); }

  // side panel (names instead of PartN)
  $stateName.textContent = "Los Angeles County";
  $topTitle.textContent = "LA Parts by Total Incidents";
  const rows = partKeys
    .filter(k => hasModelForLaPart(k))
    .map(k => {
      const pid = k.slice(-1);
      return {
        name: nameByPartId[pid] || k.split("|").slice(-1)[0], key: k,
        total: Number(partRecs[k]?.total_till_date || 0)
      };
    })
    .sort((a, b) => b.total - a.total);

  // render and build reverse map (display name -> partKey) for recolor
  $topTableTbody.innerHTML = rows
    .map((r, i) => `<tr><td>${i + 1}</td><td>${r.name}</td><td>${fmt(r.total)}</td></tr>`).join("");
  const nameByKey = {}; const keyByName = {};
  for (const r of rows) { nameByKey[r.key] = r.name; keyByName[r.name] = r.key; }

  // coverage from LA-parts file
  const last = laPartsLabels[laPartsLabels.length - 1] || "";
  $coverage.textContent = last ? `Coverage through → ${last}` : "";

  // save context for recolor on toggle
  laPartsContext = { layer, recs: partRecs, nameByKey: keyByName };

  // initial recolor (rank buckets)
  recolorLaPartsLayerAndTable();
  ensureLegend(); // legend includes battalion line
}


/* Back buttons */
async function backToUSFast() {
  removeLaBattalionOutline();
  viewLevel = "state";
  if (countiesLayer) { map.removeLayer(countiesLayer); countiesLayer = null; }
  resetStatesDim();
  if ($backButton) $backButton.style.display = "none";
  if ($stateRow) $stateRow.style.display = "none";
  $stateName.textContent = "United States";
  $stateTotal.textContent = fmt(usTotal);
  $coverage.textContent = "";
  map.setView([37.8, -96.9], 4);
  ensureLegend(); renderTop10States(); recolorStatesLayerAndTable();
}

/* ===== init ===== */
function ensureDataSourceLink() {
  const url = "https://services3.arcgis.com/T4QMspbfLg3qTGWY/ArcGIS/rest/services/WFIGS_Incident_Locations/FeatureServer";
  const host = document.querySelector(".topbar,.navbar,header,.titlebar") || document.body;
  if (document.getElementById("dataSourceLink")) return;
  const a = document.createElement("a");
  a.id = "dataSourceLink"; a.href = url; a.target = "_blank"; a.rel = "noopener"; a.textContent = "Data source: ArcGIS WFIGS";
  host.appendChild(a);
}
ensureDataSourceLink();

async function init() {
  const Splash = window.Splash || { setProgress() { }, hide() { } };
  Splash.setProgress(5);

  map = L.map("map", { zoomControl: true });
  // draw order: base tiles < battalion outline < colored parts
  map.createPane("pane-outline");
  map.getPane("pane-outline").style.zIndex = 399
  map.getPane("pane-outline").style.pointerEvents = "none";  // never intercept the mouse

  // you already use a top pane for parts; keep that as is (e.g., "pane-parts" z=402)

  const positron = L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
    { attribution: "&copy; OpenStreetMap &copy; CARTO", subdomains: "abcd", maxZoom: 19 }).addTo(map);
  const esriSat = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    { attribution: "Tiles © Esri" });
  L.control.layers({ "Positron (light)": positron, "Satellite (Esri)": esriSat }, {}).addTo(map);

  Splash.setProgress(25);

  // Load state/county weekly matrix + LA-parts weekly + hyperparams
  const [wText, laText] = await Promise.all([
    loadText(WEEKLY_CSV_URL),
    loadText(WEEKLY_LA_PARTS_URL)
  ]);
  await loadHyperparams();

  const [p1, p2] = await Promise.all([parseCSV(wText), parseCSV(laText)]);
  buildIndexes(p1);                     // states + counties only
  laPartsRows = p2.data;              // LA parts kept separate
  laPartsLabels = laPartsRows.map(r => String(r.week_start));

  Splash.setProgress(75);

  await renderStates();            // build layers AFTER constants are defined
  setColorMode("rank");            // preselect Rank
  ensureModeCaption();             // caption under table

  Splash.setProgress(100);
  Splash.hide();
}

/* Back button: to US from counties; to CA counties from LA parts */
$backButton?.addEventListener("click", async () => {
  if (viewLevel === "county") await backToUSFast();
  else if (viewLevel === "la_parts") await showCounties("CA");
});

init().catch(e => { console.error("App init fatal:", e); alert("Failed to initialize app. Check console."); });
