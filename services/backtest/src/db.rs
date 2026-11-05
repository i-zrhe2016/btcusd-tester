use serde_json::Value;
use sqlx::PgPool;
use uuid::Uuid;

use crate::model::{
    BacktestRecord, ReplayProjectRecord, ReplayProjectRequest, StrategyConfigRecord,
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

pub async fn list_backtests(pool: &PgPool, user_id: Uuid, limit: i64) -> Result<Vec<BacktestRecord>, sqlx::Error> {
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

pub async fn find_backtest(pool: &PgPool, user_id: Uuid, id: Uuid) -> Result<Option<BacktestRecord>, sqlx::Error> {
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

pub async fn list_configs(pool: &PgPool, user_id: Uuid) -> Result<Vec<StrategyConfigRecord>, sqlx::Error> {
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
               cursor_index, cursor_timestamp, trades, drawings, indicators, created_at, updated_at
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
            speed, cursor_index, cursor_timestamp, trades, drawings, indicators
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
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
            trades = EXCLUDED.trades,
            drawings = EXCLUDED.drawings,
            indicators = EXCLUDED.indicators,
            updated_at = now()
        RETURNING id, name, symbol, timeframe, panes, range_from, range_to, speed,
                  cursor_index, cursor_timestamp, trades, drawings, indicators, created_at, updated_at
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

pub async fn resolve_clerk_user(pool: &PgPool, clerk_user_id: &str) -> Result<Uuid, sqlx::Error> {
    sqlx::query_scalar(
        "INSERT INTO users (clerk_user_id, email, display_name) VALUES ($1, $2, 'Clerk user') ON CONFLICT (clerk_user_id) DO UPDATE SET clerk_user_id = EXCLUDED.clerk_user_id RETURNING id",
    )
    .bind(clerk_user_id)
    .bind(format!("{}@clerk.local.invalid", clerk_user_id))
    .fetch_one(pool)
    .await
}
