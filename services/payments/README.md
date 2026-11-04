# Waffo sandbox payments

The pricing page starts a Waffo hosted checkout for signed-in Clerk users. The payment service records verified webhook deliveries in PostgreSQL. It does **not** grant or revoke workspace access; workspace access is currently based on sign-in alone.

## Configuration

1. In Waffo, create or select a test subscription product in store `STO_1uu8TZ3IqTEfjmlTCspVxd`. Confirm its price is USD 12.99 per month, matching the pricing page. The service does not validate the product's price, interval, or store before checkout.
2. Set the variables in `.env.example` in your deployment's environment: `WAFFO_PRIVATE_KEY` to the Waffo **test** private key, `WAFFO_PRODUCT_ID` to that product, `WAFFO_SUCCESS_URL` to `https://grailab.top/payment-return`, and the Clerk issuer and authorized parties. A PEM key can use literal `\n` for line breaks.
3. After confirming the key is a test key, set `WAFFO_SANDBOX_CONFIRMED=true`. Waffo determines the API environment from the key; this flag cannot verify which environment a key belongs to. Never use a production key with this sandbox setup.
4. Start the Compose stack. Configure a Waffo test-mode HTTP webhook for `https://grailab.top/api/payments/webhook`, including `order.completed`, `subscription.activated`, and `subscription.payment_succeeded`. Webhook deliveries must reach the service and its PostgreSQL database; failed deliveries receive a non-success response for retry. The return page shows success only after a matching verified event is recorded.
5. Sign in, select the pricing button, and complete a test checkout. Waffo documents Visa `4576 7500 0000 0110` for success and `4576 7500 0000 0220` for decline, with any future expiry and CVC.

The private key stays on the server and must not be committed. Webhook payloads are retained in the `waffo_webhook_events` table; no event processor or subscription entitlement enforcement is implemented. Register the webhook separately in Waffo; starting the service does not register it automatically.
