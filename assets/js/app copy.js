// /* Wildfire States & ESN Forecasting
//    Flow: State → County → SPA (Los Angeles County as 8 named regions)
//    Data: Firestore-first with safe fallbacks
//    Color rule: fill ONLY when there is numeric data, else outline-only
// */

// import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
// import {
//   getFirestore, collection, doc, getDoc, getDocs
// } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// /* ------------------------- CONFIG ------------------------- */
// const CFG = window.WF_CONFIG || {};
// const USE_FB = !!CFG.USE_FIREBASE;
// //const SPL = window.Splash;  // tiny alias

// /* LA County Service Planning Areas (8 regions) — official GeoJSON */
// const LA_SPA_GEOJSON_URL =
//   "https://services1.arcgis.com/ZIL9uO234SBBPGL7/ArcGIS/rest/services/Los_Angeles_County_Service_Planning_Areas_Layer/FeatureServer/0/query?where=1%3D1&outFields=%2A&outSR=4326&f=geojson";

// const SPA_STROKE = "#333";

// /* --------------------------- DOM -------------------------- */
// const $stateRow   = document.querySelector("#stateName")?.closest(".metric");
// const $usTotal    = document.querySelector("#usTotal");
// const $stateName  = document.querySelector("#stateName");
// const $stateTotal = document.querySelector("#stateTotal");
// const $coverage   = document.querySelector("#coverage");
// const $backButton = document.querySelector("#backButton");
// const $topTitle   = document.querySelector("#topTitle");
// const $topTableTbody =
//   document.querySelector("#top10 tbody") || document.querySelector("#topTable tbody");

// /* ------------------------- GLOBALS ------------------------ */
// let map, statesLayer, countiesLayer, spasLayer;
// let usGeoJSON = null;
// let statesData = {};
// let usTotal = 0;

// let viewLevel = "state";
// let lastStateCode = null;

// let dimmedStateCode = null;
// let dimmedCountyFips = null;

// /* ------------------------ HELPERS ------------------------- */
// function fmt(n) { n = Number(n || 0); return isFinite(n) ? n.toLocaleString() : "0"; }
// async function loadJSON(url) {
//   if (!url) throw new Error("loadJSON: missing URL");
//   const r = await fetch(url, { cache: "no-store" });
//   if (!r.ok) throw new Error(`fetch failed ${r.status}`);
//   return r.json();
// }
// function rng(a, b) {
//   if (!a && !b) return "n/a";
//   if (a && b) return `${a} – ${b}`;
//   return a || b || "n/a";
// }
// function colorMap(c) {
//   if (!c) return "#ffd166";
//   const v = (c + "").toLowerCase();
//   if (v === "r") return "#ef4444";
//   if (v === "g") return "#10b981";
//   if (v === "y") return "#facc15";
//   return c;
// }
// function hasCountyData(rec) {
//   if (!rec) return false;
//   const t  = Number(rec.total_till_date ?? 0);
//   const w  = Number(rec.last_obs_week?.count ?? 0);
//   const m  = Number(rec.last_obs_month?.count ?? 0);
//   const nw = Number(rec.next_week_forecast?.count ?? 0);
//   const nm = Number(rec.next_month_forecast?.count ?? 0);
//   return (t > 0 || w > 0 || m > 0 || nw > 0 || nm > 0);
// }

// function setStateFillVisibility(stateCode, visible) {
//   if (!statesLayer) return;
//   statesLayer.eachLayer(l => {
//     const code = (l.feature?.id || "").toUpperCase();
//     if (code === stateCode) {
//       if (visible) statesLayer.resetStyle(l);
//       else l.setStyle({ fillOpacity: 0 });
//     }
//   });
// }
// function setCountyFillVisibility(countyFips, visible) {
//   if (!countiesLayer) return;
//   countiesLayer.eachLayer(l => {
//     const raw = l.feature?.id ?? l.feature?.properties?.GEOID ?? l.feature?.properties?.COUNTYFP;
//     const fips = String(raw ?? "").padStart(5, "0");
//     if (fips === countyFips) {
//       if (visible) countiesLayer.resetStyle(l);
//       else l.setStyle({ fillOpacity: 0 });
//     }
//   });
// }

// function code2name(code) {
//   const map = {
//     "AL":"Alabama","AK":"Alaska","AZ":"Arizona","AR":"Arkansas","CA":"California","CO":"Colorado",
//     "CT":"Connecticut","DE":"Delaware","FL":"Florida","GA":"Georgia","HI":"Hawaii","ID":"Idaho",
//     "IL":"Illinois","IN":"Indiana","IA":"Iowa","KS":"Kansas","KY":"Kentucky","LA":"Louisiana",
//     "ME":"Maine","MD":"Maryland","MA":"Massachusetts","MI":"Michigan","MN":"Minnesota","MS":"Mississippi",
//     "MO":"Missouri","MT":"Montana","NE":"Nebraska","NV":"Nevada","NH":"New Hampshire","NJ":"New Jersey",
//     "NM":"New Mexico","NY":"New York","NC":"North Carolina","ND":"North Dakota","OH":"Ohio","OK":"Oklahoma",
//     "OR":"Oregon","PA":"Pennsylvania","RI":"Rhode Island","SC":"South Carolina","SD":"South Dakota",
//     "TN":"Tennessee","TX":"Texas","UT":"Utah","VT":"Vermont","VA":"Virginia","WA":"Washington",
//     "WV":"West Virginia","WI":"Wisconsin","WY":"Wyoming","DC":"District of Columbia",
//   };
//   return map[code] || code;
// }
// function stateCodeToFipsPrefix(code) {
//   const map = {
//     "AL":"01","AK":"02","AZ":"04","AR":"05","CA":"06","CO":"08","CT":"09","DE":"10","FL":"12","GA":"13",
//     "HI":"15","ID":"16","IL":"17","IN":"18","IA":"19","KS":"20","KY":"21","LA":"22","ME":"23","MD":"24",
//     "MA":"25","MI":"26","MN":"27","MS":"28","MO":"29","MT":"30","NE":"31","NV":"32","NH":"33","NJ":"34",
//     "NM":"35","NY":"36","NC":"37","ND":"38","OH":"39","OK":"40","OR":"41","PA":"42","RI":"44","SC":"45",
//     "SD":"46","TN":"47","TX":"48","UT":"49","VT":"50","VA":"51","WA":"53","WV":"54","WI":"55","WY":"56",
//     "DC":"11"
//   };
//   return map[code] || "";
// }

// /* ---------------------- NORMALIZERS ----------------------- */
// function normalizeStateRec(d) {
//   if (!d) return null;
//   const rec = {
//     total_till_date: Number(d.total_till_date ?? 0),
//     color: d.color || "y",
//     last_obs_week: {
//       start: d.last_obs_week_start || d.last_week_start || "",
//       end:   d.last_obs_week_end   || d.last_week_end   || "",
//       count: Number(d.last_obs_week_count ?? d.last_week_count ?? 0),
//     },
//     last_obs_month: {
//       start: d.last_obs_month_start || d.last_month_start || "",
//       end:   d.last_obs_month_end   || d.last_month_end   || "",
//       count: Number(d.last_obs_month_count ?? d.last_month_count ?? 0),
//     },
//     next_week_forecast: {
//       start: d.next_week_start || "",
//       end:   d.next_week_end   || "",
//       count: Number(d.next_week_forecast ?? 0),
//     },
//     next_month_forecast: {
//       start: d.next_month_start || "",
//       end:   d.next_month_end   || "",
//       count: Number(d.next_month_forecast ?? 0),
//     },
//   };
//   const hasNums =
//     rec.total_till_date > 0 ||
//     rec.last_obs_week.count > 0 ||
//     rec.last_obs_month.count > 0 ||
//     rec.next_week_forecast.count > 0 ||
//     rec.next_month_forecast.count > 0;
//   return hasNums ? rec : null;
// }
// function normalizeCountyRec(d) {
//   if (!d) return null;
//   const rec = {
//     county_name: d.county_name || "",
//     total_till_date: Number(d.total_till_date ?? 0),
//     color: d.color || "y",
//     last_obs_week: {
//       start: d.last_obs_week_start || "",
//       end:   d.last_obs_week_end   || "",
//       count: Number(d.last_obs_week_count ?? 0),
//     },
//     last_obs_month: {
//       start: d.last_obs_month_start || "",
//       end:   d.last_obs_month_end   || "",
//       count: Number(d.last_obs_month_count ?? 0),
//     },
//     next_week_forecast: {
//       start: d.next_week_start || "",
//       end:   d.next_week_end   || "",
//       count: Number(d.next_week_forecast ?? 0),
//     },
//     next_month_forecast: {
//       start: d.next_month_start || "",
//       end:   d.next_month_end   || "",
//       count: Number(d.next_month_forecast ?? 0),
//     },
//   };
//   const hasNums =
//     rec.total_till_date > 0 ||
//     rec.last_obs_week.count > 0 ||
//     rec.last_obs_month.count > 0 ||
//     rec.next_week_forecast.count > 0 ||
//     rec.next_month_forecast.count > 0;
//   return hasNums ? rec : null;
// }

