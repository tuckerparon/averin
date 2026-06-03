from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from api.contracts import router as contracts_router
from api.payers import router as payers_router
from api.ehr import router as ehr_router
from api.chat import router as chat_router

app = FastAPI(title="Averin Health API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(contracts_router)
app.include_router(payers_router)
app.include_router(ehr_router)
app.include_router(chat_router)


@app.get("/health")
async def health():
    return {"status": "ok"}
