// =========================
// Config
// =========================
const DATA_URL = "data/my_faostat_subset_long.csv";
const WORLD_TOPOJSON = "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json";

const ELEMENTS_REQUIRED = ["Production", "Area harvested", "Yield"]; // doit exister dans ton CSV

// Attendre que le DOM soit prêt
document.addEventListener("DOMContentLoaded", function () {
  let state = {
    item: null,
    element: "Production",
    year: 1980,
    scaleMode: "linear", // linear|log
    topN: 15,
    playing: false,
    selectedCountries: [], // Sélection multiple
  };

  let timer = null;
  let dataRows = [];
  let byKey = new Map(); // key = `${Area}|${Item}|${Element}|${Year}` => Value
  let byGeoKey = new Map(); // key = `${M49}|${Item}|${Element}|${Year}` => Value
  let units = new Map(); // key = `${Item}|${Element}` => Unit (approx)
  let areaByM49 = new Map(); // key = M49 (normalisé) => Area
  let m49ByArea = new Map(); // key = Area => M49 (normalisé)
  let countryM49Set = new Set(); // M49 présents dans les géométries de pays
  let areasSet = new Set();
  let itemsSet = new Set();

  // =========================
  // DOM refs
  // =========================
  // ✅ Fix: accepte "#id" (querySelector) OU "id" (getElementById)
  const $ = (sel) =>
    typeof sel === "string" && sel.startsWith("#")
      ? document.querySelector(sel)
      : document.getElementById(sel);

  const tooltip = d3.select("#tooltip");
  const loadingOverlay = $("loadingOverlay");

  const pageDashboard = $("#pageDashboard");
  const pageCountry   = $("#pageCountry");
  const pageStats     = $("#pageStats");
  const btnDashboard  = $("#btnDashboard");
  const btnCountry    = $("#btnCountry");
  const btnStats      = $("#btnStats");
  const btnBack       = $("#btnBack");

  // SVGs — Dashboard
  const svgMap           = d3.select("#svgMap");
  const svgTopCountries  = d3.select("#svgTopCountries");
  const svgTopContinents = d3.select("#svgTopContinents");
  const svgScatter       = d3.select("#svgScatter");
  const svgMiniLine      = d3.select("#svgMiniLine");

  // SVGs — Country page
  const svgBars       = d3.select("#svgBars");
  const svgSparklines = d3.select("#svgSparklines");
  const svgCropBars   = d3.select("#svgCropBars");

  // SVGs — Stats page
  const svgCropDonut      = d3.select("#svgCropDonut");
  const svgContinentDonut = d3.select("#svgContinentDonut");
  const svgStackedArea    = d3.select("#svgStackedArea");

  // Controls
  const selItem    = $("#selItem");
  const selElement = $("#selElement");
  const yearSlider = $("#yearSlider");
  const lblYear    = $("#lblYear");
  const selScale   = $("#selScale");
  const topNSlider = $("#topNSlider");
  const lblTopN    = $("#lblTopN");

  const btnPlay           = $("#btnPlay");
  const btnReset          = $("#btnReset");
  const btnClearSelection = $("#btnClearSelection");

  // Detail page labels
  const countryName      = $("#countryName");
  const countryMeta      = $("#countryMeta");
  const cropBreakdownMeta = $("#cropBreakdownMeta");
  const miniTitle        = $("#miniTitle");
  const statsMeta        = $("#statsMeta");
  const kpiProd      = $("#kpiProd");
  const kpiArea      = $("#kpiArea");
  const kpiYield     = $("#kpiYield");
  const kpiProdUnit  = $("#kpiProdUnit");
  const kpiAreaUnit  = $("#kpiAreaUnit");
  const kpiYieldUnit = $("#kpiYieldUnit");

  // Vérification que tous les éléments existent
  if (!selItem || !selElement || !yearSlider) {
    console.error("❌ Erreur: Certains éléments DOM sont manquants!");
    console.error("selItem:", selItem, "selElement:", selElement, "yearSlider:", yearSlider);
  }

  // =========================
  // Helpers
  // =========================
  function key(area, item, element, year) {
    return `${area}|${item}|${element}|${year}`;
  }

  function normalizeM49(raw) {
    if (raw == null) return null;
    const digits = String(raw).replace(/\D/g, "");
    if (!digits) return null;
    return String(parseInt(digits, 10));
  }

  function formatNumber(v) {
    if (v == null || isNaN(v)) return "—";
    const abs = Math.abs(v);
    if (abs >= 1e9) return (v / 1e9).toFixed(2) + "B";
    if (abs >= 1e6) return (v / 1e6).toFixed(2) + "M";
    if (abs >= 1e3) return (v / 1e3).toFixed(2) + "k";
    return v.toFixed(2).replace(/\.00$/, "");
  }

  function truncateLabel(label, maxLen = 22) {
    if (!label) return "";
    return label.length > maxLen ? `${label.slice(0, maxLen - 1)}…` : label;
  }

  function showTooltip(html, x, y) {
    tooltip
      .classed("hidden", false)
      .html(html)
      .style("left", x + 12 + "px")
      .style("top", y + 12 + "px");
  }
  function hideTooltip() {
    tooltip.classed("hidden", true);
  }

  function navigate(to) {
    pageDashboard.classList.toggle("hidden", to !== "dashboard");
    pageCountry.classList.toggle("hidden",   to !== "country");
    pageStats.classList.toggle("hidden",     to !== "stats");
    btnDashboard.classList.toggle("active",  to === "dashboard");
    btnCountry.classList.toggle("active",    to === "country");
    btnStats.classList.toggle("active",      to === "stats");
  }

  function isLikelyAggregate(areaName) {
    // Correspondances exactes pour les agrégats FAO connus
    const exactAggregates = new Set([
      "World", "Africa", "Americas", "Asia", "Europe", "Oceania",
      "China", // agrégat FAO (mainland + Taiwan + HK + Macao)
      "China, Taiwan Province of",
      "European Union", "European Union (27)",
      "Australia and New Zealand", "Caribbean",
      "Melanesia", "Micronesia", "Polynesia",
      "SIDS", "Small Island Developing States (SIDS)",
      "Least Developed Countries (LDCs)",
      "Land Locked Developing Countries (LLDCs)",
      "Low Income Food Deficit Countries (LIFDCs)",
      "Net Food Importing Developing Countries (NFIDCs)",
    ]);
    if (exactAggregates.has(areaName)) return true;

    // Sous-chaînes pour les autres patterns régionaux
    const bad = [
      "Eastern Europe", "Western Europe", "Northern Europe", "Southern Europe",
      "Eastern Asia", "Western Asia", "Southern Asia", "Central Asia",
      "South-eastern Asia",
      "Northern America", "Central America", "South America",
      "Eastern Africa", "Western Africa", "Northern Africa", "Southern Africa", "Middle Africa",
      "Developing", "Least Developed", "Land Locked",
      "Lower middle income", "Upper middle income", "High income", "Low Income",
      "Net Food", "Annex I",
    ];
    return bad.some((s) => areaName.includes(s));
  }

  function isCountryArea(areaName) {
    if (isLikelyAggregate(areaName)) return false;
    const m49 = m49ByArea.get(areaName);
    if (!m49) return false;
    
    const code = parseInt(m49, 10);
    if (isNaN(code)) return false;
    
    // Exclude regional aggregates (M49 codes < 100 or 900-999)
    if (code < 100) return false;
    if (code >= 900 && code < 1000) return false;
    
    return countryM49Set.has(m49);
  }

  function isContinentOnly(areaName) {
    const continents = ["Africa", "Americas", "Asia", "Europe", "Oceania"];
    return continents.includes(areaName);
  }

  // =========================
  // Load
  // =========================
  Promise.all([
    d3.csv(DATA_URL, (d) => ({
      Area: d.Area,
      M49: d["Area Code (M49)"],
      Item: d.Item,
      ItemCode: d["Item Code (CPC)"],
      Element: d.Element,
      Unit: d.Unit,
      Year: +d.Year,
      Value: +d.Value,
    })),
    d3.json(WORLD_TOPOJSON),
  ])
    .then(([rows, world]) => {
      dataRows = rows;
      console.log("✓ Données chargées:", dataRows.length, "lignes");
      console.log("Exemple de ligne:", dataRows[0]);

      // Index
      for (const r of dataRows) {
        areasSet.add(r.Area);
        itemsSet.add(r.Item);

        const v = r.Value == null || isNaN(r.Value) ? null : r.Value;
        byKey.set(key(r.Area, r.Item, r.Element, r.Year), v);

        const m49 = normalizeM49(r.M49);
        if (m49) {
          byGeoKey.set(`${m49}|${r.Item}|${r.Element}|${r.Year}`, v);
          if (!areaByM49.has(m49)) areaByM49.set(m49, r.Area);
          if (!m49ByArea.has(r.Area)) m49ByArea.set(r.Area, m49);
        }

        const uKey = `${r.Item}|${r.Element}`;
        if (!units.has(uKey) && r.Unit) units.set(uKey, r.Unit);
      }

      // Setup controls
      const items = Array.from(itemsSet).sort(d3.ascending);
      state.item = items[0];

      const years = Array.from(new Set(dataRows.map((d) => d.Year)))
        .filter((y) => !isNaN(y))
        .sort((a, b) => a - b);

      console.log("📊 Items disponibles:", items.length, items.slice(0, 5));
      console.log("🌍 Pays/régions:", areasSet.size);
      console.log("🗃️ Données indexées:", byKey.size, "entrées");

      // Populate selects
      for (const it of items) {
        const opt = document.createElement("option");
        opt.value = it;
        opt.textContent = it;
        selItem.appendChild(opt);
      }
      for (const el of ELEMENTS_REQUIRED) {
        const opt = document.createElement("option");
        opt.value = el;
        opt.textContent = el;
        selElement.appendChild(opt);
      }

      selItem.value = state.item;
      selElement.value = state.element;
      if (years.length > 0) {
        yearSlider.min = years[0];
        yearSlider.max = years[years.length - 1];
        state.year = years[years.length - 1];
      }
      yearSlider.value = state.year;
      lblYear.textContent = state.year;
      selScale.value = state.scaleMode;

      topNSlider.value = state.topN;
      lblTopN.textContent = state.topN;

      // World shapes
      const countries = topojson.feature(world, world.objects.countries).features;
      initMap(countries);

      // Masquer l'overlay de chargement
      if (loadingOverlay) loadingOverlay.classList.add("hidden");

      // First render
      renderAll();

      // Bind events
      selItem.addEventListener("change", () => {
        state.item = selItem.value;
        renderAll();
      });
      selElement.addEventListener("change", () => {
        state.element = selElement.value;
        renderAll();
      });
      yearSlider.addEventListener("input", () => {
        state.year = +yearSlider.value;
        lblYear.textContent = state.year;
        renderAll();
      });
      selScale.addEventListener("change", () => {
        state.scaleMode = selScale.value;
        renderAll();
      });
      topNSlider.addEventListener("input", () => {
        state.topN = +topNSlider.value;
        lblTopN.textContent = state.topN;
        renderAll();
      });

      btnPlay.addEventListener("click", togglePlay);
      btnReset.addEventListener("click", () => {
        stopPlay();
        state.year = +yearSlider.min;
        yearSlider.value = state.year;
        lblYear.textContent = state.year;
        state.topN = 15;
        topNSlider.value = 15;
        lblTopN.textContent = 15;
        state.scaleMode = "linear";
        selScale.value = "linear";
        state.element = "Production";
        selElement.value = "Production";
        renderAll();
      });

      btnDashboard.addEventListener("click", () => {
        navigate("dashboard");
        renderAll();
      });
      btnCountry.addEventListener("click", () => {
        if (state.selectedCountries.length > 0) {
          navigate("country");
          // Forcer le rendu après que la page soit visible (dimensions correctes)
          renderCountryPage();
        } else {
          alert("Veuillez sélectionner au moins un pays d'abord.\nCliquez sur un pays sur la carte ou le top pays.");
        }
      });
      btnBack.addEventListener("click", () => {
        navigate("dashboard");
        renderAll();
      });

      btnStats.addEventListener("click", () => {
        navigate("stats");
        renderStatsPage();
      });
      
      btnClearSelection.addEventListener("click", () => {
        state.selectedCountries = [];
        renderMiniLine();
        renderMap();
        renderScatter();
        renderTop();
      });
    })
    .catch((err) => {
      if (loadingOverlay) loadingOverlay.classList.add("hidden");
      console.error("Erreur de chargement:", err);
      console.error("Message:", err.message);
      console.error("Stack:", err.stack);
      alert(
        "Erreur de chargement des données.\nErreur: " +
          err.message +
          "\n\nVérifie la console pour plus de détails."
      );
    });

  function togglePlay() {
    if (state.playing) stopPlay();
    else startPlay();
  }
  function startPlay() {
    state.playing = true;
    btnPlay.textContent = "⏸ Pause";
    timer = setInterval(() => {
      state.year += 1;
      if (state.year > +yearSlider.max) state.year = +yearSlider.min;
      yearSlider.value = state.year;
      lblYear.textContent = state.year;
      renderAll();
    }, 700);
  }
  function stopPlay() {
    state.playing = false;
    btnPlay.textContent = "▶ Play";
    if (timer) clearInterval(timer);
    timer = null;
  }

  // =========================
  // Render pipeline
  // =========================
  function renderAll() {
    renderMap();
    renderTop();
    renderScatter();
    renderMiniLine();
    if (!pageCountry.classList.contains("hidden")) renderCountryPage();
    if (!pageStats.classList.contains("hidden"))   renderStatsPage();
  }

  // =========================
  // MAP
  // =========================
  let mapG, projection, path, mapCountries;

  function featureM49(feature) {
    if (feature == null || feature.id == null) return null;
    const digits = String(feature.id).replace(/\D/g, "");
    if (!digits) return null;
    return String(parseInt(digits, 10));
  }

  function areaFromFeature(feature) {
    const byName = feature?.properties?.name;
    if (byName && areasSet.has(byName)) return byName;

    const m49 = featureM49(feature);
    if (m49 && areaByM49.has(m49)) return areaByM49.get(m49);

    return byName || null;
  }

  function valueFromFeature(feature) {
    const area = areaFromFeature(feature);
    if (area) {
      const byArea = byKey.get(key(area, state.item, state.element, state.year));
      if (byArea != null && !isNaN(byArea)) return byArea;
    }

    const m49 = featureM49(feature);
    if (!m49) return null;
    const byCode = byGeoKey.get(`${m49}|${state.item}|${state.element}|${state.year}`);
    if (byCode == null || isNaN(byCode)) return null;
    return byCode;
  }

  function initMap(countries) {
    if (!svgMap.node()) {
      console.error("❌ Element svgMap n'existe pas!");
      return;
    }

    const w = svgMap.node().clientWidth || 800;
    const h = svgMap.node().clientHeight || 400;

    countryM49Set = new Set(
      countries.map((feature) => featureM49(feature)).filter((m49) => m49 != null)
    );

    projection = d3.geoNaturalEarth1().fitSize([w, h], { type: "Sphere" });
    path = d3.geoPath(projection);

    svgMap.attr("viewBox", `0 0 ${w} ${h}`);

    mapG = svgMap.append("g");

    mapG
      .append("path")
      .attr("d", path({ type: "Sphere" }))
      .attr("fill", "#e8ecf0")
      .attr("stroke", "#d1d9e0");

    mapCountries = mapG
      .append("g")
      .selectAll("path.country")
      .data(countries)
      .join("path")
      .attr("class", "country")
      .attr("d", path)
      .attr("fill", "#f8fafc")
      .attr("stroke", "#cbd5e1")
      .on("mousemove", (e, feature) => {
        const area = areaFromFeature(feature) || "Pays";
        const v = valueFromFeature(feature);
        const unit = units.get(`${state.item}|${state.element}`) || "";
        showTooltip(
          `<b>${area}</b><br>${state.item} • ${state.element} (${state.year})<br>${v == null ? "—" : formatNumber(v)} ${unit}`,
          e.clientX,
          e.clientY
        );
      })
      .on("mouseleave", hideTooltip)
      .on("click", (_, feature) => {
        const area = areaFromFeature(feature);
        if (!area) return;
        selectCountry(area);
      });
  }

  function renderMap() {
    const vals = [];
    for (const area of areasSet) {
      if (!isCountryArea(area)) continue;
      const v = byKey.get(key(area, state.item, state.element, state.year));
      if (v != null && !isNaN(v)) vals.push(v);
    }

    const min = d3.min(vals) ?? 0;
    const max = d3.max(vals) ?? 1;

    const color = buildColorScale(min, max);

    if (mapCountries) {
      mapCountries
        .transition()
        .duration(450)
        .attr("fill", (feature) => color(valueFromFeature(feature)))
        .attr("stroke", (feature) => {
          const area = areaFromFeature(feature);
          return state.selectedCountries.includes(area)
            ? "#0f172a"
            : "#cbd5e1";
        })
        .attr("stroke-width", (feature) => {
          const area = areaFromFeature(feature);
          return state.selectedCountries.includes(area) ? 2 : 0.8;
        });
    }

    const elemDefs = [
      { el: "Production",     r: 46,  g: 204, b: 113, label: "Production" },
      { el: "Area harvested", r: 231, g: 76,  b: 60,  label: "Surface" },
      { el: "Yield",          r: 66,  g: 133, b: 244, label: "Rendement" },
    ];
    let legendHTML = "";
    for (const ed of elemDefs) {
      const elVals = [];
      for (const area of areasSet) {
        if (!isCountryArea(area)) continue;
        const v = byKey.get(key(area, state.item, ed.el, state.year));
        if (v != null && !isNaN(v)) elVals.push(v);
      }
      const elMin = d3.min(elVals) ?? 0;
      const elMax = d3.max(elVals) ?? 1;
      const elUnit = units.get(`${state.item}|${ed.el}`) || "";
      const isActive = ed.el === state.element;
      legendHTML += `<div class="legendRow${isActive ? " active" : ""}">
        <div class="legendRowLabel">${ed.label}</div>
        <div class="legendBar" style="background:linear-gradient(to right,rgba(${ed.r},${ed.g},${ed.b},0.12),rgba(${ed.r},${ed.g},${ed.b},0.9))"></div>
        <div class="legendMinMax"><span>${formatNumber(elMin)}</span><span>${formatNumber(elMax)} ${elUnit}</span></div>
      </div>`;
    }
    d3.select("#mapLegend").html(legendHTML);
  }

  function buildColorScale(min, max) {
    const rgb = getElementBaseRgb();
    const alphaMin = 0.12;
    const alphaMax = 0.95;

    if (state.scaleMode === "log") {
      const minPos = Math.max(1e-9, min <= 0 ? 1e-9 : min);
      const maxPos = Math.max(minPos * 1.0001, max);
      const alphaScale = d3
        .scaleLog()
        .domain([minPos, maxPos])
        .range([alphaMin, alphaMax])
        .clamp(true);

      return (v) => {
        if (v == null || isNaN(v) || v <= 0) return "#f1f5f9";
        const a = alphaScale(v);
        return `rgba(${rgb.r},${rgb.g},${rgb.b},${a})`;
      };
    }

    const safeMax = Math.max(min + 1e-9, max);
    const alphaScale = d3
      .scaleLinear()
      .domain([min, safeMax])
      .range([alphaMin, alphaMax])
      .clamp(true);

    return (v) => {
      if (v == null || isNaN(v)) return "#f1f5f9";
      const a = alphaScale(v);
      return `rgba(${rgb.r},${rgb.g},${rgb.b},${a})`;
    };
  }

  function getElementBaseRgb() {
    if (state.element === "Production") return { r: 46, g: 204, b: 113 };
    if (state.element === "Area harvested") return { r: 231, g: 76, b: 60 };
    return { r: 66, g: 133, b: 244 };
  }

  // =========================
  // TOP N
  // =========================
  function renderTop() {
    const unit = units.get(`${state.item}|${state.element}`) || "";

    const allRows = [];
    for (const area of areasSet) {
      const v = byKey.get(key(area, state.item, state.element, state.year));
      if (v == null || isNaN(v)) continue;
      allRows.push({ area, value: v });
    }

    const countryRows = allRows
      .filter((d) => isCountryArea(d.area))
      .sort((a, b) => d3.descending(a.value, b.value))
      .slice(0, state.topN);

    const continentRows = allRows
      .filter((d) => isContinentOnly(d.area))
      .sort((a, b) => d3.descending(a.value, b.value))
      .slice(0, state.topN);

    renderTopChart(svgTopCountries, countryRows, unit, true, "Aucune donnée pays.");
    renderTopChart(
      svgTopContinents,
      continentRows,
      unit,
      false,
      "Aucune donnée continent."
    );
  }

  function renderTopChart(svg, rows, unit, clickable, emptyLabel) {
    if (!svg.node()) return;

    const w = svg.node().clientWidth || 420;
    const h = svg.node().clientHeight || 220;
    svg.attr("viewBox", `0 0 ${w} ${h}`);
    svg.selectAll("*").remove();

    if (rows.length === 0) {
      svg
        .append("text")
        .attr("x", 12)
        .attr("y", 20)
        .attr("fill", "#94a3b8")
        .attr("font-size", 12)
        .text(emptyLabel);
      return;
    }

    const margin = { top: 10, right: 20, bottom: 35, left: 130 };
    const innerW = w - margin.left - margin.right;
    const innerH = h - margin.top - margin.bottom;

    const maxRowsByHeight = Math.max(6, Math.floor(innerH / 16));
    const visibleRows = rows.slice(0, maxRowsByHeight);

    const g = svg
      .append("g")
      .attr("transform", `translate(${margin.left},${margin.top})`);

    const x = d3
      .scaleLinear()
      .domain([0, d3.max(visibleRows, (d) => d.value) || 1])
      .range([0, innerW]);

    const y = d3
      .scaleBand()
      .domain(visibleRows.map((d) => d.area))
      .range([0, innerH])
      .padding(0.15);

    const xAxis = g.append("g")
      .attr("transform", `translate(0,${innerH})`)
      .call(d3.axisBottom(x).ticks(4).tickFormat(d3.format("~s")))
      .call(styleAxis);
    
    xAxis.append("text")
      .attr("x", innerW / 2)
      .attr("y", 28)
      .attr("fill", "#64748b")
      .attr("text-anchor", "middle")
      .attr("font-size", 11)
      .attr("font-weight", "600")
      .text(unit || "Valeur");

    g.append("g")
      .call(d3.axisLeft(y).tickSize(0).tickFormat((name) => truncateLabel(name, 20)))
      .call(styleAxis);

    g.selectAll("rect")
      .data(visibleRows, (d) => d.area)
      .join("rect")
      .attr("x", 0)
      .attr("y", (d) => y(d.area))
      .attr("height", y.bandwidth())
      .attr("width", (d) => x(d.value))
      .attr("fill", (d) => state.selectedCountries.includes(d.area) ? "rgba(37,99,235,.9)" : "rgba(37,99,235,.5)")
      .attr("stroke", (d) => state.selectedCountries.includes(d.area) ? "rgba(37,99,235,1)" : "none")
      .attr("stroke-width", (d) => state.selectedCountries.includes(d.area) ? 2 : 0)
      .attr("rx", 6)
      .style("cursor", clickable ? "pointer" : "default")
      .on("mousemove", (e, d) => {
        showTooltip(`<b>${d.area}</b><br>${formatNumber(d.value)} ${unit}`, e.clientX, e.clientY);
      })
      .on("mouseleave", hideTooltip)
      .on("click", (_, d) => {
        if (clickable) selectCountry(d.area);
      });

    const showValueLabels = y.bandwidth() >= 13;
    if (showValueLabels) {
      g.selectAll(".labelValue")
        .data(visibleRows)
        .join("text")
        .attr("class", "labelValue")
        .attr("x", (d) => x(d.value) + 6)
        .attr("y", (d) => y(d.area) + y.bandwidth() / 2 + 4)
        .attr("fill", "#475569")
        .attr("font-size", 10)
        .text((d) => d3.format("~s")(d.value));
    }
  }

  function styleAxis(g) {
    g.selectAll("path,line").attr("stroke", "#e2e8f0");
    g.selectAll("text").attr("fill", "#64748b").attr("font-size", 11);
  }

  // =========================
  // SCATTER: X=Area harvested, Y=Yield, size=Production
  // =========================
  function renderScatter() {
    const rows = [];
    for (const area of areasSet) {
      if (!isCountryArea(area)) continue;
      const a = byKey.get(key(area, state.item, "Area harvested", state.year));
      const y = byKey.get(key(area, state.item, "Yield", state.year));
      const p = byKey.get(key(area, state.item, "Production", state.year));
      if ([a, y, p].some((v) => v == null || isNaN(v))) continue;
      if (a <= 0 || y <= 0 || p <= 0) continue;
      rows.push({ area, areaHarvested: a, yield: y, production: p });
    }

    const w = svgScatter.node().clientWidth || 800;
    const h = svgScatter.node().clientHeight || 320;
    svgScatter.attr("viewBox", `0 0 ${w} ${h}`);
    svgScatter.selectAll("*").remove();

    // ✅ Fix: si pas de données, on affiche un message au lieu de crash
    if (rows.length === 0) {
      svgScatter
        .append("text")
        .attr("x", 20)
        .attr("y", 30)
        .attr("fill", "#94a3b8")
        .attr("font-size", 12)
        .text("Pas assez de données (Production + Surface + Rendement) pour cette culture/année.");
      return;
    }

    const margin = { top: 20, right: 30, bottom: 55, left: 75 };
    const innerW = w - margin.left - margin.right;
    const innerH = h - margin.top - margin.bottom;

    const g = svgScatter
      .append("g")
      .attr("transform", `translate(${margin.left},${margin.top})`);

    const xExt = d3.extent(rows, (d) => d.areaHarvested);
    const yExt = d3.extent(rows, (d) => d.yield);
    const pExt = d3.extent(rows, (d) => d.production);

    const x = d3
      .scaleLog()
      .domain([Math.max(1e-6, xExt[0]), xExt[1]])
      .range([0, innerW]);

    const y = d3
      .scaleLog()
      .domain([Math.max(1e-6, yExt[0]), yExt[1]])
      .range([innerH, 0]);

    const r = d3.scaleSqrt().domain(pExt).range([2.5, 18]);

    // Axes avec labels
    const xAxis = g.append("g")
      .attr("transform", `translate(0,${innerH})`)
      .call(d3.axisBottom(x).ticks(5, "~s"))
      .call(styleAxis);
    
    xAxis.append("text")
      .attr("x", innerW / 2)
      .attr("y", 42)
      .attr("fill", "#64748b")
      .attr("text-anchor", "middle")
      .attr("font-size", 11)
      .attr("font-weight", "600")
      .text("Surface récoltée (ha) [log]");

    const yAxis = g.append("g")
      .call(d3.axisLeft(y).ticks(5, "~s"))
      .call(styleAxis);

    yAxis.append("text")
      .attr("x", -innerH / 2)
      .attr("y", -58)
      .attr("transform", "rotate(-90)")
      .attr("text-anchor", "middle")
      .attr("fill", "#64748b")
      .attr("font-size", 11)
      .attr("font-weight", "600")
      .text("Rendement (kg/ha) [log]");

    // Légende pour les bulles (Production)
    const legendX = innerW - 120;
    const legendY = -8;
    const legend = g.append("g")
      .attr("transform", `translate(${legendX},${legendY})`);

    legend.append("text")
      .attr("x", 0)
      .attr("y", 0)
      .attr("fill", "#94a3b8")
      .attr("font-size", 10)
      .attr("font-weight", "600")
      .text("Taille = Production");

    const bubbleSizes = [r.domain()[0], (r.domain()[0] + r.domain()[1]) / 2, r.domain()[1]];
    const bubbleLabels = bubbleSizes.map((v) => formatNumber(v) + "t");
    [0, 1, 2].forEach((i) => {
      legend.append("circle")
        .attr("cx", 8)
        .attr("cy", 14 + i * 14)
        .attr("r", r(bubbleSizes[i]))
        .attr("fill", "rgba(37,99,235,.3)")
        .attr("stroke", "#e2e8f0");
      legend.append("text")
        .attr("x", 20)
        .attr("y", 14 + i * 14 + 3)
        .attr("fill", "#94a3b8")
        .attr("font-size", 9)
        .text(bubbleLabels[i]);
    });

    // Palette de couleurs pour les pays sélectionnés
    const colorScale = d3.scaleOrdinal()
      .domain(state.selectedCountries)
      .range([
        "rgba(37,99,235,.9)",
        "rgba(220,38,38,.9)",
        "rgba(34,197,94,.9)",
        "rgba(234,179,8,.9)",
        "rgba(168,85,247,.9)",
        "rgba(236,72,153,.9)",
        "rgba(14,165,233,.9)",
        "rgba(249,115,22,.9)",
      ]);

    // Séparer les points sélectionnés et non sélectionnés
    const unselectedRows = rows.filter(d => !state.selectedCountries.includes(d.area));
    const selectedRows = rows.filter(d => state.selectedCountries.includes(d.area));

    // Dessiner d'abord les points non sélectionnés (en arrière-plan)
    g.selectAll("circle.unselected")
      .data(unselectedRows)
      .join("circle")
      .attr("class", "unselected")
      .attr("cx", (d) => x(d.areaHarvested))
      .attr("cy", (d) => y(d.yield))
      .attr("r", (d) => r(d.production))
      .attr("fill", "#dde3eb")
      .attr("stroke", "#c5cdd8")
      .attr("stroke-width", 0.5)
      .style("cursor", "pointer")
      .on("mousemove", (e, d) => {
        showTooltip(
          `<b>${d.area}</b><br>
           Surf: ${formatNumber(d.areaHarvested)} ha<br>
           Rend: ${formatNumber(d.yield)} kg/ha<br>
           Prod: ${formatNumber(d.production)} t`,
          e.clientX,
          e.clientY
        );
      })
      .on("mouseleave", hideTooltip)
      .on("click", (_, d) => selectCountry(d.area));

    // Dessiner ensuite les points sélectionnés (au premier plan)
    g.selectAll("circle.selected")
      .data(selectedRows)
      .join("circle")
      .attr("class", "selected")
      .attr("cx", (d) => x(d.areaHarvested))
      .attr("cy", (d) => y(d.yield))
      .attr("r", (d) => r(d.production) * 1.4)
      .attr("fill", (d) => colorScale(d.area))
      .attr("stroke", "white")
      .attr("stroke-width", 3)
      .style("cursor", "pointer")
      .on("mousemove", (e, d) => {
        showTooltip(
          `<b>${d.area}</b> ✓<br>
           Surf: ${formatNumber(d.areaHarvested)} ha<br>
           Rend: ${formatNumber(d.yield)} kg/ha<br>
           Prod: ${formatNumber(d.production)} t<br>
           <em>Cliquez pour retirer</em>`,
          e.clientX,
          e.clientY
        );
      })
      .on("mouseleave", hideTooltip)
      .on("click", (_, d) => selectCountry(d.area));

    // Ajouter des labels pour les pays sélectionnés
    g.selectAll("text.label")
      .data(selectedRows)
      .join("text")
      .attr("class", "label")
      .attr("x", (d) => x(d.areaHarvested))
      .attr("y", (d) => y(d.yield) - r(d.production) * 1.4 - 8)
      .attr("text-anchor", "middle")
      .attr("font-size", 11)
      .attr("font-weight", "600")
      .attr("fill", (d) => colorScale(d.area))
      .attr("stroke", "white")
      .attr("stroke-width", 3)
      .attr("paint-order", "stroke")
      .text((d) => truncateLabel(d.area, 18))
      .style("pointer-events", "none");
  }

  // =========================
  // MINI LINE
  // =========================
  function renderMiniLine() {
    const countries = state.selectedCountries;
    const w = svgMiniLine.node().clientWidth || 420;
    const h = svgMiniLine.node().clientHeight || 280;
    svgMiniLine.attr("viewBox", `0 0 ${w} ${h}`);
    svgMiniLine.selectAll("*").remove();

    if (countries.length === 0) {
      miniTitle.textContent = "Aucun pays sélectionné (cliquez pour ajouter)";
      return;
    }

    miniTitle.textContent = countries.length === 1 
      ? countries[0] 
      : `Comparaison de ${countries.length} pays`;

    const years = d3.range(+yearSlider.min, +yearSlider.max + 1);
    
    // Créer une série par pays
    const allSeries = countries.map((area) => ({
      area,
      data: years
        .map((yr) => ({
          year: yr,
          value: byKey.get(key(area, state.item, state.element, yr)),
        }))
        .filter((d) => d.value != null && !isNaN(d.value)),
    })).filter(s => s.data.length > 0);

    if (allSeries.length === 0) {
      miniTitle.textContent = "Pas de données pour les pays sélectionnés";
      return;
    }
    
    // Domaine Y global pour tous les pays
    const allValues = allSeries.flatMap(s => s.data.map(d => d.value));
    const globalYExtent = d3.extent(allValues);

    const margin = { top: 18, right: 140, bottom: 42, left: 60 };
    const innerW = w - margin.left - margin.right;
    const innerH = h - margin.top - margin.bottom;

    const g = svgMiniLine
      .append("g")
      .attr("transform", `translate(${margin.left},${margin.top})`);

    const x = d3
      .scaleLinear()
      .domain([+yearSlider.min, +yearSlider.max])
      .range([0, innerW]);

    const y = d3
      .scaleLinear()
      .domain(globalYExtent)
      .nice()
      .range([innerH, 0]);

    const line = d3
      .line()
      .x((d) => x(d.year))
      .y((d) => y(d.value));

    // Palette de couleurs pour les pays
    const colorScale = d3.scaleOrdinal()
      .domain(countries)
      .range([
        "rgba(37,99,235,.9)",
        "rgba(220,38,38,.9)",
        "rgba(34,197,94,.9)",
        "rgba(234,179,8,.9)",
        "rgba(168,85,247,.9)",
        "rgba(236,72,153,.9)",
        "rgba(14,165,233,.9)",
        "rgba(249,115,22,.9)",
      ]);

    // Dessiner une ligne par pays
    allSeries.forEach((series) => {
      g.append("path")
        .datum(series.data)
        .attr("fill", "none")
        .attr("stroke", colorScale(series.area))
        .attr("stroke-width", 2.5)
        .attr("d", line);
    });

    const xAxis = g.append("g")
      .attr("transform", `translate(0,${innerH})`)
      .call(d3.axisBottom(x).ticks(5).tickFormat(d3.format("d")))
      .call(styleAxis);
    
    xAxis.append("text")
      .attr("x", innerW / 2)
      .attr("y", 32)
      .attr("fill", "#64748b")
      .attr("text-anchor", "middle")
      .attr("font-size", 11)
      .attr("font-weight", "600")
      .text("Année");

    const yAxis = g.append("g")
      .call(d3.axisLeft(y).ticks(4).tickFormat(d3.format("~s")))
      .call(styleAxis);

    yAxis.append("text")
      .attr("x", -innerH / 2)
      .attr("y", -45)
      .attr("transform", "rotate(-90)")
      .attr("text-anchor", "middle")
      .attr("fill", "#64748b")
      .attr("font-size", 11)
      .attr("font-weight", "600")
      .text(state.element);

    // Afficher un point pour l'année actuelle sur chaque ligne
    allSeries.forEach((series) => {
      const cur = series.data.find((d) => d.year === state.year);
      if (cur) {
        g.append("circle")
          .attr("cx", x(cur.year))
          .attr("cy", y(cur.value))
          .attr("r", 4.5)
          .attr("fill", colorScale(series.area))
          .attr("stroke", "white")
          .attr("stroke-width", 2);
      }
    });

    // Légende à droite
    const legend = svgMiniLine
      .append("g")
      .attr("transform", `translate(${w - 130}, 25)`);
    
    legend.append("text")
      .attr("x", 0)
      .attr("y", 0)
      .attr("font-size", 10)
      .attr("font-weight", "700")
      .attr("fill", "#94a3b8")
      .attr("text-transform", "uppercase")
      .text("Pays sélectionnés");

    allSeries.forEach((series, i) => {
      const yPos = 18 + i * 20;

      legend.append("line")
        .attr("x1", 0)
        .attr("x2", 18)
        .attr("y1", yPos)
        .attr("y2", yPos)
        .attr("stroke", colorScale(series.area))
        .attr("stroke-width", 2.5);

      legend.append("text")
        .attr("x", 24)
        .attr("y", yPos + 4)
        .attr("font-size", 10)
        .attr("fill", "#475569")
        .text(truncateLabel(series.area, 14));
    });
  }

  // =========================
  // COUNTRY PAGE
  // =========================
  function selectCountry(area) {
    // Toggle: ajouter ou retirer le pays de la sélection
    const index = state.selectedCountries.indexOf(area);
    if (index === -1) {
      // Ajouter (max 5 pays)
      if (state.selectedCountries.length < 5) {
        state.selectedCountries.push(area);
      } else {
        // Remplacer le plus ancien
        state.selectedCountries.shift();
        state.selectedCountries.push(area);
      }
    } else {
      // Retirer
      state.selectedCountries.splice(index, 1);
    }
    renderMiniLine();
    renderMap();
    renderScatter();
    renderTop();
  }

  function renderCountryPage() {
    // Afficher le dernier pays sélectionné (le plus récent)
    const area = state.selectedCountries[state.selectedCountries.length - 1];
    if (!area) {
      countryName.textContent = "Aucun pays sélectionné";
      countryMeta.textContent = "Clique un pays sur le Dashboard.";
      return;
    }

    countryName.textContent = area;
    countryMeta.textContent = `${state.item} • ${state.year}`;
    cropBreakdownMeta.textContent = `${state.element} • ${state.year}`;

    const prod = byKey.get(key(area, state.item, "Production", state.year));
    const ar = byKey.get(key(area, state.item, "Area harvested", state.year));
    const yld = byKey.get(key(area, state.item, "Yield", state.year));

    kpiProd.textContent = formatNumber(prod);
    kpiArea.textContent = formatNumber(ar);
    kpiYield.textContent = formatNumber(yld);

    kpiProdUnit.textContent = units.get(`${state.item}|Production`) || "t";
    kpiAreaUnit.textContent = units.get(`${state.item}|Area harvested`) || "ha";
    kpiYieldUnit.textContent = units.get(`${state.item}|Yield`) || "kg/ha";

    renderCountryBars(area);
    renderSparklines(area);
    renderCropBreakdown(area);
  }

  function renderCountryBars(area) {
    const w = svgBars.node().clientWidth || 600;
    const h = svgBars.node().clientHeight || 220;
    svgBars.attr("viewBox", `0 0 ${w} ${h}`);
    svgBars.selectAll("*").remove();

    // Calcul du max mondial par indicateur (pays uniquement)
    let gMaxProd = 0, gMaxArea = 0, gMaxYield = 0;
    for (const a of areasSet) {
      if (!isCountryArea(a)) continue;
      const p = byKey.get(key(a, state.item, "Production", state.year));
      const ar = byKey.get(key(a, state.item, "Area harvested", state.year));
      const yl = byKey.get(key(a, state.item, "Yield", state.year));
      if (p != null && !isNaN(p)) gMaxProd = Math.max(gMaxProd, p);
      if (ar != null && !isNaN(ar)) gMaxArea = Math.max(gMaxArea, ar);
      if (yl != null && !isNaN(yl)) gMaxYield = Math.max(gMaxYield, yl);
    }

    const prod = byKey.get(key(area, state.item, "Production", state.year));
    const areaVal = byKey.get(key(area, state.item, "Area harvested", state.year));
    const yldVal = byKey.get(key(area, state.item, "Yield", state.year));

    const indicColors = {
      "Production": "rgba(46,204,113,.8)",
      "Area harvested": "rgba(231,76,60,.8)",
      "Yield": "rgba(66,133,244,.8)",
    };

    // Chaque barre = % du maximum mondial pour cet indicateur
    const rows = [
      {
        k: "Production",
        v: prod,
        pct: gMaxProd > 0 && prod != null ? (prod / gMaxProd) * 100 : 0,
        unit: units.get(`${state.item}|Production`) || "t",
      },
      {
        k: "Area harvested",
        v: areaVal,
        pct: gMaxArea > 0 && areaVal != null ? (areaVal / gMaxArea) * 100 : 0,
        unit: units.get(`${state.item}|Area harvested`) || "ha",
      },
      {
        k: "Yield",
        v: yldVal,
        pct: gMaxYield > 0 && yldVal != null ? (yldVal / gMaxYield) * 100 : 0,
        unit: units.get(`${state.item}|Yield`) || "kg/ha",
      },
    ];

    const margin = { top: 20, right: 20, bottom: 42, left: 120 };
    const innerW = w - margin.left - margin.right;
    const innerH = h - margin.top - margin.bottom;
    const g = svgBars
      .append("g")
      .attr("transform", `translate(${margin.left},${margin.top})`);

    // Échelle commune 0–100 % (comparable entre indicateurs)
    const x = d3.scaleLinear().domain([0, 100]).range([0, innerW]);
    const y = d3
      .scaleBand()
      .domain(rows.map((d) => d.k))
      .range([0, innerH])
      .padding(0.3);

    // Ligne de référence à 100 % (= leader mondial)
    g.append("line")
      .attr("x1", x(100)).attr("x2", x(100))
      .attr("y1", -4).attr("y2", innerH)
      .attr("stroke", "#e2e8f0")
      .attr("stroke-width", 1)
      .attr("stroke-dasharray", "4,3");

    const xAxis = g.append("g")
      .attr("transform", `translate(0,${innerH})`)
      .call(d3.axisBottom(x).ticks(5).tickFormat((d) => d + "%"))
      .call(styleAxis);

    xAxis.append("text")
      .attr("x", innerW / 2)
      .attr("y", 30)
      .attr("fill", "#64748b")
      .attr("text-anchor", "middle")
      .attr("font-size", 11)
      .attr("font-weight", "600")
      .text("% du maximum mondial (100 % = leader mondial)");

    g.append("g").call(d3.axisLeft(y).tickSize(0)).call(styleAxis);

    g.selectAll("rect")
      .data(rows)
      .join("rect")
      .attr("x", 0)
      .attr("y", (d) => y(d.k))
      .attr("height", y.bandwidth())
      .attr("width", (d) => x(Math.max(0, d.pct)))
      .attr("fill", (d) => indicColors[d.k])
      .attr("rx", 6);

    g.selectAll("text.v")
      .data(rows)
      .join("text")
      .attr("class", "v")
      .attr("x", (d) => x(Math.max(0, d.pct)) + 6)
      .attr("y", (d) => y(d.k) + y.bandwidth() / 2 + 4)
      .attr("fill", "#475569")
      .attr("font-size", 10)
      .text((d) =>
        d.v != null
          ? `${formatNumber(d.v)} ${d.unit} (${d.pct.toFixed(1)}%)`
          : "—"
      );
  }

  function renderSparklines(area) {
    const w = svgSparklines.node().clientWidth || 600;
    const h = svgSparklines.node().clientHeight || 320;
    svgSparklines.attr("viewBox", `0 0 ${w} ${h}`);
    svgSparklines.selectAll("*").remove();

    const years = d3.range(+yearSlider.min, +yearSlider.max + 1);

    const seriesList = [
      { name: "Production", element: "Production" },
      { name: "Area harvested", element: "Area harvested" },
      { name: "Yield", element: "Yield" },
    ].map((s) => ({
      ...s,
      values: years
        .map((yr) => ({
          year: yr,
          value: byKey.get(key(area, state.item, s.element, yr)),
        }))
        .filter((d) => d.value != null && !isNaN(d.value)),
    }));

    const margin = { top: 20, right: 16, bottom: 18, left: 70 };
    const innerW = w - margin.left - margin.right;
    const innerH = h - margin.top - margin.bottom;
    const rowH = innerH / seriesList.length;

    const g = svgSparklines
      .append("g")
      .attr("transform", `translate(${margin.left},${margin.top})`);

    for (let i = 0; i < seriesList.length; i++) {
      const s = seriesList[i];
      const y0 = i * rowH;

      // Toujours afficher le label, même sans données
      g.append("text")
        .attr("x", -12)
        .attr("y", y0 + rowH / 2 + 4)
        .attr("text-anchor", "end")
        .attr("fill", "#475569")
        .attr("font-size", 11)
        .attr("font-weight", "600")
        .text(s.name);

      if (s.values.length === 0) {
        g.append("text")
          .attr("x", 0)
          .attr("y", y0 + rowH / 2 + 4)
          .attr("fill", "#94a3b8")
          .attr("font-size", 11)
          .text("— aucune donnée —");
        continue;
      }

      const x = d3
        .scaleLinear()
        .domain(d3.extent(s.values, (d) => d.year))
        .range([0, innerW]);

      const y = d3
        .scaleLinear()
        .domain(d3.extent(s.values, (d) => d.value))
        .nice()
        .range([y0 + rowH - 14, y0 + 6]);

      const line = d3.line().x((d) => x(d.year)).y((d) => y(d.value));

      g.append("path")
        .datum(s.values)
        .attr("fill", "none")
        .attr("stroke", "#2563eb")
        .attr("stroke-width", 2)
        .attr("d", line);

      const cur = s.values.find((d) => d.year === state.year);
      if (cur) {
        g.append("circle")
          .attr("cx", x(cur.year))
          .attr("cy", y(cur.value))
          .attr("r", 3.8)
          .attr("fill", "#0f172a")
          .attr("stroke", "#fff")
          .attr("stroke-width", 1.5);
      }
    }
  }

  function renderCropBreakdown(area) {
    const w = svgCropBars.node().clientWidth || 600;
    const h = svgCropBars.node().clientHeight || 320;
    svgCropBars.attr("viewBox", `0 0 ${w} ${h}`);
    svgCropBars.selectAll("*").remove();

    const items = Array.from(itemsSet).sort(d3.ascending);
    const rows = items
      .map((it) => ({
        item: it,
        value: byKey.get(key(area, it, state.element, state.year)),
      }))
      .filter((d) => d.value != null && !isNaN(d.value));

    rows.sort((a, b) => d3.descending(a.value, b.value));

    if (rows.length === 0) {
      svgCropBars
        .append("text")
        .attr("x", 20)
        .attr("y", 40)
        .attr("fill", "#94a3b8")
        .attr("font-size", 13)
        .text("Aucune donnée de répartition disponible pour cette sélection.");
      return;
    }

    const margin = { top: 18, right: 14, bottom: 45, left: 140 };
    const innerW = w - margin.left - margin.right;
    const innerH = h - margin.top - margin.bottom;

    const g = svgCropBars
      .append("g")
      .attr("transform", `translate(${margin.left},${margin.top})`);

    const x = d3
      .scaleLinear()
      .domain([0, d3.max(rows, (d) => d.value) || 1])
      .range([0, innerW]);

    const y = d3
      .scaleBand()
      .domain(rows.map((d) => d.item))
      .range([0, innerH])
      .padding(0.15);

    g.append("g")
      .attr("transform", `translate(0,${innerH})`)
      .call(d3.axisBottom(x).ticks(4).tickFormat(d3.format("~s")))
      .call(styleAxis);

    g.append("g").call(d3.axisLeft(y).tickSize(0)).call(styleAxis);

    g.selectAll("rect")
      .data(rows)
      .join("rect")
      .attr("x", 0)
      .attr("y", (d) => y(d.item))
      .attr("height", y.bandwidth())
      .attr("width", (d) => x(d.value))
      .attr("fill", "rgba(37,99,235,.55)")
      .attr("rx", 6);
  }

  // =========================
  // STATS PAGE
  // =========================
  const CROP_COLORS_PAL = [
    "#2563eb","#16a34a","#dc2626","#d97706","#7c3aed",
    "#0891b2","#db2777","#ea580c","#65a30d","#0d9488",
  ];
  const CONTINENT_COLORS = {
    "Africa":   "#f59e0b",
    "Americas": "#3b82f6",
    "Asia":     "#ef4444",
    "Europe":   "#8b5cf6",
    "Oceania":  "#10b981",
  };

  function getWorldValue(item, element, year) {
    const worldVal = byKey.get(key("World", item, element, year));
    if (worldVal != null && !isNaN(worldVal) && worldVal > 0) return worldVal;
    let sum = 0, hasData = false;
    for (const area of areasSet) {
      if (!isCountryArea(area)) continue;
      const v = byKey.get(key(area, item, element, year));
      if (v != null && !isNaN(v) && v > 0) { sum += v; hasData = true; }
    }
    return hasData ? sum : null;
  }

  function renderStatsPage() {
    statsMeta.textContent = `${state.item} · ${state.element} · ${state.year}`;
    renderCropDonut();
    renderContinentDonut();
    renderStackedArea();
  }

  function renderCropDonut() {
    if (!svgCropDonut.node()) return;
    svgCropDonut.selectAll("*").remove();

    const items = Array.from(itemsSet).sort(d3.ascending);
    const data = items
      .map((item, i) => ({
        item,
        value: getWorldValue(item, state.element, state.year),
        color: CROP_COLORS_PAL[i % CROP_COLORS_PAL.length],
      }))
      .filter((d) => d.value != null && d.value > 0);

    if (data.length === 0) {
      svgCropDonut.append("text").attr("x", 10).attr("y", 30)
        .attr("fill", "#94a3b8").attr("font-size", 13).text("Aucune donnée.");
      return;
    }

    const total = d3.sum(data, (d) => d.value);
    const unit = units.get(`${state.item}|${state.element}`) || "";
    const w = svgCropDonut.node().clientWidth || 260;
    const h = svgCropDonut.node().clientHeight || 300;
    svgCropDonut.attr("viewBox", `0 0 ${w} ${h}`);

    const radius = Math.min(w, h) / 2 * 0.88;
    const innerRadius = radius * 0.55;
    const cx = w / 2, cy = h / 2;

    const pie = d3.pie().value((d) => d.value).sort(null);
    const arc = d3.arc().innerRadius(innerRadius).outerRadius(radius);
    const arcHov = d3.arc().innerRadius(innerRadius).outerRadius(radius * 1.07);

    const g = svgCropDonut.append("g").attr("transform", `translate(${cx},${cy})`);

    g.selectAll("path")
      .data(pie(data))
      .join("path")
      .attr("d", arc)
      .attr("fill", (d) => d.data.color)
      .attr("stroke", "white")
      .attr("stroke-width", 2)
      .style("cursor", "pointer")
      .on("mousemove", (e, d) => {
        d3.select(e.currentTarget).attr("d", arcHov);
        const pct = ((d.data.value / total) * 100).toFixed(1);
        showTooltip(`<b>${d.data.item}</b><br>${formatNumber(d.data.value)} ${unit}<br>${pct}%`, e.clientX, e.clientY);
      })
      .on("mouseleave", (e) => { d3.select(e.currentTarget).attr("d", arc); hideTooltip(); });

    g.append("text").attr("text-anchor", "middle").attr("y", -8)
      .attr("font-size", 14).attr("font-weight", "700").attr("fill", "#0f172a").text(state.year);
    g.append("text").attr("text-anchor", "middle").attr("y", 10)
      .attr("font-size", 10).attr("fill", "#64748b").text(state.element.slice(0, 12));

    const legendDiv = document.getElementById("cropDonutLegend");
    if (legendDiv) {
      legendDiv.innerHTML = data.map((d) => {
        const pct = ((d.value / total) * 100).toFixed(1);
        return `<div class="donutLegendItem">
          <div class="donutDot" style="background:${d.color}"></div>
          <div class="donutLegendName">${d.item}</div>
          <div class="donutLegendPct">${pct}%</div>
          <div class="donutLegendVal">${formatNumber(d.value)}</div>
        </div>`;
      }).join("");
    }
  }

  function renderContinentDonut() {
    if (!svgContinentDonut.node()) return;
    svgContinentDonut.selectAll("*").remove();

    const continents = ["Africa", "Americas", "Asia", "Europe", "Oceania"];
    const data = continents
      .map((cont) => {
        const v = byKey.get(key(cont, state.item, state.element, state.year));
        return { cont, value: (v != null && !isNaN(v) && v > 0) ? v : null, color: CONTINENT_COLORS[cont] };
      })
      .filter((d) => d.value != null);

    if (data.length === 0) {
      svgContinentDonut.append("text").attr("x", 10).attr("y", 30)
        .attr("fill", "#94a3b8").attr("font-size", 13).text("Aucune donnée.");
      return;
    }

    const total = d3.sum(data, (d) => d.value);
    const unit = units.get(`${state.item}|${state.element}`) || "";
    const w = svgContinentDonut.node().clientWidth || 260;
    const h = svgContinentDonut.node().clientHeight || 300;
    svgContinentDonut.attr("viewBox", `0 0 ${w} ${h}`);

    const radius = Math.min(w, h) / 2 * 0.88;
    const innerRadius = radius * 0.55;
    const cx = w / 2, cy = h / 2;

    const pie = d3.pie().value((d) => d.value).sort(null);
    const arc = d3.arc().innerRadius(innerRadius).outerRadius(radius);
    const arcHov = d3.arc().innerRadius(innerRadius).outerRadius(radius * 1.07);

    const g = svgContinentDonut.append("g").attr("transform", `translate(${cx},${cy})`);

    g.selectAll("path")
      .data(pie(data))
      .join("path")
      .attr("d", arc)
      .attr("fill", (d) => d.data.color)
      .attr("stroke", "white")
      .attr("stroke-width", 2)
      .style("cursor", "pointer")
      .on("mousemove", (e, d) => {
        d3.select(e.currentTarget).attr("d", arcHov);
        const pct = ((d.data.value / total) * 100).toFixed(1);
        showTooltip(`<b>${d.data.cont}</b><br>${formatNumber(d.data.value)} ${unit}<br>${pct}%`, e.clientX, e.clientY);
      })
      .on("mouseleave", (e) => { d3.select(e.currentTarget).attr("d", arc); hideTooltip(); });

    g.append("text").attr("text-anchor", "middle").attr("y", -8)
      .attr("font-size", 14).attr("font-weight", "700").attr("fill", "#0f172a").text(state.year);
    g.append("text").attr("text-anchor", "middle").attr("y", 10)
      .attr("font-size", 10).attr("fill", "#64748b").text("continents");

    const legendDiv = document.getElementById("continentDonutLegend");
    if (legendDiv) {
      legendDiv.innerHTML = data.map((d) => {
        const pct = ((d.value / total) * 100).toFixed(1);
        return `<div class="donutLegendItem">
          <div class="donutDot" style="background:${d.color}"></div>
          <div class="donutLegendName">${d.cont}</div>
          <div class="donutLegendPct">${pct}%</div>
          <div class="donutLegendVal">${formatNumber(d.value)}</div>
        </div>`;
      }).join("");
    }
  }

  function renderStackedArea() {
    if (!svgStackedArea.node()) return;
    svgStackedArea.selectAll("*").remove();

    const w = svgStackedArea.node().clientWidth || 900;
    const h = svgStackedArea.node().clientHeight || 300;
    svgStackedArea.attr("viewBox", `0 0 ${w} ${h}`);

    const items = Array.from(itemsSet).sort(d3.ascending);
    const allYears = d3.range(+yearSlider.min, +yearSlider.max + 1);

    // Compute % share of each item per year (always uses Production for the stack)
    const tableData = allYears.map((yr) => {
      const row = { year: yr };
      let total = 0;
      const vals = {};
      for (const item of items) {
        const v = getWorldValue(item, "Production", yr);
        vals[item] = (v != null && !isNaN(v)) ? v : 0;
        total += vals[item];
      }
      for (const item of items) {
        row[item] = total > 0 ? (vals[item] / total) * 100 : 0;
      }
      return row;
    });

    const margin = { top: 16, right: 20, bottom: 40, left: 52 };
    const innerW = w - margin.left - margin.right;
    const innerH = h - margin.top - margin.bottom;
    const g = svgStackedArea.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

    const x = d3.scaleLinear().domain([+yearSlider.min, +yearSlider.max]).range([0, innerW]);
    const y = d3.scaleLinear().domain([0, 100]).range([innerH, 0]);

    const colorScale = d3.scaleOrdinal().domain(items).range(CROP_COLORS_PAL);
    const stack = d3.stack().keys(items).offset(d3.stackOffsetNone);
    const series = stack(tableData);

    const area = d3.area()
      .x((d) => x(d.data.year))
      .y0((d) => y(d[0]))
      .y1((d) => y(d[1]));

    g.selectAll("path.layer")
      .data(series)
      .join("path")
      .attr("class", "layer")
      .attr("d", area)
      .attr("fill", (d) => colorScale(d.key))
      .attr("opacity", 0.82)
      .on("mousemove", (e, d) => {
        const [mx] = d3.pointer(e);
        const yr = Math.round(x.invert(mx));
        const row = tableData.find((r) => r.year === yr);
        if (!row) return;
        showTooltip(`<b>${d.key}</b><br>${yr} : ${row[d.key].toFixed(1)}%`, e.clientX, e.clientY);
      })
      .on("mouseleave", hideTooltip);

    // Ligne verticale = année sélectionnée dans le dashboard
    g.append("line")
      .attr("x1", x(state.year)).attr("x2", x(state.year))
      .attr("y1", 0).attr("y2", innerH)
      .attr("stroke", "#0f172a").attr("stroke-width", 1.5)
      .attr("stroke-dasharray", "4,3").attr("opacity", 0.5);

    const xAxis = g.append("g")
      .attr("transform", `translate(0,${innerH})`)
      .call(d3.axisBottom(x).ticks(10).tickFormat(d3.format("d")))
      .call(styleAxis);

    xAxis.append("text")
      .attr("x", innerW / 2).attr("y", 32)
      .attr("fill", "#64748b").attr("text-anchor", "middle")
      .attr("font-size", 11).attr("font-weight", "600").text("Année");

    const yAxis = g.append("g")
      .call(d3.axisLeft(y).ticks(5).tickFormat((d) => d + "%"))
      .call(styleAxis);

    yAxis.append("text")
      .attr("x", -innerH / 2).attr("y", -40)
      .attr("transform", "rotate(-90)").attr("text-anchor", "middle")
      .attr("fill", "#64748b").attr("font-size", 11).attr("font-weight", "600")
      .text("Part de la production mondiale (%)");

    // Labels inline sur les zones suffisamment larges
    series.forEach((s) => {
      const midIdx = Math.floor(s.length / 2);
      const d = s[midIdx];
      const bandH = y(d[0]) - y(d[1]);
      if (bandH < 12) return;
      g.append("text")
        .attr("x", x(s[midIdx].data.year))
        .attr("y", (y(d[0]) + y(d[1])) / 2 + 4)
        .attr("text-anchor", "middle")
        .attr("font-size", 10).attr("font-weight", "600")
        .attr("fill", "white").attr("pointer-events", "none")
        .text(truncateLabel(s.key, 10));
    });
  }
});