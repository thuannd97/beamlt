// Dùng chung giữa main thread và worker opfsWriter.ts

export const OPFS_DIR = "beamlt-incoming";

export type WorkerRequest =
  | { type: "open"; fileName: string }
  | { type: "write"; data: ArrayBuffer }
  | { type: "close" }
  | { type: "abort" };

export type WorkerResponse =
  | { type: "opened" }
  | { type: "closed"; size: number }
  | { type: "aborted" }
  | { type: "error"; message: string };
