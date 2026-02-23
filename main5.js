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
    selectedCountry: null,
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

  const pageDashboard = $("#pageDashboard");
  const pageCountry = $("#pageCountry");
  const btnDashboard = $("#btnDashboard");
  const btnCountry = $("#btnCountry");
  const btnBack = $("#btnBack");

  // SVGs
  const svgMap = d3.select("#svgMap");
  const svgTopCountries = d3.select("#svgTopCountries");
  const svgTopContinents = d3.select("#svgTopContinents");
  const svgScatter = d3.select("#svgScatter");
  const svgMiniLine = d3.select("#svgMiniLine");

  const svgBars = d3.select("#svgBars");
  const svgSparklines = d3.select("#svgSparklines");
  const svgCropBars = d3.select("#svgCropBars");

  // Controls
  const selItem = $("#selItem");
  const selElement = $("#selElement");
  const yearSlider = $("#yearSlider");
  const lblYear = $("#lblYear");
  const selScale = $("#selScale");
  const topNSlider = $("#topNSlider");
  const lblTopN = $("#lblTopN");

  const btnPlay = $("#btnPlay");
  const btnReset = $("#btnReset");

  // Detail page labels
  const countryName = $("#countryName");
  const countryMeta = $("#countryMeta");
  const miniTitle = $("#miniTitle");
  const kpiProd = $("#kpiProd");
  const kpiArea = $("#kpiArea");
  const kpiYield = $("#kpiYield");
  const kpiProdUnit = $("#kpiProdUnit");
  const kpiAreaUnit = $("#kpiAreaUnit");
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
    const isDash = to === "dashboard";
    pageDashboard.classList.toggle("hidden", !isDash);
    pageCountry.classList.toggle("hidden", isDash);
    btnDashboard.classList.toggle("active", isDash);
    btnCountry.classList.toggle("active", !isDash);
  }

  function isLikelyAggregate(areaName) {
    const bad = [
      "World",
      "Europe",
      "Asia",
      "Americas",
      "Africa",
      "Oceania",
      "European Union",
      "SIDS",
      "Developing",
      "Least Developed",
      "Land Locked",
    ];
    return bad.some((s) => areaName.includes(s));
  }

  function isCountryArea(areaName) {
    const m49 = m49ByArea.get(areaName);
    if (m49 && countryM49Set.has(m49)) return true;
    return !isLikelyAggregate(areaName);
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

      btnDashboard.addEventListener("click", () => navigate("dashboard"));
      btnCountry.addEventListener("click", () => navigate("country"));
      btnBack.addEventListener("click", () => navigate("dashboard"));
    })
    .catch((err) => {
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
      .attr("fill", "rgba(20,28,44,.35)")
      .attr("stroke", "rgba(255,255,255,.06)");

    mapCountries = mapG
      .append("g")
      .selectAll("path.country")
      .data(countries)
      .join("path")
      .attr("class", "country")
      .attr("d", path)
      .attr("fill", "rgba(255,255,255,.06)")
      .attr("stroke", "rgba(255,255,255,.05)")
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
        .attr("stroke", (feature) =>
          areaFromFeature(feature) === state.selectedCountry
            ? "rgba(232,238,252,.95)"
            : "rgba(255,255,255,.08)"
        )
        .attr("stroke-width", (feature) =>
          areaFromFeature(feature) === state.selectedCountry ? 1.6 : 0.8
        );
    }

    const unit = units.get(`${state.item}|${state.element}`) || "";
    d3.select("#mapLegend").html(`
      <span>Min: ${formatNumber(min)} ${unit}</span>
      <span>Max: ${formatNumber(max)} ${unit}</span>
    `);
  }

  function buildColorScale(min, max) {
    const interp = d3.interpolateViridis;
    if (state.scaleMode === "log") {
      const minPos = Math.max(1e-9, min <= 0 ? 1e-9 : min);
      const maxPos = Math.max(minPos * 10, max);
      const s = d3
        .scaleSequential(interp)
        .domain([Math.log10(minPos), Math.log10(maxPos)]);
      return (v) => {
        if (v == null || isNaN(v) || v <= 0) return "rgba(255,255,255,.05)";
        return s(Math.log10(v));
      };
    } else {
      const s = d3.scaleSequential(interp).domain([min, max]);
      return (v) =>
        v == null || isNaN(v) ? "rgba(255,255,255,.05)" : s(v);
    }
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
      .filter((d) => !isCountryArea(d.area))
      .sort((a, b) => d3.descending(a.value, b.value))
      .slice(0, state.topN);

    renderTopChart(svgTopCountries, countryRows, unit, true, "Aucune donnée pays.");
    renderTopChart(
      svgTopContinents,
      continentRows,
      unit,
      false,
      "Aucune donnée continent/région."
    );
  }

  function renderTopChart(svg, rows, unit, clickable, emptyLabel) {
    if (!svg.node()) return;

    const w = svg.node().clientWidth || 420;
    const h = svg.node().clientHeight || 180;
    svg.attr("viewBox", `0 0 ${w} ${h}`);
    svg.selectAll("*").remove();

    if (rows.length === 0) {
      svg
        .append("text")
        .attr("x", 12)
        .attr("y", 20)
        .attr("fill", "rgba(232,238,252,.75)")
        .attr("font-size", 12)
        .text(emptyLabel);
      return;
    }

    const margin = { top: 8, right: 20, bottom: 26, left: 140 };
    const innerW = w - margin.left - margin.right;
    const innerH = h - margin.top - margin.bottom;

    const g = svg
      .append("g")
      .attr("transform", `translate(${margin.left},${margin.top})`);

    const x = d3
      .scaleLinear()
      .domain([0, d3.max(rows, (d) => d.value) || 1])
      .range([0, innerW]);

    const y = d3
      .scaleBand()
      .domain(rows.map((d) => d.area))
      .range([0, innerH])
      .padding(0.15);

    g.append("g")
      .attr("transform", `translate(0,${innerH})`)
      .call(d3.axisBottom(x).ticks(4).tickFormat(d3.format("~s")))
      .call(styleAxis);

    g.append("g").call(d3.axisLeft(y).tickSize(0)).call(styleAxis);

    g.selectAll("rect")
      .data(rows, (d) => d.area)
      .join("rect")
      .attr("x", 0)
      .attr("y", (d) => y(d.area))
      .attr("height", y.bandwidth())
      .attr("width", (d) => x(d.value))
      .attr("fill", "rgba(91,124,250,.75)")
      .attr("rx", 6)
      .style("cursor", clickable ? "pointer" : "default")
      .on("mousemove", (e, d) => {
        showTooltip(`<b>${d.area}</b><br>${formatNumber(d.value)} ${unit}`, e.clientX, e.clientY);
      })
      .on("mouseleave", hideTooltip)
      .on("click", (_, d) => {
        if (clickable) selectCountry(d.area);
      });

    g.selectAll(".labelValue")
      .data(rows)
      .join("text")
      .attr("class", "labelValue")
      .attr("x", (d) => x(d.value) + 6)
      .attr("y", (d) => y(d.area) + y.bandwidth() / 2 + 4)
      .attr("fill", "rgba(232,238,252,.85)")
      .attr("font-size", 11)
      .text((d) => d3.format("~s")(d.value));
  }

  function styleAxis(g) {
    g.selectAll("path,line").attr("stroke", "rgba(255,255,255,.10)");
    g.selectAll("text").attr("fill", "rgba(232,238,252,.75)").attr("font-size", 11);
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
        .attr("fill", "rgba(232,238,252,.75)")
        .attr("font-size", 12)
        .text("Pas assez de données (Production + Surface + Rendement) pour cette culture/année.");
      return;
    }

    const margin = { top: 10, right: 20, bottom: 45, left: 60 };
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

    g.append("g")
      .attr("transform", `translate(0,${innerH})`)
      .call(d3.axisBottom(x).ticks(5, "~s"))
      .call(styleAxis);

    g.append("g").call(d3.axisLeft(y).ticks(5, "~s")).call(styleAxis);

    g.append("text")
      .attr("x", innerW / 2)
      .attr("y", innerH + 38)
      .attr("text-anchor", "middle")
      .attr("fill", "rgba(232,238,252,.7)")
      .attr("font-size", 12)
      .text("Area harvested (ha) [log]");

    g.append("text")
      .attr("x", -innerH / 2)
      .attr("y", -42)
      .attr("transform", "rotate(-90)")
      .attr("text-anchor", "middle")
      .attr("fill", "rgba(232,238,252,.7)")
      .attr("font-size", 12)
      .text("Yield (kg/ha) [log]");

    g.selectAll("circle")
      .data(rows)
      .join("circle")
      .attr("cx", (d) => x(d.areaHarvested))
      .attr("cy", (d) => y(d.yield))
      .attr("r", (d) => r(d.production))
      .attr("fill", "rgba(91,124,250,.55)")
      .attr("stroke", "rgba(255,255,255,.18)")
      .attr("stroke-width", 1)
      .on("mousemove", (e, d) => {
        showTooltip(
          `<b>${d.area}</b><br>
           Surface: ${formatNumber(d.areaHarvested)} ha<br>
           Rendement: ${formatNumber(d.yield)} kg/ha<br>
           Production: ${formatNumber(d.production)} t`,
          e.clientX,
          e.clientY
        );
      })
      .on("mouseleave", hideTooltip)
      .on("click", (_, d) => selectCountry(d.area));
  }

  // =========================
  // MINI LINE
  // =========================
  function renderMiniLine() {
    const area = state.selectedCountry;
    const w = svgMiniLine.node().clientWidth || 420;
    const h = svgMiniLine.node().clientHeight || 280;
    svgMiniLine.attr("viewBox", `0 0 ${w} ${h}`);
    svgMiniLine.selectAll("*").remove();

    if (!area) {
      miniTitle.textContent = "Aucun pays sélectionné";
      return;
    }

    miniTitle.textContent = area;

    const years = d3.range(+yearSlider.min, +yearSlider.max + 1);
    const series = years
      .map((yr) => ({
        year: yr,
        value: byKey.get(key(area, state.item, state.element, yr)),
      }))
      .filter((d) => d.value != null && !isNaN(d.value));

    const margin = { top: 12, right: 14, bottom: 28, left: 42 };
    const innerW = w - margin.left - margin.right;
    const innerH = h - margin.top - margin.bottom;

    const g = svgMiniLine
      .append("g")
      .attr("transform", `translate(${margin.left},${margin.top})`);

    const x = d3
      .scaleLinear()
      .domain(d3.extent(series, (d) => d.year))
      .range([0, innerW]);

    const y = d3
      .scaleLinear()
      .domain(d3.extent(series, (d) => d.value))
      .nice()
      .range([innerH, 0]);

    const line = d3
      .line()
      .x((d) => x(d.year))
      .y((d) => y(d.value));

    g.append("path")
      .datum(series)
      .attr("fill", "none")
      .attr("stroke", "rgba(91,124,250,.95)")
      .attr("stroke-width", 2)
      .attr("d", line);

    g.append("g")
      .attr("transform", `translate(0,${innerH})`)
      .call(d3.axisBottom(x).ticks(5).tickFormat(d3.format("d")))
      .call(styleAxis);

    g.append("g")
      .call(d3.axisLeft(y).ticks(4).tickFormat(d3.format("~s")))
      .call(styleAxis);

    const cur = series.find((d) => d.year === state.year);
    if (cur) {
      g.append("circle")
        .attr("cx", x(cur.year))
        .attr("cy", y(cur.value))
        .attr("r", 4.5)
        .attr("fill", "rgba(232,238,252,.95)");
    }
  }

  // =========================
  // COUNTRY PAGE
  // =========================
  function selectCountry(area) {
    state.selectedCountry = area;
    navigate("country");
    renderAll();
  }

  function renderCountryPage() {
    const area = state.selectedCountry;
    if (!area) {
      countryName.textContent = "Aucun pays sélectionné";
      countryMeta.textContent = "Clique un pays sur le Dashboard.";
      return;
    }

    countryName.textContent = area;
    countryMeta.textContent = `${state.item} • ${state.year}`;

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
    const h = svgBars.node().clientHeight || 320;
    svgBars.attr("viewBox", `0 0 ${w} ${h}`);
    svgBars.selectAll("*").remove();

    const rows = [
      {
        k: "Production",
        v: byKey.get(key(area, state.item, "Production", state.year)) || 0,
        unit: units.get(`${state.item}|Production`) || "t",
      },
      {
        k: "Area harvested",
        v: byKey.get(key(area, state.item, "Area harvested", state.year)) || 0,
        unit: units.get(`${state.item}|Area harvested`) || "ha",
      },
      {
        k: "Yield",
        v: byKey.get(key(area, state.item, "Yield", state.year)) || 0,
        unit: units.get(`${state.item}|Yield`) || "kg/ha",
      },
    ];

    const margin = { top: 20, right: 20, bottom: 35, left: 120 };
    const innerW = w - margin.left - margin.right;
    const innerH = h - margin.top - margin.bottom;
    const g = svgBars
      .append("g")
      .attr("transform", `translate(${margin.left},${margin.top})`);

    const maxV = d3.max(rows, (d) => d.v) || 1;
    const x = d3.scaleLinear().domain([0, maxV]).range([0, innerW]);
    const y = d3
      .scaleBand()
      .domain(rows.map((d) => d.k))
      .range([0, innerH])
      .padding(0.25);

    g.append("g")
      .attr("transform", `translate(0,${innerH})`)
      .call(d3.axisBottom(x).ticks(4).tickFormat(d3.format("~s")))
      .call(styleAxis);

    g.append("g").call(d3.axisLeft(y).tickSize(0)).call(styleAxis);

    g.selectAll("rect")
      .data(rows)
      .join("rect")
      .attr("x", 0)
      .attr("y", (d) => y(d.k))
      .attr("height", y.bandwidth())
      .attr("width", (d) => x(d.v))
      .attr("fill", "rgba(91,124,250,.75)")
      .attr("rx", 6);

    g.selectAll("text.v")
      .data(rows)
      .join("text")
      .attr("class", "v")
      .attr("x", (d) => x(d.v) + 8)
      .attr("y", (d) => y(d.k) + y.bandwidth() / 2 + 4)
      .attr("fill", "rgba(232,238,252,.85)")
      .attr("font-size", 11)
      .text((d) => `${formatNumber(d.v)} ${d.unit}`);
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

      g.append("text")
        .attr("x", -12)
        .attr("y", y0 + rowH / 2 + 4)
        .attr("text-anchor", "end")
        .attr("fill", "rgba(232,238,252,.78)")
        .attr("font-size", 12)
        .text(s.name);

      g.append("path")
        .datum(s.values)
        .attr("fill", "none")
        .attr("stroke", "rgba(91,124,250,.95)")
        .attr("stroke-width", 2)
        .attr("d", line);

      const cur = s.values.find((d) => d.year === state.year);
      if (cur) {
        g.append("circle")
          .attr("cx", x(cur.year))
          .attr("cy", y(cur.value))
          .attr("r", 3.8)
          .attr("fill", "rgba(232,238,252,.95)");
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
      .attr("fill", "rgba(91,124,250,.55)")
      .attr("rx", 6);
  }
});