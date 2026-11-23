const storagePrefix = new URL('.', import.meta.url).pathname + ':';
export function localGet(k) {try{return localStorage.getItem(storagePrefix+k)}catch{return null}}
export function localSet(k,v) {try{localStorage.setItem(storagePrefix+k,v);return true}catch{return false}}
