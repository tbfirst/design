-- Stable idempotency key for cross-service retries. A soft-deleted job does not
-- block a deliberately new request that reuses the old key.
ALTER TABLE image.generation_job ADD COLUMN IF NOT EXISTS request_id VARCHAR(128);
CREATE UNIQUE INDEX IF NOT EXISTS uk_generation_job_user_request
    ON image.generation_job(user_id, request_id)
    WHERE request_id IS NOT NULL AND deleted = 0;
