import random
import math
from dataclasses import dataclass, field


GOODS = {
    "Food": 10,
    "Ore": 25,
    "Electronics": 80,
    "Medicine": 50,
    "Fuel": 8,
}

ECONOMIES = {
    "Agricultural": {"Food": 0.6, "Ore": 1.2, "Electronics": 1.4, "Medicine": 1.1, "Fuel": 1.0},
    "Industrial": {"Food": 1.3, "Ore": 0.9, "Electronics": 0.7, "Medicine": 1.1, "Fuel": 1.0},
    "Mining": {"Food": 1.2, "Ore": 0.6, "Electronics": 1.2, "Medicine": 1.0, "Fuel": 1.0},
    "HighTech": {"Food": 1.1, "Ore": 1.3, "Electronics": 0.6, "Medicine": 0.8, "Fuel": 1.0},
}

NAME_WORDS = ["Nova", "Atlas", "Orion", "Helios", "Draco", "Zenith", "Kepler", "Vega", "Titan", "Eclipse"]

TRAVEL_COST = 100
START_CREDITS = 5000
WIN_CREDITS = 100_000
START_CAPACITY = 20
START_STARDATE = 7421.0  # shared start date for all runs
GALAXY_SEED = 424242
PLANET_COUNT = 50
CLUSTER_COUNT = 5
MAP_SIZE = 100.0
CLUSTER_RADIUS = 14.0
ROUTE_TARGET_K = 3
ROUTE_MIN_DEGREE = 2
ROUTE_MAX_DEGREE = 4
TRAVEL_SPEED = 20.0


def fmt_stardate(travel_jumps: int) -> str:
    return f"Stardate {START_STARDATE + travel_jumps:.1f}"


def clamp_int(n: int, min_v: int, max_v: int) -> int:
    return max(min_v, min(max_v, n))


def ask_int(prompt: str, min_v: int | None = None, max_v: int | None = None) -> int | None:
    raw = input(prompt).strip()
    if raw.lower() in {"b", "back", ""}:
        return None
    try:
        n = int(raw)
    except ValueError:
        return None
    if min_v is not None and n < min_v:
        return None
    if max_v is not None and n > max_v:
        return None
    return n


def fmt_credits(c: int) -> str:
    return f"{c:,}"


@dataclass
class Planet:
    name: str
    economy: str
    x: float
    y: float
    market: dict[str, int] = field(default_factory=dict)

    def regenerate_market(self, rng: random.Random) -> None:
        mods = ECONOMIES[self.economy]
        self.market = {}
        for good, base in GOODS.items():
            modifier = mods[good]
            swing = rng.uniform(0.9, 1.1)
            price = int(round(base * modifier * swing))
            self.market[good] = max(1, price)


@dataclass
class Player:
    credits: int = START_CREDITS
    capacity: int = START_CAPACITY
    cargo: dict[str, int] = field(default_factory=lambda: {g: 0 for g in GOODS})

    def cargo_used(self) -> int:
        return sum(self.cargo.values())

    def cargo_free(self) -> int:
        return self.capacity - self.cargo_used()

    def can_afford(self, amount: int) -> bool:
        return self.credits >= amount

    def buy(self, good: str, qty: int, price: int) -> tuple[bool, str]:
        if qty <= 0:
            return False, "Quantity must be at least 1."
        if qty > self.cargo_free():
            return False, "Not enough cargo space."
        cost = qty * price
        if not self.can_afford(cost):
            return False, "Not enough credits."
        self.credits -= cost
        self.cargo[good] += qty
        return True, f"Bought {qty} {good} for {fmt_credits(cost)} credits."

    def sell(self, good: str, qty: int, price: int) -> tuple[bool, str]:
        if qty <= 0:
            return False, "Quantity must be at least 1."
        if qty > self.cargo[good]:
            return False, "You don't have that many units."
        revenue = qty * price
        self.cargo[good] -= qty
        self.credits += revenue
        return True, f"Sold {qty} {good} for {fmt_credits(revenue)} credits."


