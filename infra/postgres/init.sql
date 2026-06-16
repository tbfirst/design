-- tbfirst 统一初始化脚本
--
-- 使用方式：
--   - Docker 启动 postgres 时自动挂载为 /docker-entrypoint-initdb.d/init.sql（首次建库时执行）
--   - 各服务 Flyway 仍保留原有版本脚本作为幂等兜底（CREATE TABLE IF NOT EXISTS / ADD COLUMN IF NOT EXISTS）
--
-- 约定：
--   - 所有表遵循 BaseEntity 规范：create_time / update_time / create_by / update_by / deleted
--   - `deleted` 用 SMALLINT（0=有效，1=软删）
--   - 每个业务服务独占 schema，asset schema 跨服务共享

-- ---------------------------------------------------------------------------
-- 0. 基础：schema 隔离 + 扩展（pgvector 供 AI 服务向量检索，uuid-ossp 供 UUID 默认值）
-- ---------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS image;
CREATE SCHEMA IF NOT EXISTS modellink;
CREATE SCHEMA IF NOT EXISTS realshow;
CREATE SCHEMA IF NOT EXISTS cinestitch;
CREATE SCHEMA IF NOT EXISTS adimage;
CREATE SCHEMA IF NOT EXISTS asset;
CREATE SCHEMA IF NOT EXISTS ai;

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 注意：这里的 user1 必须与 .env 中 POSTGRES_USER 一致（errorConclude #4）
GRANT ALL ON SCHEMA auth, image, modellink, realshow, cinestitch, adimage, asset, ai TO user1;


