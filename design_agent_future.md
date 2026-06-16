# 创意 Agent 总体设计：全自动流水线 + 并行子 Agent

> 关联文档（本文是四者的综合落点 / North Star）：
> - `context_future.md` — L1–L4 上下文压缩（**已完成**，本设计直接复用）
> - `tool_future.md` — 工具层硬化（ToolSpec 注册表 / 结果预算 / 并发 / 错误信封）
> - `agent_future2.md` — 思维范式（ReAct / Plan-Solve / Reflection）
> - `agent_future.md` — Claude Code 机制参考目录（按需取用，**不照搬其编码 agent 优先级**）
>
> 当前实现：`app/agent/graph/`（LangGraph + Gemini，单条 ReAct 循环 + 6 层记忆 + 5 个检索/创作工具）
> 参考：`E:\github-clone\repo_analysis\docs\07-multi-agent.md`、`15-task-system.md`

---

## 〇、愿景与定位

**目标产品**：一个**创意 Agent**，对外暴露**多条一键全自动流水线**，用户给一句目标就能跑完整条创作链，中途无需逐步干预。典型流水线：

- **脚本 → 最终视频**：用户给创意 brief → 自动写脚本 → 拆分镜 → 并行出宫格图 → 拼接成片 → 自检定稿。
- **竞品分析**：用户给品类/品牌 → 自动拆解维度 → **并行**上网调研多个竞品 → 对抗式核实 → 产出对比报告。
- 后续可扩展：品牌视觉提案、系列企划、色彩方案生成等。

三个硬能力：**① 全自动多步流水线一键跑通；② 自主上网搜寻与研究；③ 派生多个并行子 Agent 协作。**

**与当前的差距**：现在是"薄 ReAct 对话 Agent"——只能搜、能提交一张图，单循环、单 Agent、无流水线、无并行、无质量门。本设计把它升级成"**确定性编排 + 智能执行 + 质量自检**"的流水线 Agent。

**设计原则**：
1. **领域适配优先**——这是创意 Agent，不是 coding agent；不引入 bash/文件写这类危险面（详见 `agent_future.md` 复盘）。
2. **确定性编排，智能执行**——流水线骨架（DAG、依赖、并行、重试）用代码写死保证确定性；每个 stage 内部交给 LLM 子 Agent（ReAct）发挥。这正是 Plan-Solve 思想的工程化：**DAG 即计划，子 Agent 即执行器**。
3. **每个创意产物过质量门**——图/视频/脚本生成后自检，不合格自动重做（Reflection）。
4. **可预算、可恢复、可观测**——长流水线必须有 token/成本预算、熔断、断点续跑、前端进度。

---

## 一、总体架构（三层）

```
┌─ Tier 0：对话入口（现有 ReAct 主图，app/agent/graph/build.py）───────────────┐
│  识别意图：普通对话 → 原路径；流水线意图 → 调 run_pipeline 工具移交 Tier 1      │
└───────────────────────────────────────────────────────────────────────────┘
                                   │ run_pipeline(name 或 goal)
                                   ▼
┌─ Tier 1：Pipeline Orchestrator（确定性 DAG 编排，app/agent/pipeline/runner.py）─┐
│  - 已知流水线：读 PipelineSpec（声明式 DAG）                                      │
│  - 新目标：LLM planner 动态生成 PipelineSpec（Plan-Solve 动态规划）             │
│  - 按依赖拓扑执行；无依赖的 stage 并行 fan-out；带重试/预算/断点续跑             │
└───────────────────────────────────────────────────────────────────────────┘
        │ 每个 stage                         │ parallel_over: fan-out
        ▼                                   ▼
┌─ Tier 2：Stage Executor ───────────────────────────────────────────────────┐
│  kind=tool      → 确定性工具调用（如 assemble_video、generate_storyboard_grid）│
│  kind=subagent  → 派生子 Agent（作用域化 ReAct 子图）+ 可选 Reflection 质量门   │
│  并行 stage     → spawn_subagents（asyncio.gather + Semaphore 并发上限）        │
└───────────────────────────────────────────────────────────────────────────┘
```

