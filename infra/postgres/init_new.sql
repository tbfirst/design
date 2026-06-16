-- tbfirst 统一初始化脚本 v2 —— 清库重建用
--
-- 与同路径 init.sql 的关系：
--   - init.sql     旧版本，采用 "CREATE TABLE + 后续 ALTER TABLE ADD COLUMN IF NOT EXISTS" 的叠加写法，
--                  兼容老库滚动升级路径，不动。
--   - init_new.sql 本文件，把 auth/image 两个服务历次 Flyway（V1~V5）字段**全部内联到 CREATE TABLE**，
--                  用于全新清库重建 —— 所有表一次到位，无 ALTER、无数据迁移、无历史包袱。
--
-- 使用方式：
--   清库重建时，将 docker-compose.infra.yml 里 postgres 的 init 挂载点改为指向本文件：
--     ./infra/postgres/init_new.sql:/docker-entrypoint-initdb.d/init.sql
--   然后 `docker compose -f docker-compose.infra.yml down -v && up -d`，postgres 首次启动自动执行。
--
-- Schema 作用速查：
--   auth       — 用户 / 共享组 / 申请 / 邀请            (tbfirst-auth:8101)
--   image      — 生图任务 / 模特库 / 审计               (tbfirst-image:8102，唯一有真实业务的 Java 服务)
--   modellink  — 模特链路                               (tbfirst-modellink:8103，骨架)
--   realshow   — 真实场景展示                           (tbfirst-realshow:8104，骨架)
--   cinestitch — 电影级拼接                             (tbfirst-cinestitch:8105，骨架)
--   adimage    — 广告图生成                             (tbfirst-adimage:8106，骨架)
--   asset      — 跨服务共享资产注册                     (由 init*.sql 独占，不走 Flyway)
--   ai         — AI 能力预留（RAG / embedding）         (当前无表，pgvector 扩展已装)
--
-- 约定：
--   - 所有业务表遵循 BaseEntity：create_time / update_time / create_by / update_by / deleted(SMALLINT, 0=有效 1=软删)
--   - JSON 字段用 JSONB，Hibernate 侧必须 @JdbcTypeCode(SqlTypes.JSON)（errorConclude #8）
--   - GRANT 的 user1 必须与 .env 的 POSTGRES_USER 一致（errorConclude #4）
--   - 各服务 Flyway V*.sql 不依赖本文件，仍保留用于老库滚动升级的幂等兜底

-- ===========================================================================
-- §0 基础：schema + 扩展 + 权限
-- ===========================================================================
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

GRANT ALL ON SCHEMA auth, image, modellink, realshow, cinestitch, adimage, asset, ai TO user1;