class Universe:
    def __init__(self, rng: random.Random) -> None:
        self.rng = rng
        self.planets: list[Planet] = self._generate_planets(PLANET_COUNT)
        self.routes: list[list[dict[str, float | int]]] = self._generate_routes()

    def _generate_planets(self, count: int) -> list[Planet]:
        economies = list(ECONOMIES.keys())
        names = self._generate_unique_names(count)
        centers: list[tuple[float, float]] = [
            (self.rng.random() * MAP_SIZE, self.rng.random() * MAP_SIZE) for _ in range(CLUSTER_COUNT)
        ]
        planets: list[Planet] = []
        for i, name in enumerate(names):
            cx, cy = centers[i % CLUSTER_COUNT]
            angle = self.rng.random() * math.tau
            radius = math.sqrt(self.rng.random()) * CLUSTER_RADIUS
            x = max(0.0, min(MAP_SIZE, cx + math.cos(angle) * radius))
            y = max(0.0, min(MAP_SIZE, cy + math.sin(angle) * radius))

            eco = self.rng.choice(economies)
            p = Planet(name=name, economy=eco, x=x, y=y)
            p.regenerate_market(self.rng)
            planets.append(p)
        return planets

    def _generate_unique_names(self, count: int) -> list[str]:
        # Build names like "Nova Helios" or "Atlas-7" with light variety.
        used: set[str] = set()
        results: list[str] = []
        attempts = 0
        while len(results) < count and attempts < 2000:
            attempts += 1
            style = self.rng.randint(1, 3)
            if style == 1:
                name = f"{self.rng.choice(NAME_WORDS)} {self.rng.choice(NAME_WORDS)}"
            elif style == 2:
                name = f"{self.rng.choice(NAME_WORDS)}-{self.rng.randint(2, 99)}"
            else:
                name = f"{self.rng.choice(NAME_WORDS)} {self.rng.randint(2, 99)}"
            if name not in used:
                used.add(name)
                results.append(name)
        if len(results) < count:
            # Fallback deterministic names if RNG got unlucky
            for i in range(count - len(results)):
                results.append(f"{NAME_WORDS[i % len(NAME_WORDS)]}-{100 + i}")
        return results

    def _dist(self, a: int, b: int) -> float:
        pa = self.planets[a]
        pb = self.planets[b]
        return math.hypot(pa.x - pb.x, pa.y - pb.y)

    def _route_time(self, distance: float) -> int:
        return max(1, int(math.ceil(distance / TRAVEL_SPEED)))

    def _generate_routes(self) -> list[list[dict[str, float | int]]]:
        n = len(self.planets)
        neighbors: list[dict[int, tuple[float, int]]] = [dict() for _ in range(n)]  # to -> (distance, time)

        def add_edge(i: int, j: int) -> None:
            if i == j:
                return
            d = self._dist(i, j)
            t = self._route_time(d)
            neighbors[i][j] = (d, t)
            neighbors[j][i] = (d, t)

        # k-nearest neighbors
        for i in range(n):
            ds = [(self._dist(i, j), j) for j in range(n) if j != i]
            ds.sort(key=lambda x: x[0])
            for _, j in ds[:ROUTE_TARGET_K]:
                add_edge(i, j)

        def prune_to_max_degree() -> None:
            changed = True
            while changed:
                changed = False
                for i in range(n):
                    while len(neighbors[i]) > ROUTE_MAX_DEGREE:
                        worst_j = max(neighbors[i].items(), key=lambda kv: kv[1][0])[0]
                        neighbors[i].pop(worst_j, None)
                        neighbors[worst_j].pop(i, None)
                        changed = True

        def ensure_min_degree() -> None:
            for i in range(n):
                if len(neighbors[i]) >= ROUTE_MIN_DEGREE:
                    continue
                candidates: list[tuple[float, int]] = []
                for j in range(n):
                    if i == j or j in neighbors[i]:
                        continue
                    if len(neighbors[j]) >= ROUTE_MAX_DEGREE:
                        continue
                    candidates.append((self._dist(i, j), j))
                candidates.sort(key=lambda x: x[0])
                for _, j in candidates:
                    if len(neighbors[i]) >= ROUTE_MIN_DEGREE:
                        break
                    if len(neighbors[j]) >= ROUTE_MAX_DEGREE:
                        continue
                    add_edge(i, j)

        def components() -> list[list[int]]:
            seen = [False] * n
            comps: list[list[int]] = []
            for i in range(n):
                if seen[i]:
                    continue
                stack = [i]
                seen[i] = True
                comp: list[int] = []
                while stack:
                    cur = stack.pop()
                    comp.append(cur)
                    for to in neighbors[cur].keys():
                        if not seen[to]:
                            seen[to] = True
                            stack.append(to)
                comps.append(comp)
            return comps

        prune_to_max_degree()
        ensure_min_degree()

        comps = components()
        while len(comps) > 1:
            a = comps[0]
            best: tuple[float, int, int] | None = None
            for b in comps[1:]:
                for i in a:
                    if len(neighbors[i]) >= ROUTE_MAX_DEGREE:
                        continue
                    for j in b:
                        if len(neighbors[j]) >= ROUTE_MAX_DEGREE:
                            continue
                        d = self._dist(i, j)
                        if best is None or d < best[0]:
                            best = (d, i, j)
            if best is None:
                b = comps[1]
                fallback = min(((self._dist(i, j), i, j) for i in a for j in b), key=lambda x: x[0])
                add_edge(fallback[1], fallback[2])
            else:
                add_edge(best[1], best[2])
            prune_to_max_degree()
            ensure_min_degree()
            comps = components()

        routes: list[list[dict[str, float | int]]] = []
        for i in range(n):
            rlist = [{"to": j, "distance": d, "time": t} for j, (d, t) in neighbors[i].items()]
            rlist.sort(key=lambda r: float(r["distance"]))
            routes.append(rlist)
        return routes


