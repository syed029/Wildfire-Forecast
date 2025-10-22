import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getFirestore, collection, doc, getDoc, getDocs
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

/* ------------------------- CONFIG ------------------------- */
const CFG = window.WF_CONFIG || {};
const USE_FB = !!CFG.USE_FIREBASE;

// CSV (local or GitHub Pages)
const WEEKLY_CSV_URL = new URL("./assets/weekly_matrix_by_county.csv", document.baseURI).href;

/* Chart trim behavior (you can tweak these) */
const TRIM_THRESHOLD = 10;   // trim leading points until value >= this
const FALLBACK_TAIL  = 52;   // if nothing crosses the threshold, keep last N points

/* LA County Service Planning Areas (8 regions) — official GeoJSON */
const LA_SPA_GEOJSON_URL =
  "https://services1.arcgis.com/ZIL9uO234SBBPGL7/ArcGIS/rest/services/Los_Angeles_County_Service_Planning_Areas_Layer/FeatureServer/0/query?where=1%3D1&outFields=%2A&outSR=4326&f=geojson";

const SPA_STROKE = "#333";
const GRAY_FILL  = "#d1d5db";  // used when no data / no color

/* --------------------------- DOM -------------------------- */
const $stateRow   = document.querySelector("#stateName")?.closest(".metric");
const $usTotal    = document.querySelector("#usTotal");
const $stateName  = document.querySelector("#stateName");
const $stateTotal = document.querySelector("#stateTotal");
const $coverage   = document.querySelector("#coverage");
const $backButton = document.querySelector("#backButton");
const $topTitle   = document.querySelector("#topTitle");
const $topTableTbody =
  document.querySelector("#top10 tbody") || document.querySelector("#topTable tbody");

/* ------------------------- GLOBALS ------------------------ */
let map, statesLayer, countiesLayer, spasLayer;
let usGeoJSON = null;
let statesData = {};
let usTotal = 0;

let viewLevel = "state";
let lastStateCode = null;

let dimmedStateCode = null;
let dimmedCountyFips = null;

/* ---- Series + hover chart (Chart.js + Papa Parse) ---- */
let weeklyRows = [];                  // raw CSV rows
let labelsAll = [];                   // all week_start labels
let stateSeries = {};                 // { CA: {labels:[], values:[]} }
let countySeries = {};                // cache: { "CA|losangeles": {labels:[], values:[]} }
let countyHeaderByNorm = {};          // { CA: { "losangeles": "CA|Los Angeles", ... } }
let hoverChart, hoverChartContainer;

/* ---- Color mode / selections ---- */
let colorMode = "rank"; // "rank" | "yoy"
let currentStateTopMap = new Map();   // for states view: code -> tier ("r"|"y"|"g")
let currentCountyTopMap = new Map();  // for counties view: fips -> tier

/* ------------------------ HELPERS ------------------------- */
function fmt(n) { n = Number(n || 0); return isFinite(n) ? n.toLocaleString() : "0"; }
async function loadJSON(url) {
  if (!url) throw new Error("loadJSON: missing URL");
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`fetch failed ${r.status}`);
  return r.json();
}
function rng(a, b) {
  if (!a && !b) return "n/a";
  if (a && b) return `${a} – ${b}`;
  return a || b || "n/a";
}
function colorMap(c) {
  if (!c) return GRAY_FILL;
  const v = (c + "").toLowerCase();
  if (v === "r") return "#ef4444";
  if (v === "g") return "#10b981";
  if (v === "y") return "#facc15";
  return c;
}
function hasCountyData(rec) {
  if (!rec) return false;
  const t  = Number(rec.total_till_date ?? 0);
  const w  = Number(rec.last_obs_week?.count ?? 0);
  const m  = Number(rec.last_obs_month?.count ?? 0);
  const nw = Number(rec.next_week_forecast?.count ?? 0);
  const nm = Number(rec.next_month_forecast?.count ?? 0);
  return (t > 0 || w > 0 || m > 0 || nw > 0 || nm > 0);
}

function setStateFillVisibility(stateCode, visible) {
  if (!statesLayer) return;
  statesLayer.eachLayer(l => {
    const code = (l.feature?.id || "").toUpperCase();
    if (code === stateCode) {
      if (visible) statesLayer.resetStyle(l);
      else l.setStyle({ fillOpacity: 0.15, fillColor: GRAY_FILL });
    }
  });
}
function setAllStatesDimmed() {
  if (!statesLayer) return;
  statesLayer.eachLayer(l => {
    l.setStyle({ fillOpacity: 0.15, fillColor: GRAY_FILL });
  });
}
function setCountyFillVisibility(countyFips, visible) {
  if (!countiesLayer) return;
  countiesLayer.eachLayer(l => {
    const raw = l.feature?.id ?? l.feature?.properties?.GEOID ?? l.feature?.properties?.COUNTYFP;
    const fips = String(raw ?? "").padStart(5, "0");
    if (fips === countyFips) {
      if (visible) countiesLayer.resetStyle(l);
      else l.setStyle({ fillOpacity: 0.15, fillColor: GRAY_FILL });
    }
  });
}

