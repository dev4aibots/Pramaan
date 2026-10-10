// Demo seeding removed. PRAMAAN now uses registered accounts only.
// The database schema is applied separately in src/lib/db.ts.
// This module is kept as a no-op for backward compatibility with imports.
export function ensureSeeded(_sql: any): Promise<void> {
  return Promise.resolve();
}