// /* ------------------------ FIREBASE ------------------------ */
// async function fetchStatesFromFirestore() {
//   const app = initializeApp(CFG.FIREBASE);
//   const db  = getFirestore(app);

//   const statesSnap = await getDocs(collection(db, "states"));
//   const out = {};

//   for (const s of statesSnap.docs) {
//     const code = (s.id || "").toUpperCase();

//     let rec = null;
//     try {
//       const sd = await getDoc(doc(db, "states", code));
//       if (sd.exists()) rec = normalizeStateRec(sd.data());
//     } catch {}

//     if (!rec) {
//       const cs = await getDocs(collection(db, "states", code, "counties"));
//       if (!cs.empty) {
//         let t=0, lwc=0, lmc=0, nwf=0, nmf=0;
//         let lwe="", lme="", nwe="", nme="";
//         cs.forEach(c => {
//           const d = normalizeCountyRec(c.data());
//           if (!d) return;
//           t   += Number(d.total_till_date ?? 0);
//           lwc += Number(d.last_obs_week?.count  ?? 0);
//           lmc += Number(d.last_obs_month?.count ?? 0);
//           nwf += Number(d.next_week_forecast?.count ?? 0);
//           nmf += Number(d.next_month_forecast?.count ?? 0);
//           if (d.last_obs_week?.end)  lwe = d.last_obs_week.end;
//           if (d.last_obs_month?.end) lme = d.last_obs_month.end;
//           if (d.next_week_forecast?.end)  nwe = d.next_week_forecast.end;
//           if (d.next_month_forecast?.end) nme = d.next_month_forecast.end;
//         });
//         if (t || lwc || lmc || nwf || nmf) {
//           rec = {
//             total_till_date: t, color: "y",
//             last_obs_week: { start:"", end:lwe, count:lwc },
//             last_obs_month:{ start:"", end:lme, count:lmc },
//             next_week_forecast:{ start:"", end:nwe, count:nwf },
//             next_month_forecast:{ start:"", end:nme, count:nmf },
//           };
//         }
//       }
//     }
//     if (rec) out[code] = rec;
//   }
//   return out;
// }
// async function fetchCountiesForState(code) {
//   const app = initializeApp(CFG.FIREBASE);
//   const db  = getFirestore(app);
//   const snap = await getDocs(collection(db, "states", code, "counties"));
//   const out = {};
//   snap.forEach(c => {
//     const rec = normalizeCountyRec(c.data());
//     if (rec) out[c.id] = rec;
//   });
//   return out;
// }

// /* -------------------- TLDR / TABLE UI --------------------- */
// function tldrHTML(placeNameOrCode, rec) {
//   const title = rec?.county_name || placeNameOrCode;
//   if (!rec) {
//     return `<div class="tldr">
//       <div class="tldr-title" style="padding-left:6px;padding-bottom:6px;font-weight:800;">${title}</div>
//       <div>No data</div>
//     </div>`;
//   }
//   const lastW = rec.last_obs_week || {};
//   const lastM = rec.last_obs_month || {};
//   const nextW = rec.next_week_forecast || {};
//   const nextM = rec.next_month_forecast || {};
//   const total = Number(rec.total_till_date ?? 0);

//   return `
//     <div class="tldr">
//       <div class="tldr-title" style="padding-left:6px; padding-bottom:6px; margin:0; display:flex; gap:6px; align-items:baseline;">
//         <span style="font-weight:800;">${title}</span>
//         <span style="font-weight:600;">(${fmt(total)})</span>
//       </div>
//       <table class="tldr-table">
//         <tr><td>Last observed week</td><td>${rng(lastW.start,lastW.end)}</td><td>${fmt(lastW.count)}</td></tr>
//         <tr><td>Last observed month</td><td>${rng(lastM.start,lastM.end)}</td><td>${fmt(lastM.count)}</td></tr>
//         <tr><td>Next week forecast</td><td>${rng(nextW.start,nextW.end)}</td><td>${fmt(nextW.count)}</td></tr>
//         <tr><td>Next month forecast</td><td>${rng(nextM.start,nextM.end)}</td><td>${fmt(nextM.count)}</td></tr>
//       </table>
//     </div>
//   `;
// }

// /* ----------------------- STATES VIEW ---------------------- */
// async function renderStates() {
//   viewLevel = "state";
//   if (!usGeoJSON) {
//     usGeoJSON = await loadJSON("https://cdn.jsdelivr.net/gh/python-visualization/folium/examples/data/us-states.json");
//   }
//   if (statesLayer) map.removeLayer(statesLayer);
//   if (countiesLayer) { map.removeLayer(countiesLayer); countiesLayer = null; }
//   if (spasLayer) { map.removeLayer(spasLayer); spasLayer = null; }

//   statesLayer = L.geoJSON(usGeoJSON, {
//     style: (feature) => {
//       const code = (feature?.id || "").toUpperCase();
//       const rec  = statesData[code];
//       const has  = !!rec && Number(rec.total_till_date ?? 0) > 0;
//       return {
//         color: "#666",
//         weight: 1,
//         fillColor: has ? colorMap(rec.color || "y") : "#000000",
//         fillOpacity: has ? 0.6 : 0.0,
//       };
//     },
//     onEachFeature: (feature, layer) => {
//       const code = (feature?.id || "").toUpperCase();
//       const rec  = statesData[code] || null;
//       layer.bindTooltip(tldrHTML(code, rec), { sticky:true, className:"tldr-tooltip" });
//       layer.on("click", () => showCounties(code));
//     }
//   }).addTo(map);

//   map.setView([37.8, -96.9], 5);
//   if ($backButton) $backButton.style.display = "none";

//   if ($stateRow) $stateRow.style.display = "none";
//   $stateName.textContent  = "United States";
//   $stateTotal.textContent = fmt(usTotal);
//   $coverage.textContent   = "";
//   renderTop10States();
// }

// function renderTop10States() {
//   if (!$topTableTbody) return;
//   if ($topTitle) $topTitle.textContent = "Top 10 States (by total)";
//   const rows = Object.entries(statesData)
//     .map(([code, rec]) => ({ code, total: Number(rec?.total_till_date ?? 0) }))
//     .sort((a,b) => b.total - a.total)
//     .slice(0, 10);
//   $topTableTbody.innerHTML = rows.map((r, i) =>
//     `<tr><td>${i+1}</td><td>${r.code} — ${code2name(r.code)}</td><td>${fmt(r.total)}</td></tr>`
//   ).join("");
// }

// /* ---------------------- COUNTIES VIEW --------------------- */
// async function showCounties(code) {
//   viewLevel = "county";
//   lastStateCode = code;

//   if (dimmedStateCode && dimmedStateCode !== code) setStateFillVisibility(dimmedStateCode, true);
//   setStateFillVisibility(code, false);
//   dimmedStateCode = code;

