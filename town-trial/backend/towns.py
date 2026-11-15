"""Real-town data (2A): turn a city name into a town spec the browser and the simulator both build from.

Sources (all free; every value records where it came from):
- Nominatim (OpenStreetMap geocoder): the town's centre, extent, country/state, and OSM population if tagged.
- Overpass (OpenStreetMap): real places within the town: library, schools, clinics, parks, shops, workplaces...
  with names and coordinates. Map data (c) OpenStreetMap contributors, ODbL.
- US Census ACS 5-year profile (if CENSUS_API_KEY is set and the town is a US Census place): population,
  age, employment, households with children, college enrolment, working from home, median income.
  Without it, the resident mix uses the model's defaults, labelled as such.

Layout (2A): the streets stay a schematic 6x6 grid ("subway map"), but which places exist, their names, and
their rough relative positions are real. Each place is projected onto the grid and given the nearest free
block (large places: school, park, sports) or lot (4 per block; everything else). Remaining blocks are homes.
Placement happens here, so the browser and the Node workers consume one final layout (parity holds).
"""
from __future__ import annotations

import math
import os
import re
import time

GRID = 6
UA = "town-trial-hackathon/0.2 (research demo)"  # generic client name, per the services' usage policies
OVERPASS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter",
            "https://overpass.private.coffee/api/interpreter", "https://maps.mail.ru/osm/tools/overpass/api/interpreter"]
PREBUILT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "town_cache")  # specs shipped with the backend (demo towns)
SPEC_VERSION = 2

# OSM tags -> place kinds the simulator knows. (kind, block|lot, cap shown in town, employs residents)
KINDS = {
    "library": ("lot", 3, True), "school": ("block", 3, True), "clinic": ("lot", 3, True), "pharmacy": ("lot", 2, True),
    "community": ("lot", 3, True), "townhall": ("lot", 1, True), "post_office": ("lot", 1, True), "police": ("lot", 1, True),
    "fire_station": ("lot", 1, True), "worship": ("lot", 3, False), "food": ("lot", 6, True), "shop": ("lot", 8, True),
    "bank": ("lot", 2, True), "park": ("block", 2, False), "sports": ("block", 2, True), "office": ("lot", 6, True),
}
LABEL = {"library": "Library", "school": "School", "clinic": "Clinic", "pharmacy": "Pharmacy", "community": "Community centre",
         "townhall": "Town hall", "post_office": "Post office", "police": "Police", "fire_station": "Fire station",
         "worship": "Place of worship", "food": "Cafe", "shop": "Shop", "bank": "Bank", "park": "Park", "sports": "Sports ground",
         "office": "Offices"}
CANONICAL = {"library": "library", "school": "school", "park": "park", "food": "cafe", "townhall": "townhall"}  # first of each keeps the old ids


def kind_of(t: dict) -> str | None:
    a, l, s = t.get("amenity"), t.get("leisure"), t.get("shop")
    if a == "library": return "library"
    if a in ("school", "kindergarten", "college"): return "school"
    if a in ("clinic", "doctors", "hospital", "dentist"): return "clinic"
    if a == "pharmacy": return "pharmacy"
    if a in ("community_centre", "social_centre", "arts_centre"): return "community"
    if a == "townhall": return "townhall"
    if a == "post_office": return "post_office"
    if a == "police": return "police"
    if a == "fire_station": return "fire_station"
    if a == "place_of_worship": return "worship"
    if a in ("restaurant", "cafe", "fast_food", "pub", "bar"): return "food"
    if a == "bank": return "bank"
    if l in ("park", "playground", "garden"): return "park"
    if l in ("sports_centre", "swimming_pool", "pitch", "fitness_centre", "stadium") or a == "swimming_pool": return "sports"
    if s: return "shop"
    if t.get("office") or t.get("building") in ("office", "commercial", "industrial"): return "office"
    return None


def _get(url: str, params: dict | None = None, data: dict | None = None, timeout: float = 60):
    import httpx
    with httpx.Client(headers={"User-Agent": UA}, timeout=timeout, follow_redirects=False) as c:
        r = c.post(url, data=data) if data is not None else c.get(url, params=params)
    r.raise_for_status()
    return r.json()


