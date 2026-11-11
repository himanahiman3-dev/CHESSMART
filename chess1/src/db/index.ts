// src/db/index.ts
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

function makeDb() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");
  const pool = new Pool({
    connectionString: url,
    // внешний адрес Render Postgres требует SSL, внутренний — нет
    ssl: url.includes("render.com") ? { rejectUnauthorized: false } : undefined,
  });
  return drizzle(pool, { schema });
}

type Db = ReturnType<typeof makeDb>;
let _db: Db | undefined;
export const getDb = (): Db => (_db ??= makeDb());

// остальной код может по-прежнему писать: import { db } from "@/db"
export const db = new Proxy({} as Db, {
  get: (_t, prop) => Reflect.get(getDb() as object, prop),
});