CREATE TABLE IF NOT EXISTS cinestitch.cinestitch_job (
    id          BIGSERIAL PRIMARY KEY,
    user_id     BIGINT,
    model       VARCHAR(64),
    prompt      TEXT,
    result      TEXT,
    status      VARCHAR(16),
    create_time TIMESTAMP,
    update_time TIMESTAMP,
    create_by   BIGINT,
    update_by   BIGINT,
    deleted     SMALLINT DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_cinestitch_job_user ON cinestitch.cinestitch_job(user_id);

CREATE TABLE IF NOT EXISTS cinestitch.service_permission (
    id              BIGSERIAL PRIMARY KEY,
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
