// ---------- Config ----------
const DATA_URL = "data/data2/my_faostat_subset_long.csv";
const WORLD_TOPOJSON_URL = "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json";

const mapSvg = d3.select("#map");
const barsSvg = d3.select("#bars");
const lineSvg = d3.select("#line");
const tooltip = d3.select("#tooltip");

const widthMap = +mapSvg.attr("width");
const heightMap = +mapSvg.attr("height");

const controls = {
  item: document.querySelector("#itemSelect"),
  element: document.querySelector("#elementSelect"),
  year: document.querySelector("#yearSlider"),
  yearLabel: document.querySelector("#yearLabel"),
  playBtn: document.querySelector("#playBtn"),
  resetBtn: document.querySelector("#resetBtn"),
  scale: document.querySelector("#scaleSelect"),
  topN: document.querySelector("#topNSlider"),
  topNLabel: document.querySelector("#topNLabel"),
  countryTitle: document.querySelector("#countryTitle"),
};

let state = {
  item: null,
  element: "Production",
  year: 2024,
  scale: "linear",
  topN: 15,
  selectedArea: null, // country name
  playing: false,
};

let timer = null;

// Data stores
let data = [];
let years = [];
let items = [];
let worldFeatures = [];

// Index: key = `${year}||${item}||${element}` -> Map(area -> value)
const cube = new Map();
// For time series: key = `${area}||${item}||${element}` -> [{year,value}]
const series = new Map();

function keyCube(year, item, element) {
  return `${year}||${item}||${element}`;
}
function keySeries(area, item, element) {
  return `${area}||${item}||${element}`;
}

function formatValue(v) {
  if (v == null || Number.isNaN(v)) return "—";
  if (Math.abs(v) >= 1e9) return `${(v/1e9).toFixed(2)}B`;
  if (Math.abs(v) >= 1e6) return `${(v/1e6).toFixed(2)}M`;
  if (Math.abs(v) >= 1e3) return `${(v/1e3).toFixed(2)}k`;
  return d3.format(",.2f")(v);
}

// ---------- Load ----------
Promise.all([
  d3.csv(DATA_URL, d => ({
    area: d.Area,
    m49: d["Area Code (M49)"],
    item: d.Item,
    itemCode: d["Item Code (CPC)"],
    element: d.Element,
    unit: d.Unit,
    year: +d.Year,
    value: +d.Value,
  })),
  d3.json(WORLD_TOPOJSON_URL)
]).then(([rows, world]) => {
  data = rows;

  // Countries geometry
  const countries = topojson.feature(world, world.objects.countries);
  worldFeatures = countries.features;

  // unique items/years from your subset
  years = Array.from(new Set(data.map(d => d.year))).sort((a,b) => a-b);
  items = Array.from(new Set(data.map(d => d.item))).sort(d3.ascending);

  // Build indexes
  for (const d of data) {
    const kc = keyCube(d.year, d.item, d.element);
    if (!cube.has(kc)) cube.set(kc, new Map());
    cube.get(kc).set(d.area, { value: d.value, unit: d.unit });

    const ks = keySeries(d.area, d.item, d.element);
    if (!series.has(ks)) series.set(ks, []);
    series.get(ks).push({ year: d.year, value: d.value, unit: d.unit });
  }
  // sort series
  for (const [k, arr] of series) arr.sort((a,b) => a.year - b.year);

  initUI();
  initMap();
  renderAll();
}).catch(err => {
  console.error(err);
  alert("Erreur de chargement. Vérifie les chemins du CSV et la console.");
});

// ---------- UI ----------
function initUI() {
  // Fill item select
  controls.item.innerHTML = items.map(it => `<option value="${it}">${it}</option>`).join("");
  state.item = items[0];
  controls.item.value = state.item;

  // Year slider min/max from data
  controls.year.min = years[0];
  controls.year.max = years[years.length - 1];
  state.year = years[years.length - 1];
  controls.year.value = state.year;

  controls.yearLabel.textContent = state.year;
  controls.topNLabel.textContent = state.topN;
  controls.topN.value = state.topN;

  controls.item.addEventListener("change", e => {
    state.item = e.target.value;
    renderAll();
  });

  controls.element.addEventListener("change", e => {
    state.element = e.target.value;
    renderAll();
  });

  controls.year.addEventListener("input", e => {
    state.year = +e.target.value;
    controls.yearLabel.textContent = state.year;
    renderAll();
  });

  controls.scale.addEventListener("change", e => {
    state.scale = e.target.value;
    renderAll();
  });

  controls.topN.addEventListener("input", e => {
    state.topN = +e.target.value;
    controls.topNLabel.textContent = state.topN;
    renderBars();
  });

  controls.resetBtn.addEventListener("click", () => {
    state.selectedArea = null;
    controls.countryTitle.textContent = "Aucun pays sélectionné";
    renderAll();
  });

  controls.playBtn.addEventListener("click", () => togglePlay());
}