def geocode(city: str) -> dict:
    res = _get("https://nominatim.openstreetmap.org/search", {"q": city, "format": "json", "limit": 8, "addressdetails": 1, "extratags": 1})
    if not res:
        raise LookupError(f"OpenStreetMap has no place called {city!r}")
    # Prefer the town itself over a county or region with the same name (e.g. Hood River city, not Hood River County).
    SETTLEMENT = ("city", "town", "village", "hamlet", "municipality", "suburb", "borough")
    g = next((r for r in res if r.get("addresstype") in SETTLEMENT or (r.get("class") == "place" and r.get("type") in SETTLEMENT)), res[0])
    s, n, w, e = map(float, g["boundingbox"])
    lat, lon = float(g["lat"]), float(g["lon"])
    half_diag = 0.5 * math.hypot((n - s) * 110540, (e - w) * 111320 * math.cos(math.radians(lat)))
    return {"lat": lat, "lon": lon, "display_name": g.get("display_name"), "osm": f"{g.get('osm_type')}/{g.get('osm_id')}",
            "address": g.get("address", {}), "population_osm": (g.get("extratags") or {}).get("population"),
            "radius_m": int(min(2000, max(800, half_diag)))}


def fetch_places(lat: float, lon: float, radius: int) -> list[dict]:
    """Main Overpass server at full size, then a smaller area (dense cities like Berkeley can time out), then the mirrors.
    Worst case stays under ~5 minutes so the browser's wait doesn't run out first."""
    small = min(radius, 1200)
    tries = [(OVERPASS[0], radius, 90), (OVERPASS[0], small, 60)] + [(u, small, 55) for u in OVERPASS[1:]]
    last = None
    for url, r, to in tries:
        try:
            return _overpass(url, lat, lon, r, to)
        except Exception as ex:  # try a smaller area / the next mirror
            last = ex
    raise RuntimeError(f"Overpass failed: {last}")


def _overpass(url: str, lat: float, lon: float, radius: int, timeout: float) -> list[dict]:
    a = f"around:{radius},{lat},{lon}"
    q = (f"[out:json][timeout:{int(timeout) - 5}];("
         f'nwr({a})[amenity~"^(library|school|kindergarten|college|clinic|doctors|hospital|dentist|pharmacy|community_centre|social_centre|'
         f'arts_centre|townhall|post_office|police|fire_station|place_of_worship|restaurant|cafe|fast_food|pub|bar|bank|swimming_pool)$"];'
         f'nwr({a})[leisure~"^(park|playground|garden|sports_centre|swimming_pool|pitch|fitness_centre|stadium)$"];'
         f"nwr({a})[shop];nwr({a})[office];way({a})[building~\"^(office|commercial|industrial)$\"];"
         f'way({a})[highway~"^(primary|secondary|tertiary|residential|unclassified|living_street)$"][name];'
         f");out tags center;")
    res = _get(url, data={"data": q}, timeout=timeout)
    remark = str(res.get("remark") or "")
    if "error" in remark.lower() or "timed out" in remark.lower():  # Overpass reports query timeouts as HTTP 200 + remark
        raise RuntimeError(f"Overpass remark: {remark[:160]}")
    return res.get("elements", [])


STATE_FIPS = {"Alabama": "01", "Alaska": "02", "Arizona": "04", "Arkansas": "05", "California": "06", "Colorado": "08", "Connecticut": "09",
              "Delaware": "10", "District of Columbia": "11", "Florida": "12", "Georgia": "13", "Hawaii": "15", "Idaho": "16", "Illinois": "17",
              "Indiana": "18", "Iowa": "19", "Kansas": "20", "Kentucky": "21", "Louisiana": "22", "Maine": "23", "Maryland": "24",
              "Massachusetts": "25", "Michigan": "26", "Minnesota": "27", "Mississippi": "28", "Missouri": "29", "Montana": "30",
              "Nebraska": "31", "Nevada": "32", "New Hampshire": "33", "New Jersey": "34", "New Mexico": "35", "New York": "36",
              "North Carolina": "37", "North Dakota": "38", "Ohio": "39", "Oklahoma": "40", "Oregon": "41", "Pennsylvania": "42",
              "Rhode Island": "44", "South Carolina": "45", "South Dakota": "46", "Tennessee": "47", "Texas": "48", "Utah": "49",
              "Vermont": "50", "Virginia": "51", "Washington": "53", "West Virginia": "54", "Wisconsin": "55", "Wyoming": "56"}
CENSUS_VARS = {"DP05_0001E": "population", "DP05_0019E": "under18", "DP05_0024E": "age65plus", "DP03_0001E": "pop16plus",
               "DP03_0004E": "employed", "DP03_0062E": "median_income", "DP02_0001E": "households", "DP02_0014E": "households_with_kids",
               "DP02_0058E": "college", "DP03_0024E": "work_from_home"}


