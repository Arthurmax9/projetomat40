// Adapter de armazenamento usando Workers KV (sem cartão)
export function kvAdapter(kv) {
  return {
    async put(key, body, contentType = 'application/octet-stream') {
      const data = body instanceof ArrayBuffer
        ? body
        : await new Response(body).arrayBuffer();
      if (data.byteLength > 25 * 1024 * 1024) {
        throw new Error('Arquivo maior que 25 MB (limite do KV)');
      }
      await kv.put(key, data, { metadata: { contentType, size: data.byteLength } });
    },

    async get(key) {
      const { value, metadata } = await kv.getWithMetadata(key, { type: 'stream' });
      if (!value) return null;
      return {
        body: value,
        contentType: metadata?.contentType || 'application/octet-stream',
        size: metadata?.size,
      };
    },

    async delete(key) {
      await kv.delete(key);
    },
  };
}