function code2name(code) {
  const map = {
    "AL":"Alabama","AK":"Alaska","AZ":"Arizona","AR":"Arkansas","CA":"California","CO":"Colorado",
    "CT":"Connecticut","DE":"Delaware","FL":"Florida","GA":"Georgia","HI":"Hawaii","ID":"Idaho",
    "IL":"Illinois","IN":"Indiana","IA":"Iowa","KS":"Kansas","KY":"Kentucky","LA":"Louisiana",
    "ME":"Maine","MD":"Maryland","MA":"Massachusetts","MI":"Michigan","MN":"Minnesota","MS":"Mississippi",
    "MO":"Missouri","MT":"Montana","NE":"Nebraska","NV":"Nevada","NH":"New Hampshire","NJ":"New Jersey",
    "NM":"New Mexico","NY":"New York","NC":"North Carolina","ND":"North Dakota","OH":"Ohio","OK":"Oklahoma",
    "OR":"Oregon","PA":"Pennsylvania","RI":"Rhode Island","SC":"South Carolina","SD":"South Dakota",
    "TN":"Tennessee","TX":"Texas","UT":"Utah","VT":"Vermont","VA":"Virginia","WA":"Washington",
    "WV":"West Virginia","WI":"Wisconsin","WY":"Wyoming","DC":"District of Columbia",
  };
  return map[code] || code;
}
function stateCodeToFipsPrefix(code) {
  const map = {
    "AL":"01","AK":"02","AZ":"04","AR":"05","CA":"06","CO":"08","CT":"09","DE":"10","FL":"12","GA":"13",
    "HI":"15","ID":"16","IL":"17","IN":"18","IA":"19","KS":"20","KY":"21","LA":"22","ME":"23","MD":"24",
    "MA":"25","MI":"26","MN":"27","MS":"28","MO":"29","MT":"30","NE":"31","NV":"32","NH":"33","NJ":"34",
    "NM":"35","NY":"36","NC":"37","ND":"38","OH":"39","OK":"40","OR":"41","PA":"42","RI":"44","SC":"45",
    "SD":"46","TN":"47","TX":"48","UT":"49","VT":"50","VA":"51","WA":"53","WV":"54","WI":"55","WY":"56",
    "DC":"11"
  };
  return map[code] || "";
}
const VALID_STATE_CODES = new Set([
 "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS",
 "MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY","DC","PR","GU","VI"
]);

/* -------------- SPA name/slug helpers -------------- */
function slugify(s) {
  return (s ?? "")
    .toString()
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "spa";
}
function normalizeSpaName(s) {
  const slug = slugify(s);
  const fixes = {
    "san-fernando-va": "san-fernando-valley",
    "san-gabriel-val": "san-gabriel-valley",
    "metro-l-a": "metro-l-a",
    "west-la": "west-la",
    "south-la": "south-la",
    "east-la": "east-la",
    "south-bay": "south-bay",
  };
  if (fixes[slug]) return fixes[slug];
  return slug;
}

/* ---------------------- NORMALIZERS ----------------------- */
function normalizeStateRec(d) {
  if (!d) return null;
  const rec = {
    total_till_date: Number(d.total_till_date ?? 0),
    color: d.color || "",
    last_obs_week: {
      start: d.last_obs_week_start || d.last_week_start || "",
      end:   d.last_obs_week_end   || d.last_week_end   || "",
      count: Number(d.last_obs_week_count ?? d.last_week_count ?? 0),
    },
    last_obs_month: {
      start: d.last_obs_month_start || d.last_month_start || "",
      end:   d.last_obs_month_end   || d.last_month_end   || "",
      count: Number(d.last_obs_month_count ?? d.last_month_count ?? 0),
    },
    next_week_forecast: {
      start: d.next_week_start || "",
      end:   d.next_week_end   || "",
      count: Number(d.next_week_forecast ?? 0),
    },
    next_month_forecast: {
      start: d.next_month_start || "",
      end:   d.next_month_end   || "",
      count: Number(d.next_month_forecast ?? 0),
    },
  };
  const hasNums =
    rec.total_till_date > 0 ||
    rec.last_obs_week.count > 0 ||
    rec.last_obs_month.count > 0 ||
    rec.next_week_forecast.count > 0 ||
    rec.next_month_forecast.count > 0;
  return hasNums ? rec : null;
}
function normalizeCountyRec(d) {
  if (!d) return null;
  const rec = {
    county_name: d.county_name || "",
    total_till_date: Number(d.total_till_date ?? 0),
    color: d.color || "",
    last_obs_week: {
      start: d.last_obs_week_start || "",
      end:   d.last_obs_week_end   || "",
      count: Number(d.last_obs_week_count ?? 0),
    },
    last_obs_month: {
      start: d.last_obs_month_start || "",
      end:   d.last_obs_month_end   || "",
      count: Number(d.last_obs_month_count ?? 0),
    },
    next_week_forecast: {
      start: d.next_week_start || "",
      end:   d.next_week_end   || "",
      count: Number(d.next_week_forecast ?? 0),
    },
    next_month_forecast: {
      start: d.next_month_start || "",
      end:   d.next_month_end   || "",
      count: Number(d.next_month_forecast ?? 0),
    },
  };
  const hasNums =
    rec.total_till_date > 0 ||
    rec.last_obs_week.count > 0 ||
    rec.last_obs_month.count > 0 ||
    rec.next_week_forecast.count > 0 ||
    rec.next_month_forecast.count > 0;
  return hasNums ? rec : null;
}
function normalizeSpaRec(d) {
  if (!d) return null;
  const rec = {
    spa_id: d.spa_id || normalizeSpaName(d.spa_name),
    spa_name: d.spa_name || "",
    total_till_date: Number(d.total_till_date ?? 0),
    color: d.color || "",
    last_obs_week: {
      start: d.last_obs_week_start || "",
      end:   d.last_obs_week_end   || "",
      count: Number(d.last_obs_week_count ?? 0),
    },
    last_obs_month: {
      start: d.last_obs_month_start || "",
      end:   d.last_obs_month_end   || "",
      count: Number(d.last_obs_month_count ?? 0),
    },
    next_week_forecast: {
      start: d.next_week_start || "",
      end:   d.next_week_end   || "",
      count: Number(d.next_week_forecast ?? 0),
    },
    next_month_forecast: {
      start: d.next_month_start || "",
      end:   d.next_month_end   || "",
      count: Number(d.next_month_forecast ?? 0),
    },
  };
  const hasNums =
    rec.total_till_date > 0 ||
    rec.last_obs_week.count > 0 ||
    rec.last_obs_month.count > 0 ||
    rec.next_week_forecast.count > 0 ||
    rec.next_month_forecast.count > 0;
  return hasNums ? rec : null;
}

