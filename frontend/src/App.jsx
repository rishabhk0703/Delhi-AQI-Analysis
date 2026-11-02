import React, { useEffect, useState, useCallback } from 'react'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'
import AQIDial from './AQIDial.jsx'
import './App.css'

const API_BASE = 'http://localhost:8000/api'

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload || !payload.length) return null
  return (
    <div style={{
      background: '#1a222d', border: '1px solid #263141', borderRadius: 8,
      padding: '8px 12px', fontSize: 12,
    }}>
      <div style={{ color: '#8695a7', marginBottom: 4 }}>{label}</div>
      <div style={{ color: '#e7edf3', fontFamily: 'var(--font-mono)', fontWeight: 700 }}>
        AQI {payload[0].value}
      </div>
    </div>
  )
}

export default function App() {
  const [cities, setCities] = useState([])
  const [selectedCity, setSelectedCity] = useState(null)
  const [dateRange, setDateRange] = useState({ min_date: '', max_date: '' })
  const [selectedDate, setSelectedDate] = useState('') // '' = latest available
  const [forecast, setForecast] = useState(null)
  const [history, setHistory] = useState([])
  const [summary, setSummary] = useState([])
  const [range, setRange] = useState(30)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    async function init() {
      try {
        const [citiesRes, summaryRes] = await Promise.all([
          fetch(`${API_BASE}/cities`).then((r) => r.json()),
          fetch(`${API_BASE}/summary`).then((r) => r.json()),
        ])
        setCities(citiesRes.cities)
        setSummary(summaryRes.cities)
        setSelectedCity(citiesRes.cities[0])
      } catch (e) {
        setError('Could not reach the forecast API. Is the backend running on port 8000?')
        setLoading(false)
      }
    }
    init()
  }, [])

  // Fetch the valid date range whenever the city changes, and reset the picker
  useEffect(() => {
    if (!selectedCity) return
    fetch(`${API_BASE}/date-range/${selectedCity}`)
      .then((r) => r.json())
      .then((d) => {
        setDateRange(d)
        setSelectedDate(d.max_date) // default to latest, but now editable
      })
      .catch(() => {})
  }, [selectedCity])

  const loadCityData = useCallback(async (city, days, date) => {
    setLoading(true)
    setError(null)
    try {
      const dateParam = date ? `&date=${date}` : ''
      const forecastUrl = date ? `${API_BASE}/forecast/${city}?date=${date}` : `${API_BASE}/forecast/${city}`
      const [forecastRes, historyRes] = await Promise.all([
        fetch(forecastUrl).then((r) => r.json()),
        fetch(`${API_BASE}/history/${city}?days=${days}${dateParam}`).then((r) => r.json()),
      ])
      setForecast(forecastRes)
      setHistory(
        historyRes.history.map((h) => ({
          ...h,
          label: h.date.slice(5),
        }))
      )
    } catch (e) {
      setError('Could not reach the forecast API. Is the backend running on port 8000?')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (selectedCity && selectedDate) loadCityData(selectedCity, range, selectedDate)
  }, [selectedCity, selectedDate, range, loadCityData])

  if (error) {
    return (
      <div className="app">
        <div className="state-msg error">
          {error}
          <div style={{ marginTop: 10, fontSize: 12, color: '#576374' }}>
            Run: <code>uvicorn main:app --reload --port 8000</code> from the backend folder.
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="app">
      <header className="header">
        <div>
          <p className="header-eyebrow">Delhi-NCR &middot; Air Quality</p>
          <h1>AQI Forecast Dashboard</h1>
          <p className="header-sub">Next 24&ndash;72 hour air quality outlook from any date in the dataset.</p>
        </div>
        <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
          <div className="city-picker">
            {cities.map((c) => (
              <button
                key={c}
                className={`city-chip ${c === selectedCity ? 'active' : ''}`}
                onClick={() => setSelectedCity(c)}
              >
                {c}
              </button>
            ))}
          </div>
        <input
          type="date"
          value={selectedDate}
          min={dateRange.min_date}
          max={dateRange.max_date}
          onChange={(e) => {
            const val = e.target.value
            // Ignore incomplete values while the user is still typing digits
            // (e.g. HTML date inputs fire onChange after every keystroke, so a
            // partial year like "0002-12-28" can briefly appear).
            if (/^\d{4}-\d{2}-\d{2}$/.test(val) && val.slice(0, 4) >= "1900") {
              setSelectedDate(val)
            }
          }}
          style={{
            background: '#121821',
            border: '1px solid #263141',
            color: '#e7edf3',
            borderRadius: 8,
            padding: '7px 10px',
            fontSize: 13,
            fontFamily: 'var(--font-mono)',
          }}
        />
        </div>
      </header>

      {loading && !forecast ? (
        <div className="state-msg">Loading forecast&hellip;</div>
      ) : forecast ? (
        <>
          <section className="hero">
            <div className="dial-wrap">
              <AQIDial value={forecast.current_aqi} color={forecast.current_color} />
            </div>
            <div className="hero-info">
              <p className="as-of">Reading for {forecast.as_of} &middot; {forecast.city}</p>
              <span
                className="category-label"
                style={{
                  color: forecast.current_color,
                  background: `${forecast.current_color}1a`,
                }}
              >
                {forecast.current_category}
              </span>
              <p className="advisory">{forecast.current_advisory}</p>
            </div>
          </section>

          <p className="section-label">Forecast &middot; model: {forecast.model_used}</p>
          <div className="forecast-row">
            {forecast.forecast.map((f) => (
              <div
                key={f.horizon_hours}
                className="forecast-card"
                style={{ borderLeftColor: f.color }}
              >
                <p className="horizon">{f.horizon_label} &middot; +{f.horizon_hours}H</p>
                <div className="value-row">
                  <span className="value" style={{ color: f.color }}>{f.predicted_aqi}</span>
                  <span className="unit">AQI</span>
                </div>
                <p className="cat" style={{ color: f.color }}>{f.category}</p>
                <p className="desc">{f.advisory}</p>
              </div>
            ))}
          </div>

          <div className="chart-panel">
            <div className="chart-panel-header">
              <h3>AQI trend up to {forecast.as_of} &mdash; {forecast.city}</h3>
              <div className="range-toggle">
                {[14, 30, 90].map((d) => (
                  <button
                    key={d}
                    className={range === d ? 'active' : ''}
                    onClick={() => setRange(d)}
                  >
                    {d}d
                  </button>
                ))}
              </div>
            </div>
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={history} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="aqiFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#4fd1c5" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#4fd1c5" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#1c2530" vertical={false} />
                <XAxis dataKey="label" stroke="#576374" fontSize={11} tickLine={false} axisLine={false} />
                <YAxis stroke="#576374" fontSize={11} tickLine={false} axisLine={false} width={36} />
                <Tooltip content={<CustomTooltip />} />
                <Area
                  type="monotone"
                  dataKey="aqi"
                  stroke="#4fd1c5"
                  strokeWidth={2}
                  fill="url(#aqiFill)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          <p className="section-label">All NCR cities &middot; current reading</p>
          <div className="city-strip">
            {summary.map((c) => (
              <div
                key={c.city}
                className={`city-strip-card ${c.city === selectedCity ? 'active' : ''}`}
                onClick={() => setSelectedCity(c.city)}
              >
                <p className="name">{c.city}</p>
                <div className="row">
                  <span className="dot" style={{ background: c.color }} />
                  <span className="num">{c.aqi}</span>
                </div>
              </div>
            ))}
          </div>

          <p className="footer-note">
            Forecasts are model estimates from historical AQI, pollutant, and fire-activity data &mdash;
            treat as guidance, not a substitute for official CPCB advisories.
          </p>
        </>
      ) : null}
    </div>
  )
}