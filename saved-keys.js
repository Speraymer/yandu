const database = 'yandu-keys:' + new URL('.', import.meta.url).pathname;

async function access(mode, operation) {
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open(database, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('keys', {keyPath:'provider'});
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction('keys', mode);
      const request = operation(transaction.objectStore('keys'));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    db.close();
  }
}

export async function storeKey(provider, value) {
  const key = await crypto.subtle.generateKey({name:'AES-GCM', length:256}, false, ['encrypt','decrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({name:'AES-GCM', iv}, key, new TextEncoder().encode(value));
  await access('readwrite', store => store.put({provider, key, iv, encrypted}));
}

export function removeKey(provider) {
  return access('readwrite', store => store.delete(provider));
}

export async function loadKeys(accept) {
  const records = await access('readonly', store => store.getAll());
  const results = await Promise.allSettled(records.map(async ({provider,key,iv,encrypted}) => {
    const buffer = await crypto.subtle.decrypt({name:'AES-GCM',iv},key,encrypted);
    accept(provider,new TextDecoder().decode(buffer));
  }));
  if (results.some(r => r.status === 'rejected')) throw Error('无法读取部分已保存的密钥，请在 AI 设置中重新填写。');
}
