// Guarda os PDFs no disco local. Bloqueia path traversal (../).
import { writeFile, readFile, unlink, mkdir } from 'node:fs/promises';
import { resolve, dirname, sep } from 'node:path';

export function fsStorage(dir) {
  const root = resolve(dir);
  const path = (key) => {
    const f = resolve(root, String(key));
    if (!f.startsWith(root + sep)) throw new Error('Chave de arquivo inválida');
    return f;
  };

  return {
    async put(key, data) {
      const f = path(key);
      await mkdir(dirname(f), { recursive: true });
      await writeFile(f, data);
    },
    async get(key) {
      try { return { body: await readFile(path(key)) }; } catch { return null; }
    },
    async delete(key) {
      await unlink(path(key)).catch(() => {});
    },
  };
}
