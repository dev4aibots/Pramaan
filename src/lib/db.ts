import postgres from 'postgres';

const g = globalThis as unknown as { __pramaanSql?: ReturnType<typeof postgres> };

export const sql =
  g.__pramaanSql ??
  postgres(process.env.DATABASE_URL || 'postgres://localhost:5432/pramaan', {
    max: 5,
    prepare: false, // compatible with pgbouncer / Neon pooled URLs
    idle_timeout: 20,
  });

if (process.env.NODE_ENV !== 'production') g.__pramaanSql = sql;