**为什么编排放代码、不放 LangGraph 主图**：N 个镜头并行出图 + 每项独立重试 + 全局预算，在静态 StateGraph 里很别扭；用代码驱动的 runner（loops/conditionals/fan-out 都是普通 Python）更干净，也符合"确定性控制流"原则。子 Agent 仍是 LangGraph agent 的作用域化调用——LangGraph 投资不浪费。

---

## 二、流水线子系统

### 2.1 PipelineSpec — 声明式 DAG

```python
# app/agent/pipeline/spec.py
from __future__ import annotations
from dataclasses import dataclass, field
from typing import Literal, Optional

@dataclass(frozen=True)
class StageSpec:
    name: str
    kind: Literal["tool", "subagent"]
    deps: list[str] = field(default_factory=list)   # 依赖的前序 stage 名
    # 对上游某个列表产物 fan-out 并行执行（如对 shots 列表逐镜头出图）
    parallel_over: Optional[str] = None
    tool: Optional[str] = None                        # kind=tool：调用哪个工具
    agent_type: Optional[str] = None                  # kind=subagent：哪类子 Agent
    reflect: bool = False                             # 产物是否过质量门
    max_retries: int = 1

@dataclass(frozen=True)
class PipelineSpec:
    name: str
    description: str
    stages: list[StageSpec]
```

### 2.2 两条样板流水线

**A. 竞品分析（纯文本 + Web，最易，建议首发）**

```python
COMPETITOR_ANALYSIS = PipelineSpec(
    name="competitor_analysis",
    description="给定品类/品牌，并行调研多个竞品，核实后产出对比报告",
    stages=[
        StageSpec("plan",      "subagent", agent_type="planner"),          # 拆解竞品清单 + 对比维度
        StageSpec("research",  "subagent", deps=["plan"], agent_type="research",
                  parallel_over="competitors", max_retries=2),             # ★ 每个竞品一个子 Agent 并行上网
        StageSpec("verify",    "subagent", deps=["research"], agent_type="verifier"),  # 对抗式核实关键声明
        StageSpec("synthesize","subagent", deps=["verify"], agent_type="writer", reflect=True),  # 对比报告 + 质量门
    ],
)
```

**B. 脚本 → 最终视频（图/视频，最重，最后做）**

```python
SCRIPT_TO_VIDEO = PipelineSpec(
    name="script_to_video",
    description="创意 brief → 脚本 → 分镜 → 并行出宫格图 → 拼接成片 → 定稿",
    stages=[
        StageSpec("brief",      "subagent", agent_type="research"),                    # 理解 brief + 找参考（可上网）
        StageSpec("script",     "subagent", deps=["brief"], agent_type="writer", reflect=True),
        StageSpec("storyboard", "subagent", deps=["script"], agent_type="storyboard", reflect=True),  # 剧本→分镜表
        StageSpec("grids",      "tool",     deps=["storyboard"], tool="generate_storyboard_grid",
                  parallel_over="shots", reflect=True, max_retries=2),                # ★ 逐镜头并行出图 + 多模态自检
        StageSpec("assemble",   "tool",     deps=["grids"], tool="assemble_video"),    # 图序列+时长+转场→mp4
        StageSpec("final",      "subagent", deps=["assemble"], agent_type="verifier", reflect=True),
    ],
)

PIPELINES = {p.name: p for p in (COMPETITOR_ANALYSIS, SCRIPT_TO_VIDEO)}
```

### 2.3 Pipeline Runner（async 驱动 + fan-out + 重试 + 预算）