def census(address: dict, city: str) -> dict | None:
    key = os.environ.get("CENSUS_API_KEY")
    if not key or address.get("country_code") != "us":
        return None
    fips = STATE_FIPS.get(address.get("state", ""))
    if not fips:
        return None
    name = (address.get("city") or address.get("town") or address.get("village") or city.split(",")[0]).strip().lower()
    rows = _get("https://api.census.gov/data/2022/acs/acs5/profile",
                {"get": "NAME," + ",".join(CENSUS_VARS), "for": "place:*", "in": f"state:{fips}", "key": key})
    head = rows[0]
    for r in rows[1:]:
        place = r[0].split(",")[0].lower()
        if re.sub(r"\s+(city|town|village|cdp|borough)$", "", place) == name:
            d = dict(zip(head, r))
            out = {CENSUS_VARS[k]: float(d[k]) for k in CENSUS_VARS if d.get(k) not in (None, "", "-666666666")}
            out["census_name"] = r[0]
            out["source"] = f"US Census ACS 2022 5-year profile, {r[0]} (place {d['place']})"
            return out
    return None


DEFAULT_MIX = {"day-workers": 0.3, "families": 0.22, "seniors": 0.16, "students": 0.14, "night-shift": 0.1, "remote": 0.08}


def cohort_mix(c: dict | None) -> tuple[dict, str]:
    """Resident mix from Census figures (formula below, labelled), else the model defaults."""
    if not c or not c.get("population"):
        return dict(DEFAULT_MIX), "model default (no demographic data for this town)"
    P = c["population"]
    seniors = c.get("age65plus", 0.16 * P) / P
    students = (0.7 * c.get("under18", 0.2 * P) + c.get("college", 0.05 * P)) / P
    employed = c.get("employed", 0.45 * P) / P
    wfh = c.get("work_from_home", 0.08 * c.get("employed", 0.45 * P)) / max(1.0, c.get("employed", 0.45 * P))
    families = min(employed * 0.6, 1.5 * c.get("households_with_kids", 0.25 * c.get("households", P / 2.4)) / P)
    remote = employed * wfh
    night = employed * 0.12  # no Census variable for shift work: 12% of employed (assumption, labelled)
    day = max(0.02, employed - families - remote - night)
    mix = {"day-workers": day, "families": families, "seniors": seniors, "students": students, "night-shift": night, "remote": remote}
    total = sum(mix.values())
    return ({k: round(v / total, 4) for k, v in mix.items()},
            "derived from Census: seniors = 65+; students = 0.7 x under-18 + college; working parents = 1.5 x households with "
            "children (capped at 60% of employed); remote = employed x worked-from-home share; night shift = 12% of employed "
            "(assumption); day workers = the remaining employed; normalised")


def place_on_grid(center: dict, places: list[dict]) -> tuple[list[dict], list[dict]]:
    """Project places onto the 6x6 grid; big kinds take a free block, others a free lot. Returns (blocks, placed)."""
    lat0, lon0 = center["lat"], center["lon"]
    for p in places:
        p["mx"] = (p["lon"] - lon0) * 111320 * math.cos(math.radians(lat0))
        p["mz"] = -(p["lat"] - lat0) * 110540  # north = -z (towards the back of the default camera)
    ext = sorted(max(abs(p["mx"]), abs(p["mz"])) for p in places)
    scale = max(250.0, ext[int(0.9 * (len(ext) - 1))] if ext else 500.0)
    blocks = [{"i": i, "j": j, "use": None, "lots": []} for i in range(GRID) for j in range(GRID)]
    blk = lambda i, j: blocks[i * GRID + j]  # noqa: E731
    centre = blk(2, 2)
    centre["use"] = "plaza"  # schematic town centre (fountain square)
    for p in places:
        p["gx"] = max(0.0, min(GRID - 1e-6, (p["mx"] / scale + 1) * GRID / 2))
        p["gz"] = max(0.0, min(GRID - 1e-6, (p["mz"] / scale + 1) * GRID / 2))
    placed = []
    order = sorted(places, key=lambda p: (KINDS[p["kind"]][0] != "block", p["rank"]))
    for p in order:
        big = KINDS[p["kind"]][0] == "block"
        free = [b for b in blocks if (b["use"] is None if big else (b["use"] in (None, "mixed") and len(b["lots"]) < 4))]
        if not free:
            continue
        b = min(free, key=lambda b: ((b["i"] + 0.5 - p["gx"]) ** 2 + (b["j"] + 0.5 - p["gz"]) ** 2, b["i"], b["j"]))
        if big:
            b["use"], b["place"] = p["kind"], p["id"]
        else:
            b["use"] = "mixed"
            b["lots"].append(p["id"])
        p["block"] = [b["i"], b["j"]]
        placed.append(p)
    for b in blocks:
        if b["use"] is None:
            b["use"] = "homes"
    return blocks, placed


