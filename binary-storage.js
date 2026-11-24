// WebKit may reject Blob/File values in IndexedDB; persist bytes before starting a transaction.
export async function storeBinary(blob) {
  return {bytes:await blob.arrayBuffer(),type:blob.type};
}
export function readBinary(value) {
  if (value?.bytes instanceof ArrayBuffer) return new Blob([value.bytes],{type:value.type});
  return value;
}