```python
# app/agent/pipeline/runner.py（要点骨架）
import asyncio

async def run_pipeline(spec: PipelineSpec, ctx: PipelineContext) -> dict:
    results: dict[str, object] = {}
    done: set[str] = set()
    # 拓扑批次：每批是"依赖已满足"的 stage，可并发跑
    for batch in _topo_batches(spec.stages):
        await asyncio.gather(*[
            _run_stage(st, results, ctx) for st in batch
        ])
        done.update(s.name for s in batch)
        ctx.checkpoint(results, done)          # 每批落库，支持断点续跑
        ctx.budget.assert_ok()                 # 预算/熔断闸（超支即停）
    return results

async def _run_stage(st: StageSpec, results: dict, ctx: PipelineContext):
    ctx.emit("stage_start", st.name)
    try:
        if st.parallel_over:                    # ★ fan-out：对上游列表逐项并行
            items = _resolve(results, st.parallel_over)   # 如 storyboard 产出的 shots
            sem = asyncio.Semaphore(ctx.max_parallel)     # 并发上限（默认 4）
            async def one(item, i):
                async with sem:
                    return await _exec_with_retry(st, {**results, "_item": item, "_idx": i}, ctx)
            results[st.name] = await asyncio.gather(*[one(it, i) for i, it in enumerate(items)],
                                                    return_exceptions=True)
        else:
            results[st.name] = await _exec_with_retry(st, results, ctx)
        ctx.emit("stage_end", st.name)
    except Exception as e:
        ctx.emit("stage_error", st.name, str(e))
        raise

async def _exec_with_retry(st, scope, ctx):
    for attempt in range(st.max_retries + 1):
        out = (await _call_tool(st.tool, scope, ctx) if st.kind == "tool"
               else await spawn_subagent(st.agent_type, _stage_prompt(st, scope), ctx))
        if not st.reflect:
            return out
        ok, critique = await reflect_gate(st, out, ctx)     # 质量门（见 §五）
        if ok or attempt == st.max_retries:
            return out
        scope = {**scope, "_critique": critique}            # 带反馈重做一轮
```

要点：① **拓扑分批 + 批内并发**实现 DAG；② `parallel_over` 是并行子 Agent 的核心入口；③ `_exec_with_retry` 把 Reflection 内联进重试；④ 每批 `checkpoint` 落库 + `budget` 闸保证可恢复、不烧爆。

### 2.4 持久化与恢复

长流水线必须能断点续跑（部署是 `push→迷你主机 pull→docker rebuild`，进程会重启）。每个 run + stage 落 PG（见 §九数据模型）。重启后 runner 读 `done` 集合，跳过已完成 stage——这是 `agent_future.md` §5 任务存储思想的"流水线版"。

### 2.5 动态规划（新目标 → 自动生成 DAG）

已知流水线走声明式 spec；遇到没预置的目标时，由 **planner 子 Agent** 生成 `PipelineSpec`（输出 JSON，校验后实例化），再交同一个 runner 执行。这就是 `agent_future2.md` 的 Plan-Solve 动态形态。**先做声明式（确定、可控），动态规划留到 M4**——别一上来就让 LLM 自由编排，难调试。

---

## 三、并行子 Agent

### 3.1 子 Agent = 作用域化的 ReAct 子图

子 Agent 不是新写一套循环，而是**复用现有 LangGraph agent**，只改三处：自包含 prompt、作用域工具集、隔离 state。

| 维度 | 父 Agent | 子 Agent |
|------|---------|---------|
| messages | 完整会话 | **克隆/全新**，自包含 prompt，看不到父历史 |
| 工具集 | 全量 ALL_TOOLS | **按 agent_type 过滤**（research 只给 web_search/web_fetch；writer 不给出图） |
| DB / image 客户端 | 共享 | 共享（无状态连接可共享） |
| pipeline run / 任务存储 | — | **共享**（多 Agent 协调的基础） |
| abort 信号 | 父控制器 | 子控制器（父中断→子中断，反向不传播） |

### 3.2 spawn_subagents（并发上限 + 隔离 + 异常归一）

```python
# app/agent/pipeline/subagent.py
import asyncio, contextvars

_agent_ctx = contextvars.ContextVar("agent_ctx")    # Python 版 AsyncLocalStorage 隔离

async def spawn_subagents(tasks: list["SubAgentTask"], ctx, limit: int = 4):
    sem = asyncio.Semaphore(limit)
    async def run_one(t):
        async with sem:
            scoped = _scoped_state(t)               # 隔离 messages + 作用域工具
            try:
                return await ctx.agent_graph.ainvoke(scoped, _cfg(t))
            except Exception as e:                  # 异常归一为结果，不炸整批（错误即数据）
                return {"ok": False, "error": str(e), "task": t.name}
    return await asyncio.gather(*[run_one(t) for t in tasks])   # 不 raise，逐个降级
```

