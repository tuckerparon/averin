from fastapi import APIRouter, BackgroundTasks
from ehr.metrics import compute_all
import asyncio

router = APIRouter(prefix="/ehr", tags=["ehr"])

_sync_state: dict = {"status": "idle", "last_sync": None, "last_results": None}


async def _run_sync():
    _sync_state["status"] = "running"
    try:
        results = await compute_all()
        _sync_state["last_results"] = results
        _sync_state["status"] = "complete"
    except Exception as e:
        _sync_state["status"] = "failed"
        _sync_state["error"] = str(e)


@router.post("/sync")
async def trigger_sync(background_tasks: BackgroundTasks):
    if _sync_state["status"] == "running":
        return {"status": "already_running"}
    background_tasks.add_task(_run_sync)
    return {"status": "queued"}


@router.get("/sync/status")
async def sync_status():
    return _sync_state


@router.get("/sync/results")
async def sync_results():
    return _sync_state.get("last_results", {})
