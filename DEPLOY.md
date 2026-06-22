# Deployment Handoff — Trade Handler

For DevOps. Containerized web app: FastAPI backend + React/nginx frontend, orchestrated by Docker Compose.

## TL;DR

```bash
cd app
CORS_ORIGINS=https://<your-public-domain> docker compose up --build -d
```

Only the **frontend** (port `3000`) needs to be reachable from outside. The backend is internal-only (talks to the frontend over the compose network).

---

## VM requirements

| Requirement | Detail |
|---|---|
| Docker + Docker Compose v2 | `docker compose version` should work |
| Outbound internet | **Required.** Backend fetches market OHLCV from Yahoo Finance via `yfinance`. No internet → charts/analytics fail. See "Yahoo Finance" below. |
| RAM | ~1 GB min (pandas/numpy). 2 GB comfortable. |
| Disk | Image build ~1.5 GB. App state (SQLite) grows with uploads — back up the volume. |
| Open inbound port | One only: the public HTTP(S) port → maps to frontend `:3000` (or front it with your own reverse proxy). |

---

## Ports

| Service | Container | Compose | Exposure |
|---|---|---|---|
| frontend (nginx) | 80 | `3000:80` | **public** |
| backend (uvicorn) | 8000 | internal `expose` only | private — NOT published to host |

Frontend nginx proxies `/trades`, `/symbols`, `/health`, `/dashboard/bot-analytics` → `http://backend:8000`. All API traffic flows through the frontend; clients never hit the backend directly.

---

## Configuration

Backend reads two env vars (see `backend/.env.example`):

| Var | Required | Purpose |
|---|---|---|
| `CORS_ORIGINS` | **yes, in prod** | Comma-separated list of public frontend origin(s), e.g. `https://trades.sindbad.tech`. Default is `http://localhost:3000` — wrong on a real domain → browser blocks all API calls with a CORS error. |
| `DB_PATH` | preset | `/data/trade_handler.db` — already set in compose, points at the persistent volume. Leave as-is. |

Set `CORS_ORIGINS` either as a shell var when running compose (TL;DR above) or in a `.env` file next to `docker-compose.yml`:

```
CORS_ORIGINS=https://trades.sindbad.tech
```

---

## Persistence & backup

- All app state = one SQLite DB inside the named volume `trade_data` (mounted at `/data`).
- Holds uploaded CSVs + parsed session metadata. Losing it loses user uploads.
- Back it up:
  ```bash
  docker run --rm -v trade_data:/data -v "$PWD":/backup alpine \
    tar czf /backup/trade_data-$(date +%F).tar.gz -C /data .
  ```

---

## TLS / reverse proxy

App serves plain HTTP on frontend `:3000`. For public use put a reverse proxy (Caddy / nginx / Traefik / cloud LB) in front for:
- TLS termination (HTTPS)
- A real domain → forward to `127.0.0.1:3000`

After choosing the domain, set `CORS_ORIGINS` to that `https://` origin.

---

## Yahoo Finance dependency

Market data comes from Yahoo Finance (`yfinance`). Risks on a cloud VM:
- Yahoo sometimes rate-limits or blocks datacenter IP ranges.
- If charts return empty / errors but the app is otherwise up, this is the likely cause.
- Mitigation if blocked: route outbound through a proxy/egress IP, or cache market data.

---

## Health check

```bash
# from inside the compose network or with backend port temporarily published:
curl http://localhost:8000/health   # -> {"status":"ok"}
# public:
curl https://<domain>/health        # proxied through frontend -> same response
```

---

## Update / rollback

```bash
git pull
docker compose up --build -d   # rebuild + restart, volume (data) preserved
docker compose down            # stop (data preserved in volume)
```
