import pg from "pg";

export const createPool = (connectionString: string) =>
  new pg.Pool({ connectionString, max: 10, connectionTimeoutMillis: 5_000 });
