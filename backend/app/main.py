from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import auth, chat, folders, models, papers, skill, users
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
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
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
app.include_router(skill.router)


@app.get("/api/health")
def health():
    return {"status": "ok"}
