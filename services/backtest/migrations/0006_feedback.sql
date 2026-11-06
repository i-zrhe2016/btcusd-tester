-- User feedback board. Threads are visible to every signed-in user; only the
-- author can append follow-up messages. Team replies are written by operators.
CREATE TABLE IF NOT EXISTS feedback_threads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'bug' CHECK (category IN ('bug', 'idea', 'other')),
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'resolved')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS feedback_threads_updated_at_idx
    ON feedback_threads(updated_at DESC);

CREATE TABLE IF NOT EXISTS feedback_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    thread_id UUID NOT NULL REFERENCES feedback_threads(id) ON DELETE CASCADE,
    author TEXT NOT NULL CHECK (author IN ('user', 'team')),
    body TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS feedback_messages_thread_created_at_idx
    ON feedback_messages(thread_id, created_at);
