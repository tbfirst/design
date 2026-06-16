# tbfirst

面向 AI 工具矩阵的 Java + Python 微服务骨架。

## 架构一览

```
Client (各服务独有前端)
  │
  ▼
┌────────────┐          ┌─────────────┐
│  Gateway   │ ───JWT──▶│  tbfirst-auth │ (仅登录；注册接口预留)
│  (8000)    │          └─────────────┘
└─────┬──────┘
      │ 路由 + X-User-Id/Name/Roles/Permissions
      ├──────▶ tbfirst-image      (8102) ──┐
      ├──────▶ tbfirst-cinestitch (8105) ──┤ Feign
      └──────▶ tbfirst-ai-python  (8200) ◀─┘
                 │
      ┌──────────┼──────────┐
      ▼          ▼          ▼
   Gemini    OpenAI    Anthropic

基础设施：PostgreSQL 16 + pgvector | Redis 7 | Nacos 2.4（注册中心 + 配置中心）
共享层：asset schema（跨服务资产注册表）+ StorageService（统一文件存储）
生命周期：生图结果按 30 天 LRU 清理；用户点"下载并收藏"续命 30 天
```

## 技术栈

| 层 | 选型 |
|---|---|
| JDK | Java 21 |
| Java 框架 | Spring Boot 3.5.8 |
| 微服务 | Spring Cloud 2025.0.1 + Spring Cloud Alibaba 2025.0.0.0 |
| 注册/配置中心 | Nacos 2.4.3 |
| 网关 | Spring Cloud Gateway (WebFlux) |
| 服务间调用 | OpenFeign + Loadbalancer |
| 数据库 | PostgreSQL 16 + pgvector |
| 缓存 | Redis 7 + Caffeine |
| ORM | Spring Data JPA + Flyway |
| 鉴权 | Spring Security Crypto + JWT (jjwt 0.12) |
| API 文档 | Knife4j 4.5 + SpringDoc OpenAPI |
| Python | FastAPI 0.115 + google-genai / openai / anthropic / litellm |
| Python 注册 | nacos-sdk-python 2.x |

## 模块结构

```
tbfirst/
├── pom.xml                   # 聚合父 POM
├── docker-compose.yml        # 全栈编排（11 容器）
├── docker-compose.infra.yml  # 仅基础设施
├── .env.example
│
├── tbfirst-dependencies/      # BOM
├── tbfirst-common/            # 公共库 8 个子模块
│   ├── tbfirst-common-core          # 统一响应 / 错误码 / 常量
│   ├── tbfirst-common-web           # 全局异常处理 / CORS
│   ├── tbfirst-common-security      # JWT / UserContext / 权限注解
│   ├── tbfirst-common-redis         # Redis 配置 / 分布式锁
│   ├── tbfirst-common-datasource    # JPA 审计 / BaseEntity / 共享资产
│   ├── tbfirst-common-feign         # Feign 配置 / TraceId 透传
│   ├── tbfirst-common-log           # MDC TraceId / JSON 日志
│   └── tbfirst-common-oss           # 存储抽象层（本地/MinIO/云OSS）
│
├── tbfirst-gateway/           # 网关（8000）— 唯一外部入口
├── tbfirst-auth/              # 认证服务（8101）
├── tbfirst-image/             # 生图服务（8102，已迁移 BrandGenius 业务）
├── tbfirst-cinestitch/        # 分镜生成（8105，骨架）
└── tbfirst-ai-python/         # 公共 Python AI 服务（8200）
    └── app/
        ├── providers/        # gemini / openai / anthropic
        ├── routes/           # generate/image/embedding/rag/skill/mcp
        ├── services/         # cache / rag / skill / mcp
        ├── skills/           # 内置 skill 占位
        └── mcp/              # MCP server 配置
```

## 快速开始

### 1. 启动基础设施

```bash
cd E:/tbfirst
cp .env.example .env
docker compose -f docker-compose.infra.yml up -d
```

- Nacos 控制台：<http://localhost:8848/nacos>（nacos / nacos）
- PostgreSQL：localhost:5432 / tbfirst / tbfirst
- Redis：localhost:6379

### 2. 在 Nacos 创建共享配置

