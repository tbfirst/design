ALTER TABLE cinestitch.cinestitch_job
    ADD COLUMN IF NOT EXISTS job_type VARCHAR(32);