//   if (countiesLayer) map.removeLayer(countiesLayer);
//   if (spasLayer) { map.removeLayer(spasLayer); spasLayer = null; }

//   const usCountiesGeo = await loadJSON(
//     "https://raw.githubusercontent.com/plotly/datasets/master/geojson-counties-fips.json"
//   );
//   const prefix = stateCodeToFipsPrefix(code);
//   const filtered = usCountiesGeo.features.filter(f => {
//     const rawId = f.id ?? f.properties?.GEOID ?? f.properties?.COUNTYFP;
//     const fips  = String(rawId ?? "").padStart(5, "0");
//     return fips.startsWith(prefix);
//   });

//   const countiesData = await fetchCountiesForState(code);

//   countiesLayer = L.geoJSON({ type: "FeatureCollection", features: filtered }, {
//     style: (feature) => {
//       const rawId = feature.id ?? feature.properties?.GEOID ?? feature.properties?.COUNTYFP;
//       const countyFips = String(rawId ?? "").padStart(5, "0");
//       const rec = countiesData[countyFips];
//       const has = hasCountyData(rec);
//       return {
//         color: "#444",
//         weight: 1,
//         fillColor: has ? colorMap(rec.color || "y") : "#000000",
//         fillOpacity: has ? 0.65 : 0.0,
//       };
//     },
//     onEachFeature: (feature, layer) => {
//       const rawId = feature.id ?? feature.properties?.GEOID ?? feature.properties?.COUNTYFP;
//       const countyFips = String(rawId ?? "").padStart(5, "0");
//       const rec = countiesData[countyFips] || null;

//       layer.bindTooltip(tldrHTML(countyFips, rec), { sticky: true, className: "tldr-tooltip" });
//       layer.on("mouseover", () => layer.setStyle({ weight: 2 }));
//       layer.on("mouseout",  () => layer.setStyle({ weight: 1 }));

//       // Drilldown to SPAs for Los Angeles County (06037) only (for now)
//       layer.on("click", async () => {
//         if (code === "CA" && countyFips === "06037") {
//           await showSPAs(feature, rec).catch(e => console.error("showSPAs error:", e));
//         }
//       });
//     }
//   }).addTo(map);

//   map.fitBounds(countiesLayer.getBounds(), { padding: [10,10] });
//   if ($backButton) $backButton.style.display = "inline-block";

//   const srec = statesData[code] || null;
//   if ($stateRow) $stateRow.style.display = "";
//   $stateName.textContent  = code2name(code);
//   $stateTotal.textContent = fmt(Number(srec?.total_till_date ?? 0));
//   $coverage.textContent   = srec?.last_obs_week?.end ? `Coverage till → ${srec.last_obs_week.end}` : "";

//   if ($topTitle) $topTitle.textContent = `Top 10 Counties in ${code2name(code)} (by total)`;
//   if ($topTableTbody) {
//     const rows = Object.entries(countiesData)
//       .map(([fips, rec]) => ({ name: rec?.county_name || fips, total: Number(rec?.total_till_date ?? 0) }))
//       .sort((a,b) => b.total - a.total)
//       .slice(0, 10);
//     $topTableTbody.innerHTML = rows.map((r, i) =>
//       `<tr><td>${i+1}</td><td>${r.name}</td><td>${fmt(r.total)}</td></tr>`
//     ).join("");
//   }
// }

// /* ------------------------ SPAs VIEW ----------------------- */
// async function showSPAs(countyFeature, countyRec) {
//   viewLevel = "spa";

//   // dim county fill so SPA outlines are visible without bleed
//   if (dimmedCountyFips) setCountyFillVisibility(dimmedCountyFips, true);
//   const rawId = countyFeature.id ?? countyFeature.properties?.GEOID ?? countyFeature.properties?.COUNTYFP;
//   dimmedCountyFips = String(rawId ?? "").padStart(5, "0");
//   setCountyFillVisibility(dimmedCountyFips, false);

//   if (spasLayer) { map.removeLayer(spasLayer); spasLayer = null; }

//   // Load official SPA polygons (already county-wide and gapless)
//   let spaFC;
//   try {
//     spaFC = await loadJSON(LA_SPA_GEOJSON_URL);
//   } catch (e) {
//     console.error("[SPA] load failed:", e);
//     alert("Failed to load SPA boundaries.");
//     return;
//   }

//   spasLayer = L.geoJSON(spaFC, {
//     style: () => ({ color: SPA_STROKE, weight: 1.6, fillOpacity: 0.0, fillColor: "#000000" }),
//     onEachFeature: (feature, layer) => {
//       const p = feature.properties || {};
//       const label =
//         p.SPA_Name || p.SPA_NAM || p.SPA_NAME || `SPA ${p.SPA || ""}`;
//       layer.bindTooltip(
//         `<div class="tldr"><div class="tldr-title" style="font-weight:800;">${label}</div><div>No data</div></div>`,
//         { sticky:true, className:"tldr-tooltip" }
//       );
//     }
//   }).addTo(map);

//   map.fitBounds(spasLayer.getBounds(), { padding:[10,10] });

//   if ($topTitle) $topTitle.textContent = "Los Angeles County — Service Planning Areas";
//   if ($topTableTbody) $topTableTbody.innerHTML = "";

//   if ($stateRow) $stateRow.style.display = "";
//   $stateName.textContent  = countyRec?.county_name || "Los Angeles County";
//   $stateTotal.textContent = fmt(Number(countyRec?.total_till_date ?? 0));
//   $coverage.textContent   = countyRec?.last_obs_week?.end ? `Coverage till → ${countyRec.last_obs_week.end}` : "";
// }

// /* -------------------------- INIT -------------------------- */
// async function init() {
//     // NEW: show splash + tiny starting progress
  
//   Splash.setProgress(5);
//   await new Promise(r => setTimeout(r, 300)); // allow splash to render
//   map = L.map("map", { zoomControl: true });

//   const positron = L.tileLayer(
//     "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
//     { attribution: "&copy; OpenStreetMap &copy; CARTO", subdomains:"abcd", maxZoom: 19 }
//   ).addTo(map);
//   const esriSat = L.tileLayer(
//     "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
//     { attribution: "Tiles © Esri" }
//   );
//   L.control.layers({ "Positron (light)": positron, "Satellite (Esri)": esriSat }, {}).addTo(map);

//   // NEW: some progress before network calls
//   Splash.setProgress(25);
//   await new Promise(r => setTimeout(r, 200));
//   try {
//     if (USE_FB) {
//       statesData = await fetchStatesFromFirestore();
//     } else {
//       throw new Error("USE_FIREBASE=false");
//     }
//   } catch (e) {
//     console.warn("Firestore disabled/failed. Reason:", e?.message || e);
//     // Safe fallback: try provided JSON, else empty.
//     try {
//       if (CFG.STATES_JSON) {
//         const states = await loadJSON(CFG.STATES_JSON);
//         statesData = states?.states || {};
//       } else {
//         statesData = {};
//       }
//     } catch (e2) {
//       console.error("States JSON fallback failed:", e2?.message || e2);
//       statesData = {};
//     }
//   }
//   // NEW: some progress before network calls
//   Splash.setProgress(70);
//   await new Promise(r => setTimeout(r, 100));
//   usTotal = Object.values(statesData)
//     .reduce((s, r) => s + Number(r?.total_till_date ?? 0), 0);
//   if ($usTotal) $usTotal.textContent = fmt(usTotal);

//   await renderStates();
//     // NEW: finish + hide
//   Splash.setProgress(100);
//   await new Promise(r => setTimeout(r, 100));
//   Splash.hide();
// }

// /* -------------------- BACK NAVIGATION --------------------- */
// $backButton?.addEventListener("click", async () => {
//   if (viewLevel === "spa") {
//     if (dimmedCountyFips) {
//       setCountyFillVisibility(dimmedCountyFips, true);
//       dimmedCountyFips = null;
//     }
//     await showCounties(lastStateCode);
//     return;
//   }
//   if (dimmedStateCode) {
//     setStateFillVisibility(dimmedStateCode, true);
//     dimmedStateCode = null;
//   }
//   await renderStates();
//   if ($stateRow) $stateRow.style.display = "none";
//   $stateName.textContent  = "United States";
//   $stateTotal.textContent = fmt(usTotal);
//   $coverage.textContent   = "";
// });