### 3.3 上下文隔离原则（deny by default）

子 Agent 的 prompt **必须自包含**——它看不到父对话，所有需要的信息（目标、约束、上游产物）都要写进 prompt。这是 `agent_future.md` §7 / 多 Agent 分析里反复强调的"Never write 'based on your findings'"：协调方必须自己消化上游结果，下达**具体**指令，而不是甩一句"根据你的发现"。

### 3.4 协调器模式（仅编排不执行）

实施阶段（如多镜头改图）若需 Agent 间协商，用协调器：工具集仅限 spawn/通信/停止，**自己不碰创作**。研究阶段自由并行；实施阶段按"产物集"串行防冲突（两个子 Agent 不同时改同一张图）。**M4 再上**，前期 runner 的确定性 fan-out 已够用。

---

## 四、自主网络研究（deep research 能力）

现状 `web_search` 只是单次 Gemini grounding，做竞品分析不够。升级为 research 子 Agent + 新工具：

### 4.1 能力升级

```
research 子 Agent（ReAct 循环）：
  ① 多查询 fan-out（一个竞品拆成"定价/产品线/视觉风格/用户评价"多查询）
  ② web_search 找候选源 → web_fetch 抓正文（新工具）
  ③ 抽取结构化字段（按 plan 的维度）
  ④ 关键声明交 verifier 子 Agent 对抗式核实（防幻觉/过时）
  ⑤ 带引用合成
```

### 4.2 新增 `web_fetch` 工具 + research agent_type

```python
# app/agent/graph/tools/web_fetch.py
@tool
async def web_fetch(url: str) -> dict:
    """抓取网页正文（去样板/截断到预算内），供 research 子 Agent 深读。
    返回 {ok, url, title, text, chars}。结果超 max_result_chars 走 §tool_future 落盘预算。"""
```

research 子 Agent 的工具白名单：`web_search` + `web_fetch` + `knowledge_search`（叠加内部品牌知识），**不给**出图/写库工具。

---

## 五、质量层：Reflection / Verify（每个创意 stage 的门）

来自 `agent_future2.md` Phase C。流水线里每个 `reflect=True` 的 stage 产出后过门：

| 产物 | 评估器 | 信号强度 |
|------|--------|---------|
| 图 / 视频帧 | **多模态 Gemini 自评**：是否匹配 prompt + 品牌 DNA + 分镜要求（0-1 分 + 改进点） | 中 |
| 脚本 / 分镜表 | **rubric 自评**：对照 `basic_rules`/品牌禁忌词逐条打分 + 字段完整性校验 | 中弱（rubric 抑制合理化） |
| 研究结论 | **verifier 子 Agent 对抗式核实**（独立视角，刻意找反例） | 强 |

防退化三件套：① 硬预算 `max_retries`（默认 1，重做 1 次封顶）；② 评估器与生成器用**不同 prompt 视角**（避免自我确认偏误）；③ 评估器报错默认放行，不阻断流水线。

---

## 六、可靠性与资源治理

| 机制 | 说明 | 来源 |
|------|------|------|
| 错误自恢复 | 子 Agent 内 `llm_call` 捕获上下文超限→强制压缩→重试；输出截断→续写。**不暴露给用户** | `agent_future.md` §3（保留） |
| 上下文压缩 | 流水线产生海量工具输出，压缩更关键。直接复用 L1–L4 级联 | `context_future.md`（已完成） |
| 工具结果预算 | 每工具出口按 `max_result_chars` 落盘 + 占位 + `read_cached_tool_result` 找回 | `tool_future.md` |
| Token/成本预算 | 每个 pipeline run 设总预算；`ctx.budget` 超支即停并产出"部分结果" | 本文 §2.3 |
| 熔断 | 复用 `compression/circuit_breaker.py` 的 **per-session/per-run** 熔断：planner/评估器/出图连续失败则降级 | `context_future.md` |
| 超时/后台化 | 长 stage（出视频）后台执行，SSE 推进度，不阻塞 | `agent_future.md` §3 |
| 并发上限 | `spawn_subagents` Semaphore（默认 4），防句柄/配额耗尽 | 本文 §3.2 |