/* ------------------------ FIREBASE ------------------------ */
async function fetchStatesFromFirestore() {
  const app = initializeApp(CFG.FIREBASE);
  const db  = getFirestore(app);

  const statesSnap = await getDocs(collection(db, "states"));
  const out = {};

  for (const s of statesSnap.docs) {
    const code = (s.id || "").toUpperCase();

    let rec = null;
    try {
      const sd = await getDoc(doc(db, "states", code));
      if (sd.exists()) rec = normalizeStateRec(sd.data());
    } catch {}

    if (!rec) {
      const cs = await getDocs(collection(db, "states", code, "counties"));
      if (!cs.empty) {
        let t=0, lwc=0, lmc=0, nwf=0, nmf=0;
        let lwe="", lme="", nwe="", nme="";
        cs.forEach(c => {
          const d = normalizeCountyRec(c.data());
          if (!d) return;
          t   += Number(d.total_till_date ?? 0);
          lwc += Number(d.last_obs_week?.count  ?? 0);
          lmc += Number(d.last_obs_month?.count ?? 0);
          nwf += Number(d.next_week_forecast?.count ?? 0);
          nmf += Number(d.next_month_forecast?.count ?? 0);
          if (d.last_obs_week?.end)  lwe = d.last_obs_week.end;
          if (d.last_obs_month?.end) lme = d.last_obs_month.end;
          if (d.next_week_forecast?.end)  nwe = d.next_week_forecast.end;
          if (d.next_month_forecast?.end) nme = d.next_month_forecast.end;
        });
        if (t || lwc || lmc || nwf || nmf) {
          rec = {
            total_till_date: t, color: "",
            last_obs_week: { start:"", end:lwe, count:lwc },
            last_obs_month:{ start:"", end:lme, count:lmc },
            next_week_forecast:{ start:"", end:nwe, count:nwf },
            next_month_forecast:{ start:"", end:nme, count:nmf },
          };
        }
      }
    }
    if (rec) out[code] = rec;
  }
  return out;
}
async function fetchCountiesForState(code) {
  const app = initializeApp(CFG.FIREBASE);
  const db  = getFirestore(app);
  const snap = await getDocs(collection(db, "states", code, "counties"));
  const out = {};
  snap.forEach(c => {
    const rec = normalizeCountyRec(c.data());
    if (rec) out[c.id] = rec;
  });
  return out;
}
async function fetchSPAsFromFirestore() {
  const app = initializeApp(CFG.FIREBASE);
  const db  = getFirestore(app);
  const snap = await getDocs(collection(db, "states", "CA", "spas"));
  const out = {};
  snap.forEach(d => {
    const rec = normalizeSpaRec(d.data());
    if (!rec) return;
    const key = normalizeSpaName(rec.spa_id || rec.spa_name);
    out[key] = rec;
  });
  return out;
}

/* -------------------- TLDR / TABLE UI --------------------- */
function tldrHTML(placeNameOrCode, rec) {
  const title = rec?.county_name || rec?.spa_name || placeNameOrCode;
  if (!rec) {
    return `<div class="tldr">
      <div class="tldr-title" style="padding-left:6px;padding-bottom:6px;font-weight:800;">${title}</div>
      <div>No data</div>
    </div>`;
  }
  const lastW = rec.last_obs_week || {};
  const lastM = rec.last_obs_month || {};
  const nextW = rec.next_week_forecast || {};
  const nextM = rec.next_month_forecast || {};
  const total = Number(rec.total_till_date ?? 0);

  return `
    <div class="tldr">
      <div class="tldr-title" style="padding-left:6px; padding-bottom:6px; margin:0; display:flex; gap:6px; align-items:baseline;">
        <span style="font-weight:800;">${title}</span>
        <span style="font-weight:600;">Incidents (${fmt(total)})</span>
      </div>
      <table class="tldr-table">
        <tr><td>Last recorded week</td><td>${rng(lastW.start,lastW.end)}</td><td>${fmt(lastW.count)}</td></tr>
        <tr><td>Last recorded month</td><td>${rng(lastM.start,lastM.end)}</td><td>${fmt(lastM.count)}</td></tr>
        <tr><td>Next week forecast</td><td>${rng(nextW.start,nextW.end)}</td><td>${fmt(nextW.count)}</td></tr>
        <tr><td>Next month forecast</td><td>${rng(nextM.start,nextM.end)}</td><td>${fmt(nextM.count)}</td></tr>
      </table>
    </div>
  `;
}

/* ----------------------- COLOR MODE UI --------------------- */
function ensureColorModeToggle() {
  const host = $topTitle?.parentNode || document.querySelector("#sidebar") || document.body;
  if (host.querySelector("#colorModeBar")) return;

  const bar = document.createElement("div");
  bar.id = "colorModeBar";
  bar.style.display = "flex";
  bar.style.gap = "8px";
  bar.style.alignItems = "center";
  bar.style.margin = "8px 0 8px";
  bar.innerHTML = `
    <span style="opacity:.8;">Color:</span>
    <button data-mode="rank" class="cmode">Rank</button>
    <button data-mode="yoy"  class="cmode">YoY</button>
  `;
  host.insertBefore(bar, $topTitle?.nextSibling || host.firstChild);

  const styleBtn = (btn, active) => {
    btn.style.padding = "4px 10px";
    btn.style.borderRadius = "8px";
    btn.style.border = "1px solid rgba(255,255,255,.12)";
    btn.style.cursor = "pointer";
    btn.style.background = active ? "rgba(255,255,255,.10)" : "rgba(0,0,0,.15)";
    btn.style.color = "#fff";
  };
  [...bar.querySelectorAll(".cmode")].forEach(btn => {
    styleBtn(btn, btn.dataset.mode === colorMode);
    btn.addEventListener("click", () => {
      colorMode = btn.dataset.mode;
      [...bar.querySelectorAll(".cmode")].forEach(b => styleBtn(b, b === btn));
      if (viewLevel === "state") renderStates(); else if (viewLevel === "county") showCounties(lastStateCode);
    });
  });
}

