FROM python:3.12-slim

# curl: used by the container HEALTHCHECK below.
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# copy the backend package
COPY . ./backend

# Run as a non-root user. /data is the mounted volume (DB/cache) — give the
# app user ownership so SQLite can write there.
RUN useradd --create-home --uid 10001 appuser \
    && mkdir -p /data \
    && chown -R appuser:appuser /app /data
USER appuser

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD curl -fsS http://localhost:8000/health || exit 1

# --proxy-headers: trust X-Forwarded-* from nginx so request URLs/scheme are
# correct behind the proxy. Workers scaled via WEB_CONCURRENCY (default 2).
CMD ["sh", "-c", "uvicorn backend.main:app --host 0.0.0.0 --port 8000 --proxy-headers --forwarded-allow-ips '*' --workers ${WEB_CONCURRENCY:-2}"]
