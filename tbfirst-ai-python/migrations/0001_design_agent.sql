CREATE TABLE IF NOT EXISTS ai.design_project (
    id BIGSERIAL PRIMARY KEY,
    project_uuid VARCHAR(64) UNIQUE NOT NULL,
    user_id BIGINT NOT NULL,
    group_id BIGINT,
    brand_id BIGINT,
    session_uuid VARCHAR(64),
    title VARCHAR(200) NOT NULL,
    status VARCHAR(24) NOT NULL DEFAULT 'draft',
    brief_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    brief_version INT NOT NULL DEFAULT 1,
    selected_artifact_id BIGINT,
    create_time TIMESTAMP NOT NULL DEFAULT NOW(),
    update_time TIMESTAMP NOT NULL DEFAULT NOW(),
    deleted SMALLINT NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_design_project_user
    ON ai.design_project(user_id, deleted, update_time DESC);

CREATE TABLE IF NOT EXISTS ai.design_run (
    id BIGSERIAL PRIMARY KEY,
    project_id BIGINT NOT NULL REFERENCES ai.design_project(id) ON DELETE CASCADE,
    request_id VARCHAR(64) NOT NULL,
    status VARCHAR(24) NOT NULL DEFAULT 'waiting_approval',
    plan_json JSONB NOT NULL,
    plan_version INT NOT NULL DEFAULT 1,
    generation_calls INT NOT NULL DEFAULT 0,
    cost_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    error_code VARCHAR(128),
    create_time TIMESTAMP NOT NULL DEFAULT NOW(),
    start_time TIMESTAMP,
    end_time TIMESTAMP,
    UNIQUE(project_id, request_id)
);
CREATE INDEX IF NOT EXISTS idx_design_run_project
    ON ai.design_run(project_id, create_time DESC);

CREATE TABLE IF NOT EXISTS ai.design_artifact (
    id BIGSERIAL PRIMARY KEY,
    project_id BIGINT NOT NULL REFERENCES ai.design_project(id) ON DELETE CASCADE,
    run_id BIGINT REFERENCES ai.design_run(id) ON DELETE SET NULL,
    shared_asset_id BIGINT,
    parent_artifact_id BIGINT REFERENCES ai.design_artifact(id) ON DELETE SET NULL,
    role VARCHAR(24) NOT NULL,
    kind VARCHAR(24) NOT NULL DEFAULT 'image',
    revision INT NOT NULL DEFAULT 1,
    url TEXT,
    width INT,
    height INT,
    tool_name VARCHAR(128),
    tool_input_hash VARCHAR(64),
    provenance_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    evaluation_json JSONB,
    status VARCHAR(24) NOT NULL DEFAULT 'creating',
    create_time TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_design_artifact_project
    ON ai.design_artifact(project_id, create_time DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uk_design_source_asset
    ON ai.design_artifact(project_id, role, url)
    WHERE role IN ('source', 'reference') AND url IS NOT NULL;

CREATE TABLE IF NOT EXISTS ai.design_action (
    id BIGSERIAL PRIMARY KEY,
    action_uuid VARCHAR(64) UNIQUE NOT NULL,
    project_id BIGINT NOT NULL REFERENCES ai.design_project(id) ON DELETE CASCADE,
    run_id BIGINT NOT NULL REFERENCES ai.design_run(id) ON DELETE CASCADE,
    action_type VARCHAR(32) NOT NULL,
    plan_version INT NOT NULL,
    payload_hash VARCHAR(64) NOT NULL,
    payload_json JSONB NOT NULL,
    risk_level VARCHAR(16) NOT NULL DEFAULT 'medium',
    status VARCHAR(24) NOT NULL DEFAULT 'pending',
    actor_id BIGINT,
    expires_at TIMESTAMP,
    create_time TIMESTAMP NOT NULL DEFAULT NOW(),
    resolved_at TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_design_action_run
    ON ai.design_action(run_id, status);
