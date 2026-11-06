-- Playback moves updated_at on every cursor tick, so it cannot tell whether a
-- device's drawings or indicators are newer than the stored copy. These
-- per-collection clocks let concurrent web/mobile writes keep the newer set
-- instead of overwriting it with a stale cursor update.
ALTER TABLE replay_projects
    ADD COLUMN IF NOT EXISTS drawings_updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    ADD COLUMN IF NOT EXISTS indicators_updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
