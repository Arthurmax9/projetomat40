// Adaptador SQLite (better-sqlite3) para rodar em qualquer servidor.
// Para usar Postgres ou MySQL, crie um arquivo com estas mesmas 4 funções.
import Database from 'better-sqlite3';

export function sqliteAdapter(file, migrationSql) {
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.exec(migrationSql); // cria as tabelas, se ainda não existirem

  return {
    all: async (sql, p = []) => db.prepare(sql).all(...p),
    first: async (sql, p = []) => db.prepare(sql).get(...p) ?? null,
    run: async (sql, p = []) => ({ changes: db.prepare(sql).run(...p).changes }),
    // Transação atômica, equivalente ao batch do D1
    batch: async (stmts) => {
      if (!stmts.length) return;
      db.transaction(() => {
        for (const [sql, p = []] of stmts) db.prepare(sql).run(...p);
      })();
    },
  };
}