---

## 七、领域工具盘点（要新建/升级的）

复用 `tool_future.md` 的 ToolSpec 注册表 / 结果预算 / 统一错误信封。

| 工具 | 类型 | 包装的服务 | 性质 |
|------|------|-----------|------|
| `run_pipeline(name 或 goal, params)` | 入口 | Tier 1 runner | 写（触发长任务） |
| `spawn_agent` | 编排 | Tier 2 子 Agent | 写 |
| `generate_storyboard_grid` | 创作 | 现有 `/storyboard/generate-grid` | 写（出图） |
| `revise_image` / inpaint | 创作 | image 服务 / SmartInpaint | 写 |
| `assemble_video` | 创作 | **新建视频拼接服务**（图序列+时长+转场+可选 TTS→mp4） | 写 |
| `color_palette` | 创作 | 色彩实验室 | 写 |
| `web_fetch` | 研究 | 抓正文 | 只读 |
| `web_search`（现有） | 研究 | Gemini grounding | 只读 |

> **关键约束——自主流水线的图片落库**（见记忆 `图片落库架构`）：现在出图返回 base64，落库靠**前端** `uploadDataUrisToGcs→/api/image/upload`。但全自动流水线**前端不在回路里**，必须走**服务端落库**——要么 image 服务直接持久化并回 URL，要么 runner 服务端调 `/api/image/upload`（带鉴权）。**这是 script_to_video 落地前必须先定的架构点**，否则产物拿不到可引用的 URL，视频拼接拿不到素材。

> `assemble_video` 是最重的新能力：本项目现有 cinestitch 只到"宫格图 + 排版导出图"，没有视频。需新建视频拼接 worker（ffmpeg 或外部服务）。M3 再啃。

---

## 八、前端可观测（流水线进度）

现有 SSE 已推 `chunk / tool_start / tool_end / meta`（`app/routes/agent.py`）。扩展流水线事件：

```jsonc
{"type":"pipeline_start","run_id":"r_123","name":"competitor_analysis","stages":[...]}
{"type":"stage_start","run_id":"r_123","stage":"research"}
{"type":"stage_progress","run_id":"r_123","stage":"research","done":2,"total":5}   // 并行进度
{"type":"artifact","run_id":"r_123","stage":"grids","kind":"image","url":"https://..."} // 中途产物预览
{"type":"stage_end","run_id":"r_123","stage":"research"}
{"type":"pipeline_done","run_id":"r_123","result_url":"https://.../report"}
{"type":"stage_error","run_id":"r_123","stage":"assemble","detail":"...","retriable":true}
```

前端：一键触发卡片 + 流水线进度面板（DAG 可视化）+ 中途产物预览（分镜图/草稿）+ 失败可**单 stage 重试**（不必整条重跑）。

---

## 九、数据模型（PG）

```sql
-- 流水线运行（断点续跑 + 审计）
CREATE TABLE ai.pipeline_run (
  id           BIGSERIAL PRIMARY KEY,
  run_uuid     TEXT UNIQUE NOT NULL,
  user_id      BIGINT NOT NULL,
  session_uuid TEXT,
  name         TEXT NOT NULL,            -- competitor_analysis / script_to_video / dynamic
  status       TEXT NOT NULL,            -- running | done | failed | cancelled
  goal         TEXT,                     -- 用户原始目标
  spec         JSONB,                    -- 动态规划时存生成的 DAG
  result       JSONB,                    -- 最终产物（URL/报告）
  budget_spent INT DEFAULT 0,           -- 已花 token，预算治理
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

-- 每个 stage 的状态（恢复 + 进度 + 产物）
CREATE TABLE ai.pipeline_stage (
  id        BIGSERIAL PRIMARY KEY,
  run_id    BIGINT NOT NULL REFERENCES ai.pipeline_run(id),
  name      TEXT NOT NULL,
  status    TEXT NOT NULL,               -- pending | running | done | failed
  attempt   INT DEFAULT 0,
  output    JSONB,                       -- 该 stage 产物（供下游 deps 取）
  reflect_score REAL,
  started_at  TIMESTAMPTZ,
  finished_at TIMESTAMPTZ
);
```