/* ----------------------- STATES VIEW ---------------------- */
async function renderStates() {
  ensureColorModeToggle();

  // Build the state coloring map (Top10 by selected metric, only for FB states)
  currentStateTopMap = computeStateTopMap();

  viewLevel = "state";
  if (!usGeoJSON) {
    usGeoJSON = await loadJSON("https://cdn.jsdelivr.net/gh/python-visualization/folium/examples/data/us-states.json");
  }
  if (statesLayer) map.removeLayer(statesLayer);
  if (countiesLayer) { map.removeLayer(countiesLayer); countiesLayer = null; }
  if (spasLayer) { map.removeLayer(spasLayer); spasLayer = null; }

  statesLayer = L.geoJSON(usGeoJSON, {
    style: (feature) => {
      const code = (feature?.id || "").toUpperCase();
      const tier = currentStateTopMap.get(code); // "r"|"y"|"g"|undefined
      const fill = tier ? colorMap(tier) : GRAY_FILL;
      return {
        color: "#666",
        weight: 1,
        fillColor: fill,
        fillOpacity: tier ? 0.65 : 0.15,
      };
    },
    onEachFeature: (feature, layer) => {
      const code = (feature?.id || "").toUpperCase();
      const rec  = statesData[code] || null;
      layer.bindTooltip(tldrHTML(code, rec), { sticky:true, className:"tldr-tooltip" });

      layer.on("click", () => showCounties(code));

      // Hover -> show state sparkline
      layer.on("mouseover", () => {
        layer.setStyle({ weight: 2 });
        if (stateSeries[code]) showStateChart(code);
      });
      layer.on("mouseout",  () => layer.setStyle({ weight: 1 }));
    }
  }).addTo(map);

  map.setView([37.8, -96.9], 4);
  if ($backButton) $backButton.style.display = "none";

  if ($stateRow) $stateRow.style.display = "none";
  $stateName.textContent  = "United States";
  $stateTotal.textContent = fmt(usTotal);
  $coverage.textContent   = "";
  renderTop10States();          // populate table
  colorTopTableRows(currentStateTopMap);
  ensureColorLegend();
}

function renderTop10States() {
  if (!$topTableTbody) return;
  if ($topTitle) $topTitle.textContent = "Top 10 States (by total)";
  const rows = Object.entries(statesData)
    .map(([code, rec]) => ({ code, name: `${code} — ${code2name(code)}`, total: Number(rec?.total_till_date ?? 0) }))
    .sort((a,b) => b.total - a.total)
    .slice(0, 10);
  $topTableTbody.innerHTML = rows.map((r, i) =>
    `<tr data-key="${r.code}"><td>${i+1}</td><td>${r.name}</td><td>${fmt(r.total)}</td></tr>`
  ).join("");
}

/* ---------------------- COUNTIES VIEW --------------------- */
async function showCounties(code) {
  ensureColorModeToggle();

  viewLevel = "county";
  lastStateCode = code;

  // De-color ALL states in the background
  setAllStatesDimmed();
  if (dimmedStateCode && dimmedStateCode !== code) setStateFillVisibility(dimmedStateCode, true);
  setStateFillVisibility(code, false);
  dimmedStateCode = code;

  if (countiesLayer) map.removeLayer(countiesLayer);
  if (spasLayer) { map.removeLayer(spasLayer); spasLayer = null; }

  const usCountiesGeo = await loadJSON(
    "https://raw.githubusercontent.com/plotly/datasets/master/geojson-counties-fips.json"
  );
  const prefix = stateCodeToFipsPrefix(code);
  const filtered = usCountiesGeo.features.filter(f => {
    const rawId = f.id ?? f.properties?.GEOID ?? f.properties?.COUNTYFP;
    const fips  = String(rawId ?? "").padStart(5, "0");
    return fips.startsWith(prefix);
  });

  const countiesData = await fetchCountiesForState(code);

  // County Top10 color tiers for this state (by mode)
  currentCountyTopMap = computeCountyTopMap(code, countiesData);

  countiesLayer = L.geoJSON({ type: "FeatureCollection", features: filtered }, {
    style: (feature) => {
      const rawId = feature.id ?? feature.properties?.GEOID ?? feature.properties?.COUNTYFP;
      const countyFips = String(rawId ?? "").padStart(5, "0");
      const tier = currentCountyTopMap.get(countyFips); // "r"|"y"|"g"|undefined
      const fill = tier ? colorMap(tier) : GRAY_FILL;
      return {
        color: "#444",
        weight: 1,
        fillColor: fill,
        fillOpacity: tier ? 0.7 : 0.15,
      };
    },
    onEachFeature: (feature, layer) => {
      const rawId = feature.id ?? feature.properties?.GEOID ?? feature.properties?.COUNTYFP;
      const countyFips = String(rawId ?? "").padStart(5, "0");
      const rec = countiesData[countyFips] || null;

      layer.bindTooltip(tldrHTML(rec?.county_name || countyFips, rec), { sticky: true, className: "tldr-tooltip" });

      // Hover -> show county sparkline (from CSV) using state code + county name
      layer.on("mouseover", () => {
        layer.setStyle({ weight: 2 });
        const countyName = rec?.county_name;
        if (countyName) showCountyChart(code, countyName);
      });
      layer.on("mouseout",  () => layer.setStyle({ weight: 1 }));

      // Drilldown to SPAs for Los Angeles County (06037) only (for now)
      layer.on("click", async () => {
        if (code === "CA" && countyFips === "06037") {
          await showSPAs(feature, rec).catch(e => console.error("showSPAs error:", e));
        }
      });
    }
  }).addTo(map);

  map.fitBounds(countiesLayer.getBounds(), { padding: [10,10] });
  if ($backButton) {
    $backButton.style.display = "inline-block";
    $backButton.textContent = "← Back to US";
  }

  const srec = statesData[code] || null;
  if ($stateRow) $stateRow.style.display = "";
  $stateName.textContent  = code2name(code) + " Total Incidents";
  $stateTotal.textContent = fmt(Number(srec?.total_till_date ?? 0));
  $coverage.textContent   = srec?.last_obs_week?.end ? `Coverage through → ${srec.last_obs_week.start}` : "";

  if ($topTitle) $topTitle.textContent = `Top 10 Counties in ${code2name(code)} (by total)`;
  if ($topTableTbody) {
    const rows = Object.entries(countiesData)
      .map(([fips, rec]) => ({ fips, name: rec?.county_name || fips, total: Number(rec?.total_till_date ?? 0) }))
      .sort((a,b) => b.total - a.total)
      .slice(0, 10);
    $topTableTbody.innerHTML = rows.map((r, i) =>
      `<tr data-key="${r.fips}"><td>${i+1}</td><td>${r.name}</td><td>${fmt(r.total)}</td></tr>`
    ).join("");
  }
  colorTopTableRows(currentCountyTopMap);
  ensureColorLegend();
}

