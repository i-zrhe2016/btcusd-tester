-- Chart indicator selections per replay project, keyed by timeframe.
-- The frontend owns the indicator catalogue; the column is structurally
-- validated by the API before it reaches this table.
ALTER TABLE replay_projects
    ADD COLUMN IF NOT EXISTS indicators JSONB NOT NULL DEFAULT '{}'::jsonb;
