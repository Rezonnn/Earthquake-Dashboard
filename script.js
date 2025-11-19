// Live Earthquake Dashboard v3
// USGS Real-Time GeoJSON feed + bigger map + search + dark/light mode

const FEEDS = {
  hour: "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_hour.geojson",
  day: "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson",
  week: "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_week.geojson",
  month: "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_month.geojson"
};

const MAX_QUAKES = 200; // limit to keep things smooth

const timeRangeSelect = document.getElementById("time-range");
const minMagRange = document.getElementById("min-mag");
const minMagValueLabel = document.getElementById("min-mag-value");
const refreshBtn = document.getElementById("refresh-btn");
const themeToggleBtn = document.getElementById("theme-toggle");
const searchInput = document.getElementById("search-input");

const listEl = document.getElementById("list");
const detailsEl = document.getElementById("details");
const errorBarEl = document.getElementById("error-bar");

let map;
let markersLayer;
let quakeData = []; // all filtered by time + magnitude
let activeId = null;

// Init Leaflet map
function initMap() {
  map = L.map("map", {
    center: [20, 0],
    zoom: 2,
    worldCopyJump: true
  });

  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 10,
    attribution: "&copy; OpenStreetMap"
  }).addTo(map);

  markersLayer = L.layerGroup().addTo(map);
}

// Helper: magnitude -> color
function magToColor(mag) {
  if (mag >= 7) return "#ef4444";
  if (mag >= 6) return "#f97316";
  if (mag >= 5) return "#eab308";
  if (mag >= 4) return "#22c55e";
  if (mag >= 3) return "#38bdf8";
  return "#a855f7";
}

// Helper: magnitude -> radius
function magToRadius(mag) {
  if (!mag || mag <= 0) return 4;
  return 3 + mag * 2.6;
}

// Helper: format time
function formatTime(epochMs) {
  const d = new Date(epochMs);
  return d.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short"
  });
}

// Search filter
function getVisibleQuakes() {
  const query = (searchInput.value || "").toLowerCase().trim();
  if (!query) {
    return quakeData;
  }
  return quakeData.filter(f => {
    const props = f.properties || {};
    const place = (props.place || "").toLowerCase();
    const id = (f.id || "").toLowerCase();
    const magStr =
      typeof props.mag === "number" ? props.mag.toFixed(1) : "";
    return (
      place.includes(query) ||
      id.includes(query) ||
      magStr.includes(query)
    );
  });
}

// Error handling
function showError(message) {
  errorBarEl.textContent = message;
  errorBarEl.classList.remove("hidden");
}

function clearError() {
  errorBarEl.classList.add("hidden");
}

// Fetch earthquake data
async function fetchEarthquakes() {
  const rangeKey = timeRangeSelect.value;
  const feedUrl = FEEDS[rangeKey];
  const minMag = parseFloat(minMagRange.value);

  clearError();
  listEl.innerHTML = '<div class="empty-state">Loading data…</div>';
  markersLayer.clearLayers();
  quakeData = [];
  activeId = null;
  detailsEl.innerHTML =
    "Select a marker or a list item to see details here.";

  try {
    const res = await fetch(feedUrl);
    if (!res.ok) {
      throw new Error("HTTP " + res.status);
    }
    const data = await res.json();
    const features = data.features || [];

    quakeData = features
      .filter(f => {
        const mag = f.properties?.mag;
        return typeof mag === "number" && mag >= minMag;
      })
      .sort((a, b) => (b.properties.time || 0) - (a.properties.time || 0))
      .slice(-MAX_QUAKES)
      .reverse(); // newest first

    renderAll();

    if (!quakeData.length) {
      listEl.innerHTML =
        '<div class="empty-state">No earthquakes match this filter.</div>';
    } else if (features.length > MAX_QUAKES) {
      const note = document.createElement("div");
      note.className = "empty-state";
      note.textContent = `Showing ${MAX_QUAKES} most recent earthquakes (out of ${features.length}).`;
      listEl.appendChild(note);
    }
  } catch (err) {
    console.error("Error fetching earthquakes:", err);
    showError("Could not load earthquake data. Please try again later.");
  }
}

function renderAll() {
  renderMapMarkers();
  renderList();
}

function renderMapMarkers() {
  markersLayer.clearLayers();
  const data = getVisibleQuakes();

  data.forEach(feature => {
    const coords = feature.geometry?.coordinates;
    if (!coords || coords.length < 2) return;

    const lon = coords[0];
    const lat = coords[1];
    const mag = feature.properties?.mag ?? 0;
    const place = feature.properties?.place ?? "Unknown location";
    const time = feature.properties?.time ?? 0;
    const id = feature.id;

    const circle = L.circleMarker([lat, lon], {
      radius: magToRadius(mag),
      color: magToColor(mag),
      weight: 1,
      fillColor: magToColor(mag),
      fillOpacity: 0.7
    });

    circle.bindPopup(
      `<strong>M ${mag.toFixed(1)}</strong><br>${place}<br>${formatTime(
        time
      )}`
    );

    circle.on("click", () => {
      setActiveQuake(id, true);
    });

    circle.addTo(markersLayer);
    feature._marker = circle;
  });

  const latLngs = data
    .map(f =>
      f.geometry?.coordinates
        ? [f.geometry.coordinates[1], f.geometry.coordinates[0]]
        : null
    )
    .filter(Boolean);
  if (latLngs.length) {
    map.fitBounds(latLngs, { padding: [18, 18] });
  }
}