// /* --------------------------- GO --------------------------- */
// init().catch(err => {
//   console.error("App init fatal:", err);
//   alert("Failed to initialize app. Check console.");
// });
/* Wildfire States & ESN Forecasting
   Flow: State → County → SPA (Los Angeles County as 8 named regions)
   Data: Firestore-first with safe fallbacks
   Color rule: fill gray when no numeric data or no color
*/

// import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
// import {
//   getFirestore, collection, doc, getDoc, getDocs
// } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// /* ------------------------- CONFIG ------------------------- */
// const CFG = window.WF_CONFIG || {};
// const USE_FB = !!CFG.USE_FIREBASE;

// /* LA County Service Planning Areas (8 regions) — official GeoJSON */
// const LA_SPA_GEOJSON_URL =
//   "https://services1.arcgis.com/ZIL9uO234SBBPGL7/ArcGIS/rest/services/Los_Angeles_County_Service_Planning_Areas_Layer/FeatureServer/0/query?where=1%3D1&outFields=%2A&outSR=4326&f=geojson";

// const SPA_STROKE = "#333";
// const GRAY_FILL  = "#d1d5db";  // used when no data / no color

// /* --------------------------- DOM -------------------------- */
// const $stateRow   = document.querySelector("#stateName")?.closest(".metric");
// const $usTotal    = document.querySelector("#usTotal");
// const $stateName  = document.querySelector("#stateName");
// const $stateTotal = document.querySelector("#stateTotal");
// const $coverage   = document.querySelector("#coverage");
// const $backButton = document.querySelector("#backButton");
// const $topTitle   = document.querySelector("#topTitle");
// const $topTableTbody =
//   document.querySelector("#top10 tbody") || document.querySelector("#topTable tbody");

// /* ------------------------- GLOBALS ------------------------ */
// let map, statesLayer, countiesLayer, spasLayer;
// let usGeoJSON = null;
// let statesData = {};
// let usTotal = 0;

// let viewLevel = "state";
// let lastStateCode = null;

// let dimmedStateCode = null;
// let dimmedCountyFips = null;

// /* ------------------------ HELPERS ------------------------- */
// function fmt(n) { n = Number(n || 0); return isFinite(n) ? n.toLocaleString() : "0"; }
// async function loadJSON(url) {
//   if (!url) throw new Error("loadJSON: missing URL");
//   const r = await fetch(url, { cache: "no-store" });
//   if (!r.ok) throw new Error(`fetch failed ${r.status}`);
//   return r.json();
// }
// function rng(a, b) {
//   if (!a && !b) return "n/a";
//   if (a && b) return `${a} – ${b}`;
//   return a || b || "n/a";
// }
// function colorMap(c) {
//   if (!c) return GRAY_FILL;                // default to gray when missing
//   const v = (c + "").toLowerCase();
//   if (v === "r") return "#ef4444";
//   if (v === "g") return "#10b981";
//   if (v === "y") return "#facc15";
//   return c; // allow custom hex
// }
// function hasCountyData(rec) {
//   if (!rec) return false;
//   const t  = Number(rec.total_till_date ?? 0);
//   const w  = Number(rec.last_obs_week?.count ?? 0);
//   const m  = Number(rec.last_obs_month?.count ?? 0);
//   const nw = Number(rec.next_week_forecast?.count ?? 0);
//   const nm = Number(rec.next_month_forecast?.count ?? 0);
//   return (t > 0 || w > 0 || m > 0 || nw > 0 || nm > 0);
// }

// function setStateFillVisibility(stateCode, visible) {
//   if (!statesLayer) return;
//   statesLayer.eachLayer(l => {
//     const code = (l.feature?.id || "").toUpperCase();
//     if (code === stateCode) {
//       if (visible) statesLayer.resetStyle(l);
//       else l.setStyle({ fillOpacity: 0.15, fillColor: GRAY_FILL });
//     }
//   });
// }
// function setCountyFillVisibility(countyFips, visible) {
//   if (!countiesLayer) return;
//   countiesLayer.eachLayer(l => {
//     const raw = l.feature?.id ?? l.feature?.properties?.GEOID ?? l.feature?.properties?.COUNTYFP;
//     const fips = String(raw ?? "").padStart(5, "0");
//     if (fips === countyFips) {
//       if (visible) countiesLayer.resetStyle(l);
//       else l.setStyle({ fillOpacity: 0.15, fillColor: GRAY_FILL });
//     }
//   });
// }

// function code2name(code) {
//   const map = {
//     "AL":"Alabama","AK":"Alaska","AZ":"Arizona","AR":"Arkansas","CA":"California","CO":"Colorado",
//     "CT":"Connecticut","DE":"Delaware","FL":"Florida","GA":"Georgia","HI":"Hawaii","ID":"Idaho",
//     "IL":"Illinois","IN":"Indiana","IA":"Iowa","KS":"Kansas","KY":"Kentucky","LA":"Louisiana",
//     "ME":"Maine","MD":"Maryland","MA":"Massachusetts","MI":"Michigan","MN":"Minnesota","MS":"Mississippi",
//     "MO":"Missouri","MT":"Montana","NE":"Nebraska","NV":"Nevada","NH":"New Hampshire","NJ":"New Jersey",
//     "NM":"New Mexico","NY":"New York","NC":"North Carolina","ND":"North Dakota","OH":"Ohio","OK":"Oklahoma",
//     "OR":"Oregon","PA":"Pennsylvania","RI":"Rhode Island","SC":"South Carolina","SD":"South Dakota",
//     "TN":"Tennessee","TX":"Texas","UT":"Utah","VT":"Vermont","VA":"Virginia","WA":"Washington",
//     "WV":"West Virginia","WI":"Wisconsin","WY":"Wyoming","DC":"District of Columbia",
//   };
//   return map[code] || code;
// }
// function stateCodeToFipsPrefix(code) {
//   const map = {
//     "AL":"01","AK":"02","AZ":"04","AR":"05","CA":"06","CO":"08","CT":"09","DE":"10","FL":"12","GA":"13",
//     "HI":"15","ID":"16","IL":"17","IN":"18","IA":"19","KS":"20","KY":"21","LA":"22","ME":"23","MD":"24",
//     "MA":"25","MI":"26","MN":"27","MS":"28","MO":"29","MT":"30","NE":"31","NV":"32","NH":"33","NJ":"34",
//     "NM":"35","NY":"36","NC":"37","ND":"38","OH":"39","OK":"40","OR":"41","PA":"42","RI":"44","SC":"45",
//     "SD":"46","TN":"47","TX":"48","UT":"49","VT":"50","VA":"51","WA":"53","WV":"54","WI":"55","WY":"56",
//     "DC":"11"
//   };
//   return map[code] || "";
// }

// /* -------------- name/slug helpers for SPA join -------------- */
// function slugify(s) {
//   return (s ?? "")
//     .toString()
//     .trim()
//     .toLowerCase()
//     .replace(/[^a-z0-9]+/g, "-")
//     .replace(/-+/g, "-")
//     .replace(/^-|-$/g, "") || "spa";
// }
// function normalizeSpaName(s) {
//   const slug = slugify(s);
//   // Handle common variants
//   const fixes = {
//     "san-fernando-va": "san-fernando-valley",
//     "san-gabriel-val": "san-gabriel-valley",
//     "metro-l-a": "metro-l-a",
//     "west-la": "west-la",
//     "south-la": "south-la",
//     "east-la": "east-la",
//     "south-bay": "south-bay",
//   };
//   if (fixes[slug]) return fixes[slug];
//   return slug;
// }