-- ---------------------------------------------------------------------------
-- 1. 跨服务共享资产表 asset.shared_asset
--    不归属任何单一服务的 Flyway，避免业务服务互相持有对方表所有权
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS asset.shared_asset (
    id              BIGSERIAL    PRIMARY KEY,
    asset_key       VARCHAR(512) NOT NULL,                 -- StorageService 存储键 / 对象存储 key
    bucket          VARCHAR(64)  NOT NULL,                 -- 逻辑桶，例如 'generated' / 'brand-model' / 'upload'
    source_service  VARCHAR(64)  NOT NULL,                 -- 产出服务名：tbfirst-image / tbfirst-realshow ...
    source_job_id   BIGINT,                                -- 来源 job id（可为空）
    user_id         BIGINT       NOT NULL,
    content_type    VARCHAR(128),                          -- MIME
    file_size       BIGINT,
    tags            TEXT,                                  -- 逗号分隔标签，便于检索
    visibility      VARCHAR(16)  DEFAULT 'private',        -- private / shared / public
    create_time     TIMESTAMP,
    update_time     TIMESTAMP,
    create_by       BIGINT,
    update_by       BIGINT,
    deleted         SMALLINT     DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_shared_asset_user   ON asset.shared_asset(user_id);
CREATE INDEX IF NOT EXISTS idx_shared_asset_bucket ON asset.shared_asset(user_id, bucket);


-- ---------------------------------------------------------------------------
-- 2. tbfirst-auth
-- ---------------------------------------------------------------------------
-- 2.1 用户主表
CREATE TABLE IF NOT EXISTS auth.sys_user (
    id            BIGSERIAL    PRIMARY KEY,
    username      VARCHAR(64)  NOT NULL UNIQUE,
    password_hash VARCHAR(128) NOT NULL,                   -- BCrypt 哈希
    nickname      VARCHAR(64),
    email         VARCHAR(64),
    roles         VARCHAR(255),                            -- 逗号分隔：'ADMIN,USER'
    -- 由 V2__enhance_user.sql 追加的字段，合并后直接内联
    status        VARCHAR(16)  DEFAULT 'active',           -- active / disabled
    permissions   TEXT,                                    -- 逗号分隔的权限码，例如 'image:manage-models,...'
    last_active_at TIMESTAMP,                              -- 最近活跃时间（登录/心跳刷新）
    create_time   TIMESTAMP,
    update_time   TIMESTAMP,
    create_by     BIGINT,
    update_by     BIGINT,
    deleted       SMALLINT     DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_sys_user_username ON auth.sys_user(username);

-- V3 追加：邮箱唯一索引（大小写不敏感，允许 NULL，软删后可释放）。
-- 对齐 tbfirst-auth 的 Flyway V3__email_unique.sql，幂等。
CREATE UNIQUE INDEX IF NOT EXISTS ux_sys_user_email_active
    ON auth.sys_user (LOWER(email))
    WHERE email IS NOT NULL AND deleted = 0;

-- V2 追加：个人模特库容量（null = 按角色默认 USER=5/ADMIN=50；非 null = 覆盖）
ALTER TABLE auth.sys_user ADD COLUMN IF NOT EXISTS personal_model_cap INT;

-- 2.2 资源共享组（V1 追加）
CREATE TABLE IF NOT EXISTS auth.share_group (
    id             BIGSERIAL    PRIMARY KEY,
    name           VARCHAR(64)  NOT NULL UNIQUE,
    description    TEXT,
    leader_id      BIGINT       NOT NULL REFERENCES auth.sys_user(id),
    status         VARCHAR(16)  NOT NULL DEFAULT 'active',    -- active | archived
    member_count   INT          NOT NULL DEFAULT 1,
    create_time    TIMESTAMP,
    update_time    TIMESTAMP,
    create_by      BIGINT,
    update_by      BIGINT,
    deleted        SMALLINT     NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_share_group_leader ON auth.share_group(leader_id) WHERE deleted = 0;
-- V2 追加：组模特库容量（null = 默认 30；非 null = 覆盖）
ALTER TABLE auth.share_group ADD COLUMN IF NOT EXISTS model_cap INT;

-- sys_user 的组成员字段（单组制：每人最多一个组）
ALTER TABLE auth.sys_user ADD COLUMN IF NOT EXISTS group_id   BIGINT REFERENCES auth.share_group(id);
ALTER TABLE auth.sys_user ADD COLUMN IF NOT EXISTS group_role VARCHAR(16);
CREATE INDEX IF NOT EXISTS idx_sys_user_group ON auth.sys_user(group_id) WHERE deleted = 0 AND group_id IS NOT NULL;

-- 2.3 成立共享组申请
CREATE TABLE IF NOT EXISTS auth.group_application (
    id                   BIGSERIAL    PRIMARY KEY,
    applicant_id         BIGINT       NOT NULL REFERENCES auth.sys_user(id),
    proposed_name        VARCHAR(64)  NOT NULL,
    proposed_description TEXT,
    status               VARCHAR(16)  NOT NULL DEFAULT 'pending',
    reviewer_id          BIGINT,
    review_note          TEXT,
    review_time          TIMESTAMP,
    approved_group_id    BIGINT REFERENCES auth.share_group(id),
    create_time          TIMESTAMP,
    update_time          TIMESTAMP,
    create_by            BIGINT,
    update_by            BIGINT,
    deleted              SMALLINT     NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_group_app_applicant_pending
    ON auth.group_application(applicant_id) WHERE status = 'pending' AND deleted = 0;
CREATE INDEX IF NOT EXISTS idx_group_app_status ON auth.group_application(status) WHERE deleted = 0;

-- 2.4 组内邀请
CREATE TABLE IF NOT EXISTS auth.group_invitation (
    id            BIGSERIAL    PRIMARY KEY,
    group_id      BIGINT       NOT NULL REFERENCES auth.share_group(id),
    inviter_id    BIGINT       NOT NULL,
    invitee_id    BIGINT       NOT NULL,
    invitee_email VARCHAR(128),                               -- 邀请时组长输入的 email 快照（小写归一化，非外键）
    status        VARCHAR(16)  NOT NULL DEFAULT 'pending',
    respond_time  TIMESTAMP,
    create_time   TIMESTAMP,
    update_time   TIMESTAMP,
    create_by     BIGINT,
    update_by     BIGINT,
    deleted       SMALLINT     NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_group_invitation_invitee_pending
    ON auth.group_invitation(invitee_id) WHERE status = 'pending' AND deleted = 0;
CREATE INDEX IF NOT EXISTS idx_group_invitation_group ON auth.group_invitation(group_id) WHERE deleted = 0;


-- ---------------------------------------------------------------------------
-- 3. tbfirst-image
-- ---------------------------------------------------------------------------
-- 3.1 生图任务表（含 V4 追加的 phase_config 和 reference_count）
CREATE TABLE IF NOT EXISTS image.generation_job (
    id              BIGSERIAL    PRIMARY KEY,
    phase           VARCHAR(32)  NOT NULL,                 -- phase0 / phase1 / phase2 / inpaint / color
    user_id         BIGINT,
    model           VARCHAR(64),                           -- Gemini 模型名
    prompt          TEXT,
    asset_urls      TEXT,                                  -- 多个静态 URL，换行分隔
    status          VARCHAR(16),                           -- pending / success / failed
    error_msg       TEXT,
    result_text     TEXT,                                  -- 异步化(V8)：承载 AI 文本结果（dna 提取 JSON 等），图片类阶段为空
    -- V4 追加：
    phase_config    JSONB,                                 -- 任务参数快照（aspectRatio、imageSize、tools 等）必须用 @JdbcTypeCode(SqlTypes.JSON) 映射，见 errorConclude #8
    reference_count INT          DEFAULT 0,                -- 参考图数量，用于后置审计
    -- V2（Flyway）追加：生图结果收藏续命 + LRU 清理支持
    saved           BOOLEAN      NOT NULL DEFAULT FALSE,   -- UI"已下载"标记；仅服务图标展示，不影响 LRU 判定
    last_access_at  TIMESTAMP,                             -- LRU 基准；创建时 = create_time，收藏时 = now()；超过 TTL 由定时任务物理删
    create_time     TIMESTAMP,
    update_time     TIMESTAMP,
    create_by       BIGINT,
    update_by       BIGINT,
    deleted         SMALLINT     DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_generation_job_user        ON image.generation_job(user_id);
CREATE INDEX IF NOT EXISTS idx_generation_job_phase       ON image.generation_job(phase);
CREATE INDEX IF NOT EXISTS idx_generation_job_last_access ON image.generation_job(last_access_at) WHERE deleted = 0;

-- V5 追加：历史生图组互见（null = 仅作者可见；非 null = 同组互见）
ALTER TABLE image.generation_job ADD COLUMN IF NOT EXISTS group_id BIGINT;
CREATE INDEX IF NOT EXISTS idx_generation_job_group ON image.generation_job(group_id) WHERE deleted = 0 AND group_id IS NOT NULL;

-- 3.2 品牌模特库（上传的人台/模特参考图）
CREATE TABLE IF NOT EXISTS image.brand_model (
    id          BIGSERIAL    PRIMARY KEY,
    name        VARCHAR(128),
    image_key   VARCHAR(512) NOT NULL,                     -- StorageService 存储键
    mime_type   VARCHAR(64)  NOT NULL,
    file_size   BIGINT,
    user_id     BIGINT       NOT NULL,
    visibility  VARCHAR(16)  DEFAULT 'private',
    create_time TIMESTAMP,
    update_time TIMESTAMP,
    create_by   BIGINT,
    update_by   BIGINT,
    deleted     SMALLINT     DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_brand_model_user ON image.brand_model(user_id);

-- V5 追加：个人库 / 组库双语义（group_id 为 null 时是上传者的个人库，否则是该组共享库）
ALTER TABLE image.brand_model ADD COLUMN IF NOT EXISTS group_id BIGINT;
CREATE INDEX IF NOT EXISTS idx_brand_model_personal ON image.brand_model(user_id)  WHERE deleted = 0 AND group_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_brand_model_group    ON image.brand_model(group_id) WHERE deleted = 0 AND group_id IS NOT NULL;

-- 3.3 生图审计流水
CREATE TABLE IF NOT EXISTS image.audit_log (
    id                BIGSERIAL    PRIMARY KEY,
    user_id           BIGINT       NOT NULL,
    phase             VARCHAR(32)  NOT NULL,               -- 动作发生的阶段
    action_detail     TEXT         DEFAULT '',
    generation_job_id BIGINT,
    create_time       TIMESTAMP,
    update_time       TIMESTAMP,
    create_by         BIGINT,
    update_by         BIGINT,
    deleted           SMALLINT     DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_audit_log_user  ON image.audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_phase ON image.audit_log(phase);


-- ---------------------------------------------------------------------------
-- 4. tbfirst-modellink（骨架）
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS modellink.model_link_job (
    id          BIGSERIAL    PRIMARY KEY,
    user_id     BIGINT,
    model       VARCHAR(64),
    prompt      TEXT,
    result      TEXT,
    status      VARCHAR(16),
    create_time TIMESTAMP,
    update_time TIMESTAMP,
    create_by   BIGINT,
    update_by   BIGINT,
    deleted     SMALLINT     DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_model_link_job_user ON modellink.model_link_job(user_id);

CREATE TABLE IF NOT EXISTS modellink.service_permission (
    id              BIGSERIAL    PRIMARY KEY,
    user_id         BIGINT       NOT NULL,
    permission_code VARCHAR(128) NOT NULL,
    granted_by      BIGINT,
    expire_time     TIMESTAMP,
    create_time     TIMESTAMP,
    update_time     TIMESTAMP,
    deleted         SMALLINT     DEFAULT 0,
    UNIQUE (user_id, permission_code)
);
CREATE INDEX IF NOT EXISTS idx_modellink_perm_user ON modellink.service_permission(user_id);


-- ---------------------------------------------------------------------------
-- 5. tbfirst-realshow（骨架）
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS realshow.realshow_job (
    id          BIGSERIAL    PRIMARY KEY,
    user_id     BIGINT,
    model       VARCHAR(64),
    prompt      TEXT,
    result      TEXT,
    status      VARCHAR(16),
    create_time TIMESTAMP,
    update_time TIMESTAMP,
    create_by   BIGINT,
    update_by   BIGINT,
    deleted     SMALLINT     DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_realshow_job_user ON realshow.realshow_job(user_id);

CREATE TABLE IF NOT EXISTS realshow.service_permission (
    id              BIGSERIAL    PRIMARY KEY,
    user_id         BIGINT       NOT NULL,
    permission_code VARCHAR(128) NOT NULL,
    granted_by      BIGINT,
    expire_time     TIMESTAMP,
    create_time     TIMESTAMP,
    update_time     TIMESTAMP,
    deleted         SMALLINT     DEFAULT 0,
    UNIQUE (user_id, permission_code)
);
CREATE INDEX IF NOT EXISTS idx_realshow_perm_user ON realshow.service_permission(user_id);


-- ---------------------------------------------------------------------------
-- 6. tbfirst-cinestitch（骨架）
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cinestitch.cinestitch_job (
    id          BIGSERIAL    PRIMARY KEY,
    user_id     BIGINT,
    model       VARCHAR(64),
    prompt      TEXT,
    result      TEXT,
    status      VARCHAR(16),
    create_time TIMESTAMP,
    update_time TIMESTAMP,
    create_by   BIGINT,
    update_by   BIGINT,
    deleted     SMALLINT     DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_cinestitch_job_user ON cinestitch.cinestitch_job(user_id);

CREATE TABLE IF NOT EXISTS cinestitch.service_permission (
    id              BIGSERIAL    PRIMARY KEY,
    user_id         BIGINT       NOT NULL,
    permission_code VARCHAR(128) NOT NULL,
    granted_by      BIGINT,
    expire_time     TIMESTAMP,
    create_time     TIMESTAMP,
    update_time     TIMESTAMP,
    deleted         SMALLINT     DEFAULT 0,
    UNIQUE (user_id, permission_code)
);
CREATE INDEX IF NOT EXISTS idx_cinestitch_perm_user ON cinestitch.service_permission(user_id);


-- ---------------------------------------------------------------------------
-- 7. tbfirst-adimage（骨架）
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS adimage.adimage_job (
    id          BIGSERIAL    PRIMARY KEY,
    user_id     BIGINT,
    model       VARCHAR(64),
    prompt      TEXT,
    result      TEXT,
    status      VARCHAR(16),
    create_time TIMESTAMP,
    update_time TIMESTAMP,
    create_by   BIGINT,
    update_by   BIGINT,
    deleted     SMALLINT     DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_adimage_job_user ON adimage.adimage_job(user_id);

CREATE TABLE IF NOT EXISTS adimage.service_permission (
    id              BIGSERIAL    PRIMARY KEY,
    user_id         BIGINT       NOT NULL,
    permission_code VARCHAR(128) NOT NULL,
    granted_by      BIGINT,
    expire_time     TIMESTAMP,
    create_time     TIMESTAMP,
    update_time     TIMESTAMP,
    deleted         SMALLINT     DEFAULT 0,
    UNIQUE (user_id, permission_code)
);
CREATE INDEX IF NOT EXISTS idx_adimage_perm_user ON adimage.service_permission(user_id);

-- ---------------------------------------------------------------------------
-- 8. tbfirst-ai-python — V6.M2 六层记忆系统
-- ---------------------------------------------------------------------------
-- V6.M2.A.3: 六层记忆表（L1/L3/L4/L5/L6；L2 三张表由 langgraph-checkpoint-postgres 启动时自动建在 ai schema）

-- L1 Basic Rules: 基础规则。改动罕见，改动即版本化。
CREATE TABLE IF NOT EXISTS ai.basic_rules (
    id BIGSERIAL PRIMARY KEY,
    scope VARCHAR(16) NOT NULL,          -- 'global' / 'brand' / 'group'
    scope_ref_id BIGINT,                 -- brand_id / group_id; global 时 NULL
    category VARCHAR(32),                -- 'safety' / 'platform' / 'team-rule'
    body TEXT NOT NULL,                  -- Markdown，LLM 友好
    version INT DEFAULT 1,
    is_active BOOLEAN DEFAULT TRUE,
    created_by BIGINT,
    create_time TIMESTAMP DEFAULT NOW(),
    update_time TIMESTAMP DEFAULT NOW(),
    UNIQUE (scope, scope_ref_id, category, version)
);
CREATE INDEX IF NOT EXISTS idx_basic_rules_active ON ai.basic_rules (scope, scope_ref_id, is_active);

-- L3 Session metadata
CREATE TABLE IF NOT EXISTS ai.session (
    id BIGSERIAL PRIMARY KEY,
    session_uuid VARCHAR(64) UNIQUE NOT NULL,    -- == LangGraph thread_id
    user_id BIGINT NOT NULL,
    scope VARCHAR(255),                          -- brand.url / phase 等可选
    title VARCHAR(255),                          -- 左侧会话列表显示用，首条 user message 前 30 字
    started_at TIMESTAMP DEFAULT NOW(),
    last_active_at TIMESTAMP DEFAULT NOW(),
    deleted SMALLINT DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_session_user_active ON ai.session (user_id, deleted, last_active_at DESC);

-- L3 Recall: 跨会话回顾记忆
CREATE TABLE IF NOT EXISTS ai.session_summary (
    id BIGSERIAL PRIMARY KEY,
    session_id BIGINT NOT NULL REFERENCES ai.session(id) ON DELETE CASCADE,
    user_id BIGINT NOT NULL,
    summary TEXT NOT NULL,                       -- LLM 压缩出的摘要
    raw_msg_range JSONB,                         -- {"from": msg_id_min, "to": msg_id_max}
    embedding vector(1024),                      -- bge-m3
    quality_score NUMERIC(3,2) DEFAULT 0.7,
    recall_count INT DEFAULT 0,
    last_recalled_at TIMESTAMP,
    archived BOOLEAN DEFAULT FALSE,
    create_time TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_session_summary_user ON ai.session_summary (user_id, archived);
CREATE INDEX IF NOT EXISTS idx_session_summary_hnsw ON ai.session_summary USING hnsw (embedding vector_cosine_ops);

-- L4 Semantic: 用户偏好
CREATE TABLE IF NOT EXISTS ai.user_preference (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL,
    key VARCHAR(64) NOT NULL,                    -- 'color_preference' / 'audience' / 'avoid' / 'aspect_ratio' / 'tone' / 'style'
    value TEXT NOT NULL,
    confidence NUMERIC(3,2),                     -- 0.0-1.0
    source_session_id BIGINT,
    evidence JSONB,                              -- [{"session_id": 1, "snippet": "..."}, ...]
    user_locked BOOLEAN DEFAULT FALSE,           -- 用户手动锁定后不被自动覆盖/衰减
    last_injected_at TIMESTAMP,                  -- L4 衰减依据
    create_time TIMESTAMP DEFAULT NOW(),
    update_time TIMESTAMP DEFAULT NOW(),
    UNIQUE (user_id, key)
);
CREATE INDEX IF NOT EXISTS idx_user_preference_user ON ai.user_preference (user_id);

-- L5 Procedural: 成功流程模板
CREATE TABLE IF NOT EXISTS ai.workflow_template (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT,
    group_id BIGINT,
    name VARCHAR(128),
    phase_chain JSONB,                           -- [{"phase":"phase0-dna",...},{"phase":"phase1",...}]
    sample_prompt TEXT,
    sample_job_id BIGINT,                        -- 关联 image.generation_job
    embedding vector(1024),
    quality_score NUMERIC(3,2),
    recall_count INT DEFAULT 0,
    create_time TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_workflow_template_user_group ON ai.workflow_template (user_id, group_id);
CREATE INDEX IF NOT EXISTS idx_workflow_template_hnsw ON ai.workflow_template USING hnsw (embedding vector_cosine_ops);

-- L6 Shared: 与 §3 RAG 共表
CREATE TABLE IF NOT EXISTS ai.knowledge_document (
    id BIGSERIAL PRIMARY KEY,
    collection VARCHAR(64) NOT NULL,             -- 'brand-dna' / 'personal-wiki' / 'success-prompts' / 'garment-taxonomy' / ...
    source VARCHAR(255),                          -- 'manual' / 'brand_model:123' / 'job:456' / 'mcp:xxx'
    title VARCHAR(255),
    body TEXT NOT NULL,
    meta JSONB,
    user_id BIGINT,
    group_id BIGINT,
    visibility VARCHAR(16) DEFAULT 'private',    -- private/group/public
    version INT DEFAULT 1,
    create_time TIMESTAMP DEFAULT NOW(),
    update_time TIMESTAMP DEFAULT NOW(),
    deleted SMALLINT DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_knowledge_document_scope ON ai.knowledge_document (collection, visibility, group_id, user_id);

CREATE TABLE IF NOT EXISTS ai.knowledge_chunk (
    id BIGSERIAL PRIMARY KEY,
    document_id BIGINT NOT NULL REFERENCES ai.knowledge_document(id) ON DELETE CASCADE,
    ordinal INT NOT NULL,
    chunk_text TEXT NOT NULL,
    token_count INT,
    embedding vector(1024),
    tsv tsvector,
    meta JSONB
);
CREATE INDEX IF NOT EXISTS idx_knowledge_chunk_hnsw ON ai.knowledge_chunk USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_knowledge_chunk_tsv ON ai.knowledge_chunk USING gin (tsv);

-- V6.M2.A.4: L1 baseline 基础规则 seed（幂等，靠 UNIQUE 约束）
INSERT INTO ai.basic_rules (scope, scope_ref_id, category, body, version, is_active)
VALUES
  ('global', NULL, 'safety',
   '## 真人脸保护\n本品牌生图不得出现可识别的真人脸；如用户上传含人脸的参考图，须保留构图与姿态但禁止还原五官细节。',
   1, TRUE),
  ('global', NULL, 'safety',
   '## 未成年人保护\n禁止生成任何看起来未成年的人物形象；如用户描述提到学生/少女/儿童等，须降级为成年模特的端庄商务装。',
   1, TRUE),
  ('global', NULL, 'platform',
   '## 输出比例默认值\n如用户未显式指定 aspect_ratio，默认双发 1:1 与 4:5；前者用于 Instagram 网格，后者用于详情页主图。',
   1, TRUE),
  ('global', NULL, 'team-rule',
   '## 竞品名禁止\n生成 prompt 与对话回复中禁止出现品牌竞争对手的名称、商标、可识别 logo；如用户主动提及，须在回复中改写为"同类品牌"等中性表达。',
   1, TRUE),
  ('global', NULL, 'team-rule',
   '## 输出语言\nCopilot 回复默认中文；如用户消息含 50% 以上英文则切英文回复；JSON / 代码块字段名永远英文。',
   1, TRUE)
ON CONFLICT (scope, scope_ref_id, category, version) DO NOTHING;

-- V6.M2.E.9: L6 共享知识库 baseline seed（3 个 public collection 的种子文档）。
-- 注意：仅插 knowledge_document 元数据；chunk + embedding 需 bge-m3 计算，由 ai-python
-- 启动时 lazy ingest（embedding 不能在 SQL 里算），故本处不写 ai.knowledge_chunk。
-- knowledge_document 无 UNIQUE 约束，用 WHERE NOT EXISTS 做幂等守卫（按 collection+title+public）。
INSERT INTO ai.knowledge_document (collection, source, title, body, visibility, version)
SELECT 'brand-dna', 'manual', '什么是品牌 DNA',
       E'品牌 DNA 是一个时尚品牌在视觉与表达上始终如一的核心识别，通常由以下 5 段构成：\n1) 受众画像：核心客群的年龄/场景/审美（如「25-35 都市通勤女性」）。\n2) 色彩体系：主色 + 辅助色 + 禁用色（如「主莫兰迪冷灰，禁高饱和荧光」）。\n3) 廓形语言：常用版型与剪裁倾向（如「H 廓形、极简、去装饰」）。\n4) 材质与工艺：偏好面料与质感（如「亚麻、精纺羊毛，强调垂坠」）。\n5) 调性与禁忌：文案与画面情绪 + 明确避免项（如「克制高级，忌甜腻可爱」）。',
       'public', 1
WHERE NOT EXISTS (
  SELECT 1 FROM ai.knowledge_document WHERE collection = 'brand-dna' AND title = '什么是品牌 DNA' AND visibility = 'public'
);

INSERT INTO ai.knowledge_document (collection, source, title, body, visibility, version)
SELECT 'garment-taxonomy', 'manual', '服装分类学简表',
       E'按「大类 → 子类 → 风格」三级组织，便于 prompt 精确锚定：\n连衣裙 → A 字裙 → 1950s 复古风（收腰、过膝、波点/碎花）。\n连衣裙 → 衬衫裙 → 极简通勤风（直身、系带、纯色）。\n上装 → 西装外套 → 解构廓形风（垫肩、不对称、中性）。\n下装 → 阔腿裤 → 高腰垂坠风（精纺、九分、利落）。',
       'public', 1
WHERE NOT EXISTS (
  SELECT 1 FROM ai.knowledge_document WHERE collection = 'garment-taxonomy' AND title = '服装分类学简表' AND visibility = 'public'
);

INSERT INTO ai.knowledge_document (collection, source, title, body, visibility, version)
SELECT 'success-prompts', 'manual', '成功 prompt 集合（占位）',
       E'本集合用于沉淀经人工/质量评分确认的高质量出图 prompt 模板。\n初始为空，由 L5 ETL（scripts/etl_l5）与人工精选逐步填充；检索时与 L5 workflow_template 互补。',
       'public', 1
WHERE NOT EXISTS (
  SELECT 1 FROM ai.knowledge_document WHERE collection = 'success-prompts' AND title = '成功 prompt 集合（占位）' AND visibility = 'public'
);

