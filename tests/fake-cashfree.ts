import { createHmac, randomUUID } from "node:crypto";
import { createServer } from "node:http";

// A stand in for Cashfree's Payment Gateway (src/lib/billing/cashfree.ts), on this machine only:
// it keeps what InboxCA asked for, answers as Cashfree's docs show, and sends webhooks signed
// as Cashfree signs them, with invented keys. Its checkout script opens its own pages, which
// authorise or pay at once and send the owner back. Its keys are made fresh for each run and
// given to it and to the app under test alike.
export type CashfreeKeys = { CASHFREE_APP_ID: string; CASHFREE_SECRET_KEY: string };

type Deliver = (raw: string, headers: Record<string, string>) => Promise<unknown>;
type Body = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export function fakeCashfree(keys: CashfreeKeys, deliver: Deliver) {
  const subscriptions = new Map<string, Body>();
  const charges = new Map<string, Body>();
  const orders = new Map<string, Body>();
  const refunds = new Map<string, Body & { via: "order" | "subscription" }>();
  const calls: { path: string; body: Body }[] = [];
  const recon: Body[] = [];
  let base = "";
  // A refund's webhook follows on its own, as Cashfree's would, unless a test settles it.
  let refundsSettle: "SUCCESS" | "FAILED" | null = null;
  // The next call to a path ending so is turned down, or carried out with its answer lost.
  const faults = new Map<string, "refused" | "lost">();

  const send = async (type: string, data: Body) => {
    const raw = JSON.stringify({ type, event_time: new Date().toISOString(), data });
    const timestamp = String(Date.now());
    const signature = createHmac("sha256", keys.CASHFREE_SECRET_KEY).update(timestamp + raw).digest("base64");
    return deliver(raw, { "content-type": "application/json", "x-webhook-timestamp": timestamp, "x-webhook-signature": signature, "x-webhook-version": "2025-01-01", "x-idempotency-key": randomUUID() });
  };
  const fake = {
    subscriptions, charges, orders, refunds, calls, recon,
    get url() { return base; },
    settleRefunds(outcome: "SUCCESS" | "FAILED" | null) { refundsSettle = outcome; },
    fail(ending: string, how: "refused" | "lost") { faults.set(ending, how); },
    authorise: (id: string, method = "upi") => {
      subscriptions.get(id)!.status = "ACTIVE";
      return send("SUBSCRIPTION_STATUS_CHANGED", {
        subscription_details: { subscription_id: id, cf_subscription_id: `cf-${id}`, subscription_status: "ACTIVE" },
        authorization_details: { authorization_status: "SUCCESS", payment_id: `auth-${id}`, payment_group: method, payment_method: { [method]: {} } },
      });
    },
    cancelByCustomer: (id: string) => send("SUBSCRIPTION_STATUS_CHANGED", { subscription_details: { subscription_id: id, subscription_status: "CUSTOMER_CANCELLED" } }),
    charge: (id: string, outcome: "SUCCESS" | "FAILED", reason = "DEBIT FAILED | Insufficient Funds In Customer (Remitter) Account") =>
      send(outcome === "SUCCESS" ? "SUBSCRIPTION_PAYMENT_SUCCESS" : "SUBSCRIPTION_PAYMENT_FAILED", {
        payment_id: id, cf_payment_id: `cf-${id}`, subscription_id: charges.get(id)?.subscription_id, payment_type: "CHARGE", payment_amount: charges.get(id)?.payment_amount, payment_status: outcome,
        ...(outcome === "FAILED" && { failure_details: { failure_reason: reason } }),
      }),
    pay: (id: string) => send("PAYMENT_SUCCESS_WEBHOOK", { order: { order_id: id, order_amount: orders.get(id)?.order_amount }, payment: { cf_payment_id: `cf-${id}`, payment_status: "SUCCESS", payment_amount: orders.get(id)?.order_amount, payment_group: "upi" } }),
    refund: (id: string, outcome: "SUCCESS" | "FAILED") => refunds.get(id)?.via === "order"
      ? send("REFUND_STATUS_WEBHOOK", { refund: { refund_id: id, cf_refund_id: `cf-${id}`, order_id: refunds.get(id)?.order_id, refund_amount: refunds.get(id)?.refund_amount, refund_status: outcome === "SUCCESS" ? "SUCCESS" : "CANCELLED" } })
      : send("SUBSCRIPTION_REFUND_STATUS", { refund_id: id, cf_refund_id: `cf-${id}`, payment_id: refunds.get(id)?.payment_id, refund_amount: refunds.get(id)?.refund_amount, refund_status: outcome }),
  };

  const page = (location: string) => ({ status: 303, headers: { Location: location } });
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", base);
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk as Buffer);
    const body = chunks.length ? (JSON.parse(Buffer.concat(chunks).toString()) as Body) : {};
    const fault = [...faults.keys()].find((ending) => url.pathname.endsWith(ending));
    const how = fault && request.headers["x-client-id"] ? faults.get(fault) : undefined;
    if (how) faults.delete(fault!);
    const answer = (status: number, json: Body | string, headers: Record<string, string> = { "Content-Type": "application/json" }) => void (how === "lost" ? response.destroy() : response.writeHead(status, headers).end(typeof json === "string" ? json : JSON.stringify(json)));
    if (request.method === "GET" && url.pathname === "/js/v3/cashfree.js")
      return answer(200, `window.Cashfree=function(){return{subscriptionsCheckout:function(o){location.href=${JSON.stringify(base)}+"/checkout/mandate/"+encodeURIComponent(o.subsSessionId);return Promise.resolve({})},checkout:function(o){location.href=${JSON.stringify(base)}+"/checkout/order/"+encodeURIComponent(o.paymentSessionId);return Promise.resolve({})}}}`, { "Content-Type": "text/javascript" });
    if (request.method === "GET" && url.pathname.startsWith("/checkout/")) {
      const [, , kind, session] = url.pathname.split("/");
      const id = decodeURIComponent(session).replace(/^session-/, "");
      if (kind === "mandate") await fake.authorise(id, subscriptions.get(id)!.authorization_details.payment_methods[0]);
      else await fake.pay(id);
      const { status, headers } = page((kind === "mandate" ? subscriptions.get(id)!.subscription_meta.return_url : orders.get(id)!.order_meta.return_url) as string);
      return void response.writeHead(status, headers).end();
    }
    if (request.headers["x-client-id"] !== keys.CASHFREE_APP_ID || request.headers["x-client-secret"] !== keys.CASHFREE_SECRET_KEY || !request.headers["x-api-version"]) return answer(401, { code: "authentication_failed" });
    calls.push({ path: url.pathname, body });
    if (how === "refused") return void response.writeHead(400, { "Content-Type": "application/json" }).end(JSON.stringify({ code: "request_failed" }));
    const parts = url.pathname.split("/").map(decodeURIComponent);
    if (url.pathname === "/pg/plans") return answer(200, { ...body, plan_status: "ACTIVE" });
    if (url.pathname === "/pg/subscriptions") {
      subscriptions.set(body.subscription_id, { ...body, status: "INITIALIZED" });
      return answer(200, { subscription_id: body.subscription_id, cf_subscription_id: `cf-${body.subscription_id}`, subscription_session_id: `session-${body.subscription_id}`, subscription_status: "INITIALIZED" });
    }
    if (url.pathname === "/pg/subscriptions/pay") {
      charges.set(body.payment_id, { ...body, status: "INITIALIZED" });
      return answer(200, { payment_id: body.payment_id, cf_payment_id: `cf-${body.payment_id}`, payment_status: "INITIALIZED" });
    }
    if (parts[2] === "subscriptions" && parts[4] === "payments" && parts[6] === "manage") {
      charges.get(parts[5])!.status = "CANCELLED";
      return answer(200, { payment_id: parts[5], payment_status: "CANCELLED" });
    }
    if (parts[2] === "subscriptions" && parts[4] === "manage") {
      subscriptions.get(parts[3])!.status = body.action === "CANCEL" ? "CANCELLED" : subscriptions.get(parts[3])!.status;
      return answer(200, { subscription_id: parts[3], subscription_status: subscriptions.get(parts[3])!.status });
    }
    const refunded = async (id: string) => {
      if (refundsSettle) setTimeout(() => void fake.refund(id, refundsSettle!), 200);
    };
    if (parts[2] === "subscriptions" && parts[4] === "refunds") {
      refunds.set(body.refund_id, { ...body, via: "subscription" });
      await refunded(body.refund_id);
      return answer(200, { refund_id: body.refund_id, refund_status: "PENDING" });
    }
    if (url.pathname === "/pg/orders") {
      orders.set(body.order_id, body);
      return answer(200, { order_id: body.order_id, cf_order_id: `cf-${body.order_id}`, payment_session_id: `session-${body.order_id}`, order_status: "ACTIVE" });
    }
    if (parts[2] === "orders" && parts[4] === "refunds") {
      refunds.set(body.refund_id, { ...body, order_id: parts[3], via: "order" });
      await refunded(body.refund_id);
      return answer(200, { refund_id: body.refund_id, refund_status: "PENDING" });
    }
    if (url.pathname === "/pg/recon") return answer(200, { cursor: null, limit: 1000, data: recon });
    return answer(404, { code: "not_found" });
  });

  return Object.assign(fake, {
    listen: (port = 0) => new Promise<void>((resolve) => server.listen(port, "127.0.0.1", () => {
      base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
      resolve();
    })),
    close: () => new Promise((resolve) => server.close(resolve)),
  });
}
