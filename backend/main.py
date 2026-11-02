"""
AQI Forecast API — Delhi-NCR (LSTM-enabled, date-selectable)
--------------------------------------------------------------
Uses your trained LSTM models (lstm_model_1day.keras, lstm_model_3day.keras)
if present in this folder, along with scaler.pkl / scale_cols.pkl saved
from preprocessing. Falls back to a Ridge regression trained at startup
if any of those files are missing, so the API still works either way.

Supports an optional ?date=YYYY-MM-DD query param on /api/forecast/{city}
so you can forecast from any date in the dataset, not just the last one.

Run:
    pip install -r requirements.txt
    pip install tensorflow joblib
    uvicorn main:app --reload --port 8000
"""

import os
import numpy as np
import pandas as pd
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from sklearn.linear_model import Ridge

DATA_PATH = os.environ.get("AQI_DATA_PATH", "processed_full.csv")
SEQ_LEN = 7  # must match what the LSTM was trained with

FEATURE_COLS = [
    "pm25", "pm10", "no2", "so2", "co", "o3", "temperature", "humidity",
    "wind_speed", "fire_count", "aqi_lag_1", "aqi_lag_2", "aqi_lag_3",
    "aqi_roll_mean_7", "aqi_roll_std_7", "fire_count_roll_mean_7",
    "month_sin", "month_cos", "doy_sin", "doy_cos", "is_pollution_season", "is_weekend",
]

AQI_CATEGORIES = [
    (0, 50, "Good", "#22c55e", "Air quality is safe for everyone."),
    (51, 100, "Satisfactory", "#84cc16", "Minor breathing discomfort for sensitive people."),
    (101, 200, "Moderate", "#eab308", "Breathing discomfort for people with lung/heart disease, children, and the elderly."),
    (201, 300, "Poor", "#f97316", "Breathing discomfort on prolonged exposure. Limit outdoor activity."),
    (301, 400, "Very Poor", "#ef4444", "Respiratory illness on prolonged exposure. Avoid outdoor exertion."),
    (401, 500, "Severe", "#991b1b", "Affects healthy people and seriously impacts those with existing disease. Stay indoors."),
]

def categorize_aqi(aqi: float):
    for lo, hi, label, color, advisory in AQI_CATEGORIES:
        if lo <= aqi <= hi:
            return {"label": label, "color": color, "advisory": advisory}
    return {"label": "Severe", "color": "#991b1b", "advisory": AQI_CATEGORIES[-1][4]}

# ---------------------------------------------------------------------------
# LOAD DATA
# ---------------------------------------------------------------------------
if not os.path.exists(DATA_PATH):
    raise FileNotFoundError(f"Could not find '{DATA_PATH}'. Set AQI_DATA_PATH or place it next to main.py.")

df = pd.read_csv(DATA_PATH, parse_dates=["date"])
df = df.sort_values(["city", "date"]).reset_index(drop=True)
CITIES = sorted(df["city"].unique().tolist())

# ---------------------------------------------------------------------------
# TRY TO LOAD LSTM + SCALER
# ---------------------------------------------------------------------------
LSTM_1D = LSTM_3D = SCALER = SCALE_COLS = None
USING_LSTM = False

try:
    import joblib
    import tensorflow as tf

    if all(os.path.exists(p) for p in
           ["lstm_model_1day.keras", "lstm_model_3day.keras", "scaler.pkl", "scale_cols.pkl"]):
        LSTM_1D = tf.keras.models.load_model("lstm_model_1day.keras")
        LSTM_3D = tf.keras.models.load_model("lstm_model_3day.keras")
        SCALER = joblib.load("scaler.pkl")
        SCALE_COLS = joblib.load("scale_cols.pkl")
        USING_LSTM = True
        print("Loaded trained LSTM models — using them for forecasts.")
    else:
        print("LSTM files not all found — falling back to Ridge regression.")
except Exception as e:
    print(f"Could not load LSTM ({e}) — falling back to Ridge regression.")

# ---------------------------------------------------------------------------
# RIDGE FALLBACK (trained at startup, always available as a safety net)
# ---------------------------------------------------------------------------
def build_target(frame, shift):
    return frame.groupby("city")["aqi"].shift(-shift)

df["target_1d"] = build_target(df, 1)
df["target_3d"] = build_target(df, 3)

ridge_models = {}
for horizon, target_col in [("1d", "target_1d"), ("3d", "target_3d")]:
    train_rows = df.dropna(subset=FEATURE_COLS + [target_col])
    ridge_models[horizon] = Ridge(alpha=1.0).fit(
        train_rows[FEATURE_COLS].values, train_rows[target_col].values
    )

print(f"Ridge fallback ready. Using LSTM: {USING_LSTM}")

# ---------------------------------------------------------------------------
# SEQUENCE BUILDER FOR LSTM — now takes an "as of" date instead of always
# using the very last row, so any date in the dataset can be picked.
# ---------------------------------------------------------------------------
def get_city_row(city: str, target_date: str | None):
    g = df[df["city"] == city].sort_values("date")
    if target_date is None:
        return g.iloc[-1], g
    try:
        ts = pd.to_datetime(target_date, format="%Y-%m-%d")
    except (ValueError, TypeError):
        raise HTTPException(400, f"Invalid date '{target_date}'. Expected format YYYY-MM-DD.")
    match = g[g["date"] == ts]
    if match.empty:
        raise HTTPException(
            400,
            f"No data for {city} on {target_date}. Use /api/date-range/{city} to see valid dates."
        )
    return match.iloc[0], g