// /* ---------------------- NORMALIZERS ----------------------- */
// function normalizeStateRec(d) {
//   if (!d) return null;
//   const rec = {
//     total_till_date: Number(d.total_till_date ?? 0),
//     color: d.color || "", // may be empty; will fall back to gray
//     last_obs_week: {
//       start: d.last_obs_week_start || d.last_week_start || "",
//       end:   d.last_obs_week_end   || d.last_week_end   || "",
//       count: Number(d.last_obs_week_count ?? d.last_week_count ?? 0),
//     },
//     last_obs_month: {
//       start: d.last_obs_month_start || d.last_month_start || "",
//       end:   d.last_obs_month_end   || d.last_month_end   || "",
//       count: Number(d.last_obs_month_count ?? d.last_month_count ?? 0),
//     },
//     next_week_forecast: {
//       start: d.next_week_start || "",
//       end:   d.next_week_end   || "",
//       count: Number(d.next_week_forecast ?? 0),
//     },
//     next_month_forecast: {
//       start: d.next_month_start || "",
//       end:   d.next_month_end   || "",
//       count: Number(d.next_month_forecast ?? 0),
//     },
//   };
//   const hasNums =
//     rec.total_till_date > 0 ||
//     rec.last_obs_week.count > 0 ||
//     rec.last_obs_month.count > 0 ||
//     rec.next_week_forecast.count > 0 ||
//     rec.next_month_forecast.count > 0;
//   return hasNums ? rec : null;
// }
// function normalizeCountyRec(d) {
//   if (!d) return null;
//   const rec = {
//     county_name: d.county_name || "",
//     total_till_date: Number(d.total_till_date ?? 0),
//     color: d.color || "",
//     last_obs_week: {
//       start: d.last_obs_week_start || "",
//       end:   d.last_obs_week_end   || "",
//       count: Number(d.last_obs_week_count ?? 0),
//     },
//     last_obs_month: {
//       start: d.last_obs_month_start || "",
//       end:   d.last_obs_month_end   || "",
//       count: Number(d.last_obs_month_count ?? 0),
//     },
//     next_week_forecast: {
//       start: d.next_week_start || "",
//       end:   d.next_week_end   || "",
//       count: Number(d.next_week_forecast ?? 0),
//     },
//     next_month_forecast: {
//       start: d.next_month_start || "",
//       end:   d.next_month_end   || "",
//       count: Number(d.next_month_forecast ?? 0),
//     },
//   };
//   const hasNums =
//     rec.total_till_date > 0 ||
//     rec.last_obs_week.count > 0 ||
//     rec.last_obs_month.count > 0 ||
//     rec.next_week_forecast.count > 0 ||
//     rec.next_month_forecast.count > 0;
//   return hasNums ? rec : null;
// }
// function normalizeSpaRec(d) {
//   if (!d) return null;
//   const rec = {
//     spa_id: d.spa_id || normalizeSpaName(d.spa_name),
//     spa_name: d.spa_name || "",
//     total_till_date: Number(d.total_till_date ?? 0),
//     color: d.color || "",
//     last_obs_week: {
//       start: d.last_obs_week_start || "",
//       end:   d.last_obs_week_end   || "",
//       count: Number(d.last_obs_week_count ?? 0),
//     },
//     last_obs_month: {
//       start: d.last_obs_month_start || "",
//       end:   d.last_obs_month_end   || "",
//       count: Number(d.last_obs_month_count ?? 0),
//     },
//     next_week_forecast: {
//       start: d.next_week_start || "",
//       end:   d.next_week_end   || "",
//       count: Number(d.next_week_forecast ?? 0),
//     },
//     next_month_forecast: {
//       start: d.next_month_start || "",
//       end:   d.next_month_end   || "",
//       count: Number(d.next_month_forecast ?? 0),
//     },
//   };
//   const hasNums =
//     rec.total_till_date > 0 ||
//     rec.last_obs_week.count > 0 ||
//     rec.last_obs_month.count > 0 ||
//     rec.next_week_forecast.count > 0 ||
//     rec.next_month_forecast.count > 0;
//   return hasNums ? rec : null;
// }

// /* ------------------------ FIREBASE ------------------------ */
// async function fetchStatesFromFirestore() {
//   const app = initializeApp(CFG.FIREBASE);
//   const db  = getFirestore(app);

//   const statesSnap = await getDocs(collection(db, "states"));
//   const out = {};

//   for (const s of statesSnap.docs) {
//     const code = (s.id || "").toUpperCase();

//     let rec = null;
//     try {
//       const sd = await getDoc(doc(db, "states", code));
//       if (sd.exists()) rec = normalizeStateRec(sd.data());
//     } catch {}

//     if (!rec) {
//       const cs = await getDocs(collection(db, "states", code, "counties"));
//       if (!cs.empty) {
//         let t=0, lwc=0, lmc=0, nwf=0, nmf=0;
//         let lwe="", lme="", nwe="", nme="";
//         cs.forEach(c => {
//           const d = normalizeCountyRec(c.data());
//           if (!d) return;
//           t   += Number(d.total_till_date ?? 0);
//           lwc += Number(d.last_obs_week?.count  ?? 0);
//           lmc += Number(d.last_obs_month?.count ?? 0);
//           nwf += Number(d.next_week_forecast?.count ?? 0);
//           nmf += Number(d.next_month_forecast?.count ?? 0);
//           if (d.last_obs_week?.end)  lwe = d.last_obs_week.end;
//           if (d.last_obs_month?.end) lme = d.last_obs_month.end;
//           if (d.next_week_forecast?.end)  nwe = d.next_week_forecast.end;
//           if (d.next_month_forecast?.end) nme = d.next_month_forecast.end;
//         });
//         if (t || lwc || lmc || nwf || nmf) {
//           rec = {
//             total_till_date: t, color: "", // gray fallback in render
//             last_obs_week: { start:"", end:lwe, count:lwc },
//             last_obs_month:{ start:"", end:lme, count:lmc },
//             next_week_forecast:{ start:"", end:nwe, count:nwf },
//             next_month_forecast:{ start:"", end:nme, count:nmf },
//           };
//         }
//       }
//     }
//     if (rec) out[code] = rec;
//   }
//   return out;
// }
// async function fetchCountiesForState(code) {
//   const app = initializeApp(CFG.FIREBASE);
//   const db  = getFirestore(app);
//   const snap = await getDocs(collection(db, "states", code, "counties"));
//   const out = {};
//   snap.forEach(c => {
//     const rec = normalizeCountyRec(c.data());
//     if (rec) out[c.id] = rec;
//   });
//   return out;
// }
// async function fetchSPAsFromFirestore() {
//   // Always under states/CA/spas as per seeding
//   const app = initializeApp(CFG.FIREBASE);
//   const db  = getFirestore(app);
//   const snap = await getDocs(collection(db, "states", "CA", "spas"));
//   console.log("SPA snap size:", snap.size);
//   const out = {};
//   snap.forEach(d => {
//     console.log("SPA doc:", d.id, d.data());
//     const rec = normalizeSpaRec(d.data());
//     if (!rec) return;
//     const key = normalizeSpaName(rec.spa_id || rec.spa_name);
//     out[key] = rec;
//   });
//   return out;
// }

// /* -------------------- TLDR / TABLE UI --------------------- */
// function tldrHTML(placeNameOrCode, rec) {
//   const title = rec?.county_name || rec?.spa_name || placeNameOrCode;
//   if (!rec) {
//     return `<div class="tldr">
//       <div class="tldr-title" style="padding-left:6px;padding-bottom:6px;font-weight:800;">${title}</div>
//       <div>No data</div>
//     </div>`;
//   }
//   const lastW = rec.last_obs_week || {};
//   const lastM = rec.last_obs_month || {};
//   const nextW = rec.next_week_forecast || {};
//   const nextM = rec.next_month_forecast || {};
//   const total = Number(rec.total_till_date ?? 0);

