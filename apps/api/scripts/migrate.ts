import { readdir, readFile } from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const migrationsDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "migrations"
);

const pool = new pg.Pool({
  connectionString:
    process.env.DATABASE_URL ?? "postgres://vigie:vigie@localhost:5432/vigie",
});

async function main() {
  const client = await pool.connect();
  try {
    await client.query(
      `create table if not exists _migrations (
         name text primary key,
         applied_at timestamptz not null default now()
       )`
    );
    const files = (await readdir(migrationsDir)).filter((f) => f.endsWith(".sql")).sort();
    for (const file of files) {
      const { rowCount } = await client.query(
        "select 1 from _migrations where name = $1",
        [file]
      );
      if (rowCount) continue;
      const sql = await readFile(path.join(migrationsDir, file), "utf-8");
      console.log(`Applying ${file}…`);
      await client.query("begin");
      try {
        await client.query(sql);
        await client.query("insert into _migrations (name) values ($1)", [file]);
        await client.query("commit");
      } catch (err) {
        await client.query("rollback");
        throw err;
      }
    }
    console.log("Migrations à jour.");
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
