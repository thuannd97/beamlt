// Nơi ghi file đang nhận. Thứ tự ưu tiên:
//  1. fs-access: Chrome/Edge máy tính, ghi thẳng vào file người dùng chọn (showSaveFilePicker)
//  2. opfs:      Safari iOS/iPadOS, Chrome Android, Firefox: ghi vào bộ nhớ riêng của trang trên đĩa
//  3. memory:    giữ trong RAM (cách cũ), chỉ dùng khi 2 cách trên không có
import { OPFS_DIR, type WorkerRequest, type WorkerResponse } from "@/workers/opfsProtocol";
import type { FileMetadata } from "./protocol";

export type SinkKind = "fs-access" | "opfs" | "memory";

export interface FileSink {
  readonly kind: SinkKind;
  /** Số byte đã nhận và đưa vào sink */
  readonly bytesWritten: number;
  write(chunk: ArrayBuffer): void;
  /** Ghi xong. Trả về File để tải về, hoặc null nếu đã lưu thẳng ra đĩa (fs-access). */
  finish(): Promise<File | null>;
  abort(): Promise<void>;
  /** Lỗi ghi file (ví dụ hết dung lượng) xảy ra bất đồng bộ */
  onError?: (err: Error) => void;
}

export class SinkCancelledError extends Error {}

export const MEMORY_WARN_BYTES = 500 * 1024 * 1024;

/** ?sink=opfs|memory|fs-access để ép loại sink (dùng khi test) */
function forcedKind(): SinkKind | null {
  const v = new URLSearchParams(window.location.search).get("sink");
  return v === "opfs" || v === "memory" || v === "fs-access" ? v : null;
}

// iPadOS báo user agent giống Mac, phân biệt bằng màn hình cảm ứng
const isMobile = () =>
  /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
  (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);