//   return `
//     <div class="tldr">
//       <div class="tldr-title" style="padding-left:6px; padding-bottom:6px; margin:0; display:flex; gap:6px; align-items:baseline;">
//         <span style="font-weight:800;">${title}</span>
//         <span style="font-weight:600;">(${fmt(total)})</span>
//       </div>
//       <table class="tldr-table">
//         <tr><td>Last observed week</td><td>${rng(lastW.start,lastW.end)}</td><td>${fmt(lastW.count)}</td></tr>
//         <tr><td>Last observed month</td><td>${rng(lastM.start,lastM.end)}</td><td>${fmt(lastM.count)}</td></tr>
//         <tr><td>Next week forecast</td><td>${rng(nextW.start,nextW.end)}</td><td>${fmt(nextW.count)}</td></tr>
//         <tr><td>Next month forecast</td><td>${rng(nextM.start,nextM.end)}</td><td>${fmt(nextM.count)}</td></tr>
//       </table>
//     </div>
//   `;
// }

// /* ----------------------- STATES VIEW ---------------------- */
// async function renderStates() {
//   viewLevel = "state";
//   if (!usGeoJSON) {
//     usGeoJSON = await loadJSON("https://cdn.jsdelivr.net/gh/python-visualization/folium/examples/data/us-states.json");
//   }
//   if (statesLayer) map.removeLayer(statesLayer);
//   if (countiesLayer) { map.removeLayer(countiesLayer); countiesLayer = null; }
//   if (spasLayer) { map.removeLayer(spasLayer); spasLayer = null; }

//   statesLayer = L.geoJSON(usGeoJSON, {
//     style: (feature) => {
//       const code = (feature?.id || "").toUpperCase();
//       const rec  = statesData[code];
//       const hasNums = !!rec;
//       const fill = hasNums ? colorMap(rec.color || GRAY_FILL) : GRAY_FILL;
//       return {
//         color: "#666",
//         weight: 1,
//         fillColor: fill,
//         fillOpacity: 0.6,
//       };
//     },
//     onEachFeature: (feature, layer) => {
//       const code = (feature?.id || "").toUpperCase();
//       const rec  = statesData[code] || null;
//       layer.bindTooltip(tldrHTML(code, rec), { sticky:true, className:"tldr-tooltip" });
//       layer.on("click", () => showCounties(code));
//     }
//   }).addTo(map);

//   map.setView([37.8, -96.9], 5);
//   if ($backButton) $backButton.style.display = "none";

//   if ($stateRow) $stateRow.style.display = "none";
//   $stateName.textContent  = "United States";
//   $stateTotal.textContent = fmt(usTotal);
//   $coverage.textContent   = "";
//   renderTop10States();
// }

// function renderTop10States() {
//   if (!$topTableTbody) return;
//   if ($topTitle) $topTitle.textContent = "Top 10 States (by total)";
//   const rows = Object.entries(statesData)
//     .map(([code, rec]) => ({ code, total: Number(rec?.total_till_date ?? 0) }))
//     .sort((a,b) => b.total - a.total)
//     .slice(0, 10);
//   $topTableTbody.innerHTML = rows.map((r, i) =>
//     `<tr><td>${i+1}</td><td>${r.code} — ${code2name(r.code)}</td><td>${fmt(r.total)}</td></tr>`
//   ).join("");
// }

// /* ---------------------- COUNTIES VIEW --------------------- */
// async function showCounties(code) {
//   viewLevel = "county";
//   lastStateCode = code;

//   if (dimmedStateCode && dimmedStateCode !== code) setStateFillVisibility(dimmedStateCode, true);
//   setStateFillVisibility(code, false);
//   dimmedStateCode = code;

//   if (countiesLayer) map.removeLayer(countiesLayer);
//   if (spasLayer) { map.removeLayer(spasLayer); spasLayer = null; }

//   const usCountiesGeo = await loadJSON(
//     "https://raw.githubusercontent.com/plotly/datasets/master/geojson-counties-fips.json"
//   );
//   const prefix = stateCodeToFipsPrefix(code);
//   const filtered = usCountiesGeo.features.filter(f => {
//     const rawId = f.id ?? f.properties?.GEOID ?? f.properties?.COUNTYFP;
//     const fips  = String(rawId ?? "").padStart(5, "0");
//     return fips.startsWith(prefix);
//   });

//   const countiesData = await fetchCountiesForState(code);

//   countiesLayer = L.geoJSON({ type: "FeatureCollection", features: filtered }, {
//     style: (feature) => {
//       const rawId = feature.id ?? feature.properties?.GEOID ?? feature.properties?.COUNTYFP;
//       const countyFips = String(rawId ?? "").padStart(5, "0");
//       const rec = countiesData[countyFips];
//       const fill = rec ? colorMap(rec.color || GRAY_FILL) : GRAY_FILL;
//       return {
//         color: "#444",
//         weight: 1,
//         fillColor: fill,
//         fillOpacity: 0.65,
//       };
//     },
//     onEachFeature: (feature, layer) => {
//       const rawId = feature.id ?? feature.properties?.GEOID ?? feature.properties?.COUNTYFP;
//       const countyFips = String(rawId ?? "").padStart(5, "0");
//       const rec = countiesData[countyFips] || null;

//       layer.bindTooltip(tldrHTML(rec?.county_name || countyFips, rec), { sticky: true, className: "tldr-tooltip" });
//       layer.on("mouseover", () => layer.setStyle({ weight: 2 }));
//       layer.on("mouseout",  () => layer.setStyle({ weight: 1 }));

//       // Drilldown to SPAs for Los Angeles County (06037) only (for now)
//       layer.on("click", async () => {
//         if (code === "CA" && countyFips === "06037") {
//           await showSPAs(feature, rec).catch(e => console.error("showSPAs error:", e));
//         }
//       });
//     }
//   }).addTo(map);

//   map.fitBounds(countiesLayer.getBounds(), { padding: [10,10] });
//   if ($backButton) {
//     $backButton.style.display = "inline-block";
//     $backButton.textContent = "← Back to US";          // <— set label here
//   }

//   const srec = statesData[code] || null;
//   if ($stateRow) $stateRow.style.display = "";
//   $stateName.textContent  = code2name(code);
//   $stateTotal.textContent = fmt(Number(srec?.total_till_date ?? 0));
//   $coverage.textContent   = srec?.last_obs_week?.end ? `Coverage till → ${srec.last_obs_week.start}` : "";

//   if ($topTitle) $topTitle.textContent = `Top 10 Counties in ${code2name(code)} (by total)`;
//   if ($topTableTbody) {
//     const rows = Object.entries(countiesData)
//       .map(([fips, rec]) => ({ name: rec?.county_name || fips, total: Number(rec?.total_till_date ?? 0) }))
//       .sort((a,b) => b.total - a.total)
//       .slice(0, 10);
//     $topTableTbody.innerHTML = rows.map((r, i) =>
//       `<tr><td>${i+1}</td><td>${r.name}</td><td>${fmt(r.total)}</td></tr>`
//     ).join("");
//   }
// }

// /* ------------------------ SPAs VIEW ----------------------- */
// async function showSPAs(countyFeature, countyRec) {
//   viewLevel = "spa";

//   // dim county fill so SPA outlines are visible without bleed
//   if (dimmedCountyFips) setCountyFillVisibility(dimmedCountyFips, true);
//   const rawId = countyFeature.id ?? countyFeature.properties?.GEOID ?? countyFeature.properties?.COUNTYFP;
//   dimmedCountyFips = String(rawId ?? "").padStart(5, "0");
//   setCountyFillVisibility(dimmedCountyFips, false);

//   if (spasLayer) { map.removeLayer(spasLayer); spasLayer = null; }

//   // Load official SPA polygons
//   let spaFC;
//   try {
//     spaFC = await loadJSON(LA_SPA_GEOJSON_URL);
//   } catch (e) {
//     console.error("[SPA] load failed:", e);
//     alert("Failed to load SPA boundaries.");
//     return;
//   }

//   // Load SPA TLDRs from Firestore
//   let spaData = {};
//   try {
//     spaData = USE_FB ? await fetchSPAsFromFirestore() : {};
//   } catch (e) {
//     console.warn("SPA Firestore load failed:", e?.message || e);
//   }

