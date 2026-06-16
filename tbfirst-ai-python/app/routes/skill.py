from fastapi import APIRouter

from app.schemas import SkillRunRequest

router = APIRouter(prefix="/skill", tags=["skill"])


@router.get("/list")
async def list_skills() -> dict:
    # todo 预留接口，当前暂未实现 —— 从 app/skills 扫描并返回
    return {"skills": []}


@router.post("/run")
async def run(req: SkillRunRequest) -> dict:
    # todo 预留接口，当前暂未实现 —— 根据 skill 名字派发到具体实现
    return {"skill": req.skill, "result": None, "todo": "not implemented"}