- Namespace：`dev`（需要先在 Nacos 控制台创建）
- Data ID：`tbfirst-common.yaml`
- Group：`DEFAULT_GROUP`
- 内容：复制 `infra/nacos/tbfirst-common.yaml`

### 3. 构建 Java 工程

```bash
mvn -T 2C clean install -DskipTests
```

### 4. 启动服务

**方式 A — 本地 IDE：**
按顺序启动 `GatewayApplication` / `AuthApplication` / `ImageApplication` / `ModellinkApplication` / `RealshowApplication` / `CinestitchApplication` / `AdimageApplication`。

**方式 B — Docker：**
```bash
docker compose up -d --build
```

**启动 Python 服务：**
```bash
cd tbfirst-ai-python
python -m venv .venv && source .venv/Scripts/activate   # Windows Git Bash
pip install -r requirements.txt
cp .env.example .env                                    # 填入 GEMINI_API_KEY
uvicorn app.main:app --host 0.0.0.0 --port 8200 --reload
```

### 5. 冒烟测试

```bash
# 查看 Nacos 注册实例
curl http://localhost:8848/nacos/v1/ns/instance/list?serviceName=tbfirst-image

# 登录（管理员账号由 DataSeederService 种子产生；注册接口预留未开放）
TOKEN=$(curl -s -X POST http://localhost:8000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}' | jq -r .data.token)

# 生图端到端
curl -X POST http://localhost:8000/api/image/phase0/generate \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"prompt":"a red lobster","phase":"phase0"}'

# 历史查询（前端 "历史生图" 按钮调；登录后主界面不再自动拉）
curl -H "Authorization: Bearer $TOKEN" http://localhost:8000/api/image/history

# 下载并收藏一条 job（置 saved=true + 刷新 last_access_at，续命 30 天 LRU）
curl -X POST -H "Authorization: Bearer $TOKEN" http://localhost:8000/api/image/jobs/123/save

# 品牌模特库（需要 image:manage-models 权限：admin/moyusheng/zengzimin 种子预置）
curl -H "Authorization: Bearer $TOKEN" http://localhost:8000/api/image/models

# 骨架服务健康检查
curl -H "Authorization: Bearer $TOKEN" http://localhost:8000/api/cinestitch/health

# AI 直调
curl -X POST http://localhost:8000/api/ai/image/generate \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"prompt":"sunset","model":"gemini-2.5-flash-image"}'
```

## 接口文档（Swagger UI）

每个 Java 业务服务都内置 SpringDoc OpenAPI + Swagger UI（`springdoc-openapi-starter-webmvc-ui:2.8.13`）。**没有 Knife4j 聚合页**——一个服务一个 swagger 入口，按需访问。

### 访问入口

| 服务 | 直连（开发常用） | 走网关（docker / 生产） |
|---|---|---|
| tbfirst-auth | http://localhost:8101/swagger-ui/index.html | http://localhost:8000/tbfirst-auth/swagger-ui/index.html |
| tbfirst-image | http://localhost:8102/swagger-ui/index.html | http://localhost:8000/tbfirst-image/swagger-ui/index.html |
| tbfirst-cinestitch | http://localhost:8105/swagger-ui/index.html | http://localhost:8000/tbfirst-cinestitch/swagger-ui/index.html |
| tbfirst-ai-python（FastAPI） | http://localhost:8200/docs | http://localhost:8000/api/ai/docs |

OpenAPI JSON 描述：把上表的 `/swagger-ui/index.html` 换成 `/v3/api-docs` 即可（Python 服务对应是 `/openapi.json`）。

> **走网关的路径**靠网关 `spring.cloud.gateway.server.webflux.discovery.locator.enabled=true` 自动建立的 `/<service-id>/**` 路由 + RewritePath 转发到下游。`tbfirst-gateway/AuthGlobalFilter` 已经放行 `/v3/api-docs`、`/swagger-ui`、`/webjars` 三类路径，无需 JWT 即可加载 swagger UI 页面本身。
>
> **关键配置**：image / auth 的 `application.yml` 中 `springdoc.swagger-ui.config-url=../v3/api-docs/swagger-config`、`springdoc.swagger-ui.url=../v3/api-docs` 用**相对路径**——否则走网关时 swagger UI 会用绝对路径 `/v3/api-docs/swagger-config` 请求，网关无路由匹配 404。相对路径下浏览器解析为 `/tbfirst-image/v3/api-docs/...`（走网关）或 `/v3/api-docs/...`（直连），两条路都通。

