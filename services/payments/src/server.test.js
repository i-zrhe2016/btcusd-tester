import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { createPaymentServer, successUrlForOrder } from './server.js';

async function start(extra) {
  const listener = net.createServer();
  listener.listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const port = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  const child = spawn(process.execPath, [fileURLToPath(new URL('./server.js', import.meta.url))], {
    env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, PORT: String(port), ...extra }, stdio: 'ignore'
  });
  const url = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 50; i++) {
    try { await fetch(`${url}/health`); return { child, url }; } catch { await new Promise(r => setTimeout(r, 100)); }
  }
  child.kill(); throw new Error('service did not start');
}
test('checkout success URL keeps existing parameters and fragment', () => {
  const url = new URL(successUrlForOrder('https://example.com/result?source=checkout&order=old#done', '123'));
  assert.equal(url.searchParams.get('source'), 'checkout');
  assert.deepEqual(url.searchParams.getAll('order'), ['123']);
  assert.equal(url.hash, '#done');
});

test('status requires authentication and ownership and reflects persisted events', async () => {
  const id = 'b2c56014-62b2-4a88-859c-ddb9c7e21c3b';
  const events = [];
  let queries = 0;
  const db = { async query(sql, values) {
    queries++;
    assert.match(sql, /o\.id = \$1::uuid AND o\.clerk_subject = \$2/);
    assert.match(sql, /payload->'data'->>'orderMerchantExternalId' = o\.id::text/);
    assert.deepEqual(values[2], ['subscription.activated', 'order.completed', 'subscription.payment_succeeded']);
    const [order, subject, types] = values;
    if (order !== id || subject !== 'user_owner') return { rows: [] };
    return { rows: [{ paid: events.some(event => event.order === order && types.includes(event.type)) }] };
  } };
  const server = createPaymentServer({
    isConfigured: () => true,
    authenticateRequest: async req => {
      if (!req.headers.authorization) throw new Error('unauthorized');
      return req.headers.authorization;
    },
    getDatabase: async () => db
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}/api/payments/status`;
  const request = (order, subject = 'user_owner') => fetch(`${base}?order=${encodeURIComponent(order)}`, { headers: subject ? { authorization: subject } : {} });
  try {
    assert.equal((await request(id, null)).status, 401);
    assert.equal((await request('invalid')).status, 400);
    assert.equal(queries, 0);
    assert.equal((await request(id, 'user_other')).status, 404);
    assert.equal((await request('00000000-0000-0000-0000-000000000000')).status, 404);
    assert.deepEqual(await (await request(id)).json(), { status: 'pending' });
    events.push({ order: id, type: 'order.failed' }, { order: 'other', type: 'order.completed' });
    assert.deepEqual(await (await request(id)).json(), { status: 'pending' });
    for (const type of ['subscription.activated', 'order.completed', 'subscription.payment_succeeded']) {
      events.push({ order: id, type });
      assert.deepEqual(await (await request(id)).json(), { status: 'paid' });
      events.pop();
    }
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('missing configuration fails closed', async () => {
  const { child, url } = await start({});
  try {
    const checkout = await fetch(`${url}/api/payments/checkout`, { method: 'POST' });
    assert.equal(checkout.status, 503);
    const webhook = await fetch(`${url}/api/payments/webhook`, { method: 'POST', body: '{}' });
    assert.equal(webhook.status, 503);
  } finally { child.kill(); }
});
test('webhook rejects unsigned payload before database access', async () => {
  const { child, url } = await start({ WAFFO_SANDBOX_CONFIRMED: 'true', DATABASE_URL: 'postgres://invalid:invalid@127.0.0.1:1/test' });
  try {
    const response = await fetch(`${url}/api/payments/webhook`, { method: 'POST', body: '{"id":"fake"}' });
    assert.equal(response.status, 400);
  } finally { child.kill(); }
});
