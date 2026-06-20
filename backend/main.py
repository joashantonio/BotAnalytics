import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .routers import trades, symbols, dashboard

app = FastAPI(title="Trade Handler API", version="1.0.0")

origins = os.getenv("CORS_ORIGINS", "http://localhost:5173,http://localhost:3000").split(",")

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