-- ===========================================================================
-- §1 asset —— 跨服务共享资产注册中心
--   作用：记录"哪张资产由哪个服务的哪个 job 产出、归属哪个用户、可见性如何"，让兄弟服务
--   可以用主键引用而不重复拷贝资产本体。由 init.sql 独占，不走任何服务的 Flyway。
-- ===========================================================================
CREATE TABLE IF NOT EXISTS asset.shared_asset (
    id              BIGSERIAL    PRIMARY KEY,
    asset_key       VARCHAR(512) NOT NULL,                 -- StorageService 存储键 / 对象存储 key
    bucket          VARCHAR(64)  NOT NULL,                 -- 'generated' | 'brand-model' | 'upload' ...
    source_service  VARCHAR(64)  NOT NULL,                 -- 'tbfirst-image' | 'tbfirst-realshow' ...
    source_job_id   BIGINT,                                -- 产出 job 主键（可空，非生图类资产用）
    user_id         BIGINT       NOT NULL,                 -- 资产归属人
    content_type    VARCHAR(128),                          -- MIME
    file_size       BIGINT,
    tags            TEXT,                                  -- 逗号分隔，便于标签检索
    visibility      VARCHAR(16)  DEFAULT 'private',        -- private | shared | public
    create_time     TIMESTAMP,
    update_time     TIMESTAMP,
    create_by       BIGINT,
    update_by       BIGINT,
    deleted         SMALLINT     DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_shared_asset_user   ON asset.shared_asset(user_id);
CREATE INDEX IF NOT EXISTS idx_shared_asset_bucket ON asset.shared_asset(user_id, bucket);


-- ===========================================================================
-- §2 auth —— 用户 / 共享组 / 申请 / 邀请（tbfirst-auth:8101 独占）
--   作用：一切"谁是谁 + 谁属于哪个组"的权威源。密码 BCrypt；单组制（每人最多一个组）；
--   邮箱唯一（大小写不敏感，允许 NULL，软删释放）。跨服务调用只靠 Gateway 注入的 X-User-*
--   头，下游不直连本 schema。
-- ===========================================================================

-- 2.1 用户主表（合并 V2 tunable_caps / V3 email_unique）
CREATE TABLE IF NOT EXISTS auth.sys_user (
    id                  BIGSERIAL    PRIMARY KEY,
    username            VARCHAR(64)  NOT NULL UNIQUE,
    password_hash       VARCHAR(128) NOT NULL,             -- BCrypt
    nickname            VARCHAR(64),
    email               VARCHAR(64),                       -- 可空，唯一性约束见下方 partial index
    roles               VARCHAR(255),                      -- 逗号分隔：'ADMIN,USER'
    status              VARCHAR(16)  DEFAULT 'active',     -- active | disabled | pending（pending=注册待审核）
    last_active_at      TIMESTAMP,                         -- 登录/心跳刷新
    personal_model_cap  INT,                               -- null=角色默认(USER=5/ADMIN=50)；非null=覆盖
    group_id            BIGINT,                            -- 所属共享组（FK 见下方 §2.2 之后补）
    group_role          VARCHAR(16),                       -- leader | member | null
    create_time         TIMESTAMP,
    update_time         TIMESTAMP,
    create_by           BIGINT,
    update_by           BIGINT,
    deleted             SMALLINT     DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_sys_user_username ON auth.sys_user(username);
CREATE INDEX IF NOT EXISTS idx_sys_user_group    ON auth.sys_user(group_id) WHERE deleted = 0 AND group_id IS NOT NULL;
-- 邮箱唯一（大小写不敏感，允许多 NULL，软删后可释放）
CREATE UNIQUE INDEX IF NOT EXISTS ux_sys_user_email_active
    ON auth.sys_user (LOWER(email))
    WHERE email IS NOT NULL AND deleted = 0;

-- 2.2 共享组本体（合并 V1 share_group / V2 model_cap）
CREATE TABLE IF NOT EXISTS auth.share_group (
    id             BIGSERIAL    PRIMARY KEY,
    name           VARCHAR(64)  NOT NULL UNIQUE,
    description    TEXT,
    leader_id      BIGINT       NOT NULL REFERENCES auth.sys_user(id),
    status         VARCHAR(16)  NOT NULL DEFAULT 'active', -- active | archived
    member_count   INT          NOT NULL DEFAULT 1,        -- 冗余计数，避免每次 COUNT
    model_cap      INT,                                    -- null=全局默认30；非null=覆盖
    create_time    TIMESTAMP,
    update_time    TIMESTAMP,
    create_by      BIGINT,
    update_by      BIGINT,
    deleted        SMALLINT     NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_share_group_leader ON auth.share_group(leader_id) WHERE deleted = 0;

-- 回填 sys_user.group_id 的外键（share_group 定义后才能加，避免循环依赖死锁）
-- DO $$
-- BEGIN
--     IF NOT EXISTS (
--         SELECT 1 FROM pg_constraint WHERE conname = 'fk_sys_user_group'
--     ) THEN
--         ALTER TABLE auth.sys_user
--             ADD CONSTRAINT fk_sys_user_group FOREIGN KEY (group_id) REFERENCES auth.share_group(id);
--     END IF;
-- END$$;

-- 2.3 成立共享组申请
CREATE TABLE IF NOT EXISTS auth.group_application (
    id                   BIGSERIAL    PRIMARY KEY,
    applicant_id         BIGINT       NOT NULL REFERENCES auth.sys_user(id),
    proposed_name        VARCHAR(64)  NOT NULL,
    proposed_description TEXT,
    status               VARCHAR(16)  NOT NULL DEFAULT 'pending', -- pending | approved | rejected
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
-- 同一申请人同时只能有一条 pending 申请；软删记录不占名额
CREATE UNIQUE INDEX IF NOT EXISTS idx_group_app_applicant_pending
    ON auth.group_application(applicant_id) WHERE status = 'pending' AND deleted = 0;
CREATE INDEX IF NOT EXISTS idx_group_app_status ON auth.group_application(status) WHERE deleted = 0;

-- 2.4 组内邀请
CREATE TABLE IF NOT EXISTS auth.group_invitation (
    id            BIGSERIAL    PRIMARY KEY,
    group_id      BIGINT       NOT NULL REFERENCES auth.share_group(id),
    inviter_id    BIGINT       NOT NULL,                   -- 发出邀请的组长
    invitee_id    BIGINT       NOT NULL,                   -- 被邀请的用户
    invitee_email VARCHAR(128),                            -- 邀请时组长输入的 email 快照（小写归一化，非外键；存量行可为 NULL）
    status        VARCHAR(16)  NOT NULL DEFAULT 'pending', -- pending | accepted | rejected | canceled
    respond_time  TIMESTAMP,
    create_time   TIMESTAMP,
    update_time   TIMESTAMP,
    create_by     BIGINT,
    update_by     BIGINT,
    deleted       SMALLINT     NOT NULL DEFAULT 0
);
-- 同一 invitee 同时只允许一条 pending 邀请（任何组），避免同时被两个组拉人导致冲突
CREATE UNIQUE INDEX IF NOT EXISTS idx_group_invitation_invitee_pending
    ON auth.group_invitation(invitee_id) WHERE status = 'pending' AND deleted = 0;
CREATE INDEX IF NOT EXISTS idx_group_invitation_group ON auth.group_invitation(group_id) WHERE deleted = 0;

-- 2.5 组模特库扩容申请
--   组长（二级管理员）发起；一级管理员审批；批准时同事务 UPDATE share_group.model_cap = requested_cap。
--   fee_amount 是 TODO 费用字段；支付流程尚未接入，当前允许空。
CREATE TABLE IF NOT EXISTS auth.group_capacity_application (
    id                BIGSERIAL    PRIMARY KEY,
    group_id          BIGINT       NOT NULL REFERENCES auth.share_group(id),
    applicant_id      BIGINT       NOT NULL REFERENCES auth.sys_user(id),
    current_cap       INT,                                                 -- 提交时 model_cap 的快照（审计）
    requested_cap     INT          NOT NULL,                               -- 目标容量
    reason            TEXT         NOT NULL,
    fee_amount        NUMERIC(12, 2),                                      -- TODO 费用
    status            VARCHAR(16)  NOT NULL DEFAULT 'pending',             -- pending | approved | rejected
    reviewer_id       BIGINT,
    review_note       TEXT,
    review_time       TIMESTAMP,
    create_time       TIMESTAMP,
    update_time       TIMESTAMP,
    create_by         BIGINT,
    update_by         BIGINT,
    deleted           SMALLINT     NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_group_cap_app_group_pending
    ON auth.group_capacity_application(group_id) WHERE status = 'pending' AND deleted = 0;
CREATE INDEX IF NOT EXISTS idx_group_cap_app_status
    ON auth.group_capacity_application(status) WHERE deleted = 0;


-- ===========================================================================
-- §3 image —— 生图 / 模特库 / 审计（tbfirst-image:8102 独占）
--   作用：整套 BrandGenius-AI 迁移落地的数据层主体。存生图任务（含 30 天 LRU + 组内互见）、
--   模特库（个人库 vs 组共享库双语义）、审计流水。是当前唯一有真实业务的 Java 服务。
-- ===========================================================================

-- 3.1 生图任务（合并 V2/V3 saved+last_access、V5 group_id）
CREATE TABLE IF NOT EXISTS image.generation_job (
    id              BIGSERIAL    PRIMARY KEY,
    phase           VARCHAR(32)  NOT NULL,                 -- phase0 | phase1 | phase2 | phase2Color | inpaint
    user_id         BIGINT,                                -- 作者
    model           VARCHAR(64),                           -- Gemini 模型名
    prompt          TEXT,
    asset_urls      TEXT,                                  -- 多个静态 URL，换行分隔
    status          VARCHAR(16),                           -- pending | success | failed
    error_msg       TEXT,
    result_text     TEXT,                                  -- 异步化(V8)：承载 AI 文本结果（dna 提取 JSON 等），图片类阶段为空
    phase_config    JSONB,                                 -- 任务参数快照（aspectRatio/imageSize/tools 等）
    reference_count INT          DEFAULT 0,                -- 参考图数量，后置审计用
    saved           BOOLEAN      NOT NULL DEFAULT FALSE,   -- "已下载并收藏"标记；仅服务图标展示
    last_access_at  TIMESTAMP,                             -- LRU 基准：创建=create_time，收藏=now()；超 TTL 物理删
    group_id        BIGINT,                                -- 作者生成时所属组的快照；null=仅作者可见
    create_time     TIMESTAMP,
    update_time     TIMESTAMP,
    create_by       BIGINT,
    update_by       BIGINT,
    deleted         SMALLINT     DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_generation_job_user        ON image.generation_job(user_id);
CREATE INDEX IF NOT EXISTS idx_generation_job_phase       ON image.generation_job(phase);
CREATE INDEX IF NOT EXISTS idx_generation_job_last_access ON image.generation_job(last_access_at) WHERE deleted = 0;
CREATE INDEX IF NOT EXISTS idx_generation_job_group       ON image.generation_job(group_id)       WHERE deleted = 0 AND group_id IS NOT NULL;

-- 3.2 模特库（合并 V5 group_id；V4 的全局共享清洗在空库无意义，跳过）
--   group_id IS NULL      → 上传者个人库（容量 USER=5/ADMIN=50，可被 sys_user.personal_model_cap 覆盖）
--   group_id IS NOT NULL  → 该组共享库（容量默认 30，可被 share_group.model_cap 覆盖）
--   BrandModelService 权限：上传者本人 + 组长 + admin 可改；组员互相可见不可改。
CREATE TABLE IF NOT EXISTS image.brand_model (
    id          BIGSERIAL    PRIMARY KEY,
    name        VARCHAR(128),
    image_key   VARCHAR(512) NOT NULL,                     -- StorageService 存储键
    mime_type   VARCHAR(64)  NOT NULL,
    file_size   BIGINT,
    user_id     BIGINT       NOT NULL,                     -- 上传者（= 个人库所有者，或组共享库的原始贡献者）
    group_id    BIGINT,                                    -- null=个人库；非null=该组共享库
    visibility  VARCHAR(16)  DEFAULT 'private',
    create_time TIMESTAMP,
    update_time TIMESTAMP,
    create_by   BIGINT,
    update_by   BIGINT,
    deleted     SMALLINT     DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_brand_model_user     ON image.brand_model(user_id);
CREATE INDEX IF NOT EXISTS idx_brand_model_personal ON image.brand_model(user_id)  WHERE deleted = 0 AND group_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_brand_model_group    ON image.brand_model(group_id) WHERE deleted = 0 AND group_id IS NOT NULL;

-- 3.3 生图审计流水
CREATE TABLE IF NOT EXISTS image.audit_log (
    id                BIGSERIAL    PRIMARY KEY,
    user_id           BIGINT       NOT NULL,
    phase             VARCHAR(32)  NOT NULL,               -- 动作发生的阶段
    action_detail     TEXT         DEFAULT '',
    generation_job_id BIGINT,                              -- 关联 generation_job.id（可空，非生图动作用）
    create_time       TIMESTAMP,
    update_time       TIMESTAMP,
    create_by         BIGINT,
    update_by         BIGINT,
    deleted           SMALLINT     DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_audit_log_user  ON image.audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_phase ON image.audit_log(phase);


-- ===========================================================================
-- §4 modellink —— 骨架（tbfirst-modellink:8103）
--   "模特换装链路"预留 schema。只有 job 任务表 + service_permission 权限表，等待业务实现。
-- ===========================================================================
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


-- ===========================================================================
-- §5 realshow —— 骨架（tbfirst-realshow:8104）
--   "真实场景展示"预留 schema。结构同 modellink 骨架。
-- ===========================================================================
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


-- ===========================================================================
-- §6 cinestitch —— 骨架（tbfirst-cinestitch:8105）
--   "电影级拼接"预留 schema。结构同 modellink 骨架。
-- ===========================================================================
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


-- ===========================================================================
-- §7 adimage —— 骨架（tbfirst-adimage:8106）
--   "广告图生成"预留 schema。结构同 modellink 骨架。
-- ===========================================================================
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


-- ===========================================================================
-- §8 ai —— AI 能力预留 schema
--   pgvector 扩展已在 §0 安装。未来 RAG / embedding / MCP skill 运行痕迹等 Python 侧
--   的表会落到这里（而不是放进 image schema 污染业务）。当前无表。
-- ===========================================================================
