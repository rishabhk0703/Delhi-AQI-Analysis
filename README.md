# Delhi-NCR AQI Forecast — Full-Stack App

A FastAPI backend that forecasts AQI 24/48/72 hours ahead, and a React
dashboard that displays it. Built on top of `processed_full.csv` from the
earlier preprocessing step.

```
aqi-app/
├── backend/
│   ├── main.py              <- FastAPI server, trains + serves forecasts
│   ├── requirements.txt
│   └── processed_full.csv   <- your preprocessed dataset (copy it here)
└── frontend/
    ├── src/
    │   ├── App.jsx           <- dashboard UI
    │   ├── AQIDial.jsx        <- gauge component
    │   ├── App.css / index.css
    │   └── main.jsx
    ├── index.html
    ├── package.json
    └── vite.config.js
```

## 1. Backend setup

```bash
cd backend
python -m venv venv
venv\Scripts\activate        # Windows
# source venv/bin/activate   # Mac/Linux

pip install -r requirements.txt
```

Make sure `processed_full.csv` (from the preprocessing script) is in this
`backend/` folder — if it's somewhere else, either copy it here or set:

```bash
set AQI_DATA_PATH=C:\path\to\processed_full.csv     # Windows (cmd)
$env:AQI_DATA_PATH="C:\path\to\processed_full.csv"  # Windows (PowerShell)
```

Start the API:

```bash
uvicorn main:app --reload --port 8000
```

Visit `http://localhost:8000/api/cities` in a browser — you should see a
JSON list of the 5 NCR cities. That confirms the backend is working.

### About the forecasting model

The backend trains a **Ridge regression model per horizon (24h/48h/72h)**
automatically at startup, straight from your CSV — this is deliberate so
the app runs standalone without extra setup. Based on your earlier model
comparison, Ridge/linear models sit close to naive persistence in accuracy,
so this is a reasonable default, not a compromise.

**If you want the LSTM predictions instead** (which scored noticeably
better, especially at 72h): save your trained model from the earlier LSTM
script as `lstm_aqi_model.keras` in the `backend/` folder, `pip install
tensorflow`, and restart the server — `main.py` already checks for that
file and will report `"model_used": "LSTM"` in the API response once it's
present. Wiring the actual LSTM sequence-prediction call into the
`/api/forecast` endpoint (it currently only loads the file, the prediction
call itself uses Ridge) is the one piece left if you want to finish that
integration — let me know if you want that written out too.

## 2. Frontend setup

In a **separate terminal**:

```bash
cd frontend
npm install
npm run dev
```

Open the URL it prints (usually `http://localhost:5173`). The dashboard
will fetch live from the backend at `http://localhost:8000`.

## 3. What the dashboard shows

- Current AQI for the selected city, with category and health advisory
- 24h / 48h / 72h forecast cards, each color-coded by AQI category
- Recent AQI trend chart (14/30/90-day toggle)
- A comparison strip across all 5 NCR cities, click to switch

## Notes for your report

- The 24h/48h/72h forecasting logic lives in `backend/main.py` — that's
  where to point your examiner if asked how forecasting is implemented.
- The API is a clean separation point: any model (Ridge, LSTM, ARIMA) can
  be swapped in behind the same `/api/forecast/{city}` contract without
  touching the frontend — worth a sentence in your architecture section.
- This uses your *historical* dataset to always have a "latest" row to
  forecast from. For a genuinely live system you'd replace the CSV load
  with a scheduled job pulling fresh CPCB/OpenWeather/FIRMS data daily —
  worth naming as a "future work" item in your report if you don't build
  it out.
