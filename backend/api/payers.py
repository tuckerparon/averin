from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from uuid import UUID
from db.session import get_db
from models import Contract, Metric, PerformanceGap

router = APIRouter(prefix="/payers", tags=["payers"])


@router.get("")
async def list_payers(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Contract).order_by(Contract.payer_name))
    contracts = result.scalars().all()
    # TODO: join performance_gaps to add opportunity_$ and status counts
    return [
        {
            "id": str(c.id),
            "payer_name": c.payer_name,
            "cms_star_rating": c.cms_star_rating,
            "payment_model": c.payment_model,
            "extraction_status": c.extraction_status,
        }
        for c in contracts
    ]


@router.get("/{payer_id}/metrics")
async def get_payer_metrics(payer_id: UUID, db: AsyncSession = Depends(get_db)):
    contract = await db.get(Contract, payer_id)
    if not contract:
        raise HTTPException(status_code=404, detail="Payer not found")
    result = await db.execute(select(Metric).where(Metric.contract_id == payer_id))
    return result.scalars().all()
