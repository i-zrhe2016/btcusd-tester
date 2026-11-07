use serde_json::Value;
use sqlx::PgPool;
use uuid::Uuid;

use crate::model::{
    BacktestRecord, FeedbackMessageRecord, FeedbackThreadRecord, FeedbackThreadRequest,
    ReplayProjectRecord, ReplayProjectRequest, StrategyConfigRecord,
};

pub async fn insert_backtest(
    pool: &PgPool,
    user_id: Uuid,
    name: &str,
    config: Value,
) -> Result<BacktestRecord, sqlx::Error> {
    sqlx::query_as::<_, BacktestRecord>(
        r#"
        INSERT INTO backtests (user_id, name, status, config)
        VALUES ($1, $2, 'running', $3)
        RETURNING id, user_id, name, status, config, result, error_message, created_at, completed_at
        "#,
    )
    .bind(user_id)
    .bind(name)
    .bind(config)
    .fetch_one(pool)
    .await
}

pub async fn complete_backtest(
    pool: &PgPool,
    user_id: Uuid,
    id: Uuid,
    result: Value,
) -> Result<BacktestRecord, sqlx::Error> {
    sqlx::query_as::<_, BacktestRecord>(
        r#"
        UPDATE backtests
        SET status = 'completed', result = $2, completed_at = now()
        WHERE id = $1 AND user_id = $3
        RETURNING id, user_id, name, status, config, result, error_message, created_at, completed_at
        "#,
    )
    .bind(id)
    .bind(result)
    .bind(user_id)
    .fetch_one(pool)
    .await
}

pub async fn fail_backtest(pool: &PgPool, user_id: Uuid, id: Uuid, message: &str) {
    if let Err(error) = sqlx::query(
        "UPDATE backtests SET status = 'failed', error_message = $2, completed_at = now() WHERE id = $1 AND user_id = $3",
    )
    .bind(id)
    .bind(message)
    .bind(user_id)
    .execute(pool)
    .await
    {
        tracing::error!(%error, %id, "failed to persist failed backtest state");
    }
}

pub async fn list_backtests(
    pool: &PgPool,
    user_id: Uuid,
    limit: i64,
) -> Result<Vec<BacktestRecord>, sqlx::Error> {
    sqlx::query_as::<_, BacktestRecord>(
        r#"
        SELECT id, user_id, name, status, config, result, error_message, created_at, completed_at
        FROM backtests
        WHERE user_id = $1
        ORDER BY created_at DESC
        LIMIT $2
        "#,
    )
    .bind(user_id)
    .bind(limit)
    .fetch_all(pool)
    .await
}

pub async fn find_backtest(
    pool: &PgPool,
    user_id: Uuid,
    id: Uuid,
) -> Result<Option<BacktestRecord>, sqlx::Error> {
    sqlx::query_as::<_, BacktestRecord>(
        r#"
        SELECT id, user_id, name, status, config, result, error_message, created_at, completed_at
        FROM backtests
        WHERE id = $1 AND user_id = $2
        "#,
    )
    .bind(id)
    .bind(user_id)
    .fetch_optional(pool)
    .await
}

pub async fn list_configs(
    pool: &PgPool,
    user_id: Uuid,
) -> Result<Vec<StrategyConfigRecord>, sqlx::Error> {
    sqlx::query_as::<_, StrategyConfigRecord>(
        r#"
        SELECT id, user_id, name, parameters, created_at, updated_at
        FROM strategy_configs
        WHERE user_id = $1
        ORDER BY updated_at DESC
        "#,
    )
    .bind(user_id)
    .fetch_all(pool)
    .await
}

pub async fn create_config(
    pool: &PgPool,
    user_id: Uuid,
    name: &str,
    parameters: Value,
) -> Result<StrategyConfigRecord, sqlx::Error> {
    sqlx::query_as::<_, StrategyConfigRecord>(
        r#"
        INSERT INTO strategy_configs (user_id, name, parameters)
        VALUES ($1, $2, $3)
        RETURNING id, user_id, name, parameters, created_at, updated_at
        "#,
    )
    .bind(user_id)
    .bind(name)
    .bind(parameters)
    .fetch_one(pool)
    .await
}

pub async fn list_replay_projects(
    pool: &PgPool,
    user_id: Uuid,
) -> Result<Vec<ReplayProjectRecord>, sqlx::Error> {
    sqlx::query_as::<_, ReplayProjectRecord>(
        r#"
        SELECT id, name, symbol, timeframe, panes, range_from, range_to, speed,
               cursor_index, cursor_timestamp, trades, drawings, indicators,
               drawings_updated_at, indicators_updated_at, created_at, updated_at
        FROM replay_projects
        WHERE user_id = $1
        ORDER BY updated_at DESC
        LIMIT 200
        "#,
    )
    .bind(user_id)
    .fetch_all(pool)
    .await
}

