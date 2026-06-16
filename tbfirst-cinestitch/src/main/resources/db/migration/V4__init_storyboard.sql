CREATE TABLE IF NOT EXISTS cinestitch.storyboard_project (
    id              BIGSERIAL       PRIMARY KEY,
    user_id         BIGINT          NOT NULL,
    title           VARCHAR(200),
    status          VARCHAR(16)     DEFAULT 'draft',
    stage           VARCHAR(24),
    doc_json        JSONB,
    cover_image_url VARCHAR(512),
    create_time     TIMESTAMP,
    update_time     TIMESTAMP,
    create_by       BIGINT,
    update_by       BIGINT,
    deleted         SMALLINT        DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_sb_user_id ON cinestitch.storyboard_project(user_id);
