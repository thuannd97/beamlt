// Phase 3: kiểm tra toàn vẹn file và gửi tiếp khi bị ngắt.
import { test, expect, type Page } from "@playwright/test";
import { sha256, makeRandomFile, newPeer, startSending, withQuery } from "./helpers";

const debugValue = (page: Page, key: string) => page.evaluate((k) => (window as any).__beamlt[k].value, key);

test("corrupted data is detected and not saved", async ({ browser }, info) => {
  const file = makeRandomFile(info.outputPath("corrupt.bin"), 5);
  const sender = await newPeer(browser, "A");
  const receiver = await newPeer(browser, "B");
  // Bên gửi: lật 1 byte trong chunk dữ liệu thứ 10 (sau khi đã tính hash)
  await sender.context.addInitScript(() => {
    const orig = RTCDataChannel.prototype.send;
    let n = 0;
    RTCDataChannel.prototype.send = function (data: any) {
      if (data instanceof ArrayBuffer && ++n === 10) new Uint8Array(data)[0] ^= 0xff;
      return orig.call(this, data);
    };
  });
  const link = await startSending(sender.page, file);
  let downloaded = false;
  receiver.page.on("download", () => (downloaded = true));
  await receiver.page.goto(withQuery(link, "sink=opfs"));
  await receiver.page.click(".accept-btn", { timeout: 60_000 });

  await expect(receiver.page.locator(".status")).toContainText("corrupted", { timeout: 60_000 });
  await expect(sender.page.locator(".file-status")).toContainText("corrupted", { timeout: 15_000 });
  expect(downloaded).toBe(false);
});

for (const how of ["datachannel", "peerconnection"] as const) {
  test(`resumes after the ${how} is closed mid-transfer`, async ({ browser }, info) => {
    test.setTimeout(240_000);
    const file = makeRandomFile(info.outputPath(`resume-${how}.bin`), 200);
    const sender = await newPeer(browser, "A");
    const receiver = await newPeer(browser, "B");
    const link = await startSending(sender.page, file, "debug=1");
    await receiver.page.goto(withQuery(link, "sink=opfs&debug=1"));
    const download = receiver.page.waitForEvent("download", { timeout: 200_000 });
    await receiver.page.click(".accept-btn", { timeout: 60_000 });

    // Đợi nhận được một phần rồi cắt kết nối
    await expect(receiver.page.locator("progress")).toHaveAttribute("value", /^([2-9]\d)$/, { timeout: 60_000 });
    await receiver.page.evaluate((h) => {
      const store = (window as any).__beamlt.store;
      if (h === "datachannel") store.dataChannel.close();
      else store.pc.close();
    }, how);

    const out = file + ".received";
    await (await download).saveAs(out);
    expect(await sha256(out)).toBe(await sha256(file));
    expect(await debugValue(receiver.page, "resumeCount")).toBeGreaterThanOrEqual(1);
    await expect(sender.page.locator(".file-status")).toContainText("verified", { timeout: 15_000 });
  });
}