/* ------------------------ SPAs VIEW ----------------------- */
async function showSPAs(countyFeature, countyRec) {
  viewLevel = "spa";

  if (dimmedCountyFips) setCountyFillVisibility(dimmedCountyFips, true);
  const rawId = countyFeature.id ?? countyFeature.properties?.GEOID ?? countyFeature.properties?.COUNTYFP;
  dimmedCountyFips = String(rawId ?? "").padStart(5, "0");
  setCountyFillVisibility(dimmedCountyFips, false);

  if (spasLayer) { map.removeLayer(spasLayer); spasLayer = null; }

  let spaFC;
  try {
    spaFC = await loadJSON(LA_SPA_GEOJSON_URL);
  } catch (e) {
    console.error("[SPA] load failed:", e);
    alert("Failed to load SPA boundaries.");
    return;
  }

  let spaData = {};
  try {
    spaData = USE_FB ? await fetchSPAsFromFirestore() : {};
  } catch (e) {
    console.warn("SPA Firestore load failed:", e?.message || e);
  }

  function featureSpaKey(p) {
    const label = p.SPA_Name || p.SPA_NAM || p.SPA_NAME || `SPA ${p.SPA || ""}`;
    let normalized = normalizeSpaName(label
      .replace(/Los Angeles/gi, "L.A.")
      .replace(/\s+County/gi, "")
      .replace(/\s+Region/gi, "")
      .replace(/\s+Area/gi, "")
      .replace(/\s+/g, " ")
      .trim()
    );
    const manual = {
      "san-fernando": "san-fernando-valley",
      "san-fernando-val": "san-fernando-valley",
      "metro-los-angeles": "metro-l-a",
      "metro-los-angeles-region": "metro-l-a",
      "metro": "metro-l-a",
      "west": "west-la",
      "south": "south-la",
      "east": "east-la",
      "antelope-valley": "antelope-valley",
      "san-gabriel": "san-gabriel-valley",
      "san-gabriel-val": "san-gabriel-valley",
      "south-bay": "south-bay",
    };
    if (manual[normalized]) normalized = manual[normalized];
    return normalized;
  }

  spasLayer = L.geoJSON(spaFC, {
    style: (f) => {
      const p = f.properties || {};
      const key = featureSpaKey(p);
      const rec = spaData[key];
      const fill = rec ? colorMap(rec.color || GRAY_FILL) : GRAY_FILL;
      return { color: SPA_STROKE, weight: 1.6, fillOpacity: 0.65, fillColor: fill };
    },
    onEachFeature: (feature, layer) => {
      const p = feature.properties || {};
      const key = featureSpaKey(p);
      const rec = spaData[key] || { spa_name: p.SPA_Name || p.SPA_NAM || p.SPA_NAME || key };
      layer.bindTooltip(
        tldrHTML(rec.spa_name || key, rec.total_till_date ? rec : null),
        { sticky:true, className:"tldr-tooltip" }
      );
      layer.on("mouseover", () => layer.setStyle({ weight: 2.2 }));
      layer.on("mouseout",  () => layer.setStyle({ weight: 1.6 }));
    }
  }).addTo(map);

  map.fitBounds(spasLayer.getBounds(), { padding:[10,10] });

  if ($topTitle) $topTitle.textContent = "Los Angeles County — Service Planning Areas";
  if ($topTableTbody) {
    const rows = Object.values(spaData)
      .map(r => ({ name: r.spa_name, total: Number(r.total_till_date || 0) }))
      .sort((a,b) => b.total - a.total)
      .slice(0, 8);
    $topTableTbody.innerHTML = rows.map((r, i) =>
      `<tr><td>${i+1}</td><td>${r.name}</td><td>${fmt(r.total)}</td></tr>`
    ).join("");
  }
  if ($backButton) {
    $backButton.style.display = "inline-block";
    $backButton.textContent = `← Back to ${code2name(lastStateCode)}`;
  }

  if ($stateRow) $stateRow.style.display = "";
  $stateName.textContent  = countyRec?.county_name || "Los Angeles County";
  $stateTotal.textContent = fmt(Number(countyRec?.total_till_date ?? 0));
  $coverage.textContent   = countyRec?.last_obs_week?.end ? `Coverage till → ${countyRec.last_obs_week.start}` : "";
}

/* ------------------- CSV -> series (states + counties) ------------------- */
async function loadWeeklyMatrix() {
  const res = await fetch(WEEKLY_CSV_URL, { cache: "no-store" });
  if (!res.ok) throw new Error(`CSV fetch failed: ${res.status} ${res.statusText}`);
  const csvText = await res.text();
  return new Promise((resolve, reject) => {
    if (!window.Papa) return reject(new Error("Papa Parse is not loaded"));
    Papa.parse(csvText, {
      header: true, dynamicTyping: true, skipEmptyLines: true, worker: false,
      complete: (out) => resolve(out),
      error: reject
    });
  });
}
// --- robust county normalizer (supports "County of", St./Saint, accents, etc.)
const normCounty = (s) => (s || "")
  .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .toLowerCase()
  .replace(/[^\p{L}\p{N}]+/gu, " ")
  .replace(/\b(st|st\.)\b/gi, "saint")
  .replace(/\bcounty\s+of\s+/g, "")
  .replace(/\bparish\s+of\s+/g, "")
  .replace(/\bmunicipio\s+de\s+/g, "")
  .replace(/\b(county|parish|borough|census area|city|municipality|municipio)\b/g, "")
  .replace(/\s+/g, "")
  .trim();

