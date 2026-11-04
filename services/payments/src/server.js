import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import pg from 'pg';
import { WaffoPancake, verifyWebhook } from '@waffo/pancake-ts';

const env = process.env;
const issuer = env.CLERK_ISSUER?.replace(/\/$/, '');
const parties = (env.CLERK_AUTHORIZED_PARTIES || '').split(',').map(x => x.trim()).filter(Boolean);
let jwks;
try { if (issuer && new URL(issuer).protocol === 'https:') jwks = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`)); } catch { /* unavailable configuration */ }
const pool = env.DATABASE_URL ? new pg.Pool({ connectionString: env.DATABASE_URL }) : null;
let schema;
async function database() {
  if (!pool) throw new Error('database unavailable');
  if (!schema) schema = pool.query(`
    CREATE TABLE IF NOT EXISTS waffo_checkout_orders (
      id uuid PRIMARY KEY, clerk_subject text NOT NULL, product_id text NOT NULL,
      session_id text, created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS waffo_webhook_events (
      event_id text PRIMARY KEY, event_type text NOT NULL, payload jsonb NOT NULL,
      received_at timestamptz NOT NULL DEFAULT now()
    );
  `).catch(error => { schema = undefined; throw error; });
  await schema;
  return pool;
}
function configured() {
  if (env.WAFFO_SANDBOX_CONFIRMED !== 'true' || !env.WAFFO_PRIVATE_KEY || !env.WAFFO_PRODUCT_ID ||
      !env.WAFFO_CURRENCY || !env.WAFFO_SUCCESS_URL || !env.WAFFO_MERCHANT_ID || !env.WAFFO_STORE_ID || !pool || !jwks || !parties.length) return false;
  try { return new URL(env.WAFFO_SUCCESS_URL).protocol === 'https:'; } catch { return false; }
}
async function authenticate(req) {
  if (!jwks || !parties.length) throw new Error('auth unavailable');
  const headers = req.rawHeaders.filter((_, i) => i % 2 === 0 && req.rawHeaders[i].toLowerCase() === 'authorization');
  const match = headers.length === 1 && /^Bearer ([^\s]+)$/i.exec(req.headers.authorization || '');
  if (!match) throw new Error('unauthorized');
  const { payload } = await jwtVerify(match[1], jwks, { issuer, algorithms: ['RS256'], requiredClaims: ['exp', 'nbf', 'iss', 'sub'] });
  if (typeof payload.sub !== 'string' || !/^user_[a-zA-Z0-9_]{1,250}$/.test(payload.sub) || !parties.includes(payload.azp)) throw new Error('unauthorized');
  return payload.sub;
}
async function body(req) {
  const chunks = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > 1024 * 1024) throw new Error('body too large'); chunks.push(chunk); }
  return Buffer.concat(chunks).toString('utf8');
}
function reply(res, status, data) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(JSON.stringify(data));
}
export function successUrlForOrder(configuredUrl, id) {
  const url = new URL(configuredUrl);
  url.searchParams.set('order', id);
  return url.toString();
}

export async function paymentStatus(db, id, subject) {
  const result = await db.query(`
    SELECT EXISTS (
      SELECT 1 FROM waffo_webhook_events
      WHERE payload->'data'->>'orderMerchantExternalId' = o.id::text
        AND event_type = ANY($3::text[])
    ) AS paid
    FROM waffo_checkout_orders o
    WHERE o.id = $1::uuid AND o.clerk_subject = $2
  `, [id, subject, ['subscription.activated', 'order.completed', 'subscription.payment_succeeded']]);
  return result.rows.length ? (result.rows[0].paid ? 'paid' : 'pending') : null;
}

export function createPaymentServer({ authenticateRequest = authenticate, getDatabase = database, isConfigured = configured } = {}) {
  return http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const path = url.pathname;
  if (req.method === 'GET' && path === '/health') return reply(res, 200, { ok: true });
  if (req.method === 'GET' && path === '/api/payments/status') {
    if (!isConfigured()) return reply(res, 503, { error: 'payments unavailable' });
    let subject;
    try { subject = await authenticateRequest(req); } catch { return reply(res, 401, { error: 'unauthorized' }); }
    const orders = url.searchParams.getAll('order');
    if (orders.length !== 1 || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(orders[0])) return reply(res, 400, { error: 'invalid order' });
    try {
      const status = await paymentStatus(await getDatabase(), orders[0], subject);
      return status ? reply(res, 200, { status }) : reply(res, 404, { error: 'not found' });
    } catch (error) { console.error('payment status failed', error.message); return reply(res, 503, { error: 'payments unavailable' }); }
  }
  if (req.method !== 'POST' || !['/api/payments/checkout', '/api/payments/webhook'].includes(path)) return reply(res, 404, { error: 'not found' });
  if (path === '/api/payments/checkout') {
    if (!configured()) return reply(res, 503, { error: 'payments unavailable' });
    let subject;
    try { subject = await authenticate(req); } catch { return reply(res, 401, { error: 'unauthorized' }); }
    try {
      const raw = await body(req);
      if (raw.trim() && raw.trim() !== '{}') return reply(res, 400, { error: 'request body must be empty' });
      const db = await database();
      const id = randomUUID();
      await db.query('INSERT INTO waffo_checkout_orders (id, clerk_subject, product_id) VALUES ($1, $2, $3)', [id, subject, env.WAFFO_PRODUCT_ID]);
      const client = new WaffoPancake({ merchantId: env.WAFFO_MERCHANT_ID, privateKey: env.WAFFO_PRIVATE_KEY.replace(/\\n/g, '\n'), environment: 'test' });
      const session = await client.checkout.authenticated.create({ productId: env.WAFFO_PRODUCT_ID, buyerIdentity: subject, currency: env.WAFFO_CURRENCY, successUrl: successUrlForOrder(env.WAFFO_SUCCESS_URL, id), orderMerchantExternalId: id, metadata: { orderId: id } }, { idempotencyKey: id });
      if (!session.checkoutUrl || new URL(session.checkoutUrl).protocol !== 'https:') throw new Error('invalid checkout URL');
      await db.query('UPDATE waffo_checkout_orders SET session_id = $1 WHERE id = $2', [session.sessionId, id]);
      return reply(res, 200, { checkoutUrl: session.checkoutUrl });
    } catch (error) { console.error('checkout failed', error.message); return reply(res, 502, { error: 'checkout unavailable' }); }
  }
  if (env.WAFFO_SANDBOX_CONFIRMED !== 'true' || !pool) return reply(res, 503, { error: 'payments unavailable' });
  let event;
  try {
    const raw = await body(req);
    event = verifyWebhook(raw, req.headers['x-waffo-signature'], { environment: 'test' });
    if (typeof event.id !== 'string' || !event.id || event.id.length > 255 || typeof event.eventType !== 'string' || !event.eventType || event.eventType.length > 255 || event.mode !== 'test' || event.storeId !== env.WAFFO_STORE_ID) throw new Error('invalid event');
  } catch { return reply(res, 400, { error: 'invalid webhook' }); }
  try {
    const db = await database();
    await db.query('INSERT INTO waffo_webhook_events (event_id, event_type, payload) VALUES ($1, $2, $3) ON CONFLICT (event_id) DO NOTHING', [event.id, event.eventType, JSON.stringify(event)]);
    return reply(res, 200, { received: true });
  } catch (error) { console.error('webhook persistence failed', error.message); return reply(res, 503, { error: 'webhook unavailable' }); }
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  createPaymentServer().listen(Number(env.PORT || 8083), '0.0.0.0');
}
