/// <reference lib="webworker" />
// Ghi file đang nhận vào Origin Private File System (OPFS) trong worker.
// Dùng createSyncAccessHandle vì đây là cách ghi OPFS duy nhất mà Safari iOS hỗ trợ
// (chỉ có trong dedicated worker). Dữ liệu nằm trên đĩa, không giữ trong RAM.

import { OPFS_DIR, type WorkerRequest, type WorkerResponse } from "./opfsProtocol";

interface SyncHandle {
  write(buffer: ArrayBuffer | ArrayBufferView, options?: { at?: number }): number;
  truncate(size: number): void;
  flush(): void;
  close(): void;
  getSize(): number;
}

let handle: SyncHandle | null = null;
let fileName = "";
let offset = 0;
let failed = false;

const reply = (msg: WorkerResponse) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(msg);

async function getDir() {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(OPFS_DIR, { create: true });
}

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data;
  try {
    switch (msg.type) {
      case "open": {
        fileName = msg.fileName;
        const dir = await getDir();
        const fh = await dir.getFileHandle(fileName, { create: true });
        handle = await (fh as unknown as { createSyncAccessHandle(): Promise<SyncHandle> }).createSyncAccessHandle();
        handle.truncate(0);
        offset = 0;
        reply({ type: "opened" });
        break;
      }
      case "write": {
        if (failed || !handle) return;
        offset += handle.write(msg.data, { at: offset });
        break;
      }
      case "close": {
        if (!handle) throw new Error("File not open");
        handle.flush();
        const size = handle.getSize();
        handle.close();
        handle = null;
        reply({ type: "closed", size });
        break;
      }
      case "abort": {
        handle?.close();
        handle = null;
        if (fileName) await (await getDir()).removeEntry(fileName).catch(() => {});
        reply({ type: "aborted" });
        break;
      }
    }
  } catch (err) {
    failed = true;
    reply({ type: "error", message: (err as Error)?.message ?? String(err) });
  }
};