function buildStateAndCountyIndex(papaOut){
  weeklyRows = papaOut.data;
  const fields = papaOut.meta?.fields || [];
  labelsAll = weeklyRows.map(r => String(r.week_start));

  const stateColumns = {};         // { CA: ["CA|Los Angeles", ...] }
  countyHeaderByNorm = {};         // { CA: { "losangeles": "CA|Los Angeles", ... } }

  for (const f of fields) {
    if (f === "week_start") continue;
    const parts = f.split("|");
    if (parts.length < 2) continue;

    const code = (parts[0] || "").trim();
    const countyRaw = (parts.slice(1).join("|") || "").trim();
    if (!VALID_STATE_CODES.has(code)) continue;

    (stateColumns[code] ||= []).push(f);

    const base = countyRaw;
    const noAdminSuffix = base.replace(/\b(County|Parish|Borough|Census Area|City|Municipality|Municipio)\b/gi, "").trim();
    const ofDrop = base.replace(/\b(County|Parish|Municipio)\s+of\s+/gi, "");
    const variants = new Set([
      base,
      noAdminSuffix,
      ofDrop,
      base.replace(/\bSt\.\b/gi, "Saint"),
      noAdminSuffix.replace(/\bSt\.\b/gi, "Saint")
    ]);

    (countyHeaderByNorm[code] ||= {});
    for (const v of variants) {
      const key = normCounty(v);
      if (key) countyHeaderByNorm[code][key] = f;
    }
  }

  // State series (sum of counties)
  const sSeries = {};
  for (const code of Object.keys(stateColumns)) {
    const cols = stateColumns[code];
    const vals = weeklyRows.map(r => {
      let s = 0;
      for (let i=0;i<cols.length;i++) {
        const v = Number(r[cols[i]] ?? 0);
        if (v) s += v;
      }
      return s;
    });
    sSeries[code] = { labels: labelsAll, values: vals };
  }
  return sSeries;
}



/* -------------------- trimming helper -------------------- */
function trimUntilAtLeast(labels, values, threshold = TRIM_THRESHOLD, fallbackTail = FALLBACK_TAIL) {
  let i = 0, n = values.length;
  while (i < n && Number(values[i] ?? 0) < threshold) i++;
  if (i >= n) {
    const start = Math.max(0, n - fallbackTail);
    return { labels: labels.slice(start), values: values.slice(start) };
  }
  return { labels: labels.slice(i), values: values.slice(i) };
}



function getCountySeries(stateCode, countyName){
  if (!stateCode || !countyName) return null;
  const norm = normCounty(countyName);
  const cacheKey = `${stateCode}|${norm}`;
  if (countySeries[cacheKey]) return countySeries[cacheKey];

  const mapForState = countyHeaderByNorm[stateCode] || {};
  const header = mapForState[norm];
  if (!header) return null;

  const vals = weeklyRows.map(r => Number(r[header] ?? 0));
  const out = { labels: labelsAll, values: vals };
  countySeries[cacheKey] = out; // cache
  return out;
}
/* ===== replace ensureHoverChartControl + showStateChart + showCountyChart ===== */

