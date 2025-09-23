/* Firestore-first, JSON-fallback
   - Default: national view with Top 10 states
   - Click state: drill to county polygons and show Top 10 counties for that state
   - Back button: restore national view + Top 10 states
   - US total = sum of state total_till_date
   - Colors: r=red, g=green, y=yellow, or hex
*/

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore, collection, doc, getDoc, getDocs } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ---- CONFIG ----
const CFG = window.WF_CONFIG || {};
const USE_FB = !!CFG.USE_FIREBASE;

// ---- DOM ----
const $stateRow = document.querySelector("#stateName")?.closest(".metric");
const $usTotal    = document.querySelector("#usTotal");
const $stateName  = document.querySelector("#stateName");
const $stateTotal = document.querySelector("#stateTotal");
const $coverage   = document.querySelector("#coverage");
const $backButton = document.querySelector("#backButton");
const $topTitle   = document.querySelector("#topTitle");
const $topTableTbody =
  document.querySelector("#top10 tbody") || document.querySelector("#topTable tbody");

// ---- GLOBALS ----
let map, statesLayer, countiesLayer;
let statesData = {};          // { CA: normalizedStateRec, ... }
let usGeoJSON = null;
let usTotal = 0;
let selectedState = null;     // currently focused state (when in county view)

// ---- HELPERS ----
function fmt(n) { n = Number(n || 0); return isFinite(n) ? n.toLocaleString() : "0"; }
async function loadJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`fetch failed ${r.status}`);
  return r.json();
}
function rng(a, b) {
  if (!a && !b) return "n/a";
  if (a && b) return `${a} – ${b}`;
  return a || b || "n/a";
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
function colorMap(c) {
  if (!c) return "#ffd166";
  const v = (c + "").toLowerCase();
  if (v === "r") return "#ef4444";
  if (v === "g") return "#10b981";
  if (v === "y") return "#facc15";
  return c; // assume hex
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

// ---- NORMALIZERS ----
function normalizeStateRec(d) {
  if (!d) return null;
  return {
    total_till_date: Number(d.total_till_date ?? 0),
    color: d.color || "y",
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
}
function normalizeCountyRec(d) {
  if (!d) return null;
  return {
    county_name: d.county_name || "",
    total_till_date: Number(d.total_till_date ?? 0),
    color: d.color || "y",
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
}

// ---- FIREBASE ----
async function fetchStatesFromFirestore() {
  const app = initializeApp(CFG.FIREBASE);
  const db  = getFirestore(app);

  const statesSnap = await getDocs(collection(db, "states"));
  const out = {};

  for (const s of statesSnap.docs) {
    const code = (s.id || "").toUpperCase();

    // Prefer state-level TLDR directly on the state doc
    const stateDoc = await getDoc(doc(db, "states", code));
    let rec = null;
    if (stateDoc.exists()) {
      const d = stateDoc.data();
      if (
        d.total_till_date != null ||
        d.last_obs_week_count != null ||
        d.last_obs_month_count != null ||
        d.next_week_forecast != null ||
        d.next_month_forecast != null
      ) rec = normalizeStateRec(d);
    }

    // If state TLDR not present, aggregate from counties as fallback
    if (!rec) {
      const countiesSnap = await getDocs(collection(db, "states", code, "counties"));
      if (!countiesSnap.empty) {
        let total = 0, lwc = 0, lmc = 0, nwf = 0, nmf = 0;
        let lwe = "", lme = "", nwe = "", nme = "";
        let color = "y";
        countiesSnap.forEach(c => {
          const d = c.data();
          total += Number(d.total_till_date ?? d.last_obs_month_count ?? 0);
          lwc   += Number(d.last_obs_week_count ?? 0);
          lmc   += Number(d.last_obs_month_count ?? 0);
          nwf   += Number(d.next_week_forecast ?? 0);
          nmf   += Number(d.next_month_forecast ?? 0);
          if (d.last_obs_week_end)  lwe = d.last_obs_week_end;
          if (d.last_obs_month_end) lme = d.last_obs_month_end;
          if (d.next_week_end)      nwe = d.next_week_end;
          if (d.next_month_end)     nme = d.next_month_end;
          if (d.color && color === "y") color = d.color;
        });
        rec = {
          total_till_date: total,
          color,
          last_obs_week: { start:"", end:lwe, count:lwc },
          last_obs_month:{ start:"", end:lme, count:lmc },
          next_week_forecast:{ start:"", end:nwe, count:nwf },
          next_month_forecast:{ start:"", end:nme, count:nmf },
        };
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
  snap.forEach(c => { out[c.id] = normalizeCountyRec(c.data()); });
  return out;
}

// ---- UI: tooltips & tables ----
function tldrHTML(placeName, rec) {
  const title = rec?.county_name || code2name(placeName) || placeName;
  if (!rec) return `<div class="tldr"><div class="tldr-title">${title} TLDR</div><div>No data</div></div>`;

  const lastW = rec.last_obs_week || {};
  const lastM = rec.last_obs_month || {};
  const nextW = rec.next_week_forecast || {};
  const nextM = rec.next_month_forecast || {};
  const total = Number(rec.total_till_date ?? 0);

  return `
    <div class="tldr">
<div class="tldr-title"
     style="padding-left:6px; padding-bottom:6px; margin:0; display:flex; gap:6px; align-items:baseline;">
  <span class="tldr-name" style="font-weight:800;">${title}</span>
  <span class="tldr-total" style="font-weight:600;">(${fmt(total)})</span>
</div>

      <table class="tldr-table">
        <tr><td>Last observed week</td><td>${rng(lastW.start,lastW.end)}</td><td>${fmt(lastW.count)}</td></tr>
        <tr><td>Last observed month</td><td>${rng(lastM.start,lastM.end)}</td><td>${fmt(lastM.count)}</td></tr>
        <tr><td>Next week forecast</td><td>${rng(nextW.start,nextW.end)}</td><td>${fmt(nextW.count)}</td></tr>
        <tr><td>Next month forecast</td><td>${rng(nextM.start,nextM.end)}</td><td>${fmt(nextM.count)}</td></tr>
      </table>
    </div>
  `;
}

function renderTop10States() {
  if (!$topTableTbody) return;
  if ($topTitle) $topTitle.textContent = "Top 10 States (by total)";
  const rows = Object.entries(statesData)
    .map(([code, rec]) => ({ code, total: Number(rec?.total_till_date ?? 0) }))
    .sort((a,b) => b.total - a.total)
    .slice(0, 10);
  $topTableTbody.innerHTML = rows.map((r, i) =>
    `<tr><td>${i+1}</td><td>${r.code} — ${code2name(r.code)}</td><td>${fmt(r.total)}</td></tr>`
  ).join("");
}

function renderTop10Counties(stateCode, countiesData) {
  if (!$topTableTbody) return;
  if ($topTitle) $topTitle.textContent = `Top 10 Counties in ${code2name(stateCode)} (by total)`;
  const rows = Object.entries(countiesData)
    .map(([fips, rec]) => ({
      name: rec?.county_name || fips,
      total: Number(rec?.total_till_date ?? 0)
    }))
    .sort((a,b) => b.total - a.total)
    .slice(0, 10);
  $topTableTbody.innerHTML = rows.map((r, i) =>
    `<tr><td>${i+1}</td><td>${r.name}</td><td>${fmt(r.total)}</td></tr>`
  ).join("");
}

// ---- MAP: states ----
async function renderStates() {
  if (!usGeoJSON) {
    usGeoJSON = await loadJSON("https://cdn.jsdelivr.net/gh/python-visualization/folium/examples/data/us-states.json");
  }
  if (statesLayer) map.removeLayer(statesLayer);
  if (countiesLayer) { map.removeLayer(countiesLayer); countiesLayer = null; }

  statesLayer = L.geoJSON(usGeoJSON, {
    style: (feature) => {
      const code = (feature?.id || "").toUpperCase();
      const rec  = statesData[code];
      return { color:"#666", weight:1, fillColor: colorMap(rec?.color || "y"), fillOpacity:0.6 };
    },
    onEachFeature: (feature, layer) => {
      const code = (feature?.id || "").toUpperCase();
      const rec  = statesData[code];
      layer.bindTooltip(tldrHTML(code, rec), { sticky:true, className:"tldr-tooltip" });
      layer.on("click", () => showCounties(code));
    }
  }).addTo(map);

  

  // Default national view
  // map.fitBounds(statesLayer.getBounds(), { padding: [10,10] });
  map.setView([37.8, -96.9], 5);
  if ($backButton) $backButton.style.display = "none";

  // Sidebar defaults for US
  if ($stateRow) $stateRow.style.display = "none";  // hide by default on national view
  $stateName.textContent  = "United States";
  $stateTotal.textContent = fmt(usTotal);
  $coverage.textContent   = "";
  renderTop10States();
}

// ---- MAP: counties ----
async function showCounties(code) {
  selectedState = code;
  if (countiesLayer) map.removeLayer(countiesLayer);

  const usCountiesGeo = await loadJSON(
    "https://raw.githubusercontent.com/plotly/datasets/master/geojson-counties-fips.json"
  );
  const prefix = stateCodeToFipsPrefix(code);
  const filtered = usCountiesGeo.features.filter(f => f.id.startsWith(prefix));
  const countiesData = await fetchCountiesForState(code);

  countiesLayer = L.geoJSON({ type:"FeatureCollection", features: filtered }, {
    style: (feature) => {
      const rec = countiesData[feature.id];
      return { color:"#444", weight:1, fillColor: colorMap(rec?.color || "y"), fillOpacity:0.65 };
    },
    onEachFeature: (feature, layer) => {
      const id = feature.id;
      const rec = countiesData[id];
      layer.bindTooltip(tldrHTML(id, rec), { sticky:true, className:"tldr-tooltip" });
    }
  }).addTo(map);

  map.fitBounds(countiesLayer.getBounds(), { padding: [10,10] });
  if ($backButton) $backButton.style.display = "inline-block";





  // Sidebar summary for the chosen state
  const srec = statesData[code] || null;
  if ($stateRow) $stateRow.style.display = "";      // show the row
  $stateName.textContent  = code2name(code);
  $stateTotal.textContent = fmt(srec?.total_till_date ?? 0);
  $coverage.textContent   = srec?.last_obs_week?.end ? `Coverage till → ${srec.last_obs_week.end}` : "";

  // Swap sidebar table to Top 10 counties
  renderTop10Counties(code, countiesData);
}

// ---- INIT ----
async function init() {
  map = L.map("map", { zoomControl: true });
  // Basemaps similar to your screenshot
  const positron = L.tileLayer(
    "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
    { attribution: "&copy; OpenStreetMap &copy; CARTO", subdomains:"abcd", maxZoom:19 }
  ).addTo(map);
  const esriSat = L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    { attribution: "Tiles © Esri" }
  );
  L.control.layers({ "Positron (light)": positron, "Satellite (Esri)": esriSat }, {}).addTo(map);

  try {
    if (USE_FB) {
      statesData = await fetchStatesFromFirestore();
    } else {
      throw new Error("USE_FIREBASE=false");
    }
  } catch (e) {
    console.warn("Firestore disabled/failed, using JSON fallback:", e?.message || e);
    const states = await loadJSON(CFG.STATES_JSON);
    statesData = states.states || {};
  }

  // US total = sum of state totals
  usTotal = Object.values(statesData).reduce((s, r) => s + Number(r?.total_till_date ?? 0), 0);
  if ($usTotal) $usTotal.textContent = fmt(usTotal);

  await renderStates();
}

// ---- Back to US ----
$backButton?.addEventListener("click", () => {
  selectedState = null;
  renderStates();                    // redraw national layer & fit to US
  if ($stateRow) $stateRow.style.display = "none";  // hide the row again
  $stateName.textContent  = "United States";
  $stateTotal.textContent = fmt(usTotal);
  $coverage.textContent   = "";
 // resets table to Top 10 states and hides back button
});

// ---- GO ----
init().catch(err => {
  console.error(err);
  alert("Failed to initialize app. Check console.");
});