//   // function to get a reasonable name from feature props
//   function featureSpaKey(p) {
//     const label = p.SPA_Name || p.SPA_NAM || p.SPA_NAME || `SPA ${p.SPA || ""}`;
//     // Try direct match to known labels:
//     // ArcGIS names are typically: Antelope Valley, San Fernando Valley, San Gabriel Valley,
//     // Metro Los Angeles, West, South, East, South Bay.
//     let normalized = normalizeSpaName(label
//       .replace(/Los Angeles/gi, "L.A.")
//       .replace(/\s+County/gi, "")
//       .replace(/\s+Region/gi, "")
//       .replace(/\s+Area/gi, "")
//       .replace(/\s+/g, " ")
//       .trim()
//     );

//     // Map common special cases to CSV ids (from your example sheet)
//     const manual = {
//       "san-fernando": "san-fernando-valley",
//       "san-fernando-val": "san-fernando-valley",
//       "metro-los-angeles": "metro-l-a",
//       "metro-los-angeles-region": "metro-l-a",
//       "metro": "metro-l-a",
//       "west": "west-la",
//       "south": "south-la",
//       "east": "east-la",
//       "antelope-valley": "antelope-valley",
//       "san-gabriel": "san-gabriel-valley",
//       "san-gabriel-val": "san-gabriel-valley",
//       "south-bay": "south-bay",
//     };
//     if (manual[normalized]) normalized = manual[normalized];

//     return normalized;
//   }

//   spasLayer = L.geoJSON(spaFC, {
//     style: (f) => {
//       const p = f.properties || {};
//       const key = featureSpaKey(p);
//       const rec = spaData[key];
//       const fill = rec ? colorMap(rec.color || GRAY_FILL) : GRAY_FILL;
//       return { color: SPA_STROKE, weight: 1.6, fillOpacity: 0.65, fillColor: fill };
//     },
//     onEachFeature: (feature, layer) => {
//       const p = feature.properties || {};
//       const key = featureSpaKey(p);
//       const rec = spaData[key] || { spa_name: p.SPA_Name || p.SPA_NAM || p.SPA_NAME || key };
//       layer.bindTooltip(
//         tldrHTML(rec.spa_name || key, rec.total_till_date ? rec : null),
//         { sticky:true, className:"tldr-tooltip" }
//       );
//       layer.on("mouseover", () => layer.setStyle({ weight: 2.2 }));
//       layer.on("mouseout",  () => layer.setStyle({ weight: 1.6 }));
//     }
//   }).addTo(map);

//   map.fitBounds(spasLayer.getBounds(), { padding:[10,10] });

//   if ($topTitle) $topTitle.textContent = "Los Angeles County — Service Planning Areas";
//   if ($topTableTbody) {
//     // simple top list of SPAs by total
//     const rows = Object.values(spaData)
//       .map(r => ({ name: r.spa_name, total: Number(r.total_till_date || 0) }))
//       .sort((a,b) => b.total - a.total)
//       .slice(0, 8);
//     $topTableTbody.innerHTML = rows.map((r, i) =>
//       `<tr><td>${i+1}</td><td>${r.name}</td><td>${fmt(r.total)}</td></tr>`
//     ).join("");
//   }
//     // show & relabel the back button to the state name (e.g., California)
//   if ($backButton) {
//     $backButton.style.display = "inline-block";
//     $backButton.textContent = `← Back to ${code2name(lastStateCode)}`; // <— e.g., "← Back to California"
//   }


//   // Update main metric to show county total

//   if ($stateRow) $stateRow.style.display = "";
//   $stateName.textContent  = countyRec?.county_name || "Los Angeles County";
//   $stateTotal.textContent = fmt(Number(countyRec?.total_till_date ?? 0));
//   $coverage.textContent   = countyRec?.last_obs_week?.end ? `Coverage till → ${countyRec.last_obs_week.start}` : "";
// }

// /* -------------------------- INIT -------------------------- */
// async function init() {
//   // Splash is optional – guard if not present
//   const Splash = window.Splash || { setProgress(){}, hide(){} };
//   Splash.setProgress(5);
//   await new Promise(r => setTimeout(r, 300));
//   map = L.map("map", { zoomControl: true });

//   const positron = L.tileLayer(
//     "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
//     { attribution: "&copy; OpenStreetMap &copy; CARTO", subdomains:"abcd", maxZoom: 19 }
//   ).addTo(map);
//   const esriSat = L.tileLayer(
//     "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
//     { attribution: "Tiles © Esri" }
//   );
//   L.control.layers({ "Positron (light)": positron, "Satellite (Esri)": esriSat }, {}).addTo(map);

//   Splash.setProgress(25);
//   await new Promise(r => setTimeout(r, 200));
//   try {
//     if (USE_FB) {
//       statesData = await fetchStatesFromFirestore();
//     } else {
//       throw new Error("USE_FIREBASE=false");
//     }
//   } catch (e) {
//     console.warn("Firestore disabled/failed. Reason:", e?.message || e);
//     // Safe fallback: try provided JSON, else empty.
//     try {
//       if (CFG.STATES_JSON) {
//         const states = await loadJSON(CFG.STATES_JSON);
//         statesData = states?.states || {};
//       } else {
//         statesData = {};
//       }
//     } catch (e2) {
//       console.error("States JSON fallback failed:", e2?.message || e2);
//       statesData = {};
//     }
//   }

//   Splash.setProgress(70);
//   await new Promise(r => setTimeout(r, 100));
//   usTotal = Object.values(statesData)
//     .reduce((s, r) => s + Number(r?.total_till_date ?? 0), 0);
//   if ($usTotal) $usTotal.textContent = fmt(usTotal);

//   await renderStates();
//   Splash.setProgress(100);
//   await new Promise(r => setTimeout(r, 100));
//   Splash.hide();
// }

// /* -------------------- BACK NAVIGATION --------------------- */
// $backButton?.addEventListener("click", async () => {
//   if (viewLevel === "spa") {
//     if (dimmedCountyFips) {
//       setCountyFillVisibility(dimmedCountyFips, true);
//       dimmedCountyFips = null;
//     }
//     await showCounties(lastStateCode);
//     return;
//   }
//   if (dimmedStateCode) {
//     setStateFillVisibility(dimmedStateCode, true);
//     dimmedStateCode = null;
//   }
//   await renderStates();
//   if ($stateRow) $stateRow.style.display = "none";
//   $stateName.textContent  = "United States";
//   $stateTotal.textContent = fmt(usTotal);
//   $coverage.textContent   = "";
// });

// /* --------------------------- GO --------------------------- */
// init().catch(err => {
//   console.error("App init fatal:", err);
//   alert("Failed to initialize app. Check console.");
// });




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
        <span style="font-weight:600;">(${fmt(total)})</span>
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

