const MAX_KV = 25 * 1024 * 1024;

function driver(env) {
  // Usa o R2 só se estiver configurado E a variável pedir; senão usa o KV
  if (env.STORAGE_DRIVER === 'r2' && env.FILES_R2) return 'r2';
  if (env.FILES_KV) return 'kv';
  throw new Error('Nenhum storage configurado (FILES_KV ou FILES_R2)');
}

export async function putFile(env, key, file) {
  const contentType = file.type || 'application/pdf';
  const name = file.name || 'arquivo.pdf';

  if (driver(env) === 'r2') {
    await env.FILES_R2.put(key, file.stream(), {
      httpMetadata: { contentType },
      customMetadata: { name }
    });
  } else {
    if (file.size > MAX_KV) throw new Error('Arquivo maior que 25 MB');
    await env.FILES_KV.put(key, await file.arrayBuffer(), {
      metadata: { contentType, name }
    });
  }
}

export async function getFile(env, key) {
  // Tenta no driver atual e cai para o outro (útil durante a migração)
  const order = driver(env) === 'r2' ? ['r2', 'kv'] : ['kv', 'r2'];

  for (const d of order) {
    if (d === 'r2' && env.FILES_R2) {
      const obj = await env.FILES_R2.get(key);
      if (obj) return {
        body: obj.body,
        contentType: obj.httpMetadata?.contentType || 'application/pdf',
        name: obj.customMetadata?.name || 'arquivo.pdf'
      };
    }
    if (d === 'kv' && env.FILES_KV) {
      const { value, metadata } = await env.FILES_KV.getWithMetadata(key, { type: 'arrayBuffer' });
      if (value) return {
        body: value,
        contentType: metadata?.contentType || 'application/pdf',
        name: metadata?.name || 'arquivo.pdf'
      };
    }
  }
  return null;
}

export async function deleteFile(env, key) {
  // Apaga nos dois para não sobrar arquivo órfão
  await Promise.all([
    env.FILES_KV?.delete(key),
    env.FILES_R2?.delete(key)
  ]);
}