/* ---------- full-width bottom overlay instead of a Leaflet control ---------- */
function ensureHoverChartControl(){
  if (hoverChartContainer) return;

  const HoverChart = L.Control.extend({
    options: { position: "bottomleft" },
    onAdd: function(){
      const div = L.DomUtil.create("div", "hover-chart");
      // Layout & look
      div.style.position = "relative";
      div.style.background = "rgba(17,24,39,.92)";
      div.style.border = "1px solid rgba(255,255,255,.12)";
      div.style.borderRadius = "10px";
      div.style.boxShadow = "0 8px 24px rgba(0,0,0,.35)";
      div.style.padding = "10px 12px";
      div.style.color = "#fff";
      div.style.backdropFilter = "blur(3px)";
      div.style.display = "none";
      div.style.zIndex = "9999";           // keep on top of the map/controls

      div.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
          <div style="font-weight:700" id="chartTitle">Weekly Incidents</div>
          <button id="chartCloseBtn" style="font-size:12px;padding:2px 6px;border:0;border-radius:6px;cursor:pointer;">✕</button>
        </div>
        <div id="stateSparkWrap" style="width:100%;height:100%;">
          <canvas id="stateSpark"></canvas>
        </div>
      `;

      // prevent interactions from bubbling to the map
      L.DomEvent.disableClickPropagation(div);
      L.DomEvent.disableScrollPropagation(div);

      div.querySelector("#chartCloseBtn").addEventListener("click", ()=> div.style.display="none");

      hoverChartContainer = div;

      // initial sizing
      sizeHoverChart();

      // reflow on map resize
      map.on("resize", sizeHoverChart);

      return div;
    }
  });

  map.addControl(new HoverChart());
}

// helper: set chart to full map width & 20% lower height
function sizeHoverChart(){
  if (!hoverChartContainer || !map) return;
  const pad = 16;                          // breathing room vs map edge
  const mapSize = map.getSize();           // Leaflet size in px
  const targetW = Math.max(320, mapSize.x - 2 * pad);
  const targetH = Math.max(120, Math.round((mapSize.y * 0.25) * 0.8)); // 25% of map, minus ~20%

  hoverChartContainer.style.width = `${targetW}px`;
  hoverChartContainer.style.height = `${targetH}px`;
}


/* -------------------- trimmed-series helper (unchanged) -------------------- */
// (keep your existing trimUntilAtLeast)

/* ----------------------------- STATE CHART ----------------------------- */
function showStateChart(stateCode){
  if (!stateSeries[stateCode]) return;
  ensureHoverChartControl();
  const { labels, values } = stateSeries[stateCode];

  const trimmed = trimUntilAtLeast(labels, values, TRIM_THRESHOLD, FALLBACK_TAIL);
  const LBL = trimmed.labels;
  const VAL = trimmed.values;

  hoverChartContainer.querySelector("#chartTitle").textContent =
    `${stateCode} — ${code2name(stateCode)} (from ${LBL[0] || labels[0]})`;
  hoverChartContainer.style.display = "block";

  const ctx = hoverChartContainer.querySelector("#stateSpark").getContext("2d");
  if (!window.Chart) return;

  const baseOptions = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { display: true, position: "top", align: "end" },  // top-right legend
    tooltip: { mode: "index", intersect: false }
  },
  // Year-only ticks without time adapter: use category scale and custom callback
  scales: {
    x: {
      ticks: {
        maxTicksLimit: 12,
        color: "#e5e7eb",
        callback: function(value, idx, ticks){
          // value is index; get label string and print unique years
          const curr = (this.getLabelForValue(value) || "").slice(0,4);
          if (idx > 0) {
            const prev = (this.getLabelForValue(ticks[idx-1].value) || "").slice(0,4);
            if (prev === curr) return ""; // avoid repeating the same year
          }
          return curr;
        }
      },
      grid: { display: false }
    },
    y: {
      ticks: { color: "#e5e7eb" },
      grid: { color: "rgba(255,255,255,.08)" }
    }
  }
};

  if (hoverChart) {
    hoverChart.data.labels = LBL;
    hoverChart.data.datasets[0].data = VAL;
    hoverChart.data.datasets[0].label = "State total";
    hoverChart.options = baseOptions;
    hoverChart.update("none");
  } else {
    hoverChart = new Chart(ctx, {
      type: "line",
      data: {
        labels: LBL,
        datasets: [{ label: "State total", data: VAL, borderWidth: 2, pointRadius: 0, tension: 0.2 }]
      },
      options: baseOptions
    });
  }
}

/* ----------------------------- COUNTY CHART ----------------------------- */
function showCountyChart(stateCode, countyName){
  const series = getCountySeries(stateCode, countyName);
  if (!series) return;
  ensureHoverChartControl();

  const { labels, values } = series;
  const trimmed = trimUntilAtLeast(labels, values, TRIM_THRESHOLD, FALLBACK_TAIL);
  const LBL = trimmed.labels;
  const VAL = trimmed.values;

  hoverChartContainer.querySelector("#chartTitle").textContent =
    `${countyName}, ${stateCode} (from ${LBL[0] || labels[0]})`;
  hoverChartContainer.style.display = "block";

  const ctx = hoverChartContainer.querySelector("#stateSpark").getContext("2d");
  if (!window.Chart) return;

  const baseOptions = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { display: true, position: "top", align: "end" },  // top-right legend
    tooltip: { mode: "index", intersect: false }
  },
  // Year-only ticks without time adapter: use category scale and custom callback
  scales: {
    x: {
      ticks: {
        maxTicksLimit: 12,
        color: "#e5e7eb",
        callback: function(value, idx, ticks){
          // value is index; get label string and print unique years
          const curr = (this.getLabelForValue(value) || "").slice(0,4);
          if (idx > 0) {
            const prev = (this.getLabelForValue(ticks[idx-1].value) || "").slice(0,4);
            if (prev === curr) return ""; // avoid repeating the same year
          }
          return curr;
        }
      },
      grid: { display: false }
    },
    y: {
      ticks: { color: "#e5e7eb" },
      grid: { color: "rgba(255,255,255,.08)" }
    }
  }
};

  if (hoverChart) {
    hoverChart.data.labels = LBL;
    hoverChart.data.datasets[0].data = VAL;
    hoverChart.data.datasets[0].label = "County total";
    hoverChart.options = baseOptions;
    hoverChart.update("none");
  } else {
    hoverChart = new Chart(ctx, {
      type: "line",
      data: {
        labels: LBL,
        datasets: [{ label: "County total", data: VAL, borderWidth: 2, pointRadius: 0, tension: 0.2 }]
      },
      options: baseOptions
    });
  }
}


/* ================== Color legend (updates with mode) ================== */
let colorLegendControl;

function ensureColorLegend(){
  if (colorLegendControl) { map.removeControl(colorLegendControl); colorLegendControl = null; }

  const title = (colorMode === "rank")
    ? "Rank (total to date)"
    : "YoY lift (latest vs ~52w ago)";

  colorLegendControl = L.control({ position: "topright" }); // ← was bottomright
  colorLegendControl.onAdd = function(){
    const d = L.DomUtil.create("div", "wf-legend");
    Object.assign(d.style, {
      background: "rgba(17,24,39,.92)",
      border: "1px solid rgba(255,255,255,.12)",
      borderRadius: "10px",
      padding: "10px 12px",
      color: "#fff",
      fontSize: "12px",
      zIndex: 1100,               // ← make sure it sits above chart overlay (which is 1000)
      pointerEvents: "auto"
    });
    d.innerHTML = `
      <div style="font-weight:700; margin-bottom:6px;">${title}</div>
      <div style="display:grid; grid-template-columns:auto 1fr; gap:6px 10px; align-items:center;">
        <span style="width:14px;height:14px;background:#ef4444;border-radius:4px;display:inline-block;"></span><span>Top 1–3</span>
        <span style="width:14px;height:14px;background:#facc15;border-radius:4px;display:inline-block;"></span><span>Ranks 4–7</span>
        <span style="width:14px;height:14px;background:#10b981;border-radius:4px;display:inline-block;"></span><span>Ranks 8–10</span>
        <span style="width:14px;height:14px;background:#d1d5db;border-radius:4px;display:inline-block;"></span><span>Not in Top 10 / no data</span>
      </div>
    `;
    L.DomEvent.disableClickPropagation(d);
    L.DomEvent.disableScrollPropagation(d);
    return d;
  };
  colorLegendControl.addTo(map);
}



/* -------------------- COLOR CALCULATIONS -------------------- */
function top10Tiers(listKeys) {
  // return Map(key -> "r"/"y"/"g") for top10 only
  const map = new Map();
  listKeys.slice(0, 10).forEach((k, i) => {
    let tier = null;
    if (i < 3) tier = "r";
    else if (i < 6) tier = "y";
    else tier = "g";
    map.set(k, tier);
  });
  return map;
}

function computeStateTopMap() {
  // Only consider states that exist in Firestore
  const fbStates = Object.entries(statesData);

  if (colorMode === "rank") {
    const ranked = fbStates
      .map(([code, rec]) => ({ code, total: Number(rec?.total_till_date ?? 0) }))
      .sort((a,b) => b.total - a.total)
      .map(r => r.code);
    return top10Tiers(ranked);
  }

  // YoY: latest vs ~52 weeks back from CSV state series
  const yoyPairs = fbStates
    .map(([code]) => {
      const s = stateSeries[code];
      if (!s) return null;
      const vals = s.values || [];
      const n = vals.length;
      if (n < 53) return null;
      const latest = Number(vals[n-1] ?? 0);
      const prevYr = Number(vals[n-53] ?? 0);
      const lift = latest - prevYr;
      return { code, lift };
    })
    .filter(Boolean)
    .sort((a,b) => b.lift - a.lift)
    .map(x => x.code);

  return top10Tiers(yoyPairs);
}

function computeCountyTopMap(stateCode, countiesData) {
  const entries = Object.entries(countiesData || {});
  if (colorMode === "rank") {
    const ranked = entries
      .map(([fips, rec]) => ({ fips, total: Number(rec?.total_till_date ?? 0) }))
      .sort((a,b) => b.total - a.total)
      .map(r => r.fips);
    return top10Tiers(ranked);
  }

  // YoY at county level (from CSV)
  const yoy = [];
  for (const [fips, rec] of entries) {
    const series = getCountySeries(stateCode, rec?.county_name || "");
    if (!series) continue;
    const vals = series.values || [];
    const n = vals.length;
    if (n < 53) continue;
    const latest = Number(vals[n-1] ?? 0);
    const prevYr = Number(vals[n-53] ?? 0);
    yoy.push({ fips, lift: latest - prevYr });
  }
  const ranked = yoy.sort((a,b) => b.lift - a.lift).map(x => x.fips);
  return top10Tiers(ranked);
}

/* ---------------------- TABLE ROW COLOR -------------------- */
function colorTopTableRows(tierMap) {
  if (!$topTableTbody) return;
  [...$topTableTbody.querySelectorAll("tr")].forEach(tr => {
    tr.style.background = ""; // reset
    const key = tr.getAttribute("data-key");
    const tier = tierMap.get(key);
    if (!tier) return;
    tr.style.background = colorMap(tier);
    tr.style.color = "#111";
    tr.style.fontWeight = 600;
  });
}

/* -------------------------- INIT -------------------------- */
async function init() {
  const Splash = window.Splash || { setProgress(){}, hide(){} };
  Splash.setProgress(5);
  await new Promise(r => setTimeout(r, 300));
  map = L.map("map", { zoomControl: true });

  const positron = L.tileLayer(
    "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
    { attribution: "&copy; OpenStreetMap &copy; CARTO", subdomains:"abcd", maxZoom: 19 }
  ).addTo(map);
  const esriSat = L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    { attribution: "Tiles © Esri" }
  );
  L.control.layers({ "Positron (light)": positron, "Satellite (Esri)": esriSat }, {}).addTo(map);

  Splash.setProgress(25);
  await new Promise(r => setTimeout(r, 200));
  try {
    if (USE_FB) {
      statesData = await fetchStatesFromFirestore();
    } else {
      throw new Error("USE_FIREBASE=false");
    }
  } catch (e) {
    console.warn("Firestore disabled/failed. Reason:", e?.message || e);
    try {
      if (CFG.STATES_JSON) {
        const states = await loadJSON(CFG.STATES_JSON);
        statesData = states?.states || {};
      } else {
        statesData = {};
      }
    } catch (e2) {
      console.error("States JSON fallback failed:", e2?.message || e2);
      statesData = {};
    }
  }

  // Load CSV (states + build county index)
  try {
    const parsed = await loadWeeklyMatrix();
    stateSeries = buildStateAndCountyIndex(parsed);
    console.log("[CSV] Weekly series loaded for", Object.keys(stateSeries).length, "states.");
  } catch (e) {
    console.warn("Weekly CSV load skipped/failed:", e?.message || e);
    stateSeries = {};
    countyHeaderByNorm = {};
  }

  Splash.setProgress(70);
  await new Promise(r => setTimeout(r, 100));
  usTotal = Object.values(statesData)
    .reduce((s, r) => s + Number(r?.total_till_date ?? 0), 0);
  if ($usTotal) $usTotal.textContent = fmt(usTotal);

  await renderStates();
  Splash.setProgress(100);
  await new Promise(r => setTimeout(r, 100));
  Splash.hide();
}

/* -------------------- BACK NAVIGATION --------------------- */
$backButton?.addEventListener("click", async () => {
  if (viewLevel === "spa") {
    if (dimmedCountyFips) {
      setCountyFillVisibility(dimmedCountyFips, true);
      dimmedCountyFips = null;
    }
    await showCounties(lastStateCode);
    return;
  }
  if (dimmedStateCode) {
    setStateFillVisibility(dimmedStateCode, true);
    dimmedStateCode = null;
  }
  await renderStates();
  if ($stateRow) $stateRow.style.display = "none";
  $stateName.textContent  = "United States";
  $stateTotal.textContent = fmt(usTotal);
  $coverage.textContent   = "";
});

/* --------------------------- GO --------------------------- */
init().catch(err => {
  console.error("App init fatal:", err);
  alert("Failed to initialize app. Check console.");
});
