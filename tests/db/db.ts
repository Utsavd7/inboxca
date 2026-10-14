import { Client } from "pg";

// Local Supabase's database. Never a real one: these tests write and roll back.
export const DB_URL =
  process.env.TEST_DB_URL || "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

export async function connect() {
  const client = new Client({ connectionString: DB_URL });
  await client.connect();
  return client;
}

// Runs fn inside a transaction that is always rolled back, so tests leave nothing behind.
export async function rollback<T>(client: Client, fn: () => Promise<T>) {
  await client.query("begin");
  try {
    return await fn();
  } finally {
    await client.query("rollback");
  }
}

// Acts as a signed in person from here to the end of the transaction, as Supabase does
// for a request with that person's sign in token.
export async function actAs(client: Client, userId: string | null) {
  await client.query("reset role");
  if (userId === null) {
    await client.query("set local role anon");
    return;
  }
  await client.query("set local role authenticated");
  await client.query("select set_config('request.jwt.claims', $1, true)", [
    JSON.stringify({ sub: userId, role: "authenticated" }),
  ]);
}

// Back to the database owner, to set things up or check what is really stored.
export async function asOwner(client: Client) {
  await client.query("reset role");
}

// Runs a statement savepoint wrapped, so an expected refusal does not end the transaction.
export async function attempt(client: Client, sql: string, params: unknown[] = []) {
  await client.query("savepoint attempt");
  try {
    const result = await client.query(sql, params);
    await client.query("release savepoint attempt");
    return { ok: true as const, rows: result.rows, count: result.rowCount ?? 0 };
  } catch (error) {
    await client.query("rollback to savepoint attempt");
    return { ok: false as const, error: (error as Error).message };
  }
}