pub async fn upsert_replay_project(
    pool: &PgPool,
    user_id: Uuid,
    project: &ReplayProjectRequest,
) -> Result<ReplayProjectRecord, sqlx::Error> {
    let panes = Value::Array(project.panes.iter().cloned().map(Value::String).collect());
    let trades = Value::Array(project.trades.clone());
    let drawings = Value::Array(project.drawings.clone());
    sqlx::query_as::<_, ReplayProjectRecord>(
        r#"
        INSERT INTO replay_projects (
            user_id, id, name, symbol, timeframe, panes, range_from, range_to,
            speed, cursor_index, cursor_timestamp, trades, drawings, indicators,
            drawings_updated_at, indicators_updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
        ON CONFLICT (user_id, id) DO UPDATE SET
            name = EXCLUDED.name,
            symbol = EXCLUDED.symbol,
            timeframe = EXCLUDED.timeframe,
            panes = EXCLUDED.panes,
            range_from = EXCLUDED.range_from,
            range_to = EXCLUDED.range_to,
            speed = EXCLUDED.speed,
            cursor_index = EXCLUDED.cursor_index,
            cursor_timestamp = EXCLUDED.cursor_timestamp,
            -- Trades are append-only and identified by id. Unioning them means a
            -- stale cursor write from the other device cannot erase a trade.
            trades = CASE
                WHEN replay_projects.symbol = EXCLUDED.symbol
                 AND replay_projects.range_from = EXCLUDED.range_from
                 AND replay_projects.range_to = EXCLUDED.range_to
                THEN (
                    SELECT COALESCE(jsonb_agg(item), '[]'::jsonb)
                    FROM (
                        SELECT DISTINCT ON (element->>'id') element AS item
                        FROM jsonb_array_elements(replay_projects.trades || EXCLUDED.trades) AS element
                    ) AS merged_trades
                )
                ELSE EXCLUDED.trades
            END,
            -- Collections carry their own clock so playback ticks cannot regress
            -- newer drawings or indicator selections written by the other device.
            drawings = CASE
                WHEN COALESCE(EXCLUDED.drawings_updated_at, now()) >= replay_projects.drawings_updated_at
                THEN EXCLUDED.drawings
                ELSE replay_projects.drawings
            END,
            indicators = CASE
                WHEN COALESCE(EXCLUDED.indicators_updated_at, now()) >= replay_projects.indicators_updated_at
                THEN EXCLUDED.indicators
                ELSE replay_projects.indicators
            END,
            drawings_updated_at = GREATEST(
                replay_projects.drawings_updated_at,
                COALESCE(EXCLUDED.drawings_updated_at, now())
            ),
            indicators_updated_at = GREATEST(
                replay_projects.indicators_updated_at,
                COALESCE(EXCLUDED.indicators_updated_at, now())
            ),
            updated_at = now()
        RETURNING id, name, symbol, timeframe, panes, range_from, range_to, speed,
                  cursor_index, cursor_timestamp, trades, drawings, indicators,
                  drawings_updated_at, indicators_updated_at, created_at, updated_at
        "#,
    )
    .bind(user_id)
    .bind(&project.id)
    .bind(project.name.trim())
    .bind(&project.symbol)
    .bind(&project.timeframe)
    .bind(panes)
    .bind(project.from)
    .bind(project.to)
    .bind(project.speed)
    .bind(project.cursor_index)
    .bind(project.cursor_timestamp)
    .bind(trades)
    .bind(drawings)
    .bind(project.indicators.clone())
    .bind(project.drawings_updated_at)
    .bind(project.indicators_updated_at)
    .fetch_one(pool)
    .await
}

pub async fn delete_replay_project(
    pool: &PgPool,
    user_id: Uuid,
    id: &str,
) -> Result<u64, sqlx::Error> {
    let result = sqlx::query("DELETE FROM replay_projects WHERE user_id = $1 AND id = $2")
        .bind(user_id)
        .bind(id)
        .execute(pool)
        .await?;
    Ok(result.rows_affected())
}

const FEEDBACK_THREAD_SELECT: &str = r#"
    SELECT t.id, t.title, t.category, t.status,
           COALESCE(right(u.clerk_user_id, 4), left(t.user_id::text, 4)) AS author_code,
           (t.user_id = $1) AS mine,
           stats.message_count,
           COALESCE(stats.last_body, '') AS last_body,
           t.created_at, t.updated_at
    FROM feedback_threads t
    JOIN users u ON u.id = t.user_id
    LEFT JOIN LATERAL (
        SELECT COUNT(*) AS message_count,
               (ARRAY_AGG(m.body ORDER BY m.created_at DESC, m.id DESC))[1] AS last_body
        FROM feedback_messages m
        WHERE m.thread_id = t.id
    ) stats ON TRUE
"#;

pub async fn list_feedback_threads(
    pool: &PgPool,
    viewer_id: Uuid,
    limit: i64,
) -> Result<Vec<FeedbackThreadRecord>, sqlx::Error> {
    sqlx::query_as::<_, FeedbackThreadRecord>(&format!(
        "{FEEDBACK_THREAD_SELECT} ORDER BY t.updated_at DESC LIMIT $2"
    ))
    .bind(viewer_id)
    .bind(limit)
    .fetch_all(pool)
    .await
}

async fn find_feedback_thread_in<'e, E>(
    executor: E,
    viewer_id: Uuid,
    thread_id: Uuid,
) -> Result<Option<FeedbackThreadRecord>, sqlx::Error>
where
    E: sqlx::PgExecutor<'e>,
{
    sqlx::query_as::<_, FeedbackThreadRecord>(&format!("{FEEDBACK_THREAD_SELECT} WHERE t.id = $2"))
        .bind(viewer_id)
        .bind(thread_id)
        .fetch_optional(executor)
        .await
}