def build_spec(city: str) -> dict:
    t0 = time.time()
    g = geocode(city)
    elements = fetch_places(g["lat"], g["lon"], g["radius_m"])
    counts, seen, raw, streets = {}, set(), [], {}
    for e in elements:
        t = e.get("tags", {})
        if "highway" in t:
            streets[t["name"]] = streets.get(t["name"], 0) + 1
            continue
        k = kind_of(t)
        if not k:
            continue
        lat, lon = (e.get("lat"), e.get("lon")) if "lat" in e else ((e.get("center") or {}).get("lat"), (e.get("center") or {}).get("lon"))
        if lat is None:
            continue
        counts[k] = counts.get(k, 0) + 1
        name = (t.get("name") or "").strip()
        key = (k, name.lower()) if name else (k, round(lat, 4), round(lon, 4))
        if key in seen:
            continue
        seen.add(key)
        d = math.hypot((lat - g["lat"]) * 110540, (lon - g["lon"]) * 111320 * math.cos(math.radians(g["lat"])))
        k12 = k == "school" and t.get("amenity") == "school"
        raw.append({"kind": k, "name": name or LABEL[k], "named": bool(name), "lat": lat, "lon": lon, "osm": f"{e['type']}/{e['id']}",
                    "dist_m": round(d), "hours_osm": t.get("opening_hours"), "rank": (k == "school" and not k12, not name, d)})
    # cap each kind (named places nearest the centre first), give stable ids
    places, per = [], {}
    for p in sorted(raw, key=lambda p: (p["kind"], p["rank"])):
        n = per.get(p["kind"], 0)
        if n >= KINDS[p["kind"]][1]:
            continue
        per[p["kind"]] = n + 1
        p["id"] = CANONICAL[p["kind"]] if n == 0 and p["kind"] in CANONICAL else f"{p['kind']}-{n + 1}"
        places.append(p)
    if not counts:
        raise LookupError("OpenStreetMap returned no places for this town (or Overpass timed out); not caching an all-synthetic town")
    synthetic = []
    if not any(p["kind"] == "school" for p in places):
        places.append({"id": "school", "kind": "school", "name": "School (synthetic: none mapped nearby)", "named": False, "lat": g["lat"] + 0.004,
                       "lon": g["lon"] - 0.004, "osm": None, "dist_m": None, "hours_osm": None, "rank": (True, True, 9e9), "synthetic": True})
        synthetic.append("school")
    n_work = sum(1 for p in places if KINDS[p["kind"]][2] and p["kind"] != "school")
    for i in range(max(0, 3 - n_work)):
        places.append({"id": f"office-s{i + 1}", "kind": "office", "name": "Workplace (synthetic)", "named": False, "lat": g["lat"] - 0.003 * (i + 1),
                       "lon": g["lon"] + 0.003, "osm": None, "dist_m": None, "hours_osm": None, "rank": (True, True, 9e9), "synthetic": True})
        synthetic.append(f"office-s{i + 1}")
    blocks, placed = place_on_grid(g, places)
    c = None
    census_note = None
    try:
        c = census(g["address"], city)
    except Exception as ex:
        census_note = f"Census lookup failed ({type(ex).__name__}); using defaults"
    mix, mix_source = cohort_mix(c)
    pop = (c or {}).get("population") or (float(g["population_osm"]) if str(g.get("population_osm") or "").replace(".", "").isdigit() else None)
    residents = 72 if not pop else int(max(60, min(120, 40 + 12 * math.log10(max(pop, 10)))))
    return {
        "census_checked": bool(os.environ.get("CENSUS_API_KEY")),
        "version": SPEC_VERSION, "city": city, "source": "osm", "display_name": g["display_name"], "osm": g["osm"],
        "center": {"lat": g["lat"], "lon": g["lon"]}, "radius_m": g["radius_m"],
        "population": pop, "population_source": ((c or {}).get("source") or ("OpenStreetMap population tag" if pop else None)),
        "census": c, "census_note": census_note or (None if c else ("set CENSUS_API_KEY for US demographics" if g["address"].get("country_code") == "us"
                                                                   else "no Census data outside the US")),
        "cohort_mix": mix, "cohort_mix_source": mix_source, "residents": residents,
        "each_resident_represents": round(pop / residents, 1) if pop else None,
        "places": [{**{k: p[k] for k in ("id", "kind", "name", "named", "lat", "lon", "osm", "dist_m", "hours_osm", "block")},
                    "employs": KINDS[p["kind"]][2], "synthetic": bool(p.get("synthetic"))} for p in placed],
        "synthetic_places": synthetic,
        "street_names": [n for n, _ in sorted(streets.items(), key=lambda kv: (-kv[1], kv[0]))][:14],
        "counts_in_area": counts, "blocks": blocks, "grid": GRID,
        "attribution": "Map data (c) OpenStreetMap contributors (ODbL)",
        "notes": ["Streets are schematic (a 6x6 grid) but carry real street names; places, names and rough relative positions are real.",
                  "Homes fill the blocks without a mapped place; residents are a representative sample."],
        "built_in_s": round(time.time() - t0, 1), "fetched_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }


def norm_key(city: str) -> str:
    return "town:" + re.sub(r"\s+", " ", city.strip().lower())


def enrich_census(spec: dict, city: str) -> dict:
    """Add Census demographics to a spec built without them (once; marks census_checked). Same result every time, so the
    browser and the simulator, which both read the stored spec, stay consistent."""
    if spec.get("census_checked") or not os.environ.get("CENSUS_API_KEY"):
        return spec
    spec = dict(spec, census_checked=True)
    try:
        g = geocode(city)
        c = census(g["address"], city)
    except Exception as ex:
        spec["census_note"] = f"Census lookup failed ({type(ex).__name__}); using defaults"
        return spec
    if not c:
        return spec
    mix, src = cohort_mix(c)
    pop = c.get("population") or spec.get("population")
    residents = int(max(60, min(120, 40 + 12 * math.log10(max(pop, 10))))) if pop else spec["residents"]
    spec.update(census=c, census_note=None, cohort_mix=mix, cohort_mix_source=src, population=pop, population_source=c["source"],
                residents=residents, each_resident_represents=round(pop / residents, 1) if pop else None)
    return spec


def status_key(city: str) -> str:
    return norm_key(city) + ":status"


def build_into(city: str, cache) -> None:
    """Build a spec and store it (or the error) in the cache; run in the background."""
    try:
        cache[norm_key(city)] = build_spec(city)
        cache[status_key(city)] = {"state": "ready", "t": time.time()}
    except Exception as ex:
        cache[status_key(city)] = {"state": "error", "t": time.time(), "error": f"{type(ex).__name__}: {str(ex)[:200]}"}


def prebuilt(city: str) -> dict | None:
    """A spec shipped with the backend (built ahead of time for demo towns), if there is one."""
    import json
    path = os.path.join(PREBUILT, re.sub(r"[^a-z0-9]+", "-", city.lower()).strip("-") + ".json")
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            spec = json.load(f)
        return spec if spec.get("version") == SPEC_VERSION else None
    return None


def lookup(city: str, cache, start_build) -> dict:
    """Non-blocking: {"status": "ready", "spec"} | {"status": "building"} | {"status": "error", "error"}."""
    spec = cache.get(norm_key(city), None) or prebuilt(city)
    if spec and spec.get("version") == SPEC_VERSION:
        if not spec.get("census_checked") and os.environ.get("CENSUS_API_KEY"):
            spec = enrich_census(spec, city)
            cache[norm_key(city)] = spec
        return {"status": "ready", "spec": spec}
    st = cache.get(status_key(city), None) or {}
    fresh = time.time() - st.get("t", 0) < 420
    if st.get("state") == "error" and time.time() - st.get("t", 0) < 45:  # map servers are flaky: retry soon after a failure
        return {"status": "error", "error": st["error"]}
    if st.get("state") != "building" or not fresh:
        cache[status_key(city)] = {"state": "building", "t": time.time()}
        start_build(city)
    return {"status": "building"}


def get_spec(city: str, cache) -> dict:
    """Cached spec for a city (cache: dict-like). Raises if the data services fail and nothing is cached."""
    k = norm_key(city)
    spec = cache.get(k, None) or prebuilt(city)
    if spec and spec.get("version") == SPEC_VERSION:
        if not spec.get("census_checked") and os.environ.get("CENSUS_API_KEY"):
            spec = enrich_census(spec, city)
            cache[k] = spec
        return spec
    spec = build_spec(city)
    cache[k] = spec
    return spec