export function supportsFsAccess() {
  return typeof (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker === "function" && !isMobile();
}

export function supportsOpfs() {
  return typeof navigator.storage?.getDirectory === "function" && typeof Worker !== "undefined";
}

/** Sink sẽ dùng nếu không có gì thay đổi (để UI biết trước). */
export function preferredSinkKind(): SinkKind {
  return forcedKind() ?? (supportsFsAccess() ? "fs-access" : supportsOpfs() ? "opfs" : "memory");
}

/** Kiểm tra còn đủ chỗ trống không (OPFS/RAM đều tính vào quota của trang). */
export async function checkStorage(size: number): Promise<string | null> {
  try {
    const est = await navigator.storage?.estimate?.();
    if (est?.quota !== undefined && est.usage !== undefined && est.quota - est.usage < size) {
      return `Not enough storage space (need ${Math.ceil(size / 1e6)} MB, available ${Math.floor((est.quota - est.usage) / 1e6)} MB)`;
    }
  } catch {
    /* không kiểm tra được thì bỏ qua */
  }
  return null;
}

/**
 * Tạo sink cho file sắp nhận. Với fs-access phải gọi NGAY trong handler click
 * (trình duyệt yêu cầu thao tác của người dùng để mở hộp thoại Save).
 */
export async function createSink(meta: FileMetadata): Promise<FileSink> {
  const kind = preferredSinkKind();
  if (kind === "fs-access") {
    try {
      return await createFsAccessSink(meta);
    } catch (err) {
      if ((err as Error).name === "AbortError") throw new SinkCancelledError("Save dialog cancelled");
      console.warn("[Sink] File System Access failed, falling back:", err);
    }
  }
  if (kind !== "memory" && supportsOpfs()) {
    try {
      return await createOpfsSink(meta);
    } catch (err) {
      console.warn("[Sink] OPFS failed, falling back to memory:", err);
    }
  }
  return createMemorySink(meta);
}

// --------------------------------------------------------------------------
// 1. File System Access
// --------------------------------------------------------------------------
async function createFsAccessSink(meta: FileMetadata): Promise<FileSink> {
  type Writable = { write(data: ArrayBuffer): Promise<void>; close(): Promise<void>; abort(): Promise<void> };
  const picker = (window as unknown as {
    showSaveFilePicker(o: { suggestedName: string }): Promise<{ createWritable(): Promise<Writable> }>;
  }).showSaveFilePicker;
  const handle = await picker({ suggestedName: meta.name });
  const writable = await handle.createWritable();
  let chain = Promise.resolve();
  let bytesWritten = 0;
  let error: Error | null = null;

  const sink: FileSink = {
    kind: "fs-access",
    get bytesWritten() { return bytesWritten; },
    write(chunk) {
      bytesWritten += chunk.byteLength;
      chain = chain.then(() => writable.write(chunk)).catch((err) => {
        error ??= err;
        sink.onError?.(err);
      });
    },
    async finish() {
      await chain;
      if (error) throw error;
      await writable.close();
      return null;
    },
    async abort() {
      await chain.catch(() => {});
      await writable.abort().catch(() => {});
    },
  };
  return sink;
}

// --------------------------------------------------------------------------
// 2. OPFS (qua worker)
// --------------------------------------------------------------------------
const STALE_MS = 60 * 60 * 1000;

/** Xoá file tạm cũ (>1 giờ) trong OPFS từ các lần nhận trước. */
export async function cleanupOpfs() {
  if (!supportsOpfs()) return;
  try {
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle(OPFS_DIR, { create: true });
    const now = Date.now();
    // Tên file có dạng "<timestamp>-<tên gốc>"
    for await (const name of (dir as unknown as { keys(): AsyncIterable<string> }).keys()) {
      const ts = Number(name.split("-")[0]);
      if (!Number.isFinite(ts) || now - ts > STALE_MS) await dir.removeEntry(name).catch(() => {});
    }
  } catch (err) {
    console.warn("[Sink] OPFS cleanup failed:", err);
  }
}

async function createOpfsSink(meta: FileMetadata): Promise<FileSink> {
  const worker = new Worker(new URL("../workers/opfsWriter.ts", import.meta.url), { type: "module" });
  const fileName = `${Date.now()}-${meta.name.replace(/[\\/:*?"<>|]/g, "_")}`;
  let bytesWritten = 0;
  let error: Error | null = null;
  const waiters: Array<(msg: WorkerResponse) => void> = [];

  const sink: FileSink = {
    kind: "opfs",
    get bytesWritten() { return bytesWritten; },
    write(chunk) {
      if (error) return;
      bytesWritten += chunk.byteLength;
      // Chuyển quyền sở hữu buffer sang worker: main thread không giữ bản sao
      worker.postMessage({ type: "write", data: chunk } satisfies WorkerRequest, [chunk]);
    },
    async finish() {
      const res = await request({ type: "close" });
      worker.terminate();
      if (res.type === "error") throw new Error(res.message);
      if (error) throw error;
      const root = await navigator.storage.getDirectory();
      const dir = await root.getDirectoryHandle(OPFS_DIR);
      const file = await (await dir.getFileHandle(fileName)).getFile();
      // Trả về File mang tên gốc; dữ liệu vẫn đọc từ đĩa
      return new File([file], meta.name, { type: meta.mimeType || "application/octet-stream" });
    },
    async abort() {
      await request({ type: "abort" }).catch(() => {});
      worker.terminate();
    },
  };

  worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
    if (e.data.type === "error") {
      error ??= new Error(e.data.message);
      sink.onError?.(error);
    }
    waiters.shift()?.(e.data);
  };
  worker.onerror = (e) => {
    error ??= new Error(e.message || "OPFS worker error");
    sink.onError?.(error);
    waiters.splice(0).forEach((w) => w({ type: "error", message: error!.message }));
  };

  function request(msg: WorkerRequest) {
    return new Promise<WorkerResponse>((resolve) => {
      waiters.push(resolve);
      worker.postMessage(msg);
    });
  }

  const opened = await request({ type: "open", fileName });
  if (opened.type !== "opened") {
    worker.terminate();
    throw new Error(opened.type === "error" ? opened.message : "Could not open OPFS file");
  }
  return sink;
}

// --------------------------------------------------------------------------
// 3. Memory
// --------------------------------------------------------------------------
function createMemorySink(meta: FileMetadata): FileSink {
  let chunks: ArrayBuffer[] = [];
  let bytesWritten = 0;
  return {
    kind: "memory",
    get bytesWritten() { return bytesWritten; },
    write(chunk) {
      chunks.push(chunk);
      bytesWritten += chunk.byteLength;
    },
    async finish() {
      const file = new File(chunks, meta.name, { type: meta.mimeType || "application/octet-stream" });
      chunks = [];
      return file;
    },
    async abort() {
      chunks = [];
    },
  };
}