function togglePlay() {
  state.playing = !state.playing;
  controls.playBtn.textContent = state.playing ? "⏸ Pause" : "▶ Play";

  if (state.playing) {
    timer = setInterval(() => {
      const idx = years.indexOf(state.year);
      const next = years[(idx + 1) % years.length];
      state.year = next;
      controls.year.value = state.year;
      controls.yearLabel.textContent = state.year;
      renderAll();
    }, 900);
  } else {
    clearInterval(timer);
    timer = null;
  }
}

// ---------- Map ----------
let path, projection;
let mapG;

function initMap() {
  projection = d3.geoNaturalEarth1().fitSize([widthMap, heightMap], { type: "Sphere" });
  path = d3.geoPath(projection);

  mapSvg.selectAll("*").remove();

  mapSvg.append("path")
    .datum({ type: "Sphere" })
    .attr("d", path)
    .attr("fill", "#0f1120")
    .attr("stroke", "#24283a");

  mapG = mapSvg.append("g");

  mapG.selectAll("path.country")
    .data(worldFeatures)
    .join("path")
    .attr("class", "country")
    .attr("d", path)
    .attr("stroke", "#24283a")
    .attr("stroke-width", 0.6)
    .attr("fill", "#141829")
    .on("mousemove", (event, feature) => {
      const name = feature.properties?.name; // sometimes missing depending on topojson version
      const areaName = name || "(country)";
      const v = getValueForArea(areaName);
      tooltip
        .style("display", "block")
        .style("left", (event.pageX + 12) + "px")
        .style("top", (event.pageY + 12) + "px")
        .html(`
          <div><strong>${areaName}</strong></div>
          <div>${state.item} — ${state.element} (${state.year})</div>
          <div><strong>${v ? formatValue(v.value) : "—"}</strong> ${v?.unit ?? ""}</div>
        `);
    })
    .on("mouseleave", () => tooltip.style("display", "none"))
    .on("click", (_, feature) => {
      const name = feature.properties?.name;
      if (!name) return;
      state.selectedArea = name;
      controls.countryTitle.textContent = name;
      renderLine();
      highlightSelected();
    });
}

function getValueForArea(areaName) {
  const m = cube.get(keyCube(state.year, state.item, state.element));
  if (!m) return null;
  return m.get(areaName) || null;
}

function getAllValuesForYear() {
  const m = cube.get(keyCube(state.year, state.item, state.element));
  if (!m) return [];
  return Array.from(m.entries()).map(([area, obj]) => ({ area, value: obj.value, unit: obj.unit }));
}

function renderMap() {
  const values = getAllValuesForYear().map(d => d.value).filter(v => v != null && !Number.isNaN(v));
  const max = d3.max(values) ?? 1;
  const min = d3.min(values) ?? 0;

  // color scale
  let color;
  if (state.scale === "log") {
    const safeMin = Math.max(1e-6, min === 0 ? 1e-6 : min);
    color = d3.scaleSequential(d3.interpolateViridis).domain([Math.log(safeMin), Math.log(max)]);
  } else {
    color = d3.scaleSequential(d3.interpolateViridis).domain([min, max]);
  }

  mapG.selectAll("path.country")
    .transition()
    .duration(450)
    .attr("fill", (feature) => {
      const name = feature.properties?.name;
      if (!name) return "#141829";
      const v = getValueForArea(name);
      if (!v || v.value == null || Number.isNaN(v.value)) return "#141829";
      if (state.scale === "log") return color(Math.log(Math.max(1e-6, v.value)));
      return color(v.value);
    });

  highlightSelected();
}

function highlightSelected() {
  mapG.selectAll("path.country")
    .attr("stroke-width", d => (d.properties?.name === state.selectedArea ? 1.8 : 0.6))
    .attr("stroke", d => (d.properties?.name === state.selectedArea ? "#ffffff" : "#24283a"));
}

