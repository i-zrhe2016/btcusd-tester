CREATE TABLE IF NOT EXISTS replay_projects (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    id TEXT NOT NULL,
    name TEXT NOT NULL,
    symbol TEXT NOT NULL,
    timeframe TEXT NOT NULL,
    panes JSONB NOT NULL,
    range_from BIGINT NOT NULL,
    range_to BIGINT NOT NULL,
    speed DOUBLE PRECISION NOT NULL,
    cursor_index BIGINT NOT NULL,
    cursor_timestamp BIGINT,
    trades JSONB NOT NULL,
    drawings JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, id)
);

CREATE INDEX IF NOT EXISTS replay_projects_user_updated_at_idx
    ON replay_projects(user_id, updated_at DESC);
