(() => {
  "use strict";

  const GOODS = [
    { name: "Food", base: 10 },
    { name: "Ore", base: 25 },
    { name: "Electronics", base: 80 },
    { name: "Medicine", base: 50 },
    { name: "Fuel", base: 8 },
  ];

  const ECONOMIES = {
    Agricultural: { Food: 0.6, Ore: 1.2, Electronics: 1.4, Medicine: 1.1, Fuel: 1.0 },
    Industrial: { Food: 1.3, Ore: 0.9, Electronics: 0.7, Medicine: 1.1, Fuel: 1.0 },
    Mining: { Food: 1.2, Ore: 0.6, Electronics: 1.2, Medicine: 1.0, Fuel: 1.0 },
    HighTech: { Food: 1.1, Ore: 1.3, Electronics: 0.6, Medicine: 0.8, Fuel: 1.0 },
  };

  const NAME_WORDS = ["Nova", "Atlas", "Orion", "Helios", "Draco", "Zenith", "Kepler", "Vega", "Titan", "Eclipse"];

  const TRAVEL_COST = 100;
  const START_CREDITS = 5000;
  const START_CAPACITY = 20;
  const WIN_CREDITS = 100000;
  const START_STARDATE = 7421.0; // shared start date for all runs

  const STORAGE_KEY = "frontier_fortune_v2";

  const GALAXY_SEED = 424242;
  const PLANET_COUNT = 50;
  const CLUSTER_COUNT = 5;
  const MAP_SIZE = 100;
  const CLUSTER_RADIUS = 14;
  const ROUTE_TARGET_K = 3; // aims for ~2-4 choices after symmetry + pruning
  const ROUTE_MIN_DEGREE = 2;
  const ROUTE_MAX_DEGREE = 4;
  const TRAVEL_SPEED = 20; // larger => fewer time increments per unit distance

  const $ = (id) => document.getElementById(id);
  const statusEl = $("status");
  const screenTitleEl = $("screenTitle");
  const screenEl = $("screen");
  const msgEl = $("message");
  const btnBack = $("btnBack");
  const btnReset = $("btnReset");

  const confirmDialog = $("confirmDialog");
  const confirmTitleEl = $("confirmTitle");
  const confirmTextEl = $("confirmText");

  const fmt = (n) => (n || 0).toLocaleString("en-US");

  const randInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
  const randChoice = (arr) => arr[randInt(0, arr.length - 1)];
  const randFloat = (min, max) => Math.random() * (max - min) + min;

  function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function seededInt(rng, min, max) {
    return Math.floor(rng() * (max - min + 1)) + min;
  }

  function clamp(n, min, max) {
    n = Number.isFinite(n) ? n : min;
    return Math.max(min, Math.min(max, n));
  }

  function dist(a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return Math.hypot(dx, dy);
  }

  function routeTime(distance) {
    return Math.max(1, Math.ceil(distance / TRAVEL_SPEED));
  }

  function formatStardate(travelJumps) {
    const n = START_STARDATE + (Number.isFinite(travelJumps) ? travelJumps : 0);
    return `Stardate ${n.toFixed(1)}`;
  }

  class Planet {
    constructor(name, economy, x, y) {
      this.name = name;
      this.economy = economy;
      this.x = x;
      this.y = y;
      this.market = {};
      this.regenerateMarket();
    }

    regenerateMarket() {
      const mods = ECONOMIES[this.economy];
      const market = {};
      for (const g of GOODS) {
        const swing = randFloat(0.9, 1.1);
        const price = Math.round(g.base * mods[g.name] * swing);
        market[g.name] = Math.max(1, price);
      }
      this.market = market;
    }
  }

  class Player {
    constructor() {
      this.credits = START_CREDITS;
      this.capacity = START_CAPACITY;
      this.cargo = {};
      for (const g of GOODS) this.cargo[g.name] = 0;
    }

    cargoUsed() {
      let sum = 0;
      for (const g of GOODS) sum += this.cargo[g.name] || 0;
      return sum;
    }

    cargoFree() {
      return this.capacity - this.cargoUsed();
    }

    buy(good, qty, price) {
      if (!Number.isFinite(qty) || qty <= 0) return { ok: false, msg: "Quantity must be at least 1." };
      if (qty > this.cargoFree()) return { ok: false, msg: "Not enough cargo space." };
      const cost = qty * price;
      if (cost > this.credits) return { ok: false, msg: "Not enough credits." };
      this.credits -= cost;
      this.cargo[good] += qty;
      return { ok: true, msg: `Bought ${qty} ${good} for ${fmt(cost)} credits.` };
    }

    sell(good, qty, price) {
      if (!Number.isFinite(qty) || qty <= 0) return { ok: false, msg: "Quantity must be at least 1." };
      if (qty > (this.cargo[good] || 0)) return { ok: false, msg: "You don't have that many units." };
      const revenue = qty * price;
      this.cargo[good] -= qty;
      this.credits += revenue;
      return { ok: true, msg: `Sold ${qty} ${good} for ${fmt(revenue)} credits.` };
    }
  }

  class Universe {
    constructor() {
      const rng = mulberry32(GALAXY_SEED);
      this.planets = this.generateGalaxyPlanets(rng, PLANET_COUNT);
      this.routes = this.generateRoutes(this.planets);
    }

    regenerateRoutes() {
      this.routes = this.generateRoutes(this.planets);
    }

    generateGalaxyPlanets(rng, count) {
      const economyNames = Object.keys(ECONOMIES);
      const clusterCenters = Array.from({ length: CLUSTER_COUNT }, () => ({
        x: rng() * MAP_SIZE,
        y: rng() * MAP_SIZE,
      }));

      const planets = [];
      for (let i = 0; i < count; i++) {
        const c = clusterCenters[i % CLUSTER_COUNT];
        const angle = rng() * Math.PI * 2;
        const radius = Math.sqrt(rng()) * CLUSTER_RADIUS;
        const x = clamp(c.x + Math.cos(angle) * radius, 0, MAP_SIZE);
        const y = clamp(c.y + Math.sin(angle) * radius, 0, MAP_SIZE);

        const w1 = NAME_WORDS[seededInt(rng, 0, NAME_WORDS.length - 1)];
        const w2 = NAME_WORDS[seededInt(rng, 0, NAME_WORDS.length - 1)];
        const style = seededInt(rng, 1, 3);
        const name =
          style === 1 ? `${w1} ${w2}` : style === 2 ? `${w1}-${100 + i}` : `${w1} ${100 + i}`;

        const economy = economyNames[seededInt(rng, 0, economyNames.length - 1)];
        planets.push(new Planet(name, economy, x, y));
      }
      return planets;
    }

    generateRoutes(planets) {
      const n = planets.length;
      const neighbors = Array.from({ length: n }, () => new Map()); // to -> {distance, time}

      function addEdge(a, b) {
        if (a === b) return;
        const d = dist(planets[a], planets[b]);
        const t = routeTime(d);
        neighbors[a].set(b, { distance: d, time: t });
        neighbors[b].set(a, { distance: d, time: t });
      }

      // k-nearest neighbors
      for (let i = 0; i < n; i++) {
        const ds = [];
        for (let j = 0; j < n; j++) {
          if (i === j) continue;
          ds.push({ j, d: dist(planets[i], planets[j]) });
        }
        ds.sort((a, b) => a.d - b.d);
        for (const { j } of ds.slice(0, ROUTE_TARGET_K)) addEdge(i, j);
      }

      const degree = () => neighbors.map((m) => m.size);

      function pruneToMaxDegree() {
        let changed = true;
        while (changed) {
          changed = false;
          for (let i = 0; i < n; i++) {
            while (neighbors[i].size > ROUTE_MAX_DEGREE) {
              let worst = null;
              for (const [to, info] of neighbors[i].entries()) {
                if (!worst || info.distance > worst.info.distance) worst = { to, info };
              }
              if (!worst) break;
              neighbors[i].delete(worst.to);
              neighbors[worst.to].delete(i);
              changed = true;
            }
          }
        }
      }

      function ensureMinDegree() {
        const deg = degree();
        for (let i = 0; i < n; i++) {
          if (deg[i] >= ROUTE_MIN_DEGREE) continue;
          const candidates = [];
          for (let j = 0; j < n; j++) {
            if (i === j) continue;
            if (neighbors[i].has(j)) continue;
            if (neighbors[j].size >= ROUTE_MAX_DEGREE) continue;
            candidates.push({ j, d: dist(planets[i], planets[j]) });
          }
          candidates.sort((a, b) => a.d - b.d);
          for (const { j } of candidates) {
            if (neighbors[i].size >= ROUTE_MIN_DEGREE) break;
            if (neighbors[j].size >= ROUTE_MAX_DEGREE) continue;
            addEdge(i, j);
          }
        }
      }

      function components() {
        const seen = new Array(n).fill(false);
        const comps = [];
        for (let i = 0; i < n; i++) {
          if (seen[i]) continue;
          const stack = [i];
          seen[i] = true;
          const comp = [];
          while (stack.length) {
            const cur = stack.pop();
            comp.push(cur);
            for (const to of neighbors[cur].keys()) {
              if (!seen[to]) {
                seen[to] = true;
                stack.push(to);
              }
            }
          }
          comps.push(comp);
        }
        return comps;
      }

      function ensureConnected() {
        pruneToMaxDegree();
        ensureMinDegree();
        let comps = components();
        while (comps.length > 1) {
          let best = null;
          const a = comps[0];
          for (let ci = 1; ci < comps.length; ci++) {
            const b = comps[ci];
            for (const i of a) {
              if (neighbors[i].size >= ROUTE_MAX_DEGREE) continue;
              for (const j of b) {
                if (neighbors[j].size >= ROUTE_MAX_DEGREE) continue;
                const d = dist(planets[i], planets[j]);
                if (!best || d < best.d) best = { i, j, d };
              }
            }
          }
          if (!best) {
            // As a last resort, allow exceeding max degree to connect the graph.
            const b = comps[1];
            let fallback = null;
            for (const i of a) {
              for (const j of b) {
                const d = dist(planets[i], planets[j]);
                if (!fallback || d < fallback.d) fallback = { i, j, d };
              }
            }
            if (fallback) addEdge(fallback.i, fallback.j);
            else break;
          } else {
            addEdge(best.i, best.j);
          }
          pruneToMaxDegree();
          ensureMinDegree();
          comps = components();
        }
      }

      ensureConnected();

      return neighbors.map((m) =>
        Array.from(m.entries())
          .map(([to, info]) => ({ to, distance: info.distance, time: info.time }))
          .sort((a, b) => a.distance - b.distance)
      );
    }
  }

  class Game {
    constructor() {
      this.universe = new Universe();
      this.player = new Player();
      this.currentIdx = 0;
      this.travelJumps = 0;
      this.knownPlanets = new Set([this.currentIdx]);
      this.scanCurrentPlanet();
      this.screen = { name: "menu" }; // {name, ...data}
      this.message = { kind: "muted", text: "" };
      this.persistEnabled = true;
    }

    get planet() {
      return this.universe.planets[this.currentIdx];
    }

    scanCurrentPlanet() {
      const routes = this.universe.routes?.[this.currentIdx] || [];
      for (const r of routes) this.knownPlanets.add(r.to);
    }

    toJSON() {
      return {
        v: 2,
        travelJumps: this.travelJumps,
        knownPlanets: Array.from(this.knownPlanets),
        player: { credits: this.player.credits, capacity: this.player.capacity, cargo: this.player.cargo },
        currentIdx: this.currentIdx,
        planets: this.universe.planets.map((p) => ({
          name: p.name,
          economy: p.economy,
          x: p.x,
          y: p.y,
          market: p.market,
        })),
      };
    }

    static fromJSON(data) {
      if (!data || data.v !== 2) return null;
      const g = new Game();
      g.universe.planets = (data.planets || []).map((p) => {
        const pl = new Planet(p.name, p.economy, Number(p.x ?? 0), Number(p.y ?? 0));
        if (p.market && typeof p.market === "object") pl.market = p.market;
        return pl;
      });
      g.universe.regenerateRoutes();
      g.currentIdx = clampInt(data.currentIdx ?? 0, 0, g.universe.planets.length - 1);
      g.travelJumps = clampInt(data.travelJumps ?? 0, 0, 1_000_000_000);
      g.knownPlanets = new Set((data.knownPlanets || []).map((n) => clampInt(n, 0, g.universe.planets.length - 1)));
      g.knownPlanets.add(g.currentIdx);
      g.scanCurrentPlanet();
      g.player.credits = Number(data.player?.credits ?? START_CREDITS);
      g.player.capacity = Number(data.player?.capacity ?? START_CAPACITY);
      const cargo = data.player?.cargo || {};
      for (const good of GOODS) g.player.cargo[good.name] = Number(cargo[good.name] ?? 0);
      g.screen = { name: "menu" };
      g.message = { kind: "muted", text: "Loaded saved game." };
      return g;
    }
  }

  function clampInt(n, min, max) {
    n = Number.isFinite(n) ? Math.trunc(n) : min;
    return Math.max(min, Math.min(max, n));
  }

  function setMessage(kind, text) {
    msgEl.className = "message";
    if (kind === "good") msgEl.classList.add("good");
    else if (kind === "bad") msgEl.classList.add("bad");
    msgEl.textContent = text || "";
  }

  function setBackVisible(visible) {
    btnBack.hidden = !visible;
  }

  function saveGame(game) {
    if (!game.persistEnabled) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(game.toJSON()));
    } catch {
      /* ignore */
    }
  }

  function loadGame() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      return Game.fromJSON(data);
    } catch {
      return null;
    }
  }

  async function confirmAction(title, text) {
    if (!confirmDialog || typeof confirmDialog.showModal !== "function") {
      return window.confirm(`${title}\n\n${text}`);
    }
    confirmTitleEl.textContent = title;
    confirmTextEl.textContent = text;
    confirmDialog.showModal();
    const result = await new Promise((resolve) => {
      confirmDialog.addEventListener(
        "close",
        () => {
          resolve(confirmDialog.returnValue === "ok");
        },
        { once: true }
      );
    });
    return result;
  }

  function renderStatus(game) {
    const p = game.planet;
    const pl = game.player;
    statusEl.innerHTML = `
      <div><b>Planet</b> ${escapeHtml(p.name)}</div>
      <div><b>Economy</b> ${escapeHtml(p.economy)}</div>
      <div><b>Time</b> ${escapeHtml(formatStardate(game.travelJumps))}</div>
      <div><b>Credits</b> ${fmt(pl.credits)}</div>
      <div><b>Cargo</b> ${pl.cargoUsed()} / ${pl.capacity}</div>
    `;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function renderMenu(game) {
    screenTitleEl.textContent = "Main Menu";
    setBackVisible(false);
    const p = game.planet;
    const pl = game.player;
    screenEl.innerHTML = `
      <div class="form">
        <div style="font-weight:800; margin-bottom:6px">Current status</div>
        <div class="statusOverviewLine"><b>Planet</b> ${escapeHtml(p.name)}</div>
        <div class="statusOverviewLine"><b>Economy</b> ${escapeHtml(p.economy)}</div>
        <div class="statusOverviewLine"><b>Time</b> ${escapeHtml(formatStardate(game.travelJumps))}</div>
        <div class="statusOverviewLine"><b>Credits</b> ${fmt(pl.credits)}</div>
        <div class="statusOverviewLine"><b>Cargo</b> ${pl.cargoUsed()} / ${pl.capacity}</div>
      </div>
      <div class="grid menu" style="margin-top:12px">
        <button class="btn" data-go="market" type="button">Trade at Market</button>
        <button class="btn" data-go="travel" type="button">Travel</button>
        <button class="btn warn" data-go="about" type="button">Help / Rules</button>
      </div>
    `;
    screenEl.querySelectorAll("[data-go]").forEach((b) => {
      b.addEventListener("click", () => {
        const to = b.getAttribute("data-go");
        navigate(game, to);
      });
    });
  }

  function renderMarket(game) {
    screenTitleEl.textContent = "Market";
    setBackVisible(true);
    const p = game.planet;
    const pl = game.player;
    const rows = GOODS.map((g) => {
      const price = p.market[g.name];
      const owned = pl.cargo[g.name] || 0;
      return `<tr>
        <td>
          <div class="goodMain">${escapeHtml(g.name)}</div>
          <div class="marketActions">
            <input class="marketQty" inputmode="numeric" pattern="[0-9]*" placeholder="Qty" />
            <button class="btn sm" data-action="buy" type="button">Buy</button>
            <button class="btn sm ghost" data-action="sell" type="button">Sell</button>
          </div>
        </td>
        <td class="num">${fmt(price)}</td>
        <td class="num">${fmt(owned)}</td>
      </tr>`;
    }).join("");

    screenEl.innerHTML = `
      <div class="form">
        <div style="font-weight:800; margin-bottom:6px">Market overview</div>
        <div class="statusOverviewLine"><b>Credits</b> ${fmt(pl.credits)}</div>
        <div class="statusOverviewLine"><b>Cargo</b> ${pl.cargoUsed()} / ${pl.capacity}</div>
        <div class="statusOverviewLine" style="margin-top:8px">
          <button class="btn sm ghost" data-go="cargo" type="button">View cargo details</button>
        </div>
      </div>
      <div class="tableWrap" style="margin-top:12px">
        <table>
          <thead><tr><th>Good</th><th class="num">Price</th><th class="num">Owned</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;

    screenEl.querySelectorAll("tbody tr").forEach((row, idx) => {
      const good = GOODS[idx].name;
      const qtyInput = row.querySelector(".marketQty");
      const buyBtn = row.querySelector('[data-action="buy"]');
      const sellBtn = row.querySelector('[data-action="sell"]');

      function getQty(defaultMax) {
        const raw = parseInt(qtyInput.value, 10);
        if (!Number.isFinite(raw) || raw <= 0) return 0;
        return clampInt(raw, 1, defaultMax);
      }

      if (buyBtn) {
        buyBtn.addEventListener("click", () => {
          const price = p.market[good];
          const maxBySpace = pl.cargoFree();
          const maxByMoney = Math.floor(pl.credits / price);
          const maxQty = Math.max(0, Math.min(maxBySpace, maxByMoney));
          if (!maxQty) {
            setMessage("bad", "You can't afford any or you have no cargo space.");
            return;
          }
          const qty = getQty(maxQty);
          if (!qty || qty > maxQty) {
            setMessage("bad", `Enter a quantity from 1 to ${maxQty}.`);
            return;
          }
          const res = pl.buy(good, qty, price);
          setMessage(res.ok ? "good" : "bad", res.msg);
          saveGame(game);
          renderStatus(game);
          renderMarket(game);
          checkEndState(game);
        });
      }

      if (sellBtn) {
        sellBtn.addEventListener("click", () => {
          const owned = pl.cargo[good] || 0;
          const price = p.market[good];
          if (!owned) {
            setMessage("bad", `You don't have any ${good} to sell.`);
            return;
          }
          const qty = getQty(owned);
          if (!qty || qty > owned) {
            setMessage("bad", `Enter a quantity from 1 to ${owned}.`);
            return;
          }
          const res = pl.sell(good, qty, price);
          setMessage(res.ok ? "good" : "bad", res.msg);
          saveGame(game);
          renderStatus(game);
          renderMarket(game);
          checkEndState(game);
        });
      }
    });

    const cargoBtn = screenEl.querySelector('[data-go="cargo"]');
    if (cargoBtn) {
      cargoBtn.addEventListener("click", () => navigate(game, "cargo"));
    }
  }

  function renderCargo(game) {
    screenTitleEl.textContent = "Cargo Hold";
    setBackVisible(true);
    const pl = game.player;
    const rows = GOODS.map((g) => `<tr><td>${escapeHtml(g.name)}</td><td class="num">${fmt(pl.cargo[g.name] || 0)}</td></tr>`).join("");
    screenEl.innerHTML = `
      <div class="row">
        <div class="pill">Used: ${pl.cargoUsed()} / ${pl.capacity}</div>
        <div class="pill">Free: ${pl.cargoFree()}</div>
      </div>
      <div class="tableWrap" style="margin-top:12px">
        <table>
          <thead><tr><th>Good</th><th class="num">Quantity</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;
  }

  function renderBuy(game) {
    screenTitleEl.textContent = "Buy Goods";
    setBackVisible(true);
    const p = game.planet;
    const pl = game.player;
    const options = GOODS.map((g) => {
      const price = p.market[g.name];
      return `<option value="${escapeHtml(g.name)}">${escapeHtml(g.name)} — ${fmt(price)} cr</option>`;
    }).join("");

    screenEl.innerHTML = `
      <div class="row">
        <div class="pill">Credits: ${fmt(pl.credits)}</div>
        <div class="pill">Free space: ${pl.cargoFree()}</div>
      </div>
      <div class="form" style="margin-top:12px">
        <label for="buyGood">Good</label>
        <select id="buyGood">${options}</select>
        <div style="height:10px"></div>
        <label for="buyQty">Quantity</label>
        <input id="buyQty" inputmode="numeric" pattern="[0-9]*" placeholder="e.g. 5" />
        <div class="help" id="buyHelp"></div>
        <div class="actions">
          <button class="btn" id="buyBtn" type="button">Buy</button>
        </div>
      </div>
    `;

    const goodSel = $("buyGood");
    const qtyInput = $("buyQty");
    const helpEl = $("buyHelp");
    const buyBtn = $("buyBtn");

    function updateHelp() {
      const good = goodSel.value;
      const price = p.market[good];
      const maxBySpace = pl.cargoFree();
      const maxByMoney = Math.floor(pl.credits / price);
      const maxQty = Math.max(0, Math.min(maxBySpace, maxByMoney));
      helpEl.textContent = `Price: ${fmt(price)} | Max you can buy: ${maxQty}`;
      return { good, price, maxQty };
    }

    goodSel.addEventListener("change", updateHelp);
    updateHelp();

    buyBtn.addEventListener("click", () => {
      const { good, price, maxQty } = updateHelp();
      const qty = clampInt(parseInt(qtyInput.value, 10), 1, maxQty);
      if (!maxQty) {
        setMessage("bad", "You can't afford any or you have no cargo space.");
        return;
      }
      if (!Number.isFinite(qty) || qty <= 0 || qty > maxQty) {
        setMessage("bad", `Enter a quantity from 1 to ${maxQty}.`);
        return;
      }
      const res = pl.buy(good, qty, price);
      setMessage(res.ok ? "good" : "bad", res.msg);
      saveGame(game);
      renderStatus(game);
      renderBuy(game);
      checkEndState(game);
    });
  }

  function renderSell(game) {
    screenTitleEl.textContent = "Sell Goods";
    setBackVisible(true);
    const p = game.planet;
    const pl = game.player;

    const options = GOODS.map((g) => {
      const owned = pl.cargo[g.name] || 0;
      const price = p.market[g.name];
      return `<option value="${escapeHtml(g.name)}">${escapeHtml(g.name)} — owned ${fmt(owned)} — ${fmt(price)} cr</option>`;
    }).join("");

    screenEl.innerHTML = `
      <div class="row">
        <div class="pill">Credits: ${fmt(pl.credits)}</div>
        <div class="pill">Used space: ${pl.cargoUsed()} / ${pl.capacity}</div>
      </div>
      <div class="form" style="margin-top:12px">
        <label for="sellGood">Good</label>
        <select id="sellGood">${options}</select>
        <div style="height:10px"></div>
        <label for="sellQty">Quantity</label>
        <input id="sellQty" inputmode="numeric" pattern="[0-9]*" placeholder="e.g. 3" />
        <div class="help" id="sellHelp"></div>
        <div class="actions">
          <button class="btn" id="sellBtn" type="button">Sell</button>
        </div>
      </div>
    `;

    const goodSel = $("sellGood");
    const qtyInput = $("sellQty");
    const helpEl = $("sellHelp");
    const sellBtn = $("sellBtn");

    function updateHelp() {
      const good = goodSel.value;
      const owned = pl.cargo[good] || 0;
      const price = p.market[good];
      helpEl.textContent = `Price: ${fmt(price)} | You have: ${fmt(owned)}`;
      return { good, owned, price };
    }

    goodSel.addEventListener("change", updateHelp);
    updateHelp();

    sellBtn.addEventListener("click", () => {
      const { good, owned, price } = updateHelp();
      if (!owned) {
        setMessage("bad", `You don't have any ${good} to sell.`);
        return;
      }
      const qty = clampInt(parseInt(qtyInput.value, 10), 1, owned);
      if (!Number.isFinite(qty) || qty <= 0 || qty > owned) {
        setMessage("bad", `Enter a quantity from 1 to ${owned}.`);
        return;
      }
      const res = pl.sell(good, qty, price);
      setMessage(res.ok ? "good" : "bad", res.msg);
      saveGame(game);
      renderStatus(game);
      renderSell(game);
      checkEndState(game);
    });
  }

  function renderTravel(game) {
    screenTitleEl.textContent = "Travel";
    setBackVisible(true);
    const pl = game.player;
    const canTravel = pl.credits >= TRAVEL_COST;

    const routesAll = game.universe.routes?.[game.currentIdx] || [];
    const routes = routesAll.filter((r) => game.knownPlanets.has(r.to));
    const neighborInfo = new Map(routes.map((r) => [r.to, r]));
    const list = routes
      .map((r) => {
        const p = game.universe.planets[r.to];
        const time = r.time;
        const distance = Math.round(r.distance);
        return `
          <button class="btn" data-dest="${r.to}" data-time="${time}" type="button">
            ${escapeHtml(p.name)} <span style="opacity:.8">(${escapeHtml(p.economy)})</span>
            <span style="opacity:.75">— ${distance} AU — +${time} jumps</span>
          </button>
        `;
      })
      .join("");

    screenEl.innerHTML = `
      <div class="row">
        <div class="pill">Travel cost: ${fmt(TRAVEL_COST)}</div>
        <div class="pill">Credits: ${fmt(pl.credits)}</div>
        <div class="pill">Pan: drag • Zoom: wheel / trackpad</div>
      </div>
      <div class="mapWrap" style="margin-top:12px">
        <canvas id="travelMap" class="mapCanvas" aria-label="Galaxy map"></canvas>
        <div class="mapHud">
          <div class="pill">Current: ${escapeHtml(game.planet.name)}</div>
          <div class="pill">Known: ${fmt(game.knownPlanets.size)}</div>
          <button class="btn sm ghost" id="mapRecenter" type="button">Current planet</button>
        </div>
        <div id="mapTooltip" class="mapTooltip" style="display:none"></div>
      </div>
      <div class="grid" style="margin-top:12px">
        ${list || `<div class="help" style="color: var(--muted)">No known routes from here.</div>`}
      </div>
      <div class="help" style="margin-top:10px; color: var(--muted); font-size: 12px;">
        Markets regenerate when you arrive.
      </div>
    `;

    // --- Canvas map ---
    const canvas = $("travelMap");
    const tooltip = $("mapTooltip");
    const recenterBtn = $("mapRecenter");
    if (canvas && canvas.getContext) {
      const ctx = canvas.getContext("2d");
      const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));

      const view = game.travelMapView || {
        cx: game.planet.x,
        cy: game.planet.y,
        zoom: 1,
      };
      game.travelMapView = view;

      if (recenterBtn) {
        recenterBtn.addEventListener("click", () => {
          const p = game.planet;
          view.cx = p.x;
          view.cy = p.y;
          draw();
        });
      }

      function resizeCanvas() {
        const rect = canvas.getBoundingClientRect();
        const w = Math.max(1, Math.floor(rect.width));
        const h = Math.max(1, Math.floor(rect.height));
        canvas.width = Math.floor(w * dpr);
        canvas.height = Math.floor(h * dpr);
        return { w, h };
      }

      function baseScale(w, h) {
        // Fit the 0..MAP_SIZE galaxy with some padding.
        const pad = 0.12;
        const usable = Math.min(w, h) * (1 - pad);
        return usable / MAP_SIZE;
      }

      function worldToScreen(pt, w, h) {
        const s = baseScale(w, h) * view.zoom;
        const x = (pt.x - view.cx) * s + w / 2;
        const y = (pt.y - view.cy) * s + h / 2;
        return { x, y, s };
      }

      function screenToWorld(x, y, w, h) {
        const s = baseScale(w, h) * view.zoom;
        return {
          x: (x - w / 2) / s + view.cx,
          y: (y - h / 2) / s + view.cy,
        };
      }

      function draw() {
        if (!ctx) return;
        const { w, h } = resizeCanvas();
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);

        // Background subtle grid
        ctx.save();
        ctx.globalAlpha = 0.4;
        ctx.strokeStyle = "rgba(255,255,255,0.06)";
        ctx.lineWidth = 1;
        const step = 40;
        for (let x = 0; x <= w; x += step) {
          ctx.beginPath();
          ctx.moveTo(x, 0);
          ctx.lineTo(x, h);
          ctx.stroke();
        }
        for (let y = 0; y <= h; y += step) {
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(w, y);
          ctx.stroke();
        }
        ctx.restore();

        const planets = game.universe.planets;
        const known = game.knownPlanets;
        const cur = game.currentIdx;

        // Routes between known planets (dim), then current routes (bright).
        function drawEdge(aIdx, bIdx, alpha, width) {
          const a = planets[aIdx];
          const b = planets[bIdx];
          const pa = worldToScreen(a, w, h);
          const pb = worldToScreen(b, w, h);
          ctx.globalAlpha = alpha;
          ctx.strokeStyle = "rgba(155,176,210,1)";
          ctx.lineWidth = width;
          ctx.beginPath();
          ctx.moveTo(pa.x, pa.y);
          ctx.lineTo(pb.x, pb.y);
          ctx.stroke();
        }

        ctx.save();
        const drawn = new Set();
        for (let i = 0; i < planets.length; i++) {
          if (!known.has(i)) continue;
          const rlist = game.universe.routes?.[i] || [];
          for (const r of rlist) {
            const j = r.to;
            if (!known.has(j)) continue;
            const key = i < j ? `${i}-${j}` : `${j}-${i}`;
            if (drawn.has(key)) continue;
            drawn.add(key);
            drawEdge(i, j, 0.15, 1);
          }
        }
        // highlight routes from current planet to reachable neighbors
        for (const r of routes) drawEdge(cur, r.to, 0.55, 2);
        ctx.restore();

        // Planets
        const points = [];
        for (let i = 0; i < planets.length; i++) {
          if (!known.has(i)) continue;
          const p = planets[i];
          const sc = worldToScreen(p, w, h);
          const isCur = i === cur;
          const isNeighbor = neighborInfo.has(i);
          const radius = isCur ? 7 : isNeighbor ? 6 : 4.5;

          ctx.beginPath();
          ctx.arc(sc.x, sc.y, radius, 0, Math.PI * 2);
          ctx.fillStyle = isCur ? "rgba(78,161,255,0.95)" : isNeighbor ? "rgba(64,209,139,0.9)" : "rgba(234,240,255,0.75)";
          ctx.fill();
          ctx.strokeStyle = "rgba(0,0,0,0.35)";
          ctx.lineWidth = 1;
          ctx.stroke();

          points.push({ idx: i, x: sc.x, y: sc.y, r: radius });
        }

        // Store for hit testing
        canvas.__points = points;
        canvas.__dims = { w, h };
      }

      function hitTest(clientX, clientY) {
        const rect = canvas.getBoundingClientRect();
        const x = clientX - rect.left;
        const y = clientY - rect.top;
        const pts = canvas.__points || [];
        let best = null;
        for (const p of pts) {
          const d = Math.hypot(x - p.x, y - p.y);
          if (d <= p.r + 6 && (!best || d < best.d)) best = { ...p, d };
        }
        return best ? { ...best, x, y } : null;
      }

      function showTooltip(hit) {
        if (!tooltip) return;
        if (!hit) {
          tooltip.style.display = "none";
          return;
        }
        const idx = hit.idx;
        const p = game.universe.planets[idx];
        const isCur = idx === game.currentIdx;
        const r = neighborInfo.get(idx);
        const lines = [];
        lines.push(`<div><b>${escapeHtml(p.name)}</b> <span class="muted">(${escapeHtml(p.economy)})</span></div>`);
        if (isCur) lines.push(`<div class="muted">Current location</div>`);
        if (r) {
          lines.push(`<div class="muted">${Math.round(r.distance)} AU • +${r.time} jumps</div>`);
          lines.push(`<div class="muted">Click to travel</div>`);
        } else if (!isCur) {
          lines.push(`<div class="muted">Not reachable from here</div>`);
        }
        tooltip.innerHTML = lines.join("");
        tooltip.style.left = `${Math.round(hit.x)}px`;
        tooltip.style.top = `${Math.round(hit.y)}px`;
        tooltip.style.display = "block";
      }

      // interaction state
      let dragging = false;
      let dragStart = null;
      let moved = false;
      const pointers = new Map(); // id -> {x,y}
      let pinchStart = null; // {dist, zoom, cx, cy, worldMid}

      function onPointerDown(e) {
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        moved = false;

        const rect = canvas.getBoundingClientRect();
        const lx = e.clientX - rect.left;
        const ly = e.clientY - rect.top;

        if (pointers.size === 1) {
          dragging = true;
          canvas.classList.add("dragging");
          const world = screenToWorld(lx, ly, rect.width, rect.height);
          dragStart = { x: lx, y: ly, cx: view.cx, cy: view.cy, wx: world.x, wy: world.y };
          pinchStart = null;
        } else if (pointers.size === 2) {
          // Start pinch
          dragging = false;
          canvas.classList.remove("dragging");
          dragStart = null;

          const pts = Array.from(pointers.values());
          const dx = pts[0].x - pts[1].x;
          const dy = pts[0].y - pts[1].y;
          const distPx = Math.hypot(dx, dy);
          const midClient = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
          const midLocal = { x: midClient.x - rect.left, y: midClient.y - rect.top };
          const worldMid = screenToWorld(midLocal.x, midLocal.y, rect.width, rect.height);
          pinchStart = { distPx, zoom: view.zoom, cx: view.cx, cy: view.cy, worldMid };
        }
        canvas.setPointerCapture?.(e.pointerId);
      }

      function onPointerMove(e) {
        if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        const hit = hitTest(e.clientX, e.clientY);
        showTooltip(hit);

        const rect = canvas.getBoundingClientRect();
        if (pointers.size === 2 && pinchStart) {
          const pts = Array.from(pointers.values());
          const dx = pts[0].x - pts[1].x;
          const dy = pts[0].y - pts[1].y;
          const distPx = Math.hypot(dx, dy);
          if (pinchStart.distPx > 0 && Number.isFinite(distPx)) {
            const factor = distPx / pinchStart.distPx;
            view.zoom = clamp(pinchStart.zoom * factor, 0.4, 5);

            const midClient = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
            const midLocal = { x: midClient.x - rect.left, y: midClient.y - rect.top };
            const after = screenToWorld(midLocal.x, midLocal.y, rect.width, rect.height);
            // Keep the original world midpoint under the pinch midpoint
            view.cx += pinchStart.worldMid.x - after.x;
            view.cy += pinchStart.worldMid.y - after.y;
            moved = true;
            draw();
          }
          return;
        }

        if (!dragging || !dragStart) return;
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const s = baseScale(rect.width, rect.height) * view.zoom;
        const dx = x - dragStart.x;
        const dy = y - dragStart.y;
        if (Math.hypot(dx, dy) > 3) moved = true;
        view.cx = dragStart.cx - dx / s;
        view.cy = dragStart.cy - dy / s;
        draw();
      }

      function onPointerUp(e) {
        pointers.delete(e.pointerId);
        dragging = false;
        dragStart = null;
        pinchStart = null;
        canvas.classList.remove("dragging");
        canvas.releasePointerCapture?.(e.pointerId);
      }

      function onWheel(e) {
        e.preventDefault();
        const rect = canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        const before = screenToWorld(mx, my, rect.width, rect.height);

        const delta = -e.deltaY;
        const factor = Math.exp(delta * 0.0015);
        view.zoom = clamp(view.zoom * factor, 0.4, 5);

        const after = screenToWorld(mx, my, rect.width, rect.height);
        // keep the world point under cursor stable
        view.cx += before.x - after.x;
        view.cy += before.y - after.y;
        draw();
      }

      async function onClick(e) {
        if (moved) return;
        const hit = hitTest(e.clientX, e.clientY);
        if (!hit) return;
        const idx = hit.idx;
        if (idx === game.currentIdx) return;
        const r = neighborInfo.get(idx);
        if (!r) return;
        if (!canTravel) {
          setMessage("bad", "You can't afford travel.");
          return;
        }
        const dest = game.universe.planets[idx];
        const ok = await confirmAction(
          "Confirm travel",
          `Travel to ${dest.name} (${dest.economy}) for ${fmt(TRAVEL_COST)} credits and +${r.time} jumps?`
        );
        if (!ok) return;
        game.player.credits -= TRAVEL_COST;
        game.currentIdx = idx;
        game.travelJumps += r.time;
        game.knownPlanets.add(idx);
        game.scanCurrentPlanet();
        game.planet.regenerateMarket();
        setMessage("good", `Arrived at ${dest.name}. Markets have shifted.`);
        saveGame(game);
        renderStatus(game);
        renderTravel(game);
        checkEndState(game);
      }

      canvas.addEventListener("pointerdown", onPointerDown);
      canvas.addEventListener("pointermove", onPointerMove);
      canvas.addEventListener("pointerup", onPointerUp);
      canvas.addEventListener("pointercancel", onPointerUp);
      canvas.addEventListener("wheel", onWheel, { passive: false });
      canvas.addEventListener("click", onClick);

      // Initial draw
      draw();
    }

    screenEl.querySelectorAll("[data-dest]").forEach((b) => {
      b.addEventListener("click", async () => {
        const idx = parseInt(b.getAttribute("data-dest"), 10);
        const time = clampInt(parseInt(b.getAttribute("data-time"), 10), 1, 1_000_000);
        if (!Number.isFinite(idx) || idx === game.currentIdx) return;
        if (!canTravel) {
          setMessage("bad", "You can't afford travel.");
          return;
        }
        const dest = game.universe.planets[idx];
        const ok = await confirmAction(
          "Confirm travel",
          `Travel to ${dest.name} (${dest.economy}) for ${fmt(TRAVEL_COST)} credits and +${time} jumps?`
        );
        if (!ok) return;
        game.player.credits -= TRAVEL_COST;
        game.currentIdx = idx;
        game.travelJumps += time;
        game.knownPlanets.add(idx);
        game.scanCurrentPlanet();
        game.planet.regenerateMarket();
        setMessage("good", `Arrived at ${dest.name}. Markets have shifted.`);
        saveGame(game);
        renderStatus(game);
        renderTravel(game);
        checkEndState(game);
      });
    });
  }

  function renderAbout(game) {
    screenTitleEl.textContent = "Help / Rules";
    setBackVisible(true);
    screenEl.innerHTML = `
      <div class="grid" style="gap:12px">
        <div class="form">
          <div style="font-weight:800; margin-bottom:8px">Goal</div>
          <div style="color: var(--muted)">
            Earn <b>${fmt(WIN_CREDITS)}</b> credits through interplanetary trading.
          </div>
        </div>
        <div class="form">
          <div style="font-weight:800; margin-bottom:8px">Start</div>
          <div style="color: var(--muted)">
            ${fmt(START_CREDITS)} credits, cargo capacity ${START_CAPACITY}, empty hold.
          </div>
        </div>
        <div class="form">
          <div style="font-weight:800; margin-bottom:8px">Travel</div>
          <div style="color: var(--muted)">
            Travel costs <b>${fmt(TRAVEL_COST)}</b> credits. If your credits drop below ${fmt(TRAVEL_COST)}, you lose.
          </div>
        </div>
        <div class="form">
          <div style="font-weight:800; margin-bottom:8px">Markets</div>
          <div style="color: var(--muted)">
            Prices vary by planet economy and regenerate on arrival.
          </div>
        </div>
      </div>
    `;
  }

  function navigate(game, where) {
    game.screen = { name: where };
    render(game);
  }

  function render(game) {
    renderStatus(game);
    setMessage(game.message.kind, game.message.text);
    game.message = { kind: "muted", text: "" };

    switch (game.screen.name) {
      case "menu":
        renderMenu(game);
        break;
      case "market":
        renderMarket(game);
        break;
      case "buy":
        renderBuy(game);
        break;
      case "sell":
        renderSell(game);
        break;
      case "travel":
        renderTravel(game);
        break;
      case "cargo":
        renderCargo(game);
        break;
      case "about":
        renderAbout(game);
        break;
      default:
        game.screen = { name: "menu" };
        renderMenu(game);
        break;
    }
  }

  function checkEndState(game) {
    if (game.player.credits >= WIN_CREDITS) {
      navigate(game, "menu");
      setMessage("good", `You win! You reached ${fmt(game.player.credits)} credits.`);
      return;
    }
    if (game.player.credits < TRAVEL_COST) {
      navigate(game, "menu");
      setMessage("bad", `Stranded! You have ${fmt(game.player.credits)} credits—less than ${fmt(TRAVEL_COST)} needed to travel.`);
    }
  }

  function start() {
    let game = loadGame();
    if (!game) game = new Game();

    btnBack.addEventListener("click", () => {
      navigate(game, "menu");
    });

    btnReset.addEventListener("click", async () => {
      const ok = await confirmAction("Reset game", "Start over with fresh planets, empty cargo, and 5,000 credits?");
      if (!ok) return;
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch {
        /* ignore */
      }
      game = new Game();
      setMessage("good", "New game started.");
      saveGame(game);
      render(game);
    });

    render(game);
    checkEndState(game);
    saveGame(game);
  }

  window.addEventListener("DOMContentLoaded", start);
})();

