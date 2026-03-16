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

  const STORAGE_KEY = "frontier_fortune_v1";

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

  class Planet {
    constructor(name, economy) {
      this.name = name;
      this.economy = economy;
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
      this.planets = this.generatePlanets(10);
    }

    generatePlanets(count) {
      const used = new Set();
      const names = [];
      let attempts = 0;
      while (names.length < count && attempts < 2000) {
        attempts++;
        const style = randInt(1, 3);
        let name = "";
        if (style === 1) name = `${randChoice(NAME_WORDS)} ${randChoice(NAME_WORDS)}`;
        else if (style === 2) name = `${randChoice(NAME_WORDS)}-${randInt(2, 99)}`;
        else name = `${randChoice(NAME_WORDS)} ${randInt(2, 99)}`;
        if (!used.has(name)) {
          used.add(name);
          names.push(name);
        }
      }
      while (names.length < count) names.push(`${NAME_WORDS[names.length % NAME_WORDS.length]}-${100 + names.length}`);

      const economyNames = Object.keys(ECONOMIES);
      return names.map((n) => new Planet(n, randChoice(economyNames)));
    }
  }

  class Game {
    constructor() {
      this.universe = new Universe();
      this.player = new Player();
      this.currentIdx = randInt(0, this.universe.planets.length - 1);
      this.screen = { name: "menu" }; // {name, ...data}
      this.message = { kind: "muted", text: "" };
      this.persistEnabled = true;
    }

    get planet() {
      return this.universe.planets[this.currentIdx];
    }

    toJSON() {
      return {
        v: 1,
        player: { credits: this.player.credits, capacity: this.player.capacity, cargo: this.player.cargo },
        currentIdx: this.currentIdx,
        planets: this.universe.planets.map((p) => ({ name: p.name, economy: p.economy, market: p.market })),
      };
    }

    static fromJSON(data) {
      if (!data || data.v !== 1) return null;
      const g = new Game();
      g.universe.planets = (data.planets || []).map((p) => {
        const pl = new Planet(p.name, p.economy);
        if (p.market && typeof p.market === "object") pl.market = p.market;
        return pl;
      });
      g.currentIdx = clampInt(data.currentIdx ?? 0, 0, g.universe.planets.length - 1);
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
    screenEl.innerHTML = `
      <div class="row">
        <div class="pill">Goal: ${fmt(WIN_CREDITS)} credits</div>
        <div class="pill">Travel cost: ${fmt(TRAVEL_COST)}</div>
        <div class="pill">Lose if credits &lt; ${fmt(TRAVEL_COST)}</div>
      </div>
      <div class="grid menu" style="margin-top:12px">
        <button class="btn" data-go="market" type="button">View Market</button>
        <button class="btn" data-go="buy" type="button">Buy Goods</button>
        <button class="btn" data-go="sell" type="button">Sell Goods</button>
        <button class="btn" data-go="travel" type="button">Travel</button>
        <button class="btn" data-go="cargo" type="button">View Cargo</button>
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
    const rows = GOODS.map((g) => {
      const price = p.market[g.name];
      const owned = game.player.cargo[g.name] || 0;
      return `<tr>
        <td>${escapeHtml(g.name)}</td>
        <td class="num">${fmt(price)}</td>
        <td class="num">${fmt(owned)}</td>
      </tr>`;
    }).join("");

    screenEl.innerHTML = `
      <div class="tableWrap">
        <table>
          <thead><tr><th>Good</th><th class="num">Price</th><th class="num">Owned</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div class="row" style="margin-top:12px">
        <button class="btn" data-go="buy" type="button">Buy</button>
        <button class="btn" data-go="sell" type="button">Sell</button>
      </div>
    `;
    screenEl.querySelectorAll("[data-go]").forEach((b) => b.addEventListener("click", () => navigate(game, b.getAttribute("data-go"))));
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

    const list = game.universe.planets
      .map((p, idx) => {
        const isCur = idx === game.currentIdx;
        return `
          <button class="btn ${isCur ? "ghost" : ""}" data-dest="${idx}" type="button" ${isCur ? "disabled" : ""}>
            ${escapeHtml(p.name)} <span style="opacity:.8">(${escapeHtml(p.economy)})</span>${isCur ? " — current" : ""}
          </button>
        `;
      })
      .join("");

    screenEl.innerHTML = `
      <div class="row">
        <div class="pill">Travel cost: ${fmt(TRAVEL_COST)}</div>
        <div class="pill">Credits: ${fmt(pl.credits)}</div>
      </div>
      <div class="grid" style="margin-top:12px">
        ${list}
      </div>
      <div class="help" style="margin-top:10px; color: var(--muted); font-size: 12px;">
        Markets regenerate when you arrive.
      </div>
    `;

    screenEl.querySelectorAll("[data-dest]").forEach((b) => {
      b.addEventListener("click", async () => {
        const idx = parseInt(b.getAttribute("data-dest"), 10);
        if (!Number.isFinite(idx) || idx === game.currentIdx) return;
        if (!canTravel) {
          setMessage("bad", "You can't afford travel.");
          return;
        }
        const dest = game.universe.planets[idx];
        const ok = await confirmAction(
          "Confirm travel",
          `Travel to ${dest.name} (${dest.economy}) for ${fmt(TRAVEL_COST)} credits?`
        );
        if (!ok) return;
        game.player.credits -= TRAVEL_COST;
        game.currentIdx = idx;
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
            Travel costs <b>${fmt(TRAVEL_COST)}</b> credits. If your credits drop below that, you lose.
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