恢复逻辑：重启后按 `run_uuid` 读 `status='running'` 的 run，把 `pipeline_stage.status='done'` 的产物回填进 `results`，从未完成处续跑。

---

## 十、与四份文档的整合关系

| 能力 | 依赖文档 | 状态 |
|------|---------|------|
| 上下文压缩（流水线海量输出的地基） | `context_future.md` | ✅ 已完成 |
| 工具契约/结果预算/并发/错误信封 | `tool_future.md` | ⬜ 待做（本设计的前置） |
| 子 Agent 执行器 = ReAct；流水线 = Plan-Solve；质量门 = Reflection | `agent_future2.md` | ⬜ 待做 |
| 错误自恢复、任务/多 Agent 思想 | `agent_future.md`（取 §3/§5/§7，**弃** §1-2/§4/§6/§8 的编码 agent 部分） | ⬜ 部分取用 |
| **流水线编排 + 并行子 Agent + 深度研究 + 视频** | **本文** | ⬜ 新增主线 |

---

## 十一、实施路线图（分期 + 依赖）

```
M0 — 地基（前置，域无关）
  └─ [P0] ReAct 错误自恢复（llm_call 捕获 PTL/截断→压缩/续写→重试）   ← agent_future.md §3
  └─ [P0] tool_future P0/P1：ToolSpec 注册表 + 结果出口预算 + 统一错误信封
  └─ [P0] 确认 agent_vector_memory_enabled 在 prod 已开（否则 ReAct 根本没启用）

M1 — 第一条流水线（纯文本+Web，最易验证编排骨架）
  └─ 新建 app/agent/pipeline/：spec / runner（拓扑分批+预算+落库）
  └─ ai.pipeline_run / pipeline_stage 表
  └─ web_fetch 工具 + run_pipeline 入口工具
  └─ 上线 competitor_analysis（先串行，verifier 核实，writer 出报告 + 质量门）
  └─ SSE 流水线事件 + 前端进度面板（最小版）
  验收：一句"分析 X 品类 3 个竞品" → 自动产出带引用的对比报告

M2 — 并行子 Agent + 深度研究
  └─ spawn_subagents（Semaphore 并发 + 隔离 + 异常归一）
  └─ research/verifier/writer/planner 四类 agent_type + 作用域工具集
  └─ competitor_analysis 的 research 阶段改 parallel_over=competitors（真并行）
  验收：多竞品并行调研，墙钟接近单竞品耗时；一个源失败不拖垮整批

M3 — 脚本→视频（重，图/视频）
  └─ 先定"服务端图片落库"架构点（§七关键约束）
  └─ generate_storyboard_grid / revise_image 工具化 + 多模态质量门
  └─ 新建 assemble_video 服务（图序列+时长+转场→mp4）
  └─ 上线 script_to_video（grids 阶段 parallel_over=shots）
  验收：一句创意 brief → 自动出片 + 自检定稿

M4 — 动态规划 + 协调器（系统性）
  └─ planner 子 Agent 对新目标生成 PipelineSpec（校验后执行）
  └─ 实施阶段协调器（按产物集串行防冲突）
  └─ 失败反思写入记忆（Reflexion，复用 extract_preferences/L3 召回）
```

每期独立可用，M0/M1 风险最低、价值最快兑现；M3 最重，依赖落库与视频两个新基建，单独立项。

---

## 附录：competitor_analysis stage prompt 草样（自包含原则示例）

```
[research 子 Agent prompt，自包含]
目标：调研竞品「{competitor}」在以下维度的现状：{dimensions}。
约束：① 只用 web_search/web_fetch/knowledge_search；② 每条结论附来源 URL；
     ③ 区分"官方信息"与"第三方评价"；④ 找不到就写"未获取"，禁止编造。
输出 JSON：{ "competitor": ..., "findings": [{dimension, claim, source_url, confidence}] }
```

> 注意：子 Agent 看不到主对话，`{competitor}`/`{dimensions}` 必须由 runner 从上游 `plan` 产物**填好**再下发——这就是 §3.3 "Never write 'based on your findings'" 的落地。
