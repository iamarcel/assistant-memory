import { env } from "./env";
import type db from "~/db";

let _db: typeof db | null = null;

export const useDatabase = async () => {
  if (!_db) {
    const db = await import("~/db");
    const { migrate } = await import("drizzle-orm/node-postgres/migrator");

    if (env.RUN_MIGRATIONS === "true") {
      await migrate(db.default, {
        migrationsFolder: "./drizzle",
      });
    }

    _db = db.default;
  }
  return _db;
};