def build_sequence(city_series: pd.DataFrame, as_of_row):
    """Build the SEQ_LEN-day window ending at as_of_row (inclusive), scaled."""
    idx = city_series.index.get_loc(as_of_row.name)
    window = city_series.iloc[max(0, idx - SEQ_LEN + 1): idx + 1]
    if len(window) < SEQ_LEN:
        return None
    scaled = SCALER.transform(window[SCALE_COLS].values)
    scaled_df = pd.DataFrame(scaled, columns=SCALE_COLS, index=window.index)
    full = window[FEATURE_COLS].copy()
    for col in SCALE_COLS:
        if col in full.columns:
            full[col] = scaled_df[col]
    return full[FEATURE_COLS].values.reshape(1, SEQ_LEN, len(FEATURE_COLS))

# ---------------------------------------------------------------------------
# APP
# ---------------------------------------------------------------------------
app = FastAPI(title="Delhi-NCR AQI Forecast API")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

@app.get("/api/cities")
def get_cities():
    return {"cities": CITIES}

@app.get("/api/date-range/{city}")
def get_date_range(city: str):
    """So the frontend can constrain the date picker to valid dates."""
    if city not in CITIES:
        raise HTTPException(404, f"Unknown city '{city}'. Options: {CITIES}")
    g = df[df["city"] == city].sort_values("date")
    # earliest selectable date must leave room for a SEQ_LEN-day lookback window
    # and latest selectable date must leave room for a 3-day-ahead target
    min_date = g["date"].iloc[SEQ_LEN - 1]
    max_date = g["date"].iloc[-1]
    return {
        "city": city,
        "min_date": min_date.strftime("%Y-%m-%d"),
        "max_date": max_date.strftime("%Y-%m-%d"),
    }

@app.get("/api/history/{city}")
def get_history(city: str, days: int = 30, date: str | None = None):
    if city not in CITIES:
        raise HTTPException(404, f"Unknown city '{city}'. Options: {CITIES}")
    g = df[df["city"] == city].sort_values("date")
    if date:
            try:
                ts = pd.to_datetime(date, format="%Y-%m-%d")
            except (ValueError, TypeError):
                raise HTTPException(400, f"Invalid date '{date}'. Expected format YYYY-MM-DD.")
            g = g[g["date"] <= ts]
    g = g.tail(days)
    return {
        "city": city,
        "history": [
            {"date": row["date"].strftime("%Y-%m-%d"),
             "aqi": round(float(row["aqi"]), 1),
             "pm25": round(float(row["pm25"]), 1),
             "fire_count": round(float(row["fire_count"]), 1)}
            for _, row in g.iterrows()
        ],
    }

@app.get("/api/forecast/{city}")
def get_forecast(city: str, date: str | None = Query(None, description="YYYY-MM-DD, defaults to latest available")):
    if city not in CITIES:
        raise HTTPException(404, f"Unknown city '{city}'. Options: {CITIES}")

    as_of_row, city_series = get_city_row(city, date)

    note = None
    if USING_LSTM:
        seq = build_sequence(city_series, as_of_row)
        if seq is None:
            raise HTTPException(
                400,
                f"Not enough history before {as_of_row['date'].date()} to build a {SEQ_LEN}-day sequence. "
                f"Pick a later date."
            )
        pred_1d = float(LSTM_1D.predict(seq, verbose=0)[0][0])
        pred_3d = float(LSTM_3D.predict(seq, verbose=0)[0][0])
        pred_2d = (pred_1d + pred_3d) / 2
        note = "48h figure is interpolated between the 24h and 72h LSTM predictions (no dedicated 2-day model was trained)."
        model_name = "LSTM"
    else:
        X_latest = as_of_row[FEATURE_COLS].values.reshape(1, -1)
        pred_1d = float(ridge_models["1d"].predict(X_latest)[0])
        pred_3d = float(ridge_models["3d"].predict(X_latest)[0])
        pred_2d = (pred_1d + pred_3d) / 2
        note = "48h figure is interpolated between the 24h and 72h predictions."
        model_name = "Ridge Regression (fallback)"

    preds = {1: pred_1d, 2: pred_2d, 3: pred_3d}
    horizon_labels = {1: "Tomorrow", 2: "In 2 days", 3: "In 3 days"}

    forecast = []
    for horizon_days in [1, 2, 3]:
        pred = max(0.0, min(500.0, preds[horizon_days]))
        cat = categorize_aqi(pred)
        forecast.append({
            "horizon_hours": horizon_days * 24,
            "horizon_label": horizon_labels[horizon_days],
            "predicted_aqi": round(pred, 1),
            "category": cat["label"],
            "color": cat["color"],
            "advisory": cat["advisory"],
        })

    current_cat = categorize_aqi(float(as_of_row["aqi"]))
    return {
        "city": city,
        "as_of": as_of_row["date"].strftime("%Y-%m-%d"),
        "current_aqi": round(float(as_of_row["aqi"]), 1),
        "current_category": current_cat["label"],
        "current_color": current_cat["color"],
        "current_advisory": current_cat["advisory"],
        "model_used": model_name,
        "note": note,
        "forecast": forecast,
    }

@app.get("/api/summary")
def get_summary():
    out = []
    for city in CITIES:
        latest = df[df["city"] == city].sort_values("date").iloc[-1]
        cat = categorize_aqi(float(latest["aqi"]))
        out.append({"city": city, "aqi": round(float(latest["aqi"]), 1),
                     "category": cat["label"], "color": cat["color"]})
    return {"cities": out}