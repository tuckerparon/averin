from fastapi import APIRouter, Depends, UploadFile, File, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from uuid import UUID
from db.session import get_db
from models import Contract, Metric

router = APIRouter(prefix="/contracts", tags=["contracts"])


@router.post("")
async def upload_contract(file: UploadFile = File(...), db: AsyncSession = Depends(get_db)):
    # TODO: upload to Azure Blob Storage, trigger extraction pipeline
    raise HTTPException(status_code=501, detail="Contract ingestion pipeline not yet implemented")


@router.get("")
async def list_contracts(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Contract).order_by(Contract.upload_date.desc()))
    contracts = result.scalars().all()
    return [
        {
            "id": str(c.id),
            "payer_name": c.payer_name,
            "cms_star_rating": c.cms_star_rating,
            "payment_model": c.payment_model,
            "upload_date": c.upload_date.isoformat(),
            "extraction_status": c.extraction_status,
        }
        for c in contracts
    ]


@router.get("/{contract_id}")
async def get_contract(contract_id: UUID, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Contract).where(Contract.id == contract_id))
    contract = result.scalar_one_or_none()
    if not contract:
        raise HTTPException(status_code=404, detail="Contract not found")
    return contract


@router.get("/{contract_id}/metrics")
async def get_contract_metrics(contract_id: UUID, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Metric).where(Metric.contract_id == contract_id))
    return result.scalars().all()