### 是否需要 JWT？

**两层视角分别看**：

| 资源 | 鉴权要求 |
|---|---|
| swagger UI 静态页面（HTML / JS / CSS / webjars） | ❌ 不需要 JWT，浏览器直接打开即可 |
| `/v3/api-docs` 接口描述 JSON | ❌ 不需要 JWT |
| swagger UI 里点 **Try it out** 真实调用业务接口（如 `POST /api/image/phase0/generate`） | ✅ **需要 JWT**——这才是真正会读写数据库的请求，不能裸跑 |

第三类请求由 swagger UI 的「Authorize」按钮负责注入 JWT —— 见下一节。

### 在 Swagger UI 里登录调试（Try it out）

`tbfirst-auth` 和 `tbfirst-image` 都通过 `OpenApiConfig.java` 声明了 BearerAuth SecurityScheme，swagger UI 右上角会出现 **🔐 Authorize** 按钮。流程：

1. 用任一方式拿到 token：
   ```bash
   TOKEN=$(curl -s -X POST http://localhost:8000/api/auth/login \
     -H "Content-Type: application/json" \
     -d '{"username":"admin","password":"admin123"}' | jq -r .data.token)
   echo $TOKEN
   ```
   或者打开 `http://localhost:8000/tbfirst-auth/swagger-ui/index.html` 找到 `POST /api/auth/login` 直接 Try it out（这一步不需要 token，因为登录接口本身在 AuthGlobalFilter 白名单里）。

2. 复制 token 字符串（**不要带 `Bearer ` 前缀**，swagger UI 自动加），点右上角 🔐 **Authorize** → 粘贴到 `Value` 输入框 → Authorize → Close。

3. 之后在 swagger UI 里展开任意业务接口、点 Try it out → Execute，发出的请求会自动带 `Authorization: Bearer <token>` 头，正常返回业务数据。

4. token 默认 24h 过期；过期后 401 重新走第 1 步。

### Python 服务的 Swagger（FastAPI 自带）

`tbfirst-ai-python` 用 FastAPI 自带的 `/docs` 而不是 SpringDoc：

- 直连：http://localhost:8200/docs
- 走网关：http://localhost:8000/api/ai/docs（网关有专门的 `/api/ai/**` → `RewritePath=/api/ai/(?<seg>.*), /${seg}` 路由）

Python 接口当前**未集成 JWT 校验**（设计上靠网关层 + 内部服务才能调到），所以 FastAPI 的 swagger 直接 Try it out 即可，不需要 token。这是开发态便利；生产环境如果要把 Python 服务也走 JWT，需要单独增 FastAPI 中间件，不在本次范围。

## 数据库 schema

