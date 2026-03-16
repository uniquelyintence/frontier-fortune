import random
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
        self.planets: list[Planet] = self._generate_planets(10)

    def _generate_planets(self, count: int) -> list[Planet]:
        economies = list(ECONOMIES.keys())
        names = self._generate_unique_names(count)
        planets: list[Planet] = []
        for name in names:
            eco = self.rng.choice(economies)
            p = Planet(name=name, economy=eco)
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


class Game:
    def __init__(self, seed: int | None = None) -> None:
        self.rng = random.Random(seed)
        self.universe = Universe(self.rng)
        self.player = Player()
        self.current_idx = self.rng.randrange(len(self.universe.planets))
        self.current_planet.regenerate_market(self.rng)

    @property
    def current_planet(self) -> Planet:
        return self.universe.planets[self.current_idx]

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

        planets = self.universe.planets
        cur = self.current_idx
        print("\nTravel")
        print("-" * 60)
        for i, p in enumerate(planets, start=1):
            tag = " (current)" if (i - 1) == cur else ""
            print(f"{i:>2}. {p.name:<18} {p.economy:<12}{tag}")
        print("B. Back")
        sel = input(f"Destination (cost {TRAVEL_COST}) : ").strip().lower()
        if sel in {"b", "back", ""}:
            return
        try:
            idx = int(sel) - 1
        except ValueError:
            print("Invalid destination.")
            return
        if not (0 <= idx < len(planets)) or idx == cur:
            print("Invalid destination.")
            return

        self.player.credits -= TRAVEL_COST
        self.current_idx = idx
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
        input("\nPress Enter to exit...")

    def _lose(self) -> None:
        self._clear()
        print("Stranded!")
        print("-" * 60)
        print(f"You have {fmt_credits(self.player.credits)} credits—less than the {TRAVEL_COST} needed to travel.")
        print("Your trading career ends here.")
        input("\nPress Enter to exit...")

    def _clear(self) -> None:
        # Cross-platform-ish clear without external libs.
        print("\n" * 3)


def start_game() -> None:
    Game().run()


if __name__ == "__main__":
    start_game()

