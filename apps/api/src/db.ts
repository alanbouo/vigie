import pg from "pg";
import { env } from "./env.js";

export const pool = new pg.Pool({ connectionString: env.databaseUrl, max: 10 });

export async function q<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: unknown[] = []
): Promise<T[]> {
  const res = await pool.query<T>(text, params);
  return res.rows;
}

export async function one<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: unknown[] = []
): Promise<T | null> {
  const rows = await q<T>(text, params);
  return rows[0] ?? null;
}
