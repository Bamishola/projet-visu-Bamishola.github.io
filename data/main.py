import requests
import pandas as pd
import time

API_KEY = "71a2dae2f9adc18318fa19915d0d267e717363f0d093f3a897cb92684cae8efd"
BASE = "https://api.openaq.org/v3"

H = {"X-API-Key": API_KEY}



# Polluants d’intérêt (tu peux en ajouter)
PARAMS = {"pm25", "pm10", "no2", "o3", "so2", "co"}

def pick_date(d: dict):
    """
    OpenAQ v3 peut renvoyer la date sous plusieurs clés.
    On essaie plusieurs possibilités.
    """
    for k in ("date", "day", "datetime", "datetimeUtc", "datetimeLocal"):
        if d.get(k):
            return d.get(k)

    # Parfois c'est imbriqué
    if isinstance(d.get("datetime"), dict):
        return d["datetime"].get("utc") or d["datetime"].get("local")

    if isinstance(d.get("period"), dict):
        # ex: period.start / period.end
        return d["period"].get("start") or d["period"].get("startDate")

    return None

def get_locations_near(lat, lon, radius=25000, limit=1000, max_pages=1):
    out = []
    for page in range(1, max_pages + 1):
        r = requests.get(
            f"{BASE}/locations",
            headers=H,
            params={
                "coordinates": f"{lat},{lon}",
                "radius": radius,
                "limit": limit,
                "page": page,
            },
            timeout=60,
        )
        r.raise_for_status()
        j = r.json()
        res = j.get("results", [])
        print(f"[locations] page={page} got={len(res)}")
        if not res:
            break
        out.extend(res)
        time.sleep(0.15)
    return out

def fetch_sensor_days(sensor_id, date_from, date_to, limit=1000, max_pages=50):
    rows = []
    page = 1
    while page <= max_pages:
        r = requests.get(
            f"{BASE}/sensors/{sensor_id}/days",
            headers=H,
            params={
                "datetimeFrom": date_from,
                "datetimeTo": date_to,
                "limit": limit,
                "page": page,
            },
            timeout=60,
        )

        # Rate limit
        if r.status_code == 429:
            wait = int(r.headers.get("x-ratelimit-reset", "30"))
            print(f"[429] sensor={sensor_id} wait {wait}s")
            time.sleep(wait)
            continue

        r.raise_for_status()
        j = r.json()
        res = j.get("results", [])
        if not res:
            break

        # DEBUG: regarder les clés du 1er résultat
        if page == 1:
            print(f"[days] sensor={sensor_id} sample keys:", list(res[0].keys()))

        rows.extend(res)
        print(f"[days] sensor={sensor_id} page={page} +{len(res)} total={len(rows)}")
        page += 1
        time.sleep(0.12)

    return rows

def download_city_daily(city, lat, lon, date_from="2024-01-01", date_to="2024-03-31",
                        radius=25000, sensors_limit=15):
    """
    ⚠️ Pour aller vite, commence petit (ex: 3 mois) puis élargis.
    """
    print(f"\n=== {city} {date_from} → {date_to} ===")

    locs = get_locations_near(lat, lon, radius=radius, max_pages=1)
    if not locs:
        print("No locations found.")
        return pd.DataFrame()

    # Extraire sensors depuis les locations
    sensors = []
    for loc in locs:
        coords = loc.get("coordinates") or {}
        for s in (loc.get("sensors") or []):
            param = (s.get("parameter") or {}).get("name")
            if param and param.lower() in PARAMS:
                sensors.append({
                    "city": city,
                    "location_id": loc.get("id"),
                    "location_name": loc.get("name"),
                    "country": (loc.get("country") or {}).get("code"),
                    "latitude": coords.get("latitude"),
                    "longitude": coords.get("longitude"),
                    "sensor_id": s.get("id"),
                    "parameter": param.lower(),
                    "unit": (s.get("parameter") or {}).get("units"),
                })

    if not sensors:
        print("Locations found, but no matching sensors for PARAMS.")
        return pd.DataFrame()

    df_sensors = pd.DataFrame(sensors).dropna(subset=["sensor_id"]).drop_duplicates(subset=["sensor_id"])
    df_sensors = df_sensors.head(sensors_limit)
    print("Sensors kept:", len(df_sensors))

    all_rows = []
    for _, s in df_sensors.iterrows():
        sid = int(s["sensor_id"])
        days = fetch_sensor_days(sid, date_from, date_to)

        for d in days:
            all_rows.append({
                **s.to_dict(),
                "date": pick_date(d),       # ✅ ici on corrige le problème
                "value": d.get("value"),
            })

    out = pd.DataFrame(all_rows)
    return out

# ====== TEST RAPIDE (Paris) ======
df = download_city_daily(
    city="Paris",
    lat=48.8566,
    lon=2.3522,
    date_from="2024-01-01",
    date_to="2024-02-15",
    sensors_limit=10
)

print(df.head(10))
df.to_csv("openaq_paris_daily.csv", index=False)
print("Saved: openaq_paris_daily.csv rows:", len(df))