class Game:
    def __init__(self, seed: int | None = None) -> None:
        self.rng = random.Random(GALAXY_SEED if seed is None else seed)
        self.universe = Universe(self.rng)
        self.player = Player()
        self.current_idx = 0
        self.current_planet.regenerate_market(self.rng)
        self.travel_jumps = 0
        self.known_planets: set[int] = {self.current_idx}
        self._scan_current_planet()

    @property
    def current_planet(self) -> Planet:
        return self.universe.planets[self.current_idx]

    def _scan_current_planet(self) -> None:
        for r in self.universe.routes[self.current_idx]:
            self.known_planets.add(int(r["to"]))

    def run(self) -> None:
        self._clear()
        self._intro()
        while True:
            if self.player.credits >= WIN_CREDITS:
                self._win()
                return
            if self.player.credits < TRAVEL_COST:
                self._lose()
                return

            self._status()
            choice = input("Choose an action (1-6): ").strip()
            if choice == "1":
                self._view_market()
            elif choice == "2":
                self._buy_goods()
            elif choice == "3":
                self._sell_goods()
            elif choice == "4":
                self._travel()
            elif choice == "5":
                self._view_cargo()
            elif choice == "6":
                print("\nThanks for playing Frontier Fortune.")
                return
            else:
                print("Invalid choice.")

    def _intro(self) -> None:
        print("Frontier Fortune")
        print("-" * 60)
        print("Earn 100,000 credits through interplanetary trading.")
        print(f"Travel costs {TRAVEL_COST} credits. If you drop below {TRAVEL_COST}, you're stranded.")
        input("\nPress Enter to begin...")

    def _status(self) -> None:
        p = self.current_planet
        pl = self.player
        print("\n" + "=" * 60)
        print(f"Current planet: {p.name}")
        print(f"Planet economy: {p.economy}")
        print(f"Coords: ({p.x:.1f}, {p.y:.1f})")
        print(f"Time: {fmt_stardate(self.travel_jumps)}")
        print(f"Credits: {fmt_credits(pl.credits)}")
        print(f"Cargo: {pl.cargo_used()} / {pl.capacity}")
        print("=" * 60)
        print("1 View Market")
        print("2 Buy Goods")
        print("3 Sell Goods")
        print("4 Travel")
        print("5 View Cargo")
        print("6 Quit")

    def _view_market(self) -> None:
        p = self.current_planet
        print("\nMarket Prices")
        print("-" * 60)
        print(f"{'Good':<14}{'Price':>10}{'Owned':>10}")
        for good in GOODS:
            price = p.market[good]
            owned = self.player.cargo[good]
            print(f"{good:<14}{fmt_credits(price):>10}{owned:>10}")
        input("\nPress Enter to return...")

    def _choose_good(self, title: str) -> str | None:
        p = self.current_planet
        print(f"\n{title}")
        print("-" * 60)
        goods = list(GOODS.keys())
        for i, good in enumerate(goods, start=1):
            price = p.market[good]
            owned = self.player.cargo[good]
            print(f"{i}. {good:<12} price {fmt_credits(price):>6}   owned {owned}")
        print("B. Back")
        sel = input("Select a good: ").strip().lower()
        if sel in {"b", "back", ""}:
            return None
        try:
            idx = int(sel)
        except ValueError:
            return None
        if not (1 <= idx <= len(goods)):
            return None
        return goods[idx - 1]

    def _buy_goods(self) -> None:
        good = self._choose_good("Buy Goods")
        if good is None:
            return
        price = self.current_planet.market[good]
        max_by_space = self.player.cargo_free()
        max_by_money = self.player.credits // price
        max_qty = max(0, min(max_by_space, max_by_money))
        if max_qty <= 0:
            print("You can't afford any or you have no cargo space.")
            input("Press Enter to return...")
            return

        print(f"Credits: {fmt_credits(self.player.credits)} | Space free: {self.player.cargo_free()}")
        print(f"{good} price: {fmt_credits(price)} | Max you can buy: {max_qty}")
        qty = ask_int("Quantity (or B to go back): ", min_v=1, max_v=max_qty)
        if qty is None:
            return
        ok, msg = self.player.buy(good, qty, price)
        print(msg)
        input("Press Enter to return...")

    def _sell_goods(self) -> None:
        good = self._choose_good("Sell Goods")
        if good is None:
            return
        owned = self.player.cargo[good]
        if owned <= 0:
            print("You don't have any to sell.")
            input("Press Enter to return...")
            return
        price = self.current_planet.market[good]
        print(f"You own {owned} {good}. Current price: {fmt_credits(price)}")
        qty = ask_int(f"Quantity to sell (1-{owned}, or B to go back): ", min_v=1, max_v=owned)
        if qty is None:
            return
        ok, msg = self.player.sell(good, qty, price)
        print(msg)
        input("Press Enter to return...")

    def _travel(self) -> None:
        if self.player.credits < TRAVEL_COST:
            print("You can't afford travel.")
            input("Press Enter to return...")
            return

        cur = self.current_idx
        print("\nTravel")
        print("-" * 60)
        routes = [r for r in self.universe.routes[cur] if int(r["to"]) in self.known_planets]
        if not routes:
            print("(No known routes from here.)")
            input("Press Enter to return...")
            return

        for i, r in enumerate(routes, start=1):
            to = int(r["to"])
            p = self.universe.planets[to]
            d = float(r["distance"])
            t = int(r["time"])
            print(f"{i:>2}. {p.name:<18} {p.economy:<12} {d:>5.0f} AU  +{t} jumps")
        print("B. Back")
        sel = input(f"Route (cost {TRAVEL_COST}) : ").strip().lower()
        if sel in {"b", "back", ""}:
            return
        try:
            choice = int(sel) - 1
        except ValueError:
            print("Invalid route.")
            return
        if not (0 <= choice < len(routes)):
            print("Invalid route.")
            return

        dest_idx = int(routes[choice]["to"])
        time_cost = int(routes[choice]["time"])
        if dest_idx == cur:
            print("Invalid destination.")
            return

        self.player.credits -= TRAVEL_COST
        self.current_idx = dest_idx
        self.travel_jumps += time_cost
        self.known_planets.add(self.current_idx)
        self._scan_current_planet()
        self.current_planet.regenerate_market(self.rng)
        print(f"\nArrived at {self.current_planet.name}. Markets have shifted.")
        input("Press Enter to continue...")

    def _view_cargo(self) -> None:
        pl = self.player
        print("\nCargo Hold")
        print("-" * 60)
        print(f"Used: {pl.cargo_used()} / {pl.capacity}\n")
        any_owned = False
        for good in GOODS:
            qty = pl.cargo[good]
            if qty:
                any_owned = True
            print(f"{good:<14}{qty:>6}")
        if not any_owned:
            print("\n(Empty)")
        input("\nPress Enter to return...")

    def _win(self) -> None:
        self._clear()
        print("You did it!")
        print("-" * 60)
        print(f"You reached {fmt_credits(self.player.credits)} credits and became a legend of the frontier.")
        print(f"Final time: {fmt_stardate(self.travel_jumps)} ({self.travel_jumps} travel jumps)")
        input("\nPress Enter to exit...")

    def _lose(self) -> None:
        self._clear()
        print("Stranded!")
        print("-" * 60)
        print(f"You have {fmt_credits(self.player.credits)} credits—less than the {TRAVEL_COST} needed to travel.")
        print("Your trading career ends here.")
        print(f"Final time: {fmt_stardate(self.travel_jumps)} ({self.travel_jumps} travel jumps)")
        input("\nPress Enter to exit...")

    def _clear(self) -> None:
        # Cross-platform-ish clear without external libs.
        print("\n" * 3)


def start_game() -> None:
    Game().run()


if __name__ == "__main__":
    start_game()