function renderList() {
  listEl.innerHTML = "";
  const data = getVisibleQuakes();

  if (!data.length) {
    listEl.innerHTML =
      '<div class="empty-state">No earthquakes match this search.</div>';
    return;
  }

  data.forEach(feature => {
    const props = feature.properties || {};
    const coords = feature.geometry?.coordinates || [];
    const id = feature.id;
    const mag = props.mag ?? 0;
    const place = props.place ?? "Unknown location";
    const time = props.time ?? 0;
    const depth = coords[2] ?? null;

    const item = document.createElement("div");
    item.className = "quake-item";
    item.dataset.id = id;

    const pill = document.createElement("div");
    pill.className = "mag-pill";
    pill.innerHTML = `<span class="mag-value">${mag.toFixed(
      1
    )}</span><span class="mag-label">Mag</span>`;

    const main = document.createElement("div");
    main.className = "quake-main";

    const title = document.createElement("div");
    title.className = "quake-title";
    title.textContent = place;

    const meta = document.createElement("div");
    meta.className = "quake-meta";

    const timeSpan = document.createElement("span");
    timeSpan.textContent = formatTime(time);

    const depthSpan = document.createElement("span");
    depthSpan.textContent =
      depth != null ? `Depth: ${depth.toFixed(1)} km` : "Depth: N/A";

    meta.appendChild(timeSpan);
    meta.appendChild(depthSpan);

    main.appendChild(title);
    main.appendChild(meta);

    item.appendChild(pill);
    item.appendChild(main);

    item.addEventListener("click", () => {
      setActiveQuake(id, true);
      const featureCoords = feature.geometry?.coordinates;
      if (featureCoords) {
        const lat = featureCoords[1];
        const lon = featureCoords[0];
        map.setView([lat, lon], 4, { animate: true });
        if (feature._marker) {
          feature._marker.openPopup();
        }
      }
    });

    listEl.appendChild(item);
  });
}

// Set active quake and show details
function setActiveQuake(id, scrollIntoView = false) {
  activeId = id;

  document.querySelectorAll(".quake-item").forEach(el => {
    el.classList.toggle("active", el.dataset.id === id);
  });

  const data = getVisibleQuakes();
  const feature = data.find(f => f.id === id) || quakeData.find(f => f.id === id);
  if (!feature) return;

  const props = feature.properties || {};
  const coords = feature.geometry?.coordinates || [];
  const mag = props.mag ?? 0;
  const place = props.place ?? "Unknown location";
  const time = props.time ?? 0;
  const depth = coords[2] ?? null;
  const url = props.url || props.detail || null;
  const lat = coords[1];
  const lon = coords[0];

  detailsEl.innerHTML = `
    <p><strong>${place}</strong></p>
    <p>Magnitude: <strong>${mag.toFixed(1)}</strong></p>
    <p>Time: <strong>${formatTime(time)}</strong></p>
    <p>Location: ${
      lat != null && lon != null
        ? `<strong>${lat.toFixed(3)}°, ${lon.toFixed(3)}°</strong>`
        : "<strong>Unknown</strong>"
    }</p>
    <p>Depth: <strong>${
      depth != null ? depth.toFixed(1) + " km" : "N/A"
    }</strong></p>
    ${
      url
        ? `<p>More info: <a href="${url}" target="_blank" rel="noopener noreferrer">USGS event page</a></p>`
        : ""
    }
  `;

  if (scrollIntoView) {
    const activeItem = document.querySelector(
      '.quake-item[data-id="' + id + '"]'
    );
    if (activeItem) {
      activeItem.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }
}

// Theme toggle
function initTheme() {
  const saved = localStorage.getItem("eq-dashboard-theme");
  if (saved === "light") {
    document.body.classList.add("light-mode");
  }
  updateThemeIcon();
}

function toggleTheme() {
  document.body.classList.toggle("light-mode");
  const isLight = document.body.classList.contains("light-mode");
  localStorage.setItem("eq-dashboard-theme", isLight ? "light" : "dark");
  updateThemeIcon();
}

function updateThemeIcon() {
  const isLight = document.body.classList.contains("light-mode");
  themeToggleBtn.textContent = isLight ? "☀︎" : "◐";
}

// Event listeners
minMagRange.addEventListener("input", () => {
  minMagValueLabel.textContent = minMagRange.value;
});

minMagRange.addEventListener("change", fetchEarthquakes);
timeRangeSelect.addEventListener("change", fetchEarthquakes);
refreshBtn.addEventListener("click", fetchEarthquakes);

searchInput.addEventListener("input", () => {
  renderAll();
});

themeToggleBtn.addEventListener("click", toggleTheme);

// Initialize
(function init() {
  minMagValueLabel.textContent = minMagRange.value;
  initTheme();
  initMap();
  fetchEarthquakes();
})();
