from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel
from db.session import get_db

router = APIRouter(prefix="/chat", tags=["chat"])


class ChatRequest(BaseModel):
    message: str
    session_id: str | None = None


@router.post("")
async def chat(request: ChatRequest, db: AsyncSession = Depends(get_db)):
    # TODO: RAG retrieval + Azure OpenAI streaming response
    return {"response": "Chatbot not yet implemented", "session_id": request.session_id}


@router.get("/history")
async def chat_history(session_id: str, db: AsyncSession = Depends(get_db)):
    # TODO: retrieve from chat_messages
    return {"messages": []}
