import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { createReadStream, writeFileSync } from "node:fs";
import type { Browser, BrowserContext, Page } from "@playwright/test";

export async function sha256(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

/** Tạo file ngẫu nhiên kích thước `mb` MB. */
export function makeRandomFile(path: string, mb: number): string {
  const block = randomBytes(1024 * 1024);
  const buf = Buffer.alloc(mb * 1024 * 1024);
  for (let i = 0; i < mb; i++) {
    block[0] = i & 0xff; // mỗi MB khác nhau
    block.copy(buf, i * block.length);
  }
  writeFileSync(path, buf);
  return path;
}

export interface PeerOptions {
  /** Query thêm vào URL, ví dụ "relay=1&debug=1" */
  query?: string;
  /** Trả về danh sách ICE servers giả thay cho /ice-servers */
  iceServers?: RTCIceServer[];
}

export async function newPeer(browser: Browser, name: string, opts: PeerOptions = {}) {
  const context: BrowserContext = await browser.newContext({ acceptDownloads: true });
  if (opts.iceServers) {
    const servers = opts.iceServers;
    await context.route("**/ice-servers", (route) => route.fulfill({ json: servers }));
  }
  const page: Page = await context.newPage();
  page.on("console", (m) => {
    const t = m.text();
    if (/connectionState|error|fail|\[ICE\]/i.test(t)) console.log(`[${name}] ${t}`);
  });
  page.on("pageerror", (err) => console.log(`[${name}] pageerror: ${err.message}`));
  return { context, page };
}

export function withQuery(url: string, query?: string) {
  if (!query) return url;
  return url + (url.includes("?") ? "&" : "?") + query;
}

/** Bên gửi: chọn file, tạo room, trả về share link. */
export async function startSending(page: Page, filePath: string, query?: string) {
  await page.goto(withQuery("/", query));
  await page.setInputFiles("#file-input", filePath);
  await page.click(".create-room-btn");
  const input = page.locator(".share-link input");
  await input.waitFor({ timeout: 90_000 });
  return input.inputValue();
}

/** coturn local cho test relay (bỏ qua nếu máy không có `turnserver`). */
export const TURN_PORT = 3479;
export const TURN_SERVERS: RTCIceServer[] = [
  { urls: `turn:127.0.0.1:${TURN_PORT}`, username: "test", credential: "test123" },
];

export function hasTurnServer() {
  return spawnSync("sh", ["-c", "command -v turnserver"]).status === 0;
}

export async function startTurnServer(): Promise<ChildProcess> {
  const proc = spawn(
    "turnserver",
    [
      "-n", "--listening-ip=127.0.0.1", "--relay-ip=127.0.0.1", `--listening-port=${TURN_PORT}`,
      "--lt-cred-mech", "--user=test:test123", "--realm=beamlt.test",
      "--allow-loopback-peers", "--no-cli", "--no-tls", "--no-dtls", "--log-file=stdout",
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("turnserver did not start")), 10_000);
    proc.stdout!.on("data", (d: Buffer) => {
      if (/Total (General|UDP|auth) servers|listener opened/i.test(d.toString())) {
        clearTimeout(timer);
        resolve();
      }
    });
    proc.on("exit", (code) => reject(new Error(`turnserver exited with ${code}`)));
  });
  return proc;
}