// ---------- Bars (Top N) ----------
function renderBars() {
  const margin = { top: 10, right: 10, bottom: 18, left: 160 };
  const w = +barsSvg.attr("width");
  const h = +barsSvg.attr("height");
  const innerW = w - margin.left - margin.right;
  const innerH = h - margin.top - margin.bottom;

  barsSvg.selectAll("*").remove();

  const g = barsSvg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

  let rows = getAllValuesForYear()
    .filter(d => d.value != null && !Number.isNaN(d.value))
    .sort((a,b) => d3.descending(a.value, b.value))
    .slice(0, state.topN);

  const x = d3.scaleLinear()
    .domain([0, d3.max(rows, d => d.value) ?? 1])
    .range([0, innerW]);

  const y = d3.scaleBand()
    .domain(rows.map(d => d.area))
    .range([0, innerH])
    .padding(0.15);

  g.append("g").call(d3.axisLeft(y).tickSize(0)).selectAll("text")
    .style("font-size", "11px")
    .style("fill", "#e7e7ea");

  g.append("g")
    .attr("transform", `translate(0,${innerH})`)
    .call(d3.axisBottom(x).ticks(4))
    .selectAll("text").style("fill", "#a8adbd");

  g.selectAll("rect")
    .data(rows, d => d.area)
    .join("rect")
    .attr("x", 0)
    .attr("y", d => y(d.area))
    .attr("height", y.bandwidth())
    .attr("width", d => x(d.value))
    .attr("fill", "#4c5cff")
    .attr("opacity", d => (d.area === state.selectedArea ? 1 : 0.85))
    .style("cursor", "pointer")
    .on("click", (_, d) => {
      state.selectedArea = d.area;
      controls.countryTitle.textContent = d.area;
      renderLine();
      renderMap();
    });

  // values text
  g.selectAll("text.value")
    .data(rows, d => d.area)
    .join("text")
    .attr("class", "value")
    .attr("x", d => x(d.value) + 6)
    .attr("y", d => (y(d.area) ?? 0) + y.bandwidth() / 2)
    .attr("dy", "0.32em")
    .style("fill", "#a8adbd")
    .style("font-size", "11px")
    .text(d => formatValue(d.value));
}

// ---------- Line (selected country) ----------
function renderLine() {
  const margin = { top: 10, right: 10, bottom: 22, left: 52 };
  const w = +lineSvg.attr("width");
  const h = +lineSvg.attr("height");
  const innerW = w - margin.left - margin.right;
  const innerH = h - margin.top - margin.bottom;

  lineSvg.selectAll("*").remove();
  const g = lineSvg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

  if (!state.selectedArea) {
    g.append("text")
      .attr("x", 0).attr("y", 14)
      .style("fill", "#a8adbd")
      .style("font-size", "12px")
      .text("Clique un pays pour voir sa série temporelle.");
    return;
  }

  const k = keySeries(state.selectedArea, state.item, state.element);
  const arr = series.get(k) || [];

  const x = d3.scaleLinear()
    .domain(d3.extent(arr, d => d.year) || [years[0], years[years.length-1]])
    .range([0, innerW]);

  const y = d3.scaleLinear()
    .domain([0, d3.max(arr, d => d.value) ?? 1])
    .nice()
    .range([innerH, 0]);

  g.append("g").attr("transform", `translate(0,${innerH})`)
    .call(d3.axisBottom(x).ticks(6).tickFormat(d3.format("d")))
    .selectAll("text").style("fill", "#a8adbd");

  g.append("g")
    .call(d3.axisLeft(y).ticks(4))
    .selectAll("text").style("fill", "#a8adbd");

  const line = d3.line()
    .x(d => x(d.year))
    .y(d => y(d.value));

  g.append("path")
    .datum(arr)
    .attr("fill", "none")
    .attr("stroke", "#4c5cff")
    .attr("stroke-width", 2)
    .attr("d", line);

  // marker for current year
  const current = arr.find(d => d.year === state.year);
  if (current) {
    g.append("circle")
      .attr("cx", x(current.year))
      .attr("cy", y(current.value))
      .attr("r", 4)
      .attr("fill", "#ffffff");
  }
}

// ---------- Render orchestration ----------
function renderAll() {
  renderMap();
  renderBars();
  renderLine();
}