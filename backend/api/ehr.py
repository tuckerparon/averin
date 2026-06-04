from fastapi import APIRouter, BackgroundTasks
from ehr.metrics import compute_all
from ehr.gaps import run_gap_computation
from db.session import AsyncSessionLocal
from datetime import datetime

router = APIRouter(prefix="/ehr", tags=["ehr"])

_sync_state: dict = {"status": "idle", "last_sync": None, "last_results": None, "gap_summary": None}


async def _run_sync():
    _sync_state["status"] = "running"
    try:
        # Step 1: compute FHIR metrics
        results = await compute_all()
        _sync_state["last_results"] = results

        # Step 2: compute gaps and write to DB
        async with AsyncSessionLocal() as db:
            gap_summary = await run_gap_computation(db, results)
            _sync_state["gap_summary"] = gap_summary

        _sync_state["status"] = "complete"
        _sync_state["last_sync"] = datetime.utcnow().isoformat()
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


@router.get("/sync/gaps")
async def sync_gaps():
    return _sync_state.get("gap_summary", {})
