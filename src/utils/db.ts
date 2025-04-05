import type db from "~/db";

let _db: typeof db | null = null;

export const useDatabase = async () => {
  if (!_db) {
    const db = await import("~/db");
    _db = db.default;
  }
  return _db;
};
