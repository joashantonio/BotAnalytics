# Trade Handler — Web App

Interactive trade analytics and chart visualization built on the existing Python logic.

## Architecture

```
app/
├── backend/          FastAPI + Python
│   ├── main.py
│   ├── store.py      In-memory session store
│   ├── routers/
│   │   ├── trades.py   POST /trades/upload, GET /trades/sessions/…
│   │   └── symbols.py  GET /symbols/{session}/…/chart|analytics
│   └── services/
│       ├── psar.py         PSAR computation (ported from existing scripts)
│       ├── trade_parser.py CSV parsing, trade classification
│       ├── market_data.py  yfinance OHLCV fetcher
│       └── chart_builder.py JSON chart payload builder
│
└── frontend/         React + TypeScript + Tailwind + Lightweight Charts
    └── src/
        ├── pages/
        │   ├── UploadPage.tsx
        │   ├── TradesPage.tsx
        │   ├── ChartPage.tsx
        │   └── AnalyticsPage.tsx
        ├── components/
        │   ├── TradeChart.tsx    TradingView Lightweight Charts
        │   ├── AnalyticsDashboard.tsx
        │   └── Navbar.tsx
        ├── hooks/
        │   ├── useSession.ts
        │   └── useChart.ts
        └── api/client.ts
```

## Running Locally

### Backend

```bash
cd app/backend
pip install -r requirements.txt
uvicorn backend.main:app --reload --port 8000
# API docs at http://localhost:8000/docs
```

> Run from the `app/` directory so the `backend` package resolves:
> ```bash
> cd app
> uvicorn backend.main:app --reload --port 8000
> ```

### Frontend

```bash
cd app/frontend
npm install
npm run dev
# http://localhost:5173
```

The Vite dev server proxies `/trades`, `/symbols`, `/health` to `http://localhost:8000`.

## Docker

```bash
cd app
docker compose up --build
# frontend → http://localhost:3000
# backend  → http://localhost:8000
```

## CSV Format

| Column | Example |
|---|---|
| Trade | TRD001 |
| Symbol | 1234 |
| Side | 1 (buy) / 2 (sell) |
| Quantity | 100 |
| Execution Price | 52.50 |
| Execution Date | 2024-03-15T10:00:00 |

## Exchange Suffix

Set the suffix on the Upload page to match your broker's market:

| Market | Suffix |
|---|---|
| Saudi Arabia (Tadawul) | `.SR` |
| US (NYSE / NASDAQ) | *(blank)* |
| Tokyo | `.T` |
| London | `.L` |

## Chart Features

- Candlestick chart with volume histogram
- PSAR dots (orange)
- Buy markers (green arrows) at exact execution price
- Sell markers (red arrows) at exact execution price
- Average Buy line (yellow dashed)
- Average Sell line (purple dashed)
- PSAR cycle quartile levels (Q1 / Q2 / Q3 dividers)
- Zoom, pan, crosshair — all native Lightweight Charts interactions
- Symbol and trade switching via sidebar

## Analytics

- Total P&L, Win Rate, Max Drawdown
- Completed vs Ongoing trade counts
- Per-symbol P&L breakdown
