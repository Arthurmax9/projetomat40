// Adaptador do Cloudflare R2 para guardar os PDFs.
export function r2Adapter(bucket) {
  return {
    put: (key, data, type) => bucket.put(key, data, { httpMetadata: { contentType: type } }),
    async get(key) {
      const o = await bucket.get(key);
      return o ? { body: o.body } : null;
    },
    delete: (key) => bucket.delete(key),
  };
}
