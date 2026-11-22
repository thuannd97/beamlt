import { test, expect } from "@playwright/test";
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

async function transfer(
  browser: import("@playwright/test").Browser,
  filePath: string,
  opts: { query?: string; iceServers?: RTCIceServer[] } = {},
) {
  const sender = await newPeer(browser, "A", opts);
  const receiver = await newPeer(browser, "B", opts);
  const link = await startSending(sender.page, filePath, opts.query);

  const download = receiver.page.waitForEvent("download", { timeout: 150_000 });
  await receiver.page.goto(withQuery(link, opts.query));
  const d = await download;
  const out = filePath + ".received";
  await d.saveAs(out);

  await expect(sender.page.locator(".file-status")).toContainText("File sent", { timeout: 30_000 });
  return { sender, receiver, out };
}

test("direct transfer (like LAN)", async ({ browser }, info) => {
  const file = makeRandomFile(info.outputPath("direct.bin"), 20);
  const { out } = await transfer(browser, file, { query: "debug=1" });
  expect(await sha256(out)).toBe(await sha256(file));
});

test.describe("via TURN (like 4G)", () => {
  let turn: ChildProcess | undefined;

  test.beforeAll(async () => {
    if (hasTurnServer()) turn = await startTurnServer();
  });
  test.afterAll(() => {
    turn?.kill();
  });

  test("forced relay through local coturn", async ({ browser }, info) => {
    test.skip(!turn, "cần cài coturn (turnserver) để chạy test relay");
    const file = makeRandomFile(info.outputPath("relay.bin"), 20);
    const { out } = await transfer(browser, file, { query: "relay=1&debug=1", iceServers: TURN_SERVERS });
    expect(await sha256(out)).toBe(await sha256(file));
  });
});
