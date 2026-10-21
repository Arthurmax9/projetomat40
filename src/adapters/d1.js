// Adaptador do Cloudflare D1. Expõe a mesma interface do SQLite: all, first, run, batch.
export function d1Adapter(db) {
  return {
    all: async (sql, p = []) => (await db.prepare(sql).bind(...p).all()).results || [],
    first: async (sql, p = []) => (await db.prepare(sql).bind(...p).first()) ?? null,
    run: async (sql, p = []) => {
      const r = await db.prepare(sql).bind(...p).run();
      return { changes: r.meta?.changes ?? 0 };
    },
    // O batch do D1 é atômico: ou executa tudo, ou nada.
    batch: async (stmts) => {
      if (!stmts.length) return;
      await db.batch(stmts.map(([sql, p = []]) => db.prepare(sql).bind(...p)));
    },
  };
}
