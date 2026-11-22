import { test, expect, type Browser, type Page } from "@playwright/test";
import type { ChildProcess } from "node:child_process";
import {
  sha256,
  makeRandomFile,
  newPeer,
  startSending,
  withQuery,
  hasTurnServer,
  startTurnServer,
  TURN_SERVERS,
} from "./helpers";

interface TransferOptions {
  query?: string;
  /** Query riêng cho bên nhận (mặc định ép OPFS: headless không bấm được hộp thoại Save) */
  receiverQuery?: string;
  iceServers?: RTCIceServer[];
  /** Chạy trong lúc đang gửi (sau khi bên nhận bấm Accept) */
  duringTransfer?: (pages: { sender: Page; receiver: Page }) => Promise<void>;
}

async function transfer(browser: Browser, filePath: string, opts: TransferOptions = {}) {
  const sender = await newPeer(browser, "A", opts);
  const receiver = await newPeer(browser, "B", opts);
  const link = await startSending(sender.page, filePath, opts.query);

  const download = receiver.page.waitForEvent("download", { timeout: 170_000 });
  await receiver.page.goto(withQuery(withQuery(link, opts.query), opts.receiverQuery ?? "sink=opfs"));
  await receiver.page.click(".accept-btn", { timeout: 60_000 });
  await opts.duringTransfer?.({ sender: sender.page, receiver: receiver.page });
  const d = await download;
  const out = filePath + ".received";
  await d.saveAs(out);

  await expect(sender.page.locator(".file-status")).toContainText("File sent", { timeout: 30_000 });
  return { sender, receiver, out, link };
}

const debugValue = (page: Page, key: string) => page.evaluate((k) => (window as any).__beamlt[k].value, key);

test("direct transfer (like LAN), saved via OPFS", async ({ browser }, info) => {
  const file = makeRandomFile(info.outputPath("direct.bin"), 20);
  const { out, sender, receiver } = await transfer(browser, file, { query: "debug=1" });
  expect(await sha256(out)).toBe(await sha256(file));
  expect(await debugValue(receiver.page, "sinkKind")).toBe("opfs");
  // Phase 2: nhãn loại kết nối + tốc độ trung bình ở cả 2 bên
  for (const page of [sender.page, receiver.page]) {
    expect(await debugValue(page, "connectionType")).toBe("direct");
    await expect(page.locator(".connection-type")).toContainText("Direct connection");
    await expect(page.locator(".transfer-stats")).toContainText(/Average [\d.]+ (MB|KB)\/s/);
  }
});

test("memory sink still works", async ({ browser }, info) => {
  const file = makeRandomFile(info.outputPath("memory.bin"), 5);
  const { out, receiver } = await transfer(browser, file, { query: "debug=1", receiverQuery: "sink=memory" });
  expect(await sha256(out)).toBe(await sha256(file));
  expect(await receiver.page.evaluate(() => (window as any).__beamlt.sinkKind.value)).toBe("memory");
});

test("large file (300 MB) via OPFS", async ({ browser }, info) => {
  test.setTimeout(300_000);
  const file = makeRandomFile(info.outputPath("large.bin"), 300);
  const { out } = await transfer(browser, file, {
    query: "debug=1",
    // Phase 2: trong lúc nhận phải thấy tốc độ và thời gian còn lại
    duringTransfer: async ({ receiver }) => {
      await expect(receiver.locator(".transfer-stats")).toContainText(/[\d.]+ (MB|KB)\/s · \d+:\d{2} left/, {
        timeout: 20_000,
      });
    },
  });
  expect(await sha256(out)).toBe(await sha256(file));
});

test("receiver can decline", async ({ browser }, info) => {
  const file = makeRandomFile(info.outputPath("decline.bin"), 1);
  const sender = await newPeer(browser, "A");
  const receiver = await newPeer(browser, "B");
  const link = await startSending(sender.page, file);
  await receiver.page.goto(withQuery(link, "sink=opfs"));
  await receiver.page.click(".reject-btn", { timeout: 60_000 });
  await expect(sender.page.locator(".file-status")).toContainText("declined", { timeout: 15_000 });
});

test("a third person cannot join a room", async ({ browser }, info) => {
  const file = makeRandomFile(info.outputPath("full.bin"), 10);
  const sender = await newPeer(browser, "A");
  const receiver = await newPeer(browser, "B");
  const intruder = await newPeer(browser, "C");
  const link = await startSending(sender.page, file);

  await receiver.page.goto(withQuery(link, "sink=opfs"));
  await receiver.page.locator(".accept-btn").waitFor({ timeout: 60_000 });

  await intruder.page.goto(withQuery(link, "sink=opfs"));
  await expect(intruder.page.locator(".status")).toContainText("already has two people", { timeout: 30_000 });

  // Người thứ 3 không phá được lượt gửi của 2 người đầu
  const download = receiver.page.waitForEvent("download", { timeout: 60_000 });
  await receiver.page.click(".accept-btn");
  const out = file + ".received";
  await (await download).saveAs(out);
  expect(await sha256(out)).toBe(await sha256(file));
});

test.describe("via TURN (like 4G)", () => {
  let turn: ChildProcess | undefined;

  test.beforeEach(async () => {
    if (hasTurnServer()) turn = await startTurnServer();
  });
  test.afterEach(() => {
    turn?.kill();
    turn = undefined;
  });

  test("forced relay through local coturn", async ({ browser }, info) => {
    test.skip(!turn, "requires coturn (turnserver) for relay tests");
    const file = makeRandomFile(info.outputPath("relay.bin"), 20);
    const { out, receiver } = await transfer(browser, file, { query: "relay=1&debug=1", iceServers: TURN_SERVERS });
    expect(await sha256(out)).toBe(await sha256(file));
    expect(await debugValue(receiver.page, "connectionType")).toBe("relay");
    await expect(receiver.page.locator(".connection-type")).toContainText("relay server");
  });

  test("recovers with ICE restart when the relay drops mid-transfer", async ({ browser }, info) => {
    test.skip(!turn, "requires coturn (turnserver) for relay tests");
    test.setTimeout(240_000);
    const file = makeRandomFile(info.outputPath("restart.bin"), 150);
    const { out } = await transfer(browser, file, {
      query: "relay=1&debug=1",
      iceServers: TURN_SERVERS,
      duringTransfer: async () => {
        await new Promise((r) => setTimeout(r, 1500));
        turn!.kill("SIGKILL"); // mất relay: kết nối chuyển sang disconnected/failed
        await new Promise((r) => setTimeout(r, 3000));
        turn = await startTurnServer(); // relay quay lại: ICE restart phải nối lại được
      },
    });
    expect(await sha256(out)).toBe(await sha256(file));
  });
});
