from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import auth, chat, folders, models, papers, users
from app.db.session import init_db
from app.services.parse_worker import resume_stuck_parse_jobs


@asynccontextmanager
async def lifespan(_app: FastAPI):
    init_db()
    await resume_stuck_parse_jobs()
    yield


app = FastAPI(title="研析 Yanxi", version="0.0.6", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:25000", "http://127.0.0.1:25000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(users.router)
app.include_router(models.router)
app.include_router(papers.router)
app.include_router(folders.router)
app.include_router(chat.router)


@app.get("/api/health")
def health():
    return {"status": "ok"}
