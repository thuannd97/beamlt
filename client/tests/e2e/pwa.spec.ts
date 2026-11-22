// Phase 3c: PWA (cài lên màn hình chính), nhập mã room, nút Save/Share trên điện thoại.
import { test, expect, type Browser } from "@playwright/test";
import { sha256, makeRandomFile, newPeer, startSending } from "./helpers";

const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

async function iphoneContext(browser: Browser) {
  return browser.newContext({ userAgent: IPHONE_UA, isMobile: true, hasTouch: true, viewport: { width: 390, height: 844 } });
}

test("manifest, icons and service worker make the app installable", async ({ page, request }) => {
  const res = await request.get("/manifest.webmanifest");
  expect(res.ok()).toBe(true);
  const manifest = await res.json();
  expect(manifest).toMatchObject({ short_name: "BeamLT", display: "standalone", start_url: "/" });
  for (const icon of manifest.icons) {
    const r = await request.get(icon.src);
    expect(r.ok(), icon.src).toBe(true);
    expect(r.headers()["content-type"]).toContain("image/png");
  }
  expect((await request.get("/icons/apple-touch-icon.png")).ok()).toBe(true);

  await page.goto("/");
  await expect(page).toHaveTitle("BeamLT");
  // Service worker đăng ký và kiểm soát trang
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  expect(await page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);

  // Chrome tự đánh giá khả năng cài đặt (giống DevTools > Application > Manifest)
  const cdp = await page.context().newCDPSession(page);
  const { installabilityErrors } = await cdp.send("Page.getInstallabilityErrors");
  // Playwright luôn chạy ẩn danh, mà ẩn danh thì trình duyệt không cho cài: lỗi do môi trường test
  expect(installabilityErrors.filter((e) => e.errorId !== "in-incognito")).toEqual([]);
});

test("receiver can join by typing the room code", async ({ browser }, info) => {
  const file = makeRandomFile(info.outputPath("code.bin"), 2);
  const sender = await newPeer(browser, "A");
  const receiver = await newPeer(browser, "B");
  const link = await startSending(sender.page, file);
  const code = new URL(link).searchParams.get("room")!;
  await expect(sender.page.locator(".room-code strong")).toHaveText(code);

  await receiver.page.goto("/?sink=opfs");
  await receiver.page.getByRole("button", { name: /Receive File/ }).click();
  await receiver.page.fill("#room-code", code.toLowerCase());
  await receiver.page.getByRole("button", { name: "Join" }).click();
  const download = receiver.page.waitForEvent("download", { timeout: 60_000 });
  await receiver.page.click(".accept-btn", { timeout: 60_000 });
  const out = file + ".received";
  await (await download).saveAs(out);
  expect(await sha256(out)).toBe(await sha256(file));
});

test("iPhone: install hint shows once and can be dismissed", async ({ browser }) => {
  const ctx = await iphoneContext(browser);
  const page = await ctx.newPage();
  await page.goto("/");
  await expect(page.locator(".install-hint")).toContainText("Add to Home Screen");
  await page.locator(".install-hint button").click();
  await expect(page.locator(".install-hint")).toHaveCount(0);
  await page.reload();
  await expect(page.locator(".install-hint")).toHaveCount(0);

  // Máy tính: không hiện
  const desktop = await (await browser.newContext()).newPage();
  await desktop.goto("/");
  await expect(desktop.locator(".install-hint")).toHaveCount(0);
});

test("iPhone: received file is offered via Save / Share", async ({ browser }, info) => {
  const file = makeRandomFile(info.outputPath("share.bin"), 3);
  const sender = await newPeer(browser, "A");
  const link = await startSending(sender.page, file);

  const ctx = await iphoneContext(browser);
  // Headless Chromium trên Linux không có Web Share: giả lập và ghi lại file được chia sẻ
  await ctx.addInitScript(() => {
    (window as any).__shared = [];
    (navigator as any).canShare = (data: any) => !!data?.files?.length;
    (navigator as any).share = async (data: any) => {
      for (const f of data.files) (window as any).__shared.push({ name: f.name, size: f.size });
    };
  });
  const page = await ctx.newPage();
  let autoDownloaded = false;
  page.on("download", () => (autoDownloaded = true));
  await page.goto(link + "&debug=1");
  await page.click(".accept-btn", { timeout: 60_000 });

  await expect(page.locator(".share-btn")).toBeVisible({ timeout: 60_000 });
  expect(await page.evaluate(() => (window as any).__beamlt.sinkKind.value)).toBe("opfs");
  expect(autoDownloaded).toBe(false); // điện thoại: không tự tải, để người dùng chọn Lưu ảnh / Lưu vào Tệp
  await page.click(".share-btn");
  const shared = await page.evaluate(() => (window as any).__shared);
  expect(shared).toEqual([{ name: "share.bin", size: 3 * 1024 * 1024 }]);
});