| schema | 表 | 服务 |
|---|---|---|
| `auth` | `sys_user`（`status`: active/disabled/**pending** / `group_id` / `group_role` / `personal_model_cap`）、`share_group`（`model_cap` / `leader_id`）、`group_application`、`group_invitation`、**`group_capacity_application`**（组扩容申请） | tbfirst-auth |
| `image` | `generation_job`（`saved` / `last_access_at` / `group_id` 快照 / `phase_config` JSONB）、`brand_model`（`group_id` null=个人/非空=组库）、`audit_log` | tbfirst-image |
| `cinestitch` | `cinestitch_job`, ~~`service_permission`~~（预留表，当前无代码读写） | tbfirst-cinestitch |
| `asset` | `shared_asset` | 共享资产层 |
| `ai` | （向量库预留） | tbfirst-ai-python |

## 生图结果生命周期（V3 组内互见 + 组员互下载）

- 新生图 → `saved=false`，`last_access_at=create_time`，`group_id=<作者当时所属组 id 快照>`
- 用户在前端点 **"下载并收藏"** → `POST /api/image/jobs/{id}/save` → 置 `saved=true` + 刷新 `last_access_at=now()` + 浏览器下载文件到本地
- **V3 权限放宽（组内生产资料语义）**：同组任意成员都可以下载组内其他成员的历史生图，不再限制"仅作者"；SQL WHERE 是 `user_id=:uid OR (:gid IS NOT NULL AND group_id=:gid)`
- 30 天未续命的 job 由 `GenerationJobLruCleaner`（Spring `@Scheduled`，默认每天 03:00）物理清理 DB 行 + 磁盘文件
- 前端登录后主界面 **不自动拉历史**；点顶部"历史生图"按钮才打开 `HistoryModal`，按日期分组展示，`saved=true` 的显示 ✓ 已下载 徽章
- **V3 徽标显示 username**：非本人历史左上角显示 `组员 {username}`，fallback 到 `#{authorId}`；后端 `ImageGenerateService.history` 批量 Feign 调 `AuthClient.usersByIds` 填充 `HistoryJobView.authorName`，auth 不可达时降级（见 errorConclude #42）
- 调参：`app.lru.enabled` / `app.lru.ttl-days=30` / `app.lru.cron=0 0 3 * * *`

## 品牌模特库（V3 个人库 / 组共享库双语义）

- `/api/image/models`：list / upload / rename / delete 四端点；写操作由 `BrandModelService.loadAndAuthorize` 按 scope + 角色 + 上传者判定
- **`group_id IS NULL`** = 上传者的个人库（容量 USER=5/ADMIN=50，可被 `sys_user.personal_model_cap` 覆盖）
- **`group_id IS NOT NULL`** = 该组的共享库（容量默认 30，可被 `share_group.model_cap` 覆盖）
- **权限**：上传者本人 + 组长 + admin 可改；组员互相**可见不可改** —— 与历史生图的"组员互相可下载"不同，模特库是组员私有资产
- **2026-04-22 权限全部下沉 Service 层**：`@RequirePermission` / `ServicePermissionChecker` / `sys_user.permissions` 全链路下线；组长在 GroupDashboard 有"申请扩容"入口（errorConclude #45）

## 目录约定

- **模块命名**：Maven artifactId 与目录名一致，均以 `tbfirst-` 开头
- **端口约定**：8000 网关；8101 auth；8102 image；8105 cinestitch；8200 python
- **数据库 schema**：每个服务独占一个 schema + 共享 `asset` schema
- **Redis Key 前缀**：统一 `tbfirst:<namespace>:*`
- **鉴权模型**：Gateway 一次 JWT 校验 → 透传 `X-User-Id/Name/Roles/Group-Id/Group-Role/Personal-Cap/Group-Cap` → 下游 Service 层按角色 + 资源归属判定（2026-04-22 permissions 体系完全下线，`@RequirePermission` / `ServicePermissionChecker` / `PermissionAspect` 已删除；见 errorConclude #44）
- **前端 session 管理**：`tokenExpiresAt` 本地存；ProtectedRoute 首次进入根据它决定自动登录或跳 `/login`

## 迁移问题记录

BrandGenius-AI → tbfirst 迁移过程中的所有坑点详见 [errorConclude/errorConclude.md](errorConclude/errorConclude.md)（共 45 项），每条含问题原因、解决方法、测试方法和影响冲突。最新几条涉及：
- **#30** Flyway V2 checksum drift + Hibernate schema-validation 连环坑 → 由 `FlywayConfig`（`repair → migrate → ensureColumns`）自愈
- **#31** `UserContextFilter` 漏把 `/api/auth/login/register/refresh` 加进豁免名单 → 登录死循环
- **#32** Phase1 点生成静默失败 —— `fileToDataUri` 只接受 `File` 不接受品牌模特库传来的 URL 字符串
- **#33** Python `_build_config` 丢掉 `imageConfig.aspectRatio` → Phase0 老是出 16:9 横图
- **#34** HistoryModal 日期 header sticky → 改为随滚动
- **#35~#41.5** Copilot 10060 重试 / 三项增强 / 品牌模特库权限改造 / 单组制 v1+v2 / 邮箱必填 / 关站即登出 / 参考图语义标签
- **#42** Feign `Map<Long, String>` 契约被 Jackson 反序列化成空 → HistoryModal 徽标静默退化到 `#id`（修复：统一用 `Map<String, String>` 契约）
- **#43** Copilot chat 500 连环坑 —— `req.context.brand=null` 的 AttributeError + `urlContext` 不存在（要用 `google_search`）+ reference_images 非 data URI 的 ValueError；日志补 `exc_info=True` 便于未来排障
- **#44** `permissions` 细粒度权限字段全链路下线（前后端 + JWT claim + X-User-Permissions 头 + DB 列）；权限回到纯角色路线，`image:manage-models` 等价于"必须 ADMIN"
- **#45** 注册改为"一级管理员审批"流程（status 枚举加 pending）+ 新增"共享组模特库扩容申请"功能（组长 → admin 审批 → 覆盖 `share_group.model_cap`）

### 数据库初始化脚本

- `infra/postgres/init.sql` —— 旧版，采用 "CREATE + ALTER ADD COLUMN IF NOT EXISTS" 叠加写法，兼容老库滚动升级（不动）
- `infra/postgres/init_new.sql` —— **新**（2026-04-20），把 auth V1~V3 + image V2~V5 的字段全部**内联到 CREATE TABLE**，跳过 V4/V5 的数据迁移语句，用于清库重建；切换方式：把 `docker-compose.infra.yml` 里 postgres 的 init 挂载点指向 `init_new.sql` 即可
- 各服务 Flyway `db/migration/V*.sql` 保留作为幂等兜底

## 后续 Roadmap

已完成（V2）：
- [x] ~~JWT 加 `permissions` claim + gateway 透传到 `X-User-Permissions`~~ —— 2026-04-21 全链路下线（errorConclude #44）
- [x] 品牌模特库 CRUD + Service 层 `loadAndAuthorize` 门禁（早期用 `@RequirePermission("image:manage-models")`；2026-04-22 改为纯角色 + 上传者判定）
- [x] 前端 JWT 本地过期自动跳 `/login`，有效期内自动登录
- [x] 生图结果 `saved` + `last_access_at` + 30 天 LRU 定时清理 + 历史 Modal 按日期分组 + 下载并收藏

已完成（V3，2026-04-20）：
- [x] 单组制 v2：个人库 + 组共享库双语义；容量可配置
- [x] 共享组历史生图组内互见 + 组员互相可下载（`generation_job.group_id` 快照 + `markSaved` 放宽）
- [x] HistoryModal 徽标显示组员 username（新增 `InternalController.usersByIds` + `AuthClient` Feign + `HistoryJobView` DTO）

已完成（V3.1，2026-04-21）：
- [x] 父 POM artifactId 从 `tbfirst-ai-python` 改回 `tbfirst`（历史遗留命名修正）
- [x] `com.tbfirst.common.datasource.asset.SharedAssetService` 下沉为各使用方（image / adimage）的 `SharedAssetLocalService`；common 只保留实体 + 仓库
- [x] 注册流程增加"一级管理员审批"—— `sys_user.status` 加 `pending` 语义；`AuthService.register` 强制 pending 且不签 token；新增 3 个 admin 审批端点
- [x] 管理员创建用户字段补全（email + personalModelCap）；admin 直建用户继续直接 active
- [x] `permissions` 字段全链路清理（后端 / common-security / gateway / image / 前端 / DB init_new）
- [x] 新增"共享组模特库扩容申请"功能：`auth.group_capacity_application` 表 + 组长提交 + 一级管理员审批 + 批准时同事务覆盖 `share_group.model_cap`
- [x] Copilot 500 修复（`brand` None 防御 + `urlContext`→`google_search` + reference_images try/except + `exc_info` 日志）
- [x] `init_new.sql` 清库重建版（所有字段内联 CREATE TABLE）+ 每个 schema 作用文档化
- [x] `require.md` 全量请求调用路径清单

待办：
- [ ] 4 个骨架服务的业务实现
- [ ] tbfirst-image 接入共享资产层
- [ ] Python 补全 embedding / rag / skill / mcp
- [ ] RAG：LangChain + pgvector 打通
- [ ] JWT 从 HS256 → RS256，公钥通过 Nacos 下发
- [ ] 接入 Sentinel 做限流 & 熔断


完整启动指南

  ---
一、预备工作：环境变量配置

1. 根目录 .env（Docker 用）

cd E:/tbfirst
cp .env.example .env
编辑 .env，填入 API Key：
GEMINI_API_KEY=你的key        # 必填，AI图片生成核心
OPENAI_API_KEY=               # 可选
ANTHROPIC_API_KEY=            # 可选
其余默认值（数据库 user1/123456、Redis、Nacos）已预设好，不用改。

2. Python 服务 .env

cd E:/tbfirst/tbfirst-ai-python
cp .env.example .env
同样填入 GEMINI_API_KEY。

  ---
二、启动步骤

方式 A：全 Docker 启动（最简单）

cd E:/tbfirst
docker compose up -d --build
会启动 11 个容器，自动处理依赖顺序：PostgreSQL → Redis → Nacos → 各服务。

方式 B：基础设施 Docker + 本地开发（推荐开发时用）

Step 1 — 启动基础设施
cd E:/tbfirst
docker compose -f docker-compose.infra.yml up -d
启动 PostgreSQL(5432)、Redis(6379)、Nacos(8848)。

Step 2 — 配置 Nacos
浏览器打开 http://localhost:8848/nacos，账号 nacos/nacos：
1. 创建命名空间：dev
2. 在 dev 命名空间下新建配置：
   - Data ID: tbfirst-common.yaml
   - Group: DEFAULT_GROUP
   - 内容：复制 E:\tbfirst\infra\nacos\tbfirst-common.yaml 的内容

Step 3 — 编译 Java
cd E:/tbfirst
mvn -T 2C clean install -DskipTests

Step 4 — 启动 Java 服务（按顺序）

┌──────┬───────────────────────────────────────┬───────────┬────────────────────┐
│ 顺序 │                 服务                  │   端口    │        主类        │
├──────┼───────────────────────────────────────┼───────────┼────────────────────┤
│ 1    │ Gateway                               │ 8000      │ GatewayApplication │
├──────┼───────────────────────────────────────┼───────────┼────────────────────┤
│ 2    │ Auth                                  │ 8101      │ AuthApplication    │
├──────┼───────────────────────────────────────┼───────────┼────────────────────┤
│ 3    │ Image                                 │ 8102      │ ImageApplication   │
├──────┼───────────────────────────────────────┼───────────┼────────────────────┤
│ 4    │ CineStitch                            │ 8105      │ CinestitchApplication │
└──────┴───────────────────────────────────────┴───────────┴────────────────────┘

可以在 IDEA 中逐个启动，或命令行：
java -jar tbfirst-gateway/target/*.jar &
java -jar tbfirst-auth/target/*.jar &
java -jar tbfirst-image/target/*.jar &

Step 5 — 启动 Python AI 服务
cd E:/tbfirst/tbfirst-ai-python
python -m venv .venv
source .venv/Scripts/activate    # Windows Git Bash
pip install -r requirements.txt  # 安装所有依赖
uvicorn app.main:app --host 0.0.0.0 --port 8200 --reload

Step 6 — 启动前端
cd E:/tbfirst/tbfirst-frontend
npm install
npm run dev

  ---
三、访问地址

┌─────────────────┬───────────────────────────────────────────┐
│      用途       │                   地址                    │
├─────────────────┼───────────────────────────────────────────┤
│ 前端页面        │ http://localhost:5173                     │
├─────────────────┼───────────────────────────────────────────┤
│ Gateway API     │ http://localhost:8000                     │
├─────────────────┼───────────────────────────────────────────┤
│ Nacos 控制台    │ http://localhost:8080 (nacos/nacos) │
├─────────────────┼───────────────────────────────────────────┤
│ Python 健康检查 │ http://localhost:8200/health              │
└─────────────────┴───────────────────────────────────────────┘

前端通过 Vite proxy 将 /api/* 和 /static/* 转发到 Gateway(8000)，所以你只需要访问 localhost:5173 即可使用完整功能。

  ---
四、验证是否正常

# 1. 注册用户
curl -X POST http://localhost:8000/api/auth/register \
-H "Content-Type: application/json" \
-d '{"username":"demo","password":"demo123"}'

# 2. 登录获取 token
curl -X POST http://localhost:8000/api/auth/login \
-H "Content-Type: application/json" \
-d '{"username":"demo","password":"demo123"}'

登录成功返回 JWT token 说明 Auth + Gateway + PostgreSQL 链路正常。之后在前端页面登录即可使用。

  ---
五、端口总览

5173  ← 前端 (Vite dev server)
8000  ← 网关 (所有API入口)
8101  ← Auth 服务
8102  ← Image 服务
8105  ← CineStitch
8200  ← Python AI 服务
5432  ← PostgreSQL
6379  ← Redis
8848  ← Nacos