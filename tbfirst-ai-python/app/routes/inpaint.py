from fastapi import APIRouter

from app.schemas.image import InpaintRequest, InpaintResponse
from app.services import inpaint_service

router = APIRouter(prefix="/image", tags=["inpaint"])


@router.post("/inpaint", response_model=InpaintResponse)
async def inpaint(req: InpaintRequest) -> InpaintResponse:
    return await inpaint_service.inpaint(req)