/* ----------------------- STATES VIEW ---------------------- */
async function renderStates() {
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
      const rec  = statesData[code];
      const hasNums = !!rec;
      const fill = hasNums ? colorMap(rec.color || GRAY_FILL) : GRAY_FILL;
      return {
        color: "#666",
        weight: 1,
        fillColor: fill,
        fillOpacity: 0.6,
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

  map.setView([37.8, -96.9], 5);
  if ($backButton) $backButton.style.display = "none";

  if ($stateRow) $stateRow.style.display = "none";
  $stateName.textContent  = "United States";
  $stateTotal.textContent = fmt(usTotal);
  $coverage.textContent   = "";
  renderTop10States();
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

/* ---------------------- COUNTIES VIEW --------------------- */
async function showCounties(code) {
  viewLevel = "county";
  lastStateCode = code;

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

  countiesLayer = L.geoJSON({ type: "FeatureCollection", features: filtered }, {
    style: (feature) => {
      const rawId = feature.id ?? feature.properties?.GEOID ?? feature.properties?.COUNTYFP;
      const countyFips = String(rawId ?? "").padStart(5, "0");
      const rec = countiesData[countyFips];
      const fill = rec ? colorMap(rec.color || GRAY_FILL) : GRAY_FILL;
      return {
        color: "#444",
        weight: 1,
        fillColor: fill,
        fillOpacity: 0.65,
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
  $stateName.textContent  = code2name(code) + ' Total Incidents';
  $stateTotal.textContent = fmt(Number(srec?.total_till_date ?? 0));
  $coverage.textContent   = srec?.last_obs_week?.end ? `Coverage through → ${srec.last_obs_week.start}` : "";

  if ($topTitle) $topTitle.textContent = `Top 10 Counties in ${code2name(code)} (by total)`;
  if ($topTableTbody) {
    const rows = Object.entries(countiesData)
      .map(([fips, rec]) => ({ name: rec?.county_name || fips, total: Number(rec?.total_till_date ?? 0) }))
      .sort((a,b) => b.total - a.total)
      .slice(0, 10);
    $topTableTbody.innerHTML = rows.map((r, i) =>
      `<tr><td>${i+1}</td><td>${r.name}</td><td>${fmt(r.total)}</td></tr>`
    ).join("");
  }
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
// --- replace existing normCounty with this ---
const normCounty = (s) => (s || "")
  // normalize accents
  .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .toLowerCase()
  // common punctuation to space
  .replace(/[^\p{L}\p{N}]+/gu, " ")
  // standardize Saint
  .replace(/\b(st|st\.)\b/gi, "saint")
  // drop "county of X" -> "x"
  .replace(/\bcounty\s+of\s+/g, "")
  .replace(/\bparish\s+of\s+/g, "")
  .replace(/\bmunicipio\s+de\s+/g, "")
  // drop common trailing admin types
  .replace(/\b(county|parish|borough|census area|city|municipality|canton|district|municipio)\b/g, "")
  // squeeze spaces
  .replace(/\s+/g, "")
  .trim();


function buildStateAndCountyIndex(papaOut){
  weeklyRows = papaOut.data;
  const fields = papaOut.meta?.fields || [];
  labelsAll = weeklyRows.map(r => String(r.week_start));

  const stateColumns = {};         // { CA: ["CA|Los Angeles", ...] }
  countyHeaderByNorm = {};         // { CA: { "losangeles": "CA|Los Angeles", "losangelescounty": "CA|Los Angeles" } }

  for (const f of fields) {
    if (f === "week_start") continue;
    const parts = f.split("|");
    if (parts.length < 2) continue;

    const code = (parts[0] || "").trim();
    const countyRaw = (parts.slice(1).join("|") || "").trim(); // just in case a '|' exists in a name
    if (!VALID_STATE_CODES.has(code)) continue;

    (stateColumns[code] ||= []).push(f);

    // Build aliases for this header
    const base = countyRaw;
    const noAdminSuffix = base.replace(/\b(County|Parish|Borough|Census Area|City|Municipality|Municipio)\b/gi, "").trim();
    const ofDrop = base.replace(/\b(County|Parish|Municipio)\s+of\s+/gi, "");
    const variants = new Set([
      base,
      noAdminSuffix,
      ofDrop,
      // Saint normalization variants
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


/* ----------------- bottom-left chart control ----------------- */
function ensureHoverChartControl(){
  if (hoverChartContainer) return;
  const HoverChart = L.Control.extend({
    options: { position: "bottomleft" },
    onAdd: function(){
      const div = L.DomUtil.create("div", "hover-chart");
      div.style.width = "2000px";
      div.style.maxWidth = "50vw";
      div.style.height = "180px";
      div.style.background = "rgba(17,24,39,.92)";
      div.style.border = "1px solid rgba(255,255,255,.12)";
      div.style.borderRadius = "10px";
      div.style.boxShadow = "0 8px 24px rgba(0,0,0,.35)";
      div.style.padding = "10px 12px";
      div.style.color = "#fff";
      div.style.backdropFilter = "blur(3px)";
      div.style.display = "none";
      div.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
          <div style="font-weight:700" id="chartTitle">Weekly Incidents</div>
          <button id="chartCloseBtn" style="font-size:12px;padding:2px 6px;border:0;border-radius:6px;cursor:pointer;">✕</button>
        </div>
        <canvas id="stateSpark" width="400" height="160"></canvas>
      `;
      L.DomEvent.disableClickPropagation(div);
      L.DomEvent.disableScrollPropagation(div);
      div.querySelector("#chartCloseBtn").addEventListener("click", ()=> div.style.display="none");
      hoverChartContainer = div;
      return div;
    }
  });
  map.addControl(new HoverChart());
}

/* -------------------- trimming helper (configurable) -------------------- */
function trimUntilAtLeast(labels, values, threshold = TRIM_THRESHOLD, fallbackTail = FALLBACK_TAIL) {
  let i = 0, n = values.length;
  while (i < n && Number(values[i] ?? 0) < threshold) i++;
  if (i >= n) {
    const start = Math.max(0, n - fallbackTail);
    return { labels: labels.slice(start), values: values.slice(start) };
  }
  return { labels: labels.slice(i), values: values.slice(i) };
}

/* -------------------- show charts (state + county) -------------------- */
function showStateChart(stateCode){
  if (!stateSeries[stateCode]) return;
  ensureHoverChartControl();
  const { labels, values } = stateSeries[stateCode];

  const trimmed = trimUntilAtLeast(labels, values, TRIM_THRESHOLD, FALLBACK_TAIL);
  const LBL = trimmed.labels;
  const VAL = trimmed.values;

  const title = `${stateCode} — ${code2name(stateCode)} (from ${LBL[0] || labels[0]})`;
  hoverChartContainer.querySelector("#chartTitle").textContent = title;
  hoverChartContainer.style.display = "block";

  const ctx = hoverChartContainer.querySelector("#stateSpark").getContext("2d");
  if (!window.Chart) return;

  if (hoverChart) {
    hoverChart.data.labels = LBL;
    hoverChart.data.datasets[0].data = VAL;
    hoverChart.data.datasets[0].label = "State total";
    hoverChart.update("none");
  } else {
    hoverChart = new Chart(ctx, {
      type: "line",
      data: {
        labels: LBL,
        datasets: [{ label: "State total", data: VAL, borderWidth: 2, pointRadius: 0, tension: 0.2 }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: true }, tooltip: { mode: "index", intersect: false } },
        scales: {
          x: { ticks: { maxTicksLimit: 8, color: "#e5e7eb" }, grid: { display:false } },
          y: { ticks: { color: "#e5e7eb" }, grid: { color: "rgba(255,255,255,.08)" } }
        }
      }
    });
  }
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

function showCountyChart(stateCode, countyName){
  const series = getCountySeries(stateCode, countyName);
  if (!series) return;
  ensureHoverChartControl();

  const { labels, values } = series;
  const trimmed = trimUntilAtLeast(labels, values, TRIM_THRESHOLD, FALLBACK_TAIL);
  const LBL = trimmed.labels;
  const VAL = trimmed.values;

  const title = `${countyName}, ${stateCode} (from ${LBL[0] || labels[0]})`;
  hoverChartContainer.querySelector("#chartTitle").textContent = title;
  hoverChartContainer.style.display = "block";

  const ctx = hoverChartContainer.querySelector("#stateSpark").getContext("2d");
  if (!window.Chart) return;

  if (hoverChart) {
    hoverChart.data.labels = LBL;
    hoverChart.data.datasets[0].data = VAL;
    hoverChart.data.datasets[0].label = "County total";
    hoverChart.update("none");
  } else {
    hoverChart = new Chart(ctx, {
      type: "line",
      data: {
        labels: LBL,
        datasets: [{ label: "County total", data: VAL, borderWidth: 2, pointRadius: 0, tension: 0.2 }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: true }, tooltip: { mode: "index", intersect: false } },
        scales: {
          x: { ticks: { maxTicksLimit: 8, color: "#e5e7eb" }, grid: { display:false } },
          y: { ticks: { color: "#e5e7eb" }, grid: { color: "rgba(255,255,255,.08)" } }
        }
      }
    });
  }
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