pub async fn find_feedback_thread(
    pool: &PgPool,
    viewer_id: Uuid,
    thread_id: Uuid,
) -> Result<Option<FeedbackThreadRecord>, sqlx::Error> {
    find_feedback_thread_in(pool, viewer_id, thread_id).await
}

pub async fn create_feedback_thread(
    pool: &PgPool,
    user_id: Uuid,
    request: &FeedbackThreadRequest,
) -> Result<FeedbackThreadRecord, sqlx::Error> {
    let mut tx = pool.begin().await?;
    let id: Uuid = sqlx::query_scalar(
        "INSERT INTO feedback_threads (user_id, title, category) VALUES ($1, $2, $3) RETURNING id",
    )
    .bind(user_id)
    .bind(request.title.trim())
    .bind(&request.category)
    .fetch_one(&mut *tx)
    .await?;
    sqlx::query("INSERT INTO feedback_messages (thread_id, author, body) VALUES ($1, 'user', $2)")
        .bind(id)
        .bind(request.body.trim())
        .execute(&mut *tx)
        .await?;
    let record = find_feedback_thread_in(&mut *tx, user_id, id)
        .await?
        .ok_or(sqlx::Error::RowNotFound)?;
    tx.commit().await?;
    Ok(record)
}

pub async fn list_feedback_messages(
    pool: &PgPool,
    thread_id: Uuid,
) -> Result<Vec<FeedbackMessageRecord>, sqlx::Error> {
    sqlx::query_as::<_, FeedbackMessageRecord>(
        r#"
        SELECT id, author, body, created_at
        FROM feedback_messages
        WHERE thread_id = $1
        ORDER BY created_at ASC, id ASC
        "#,
    )
    .bind(thread_id)
    .fetch_all(pool)
    .await
}

pub async fn add_feedback_message(
    pool: &PgPool,
    user_id: Uuid,
    thread_id: Uuid,
    body: &str,
) -> Result<Option<FeedbackMessageRecord>, sqlx::Error> {
    let mut tx = pool.begin().await?;
    let owned: Option<Uuid> = sqlx::query_scalar(
        "SELECT id FROM feedback_threads WHERE id = $1 AND user_id = $2 FOR UPDATE",
    )
    .bind(thread_id)
    .bind(user_id)
    .fetch_optional(&mut *tx)
    .await?;
    if owned.is_none() {
        tx.rollback().await?;
        return Ok(None);
    }
    let message = sqlx::query_as::<_, FeedbackMessageRecord>(
        r#"
        INSERT INTO feedback_messages (thread_id, author, body)
        VALUES ($1, 'user', $2)
        RETURNING id, author, body, created_at
        "#,
    )
    .bind(thread_id)
    .bind(body.trim())
    .fetch_one(&mut *tx)
    .await?;
    sqlx::query("UPDATE feedback_threads SET updated_at = now() WHERE id = $1")
        .bind(thread_id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(Some(message))
}

pub async fn resolve_clerk_user(pool: &PgPool, clerk_user_id: &str) -> Result<Uuid, sqlx::Error> {
    sqlx::query_scalar(
        "INSERT INTO users (clerk_user_id, email, display_name) VALUES ($1, $2, 'Clerk user') ON CONFLICT (clerk_user_id) DO UPDATE SET clerk_user_id = EXCLUDED.clerk_user_id RETURNING id",
    )
    .bind(clerk_user_id)
    .bind(format!("{clerk_user_id}@clerk.local.invalid"))
    .fetch_one(pool)
    .await
}
