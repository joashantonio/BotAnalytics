import logging
import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address

from .logging_config import configure_logging
from .routers import trades, symbols, dashboard

configure_logging()
logger = logging.getLogger(__name__)

# Shared rate limiter. Routers attach per-endpoint limits via request.app.state.limiter.
limiter = Limiter(key_func=get_remote_address)

app = FastAPI(title="Trade Handler API", version="1.0.0")
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

origins = os.getenv("CORS_ORIGINS", "http://localhost:5173,http://localhost:3000").split(",")
logger.info("CORS allowed origins: %s", origins)

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(trades.router)
app.include_router(symbols.router)
app.include_router(dashboard.router)


@app.get("/health")
async def health():
    return {"status": "ok"}
