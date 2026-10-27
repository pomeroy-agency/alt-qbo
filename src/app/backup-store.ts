import type { BackupStore } from "../core/nightly-backups.js";

/** The subset of a Netlify Blobs store the backups use. */
interface BlobStore {
  set(key: string, data: ArrayBuffer | Blob | string): Promise<unknown>;
  get(key: string, opts: { type: "arrayBuffer" }): Promise<ArrayBuffer | null>;
  list(opts: { prefix: string }): Promise<{ blobs: { key: string }[] }>;
  delete(key: string): Promise<unknown>;
}

/** Nightly backups in a Netlify Blobs store, which sits apart from the database. */
export function netlifyBackupStore(store: BlobStore): BackupStore {
  return {
    put: async (key, data) => { await store.set(key, new Uint8Array(data).buffer as ArrayBuffer); },
    get: async (key) => {
      const b = await store.get(key, { type: "arrayBuffer" });
      return b ? new Uint8Array(b) : null;
    },
    list: async (prefix) => (await store.list({ prefix })).blobs.map((b) => b.key),
    delete: async (key) => { await store.delete(key); },
  };
}
