import { defineConfig } from "@playwright/test";

// Port riêng cho e2e để không đụng dev server (3000 / 5173).
export const SIGNALING_PORT = 3100;
export const APP_PORT = 4180;

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 180_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${APP_PORT}/`,
    acceptDownloads: true,
    launchOptions: {
      // Trong sandbox/CI có thể trỏ tới Chromium hệ thống: PW_CHROMIUM_PATH=/usr/bin/chromium
      executablePath: process.env.PW_CHROMIUM_PATH || undefined,
      args: ["--no-sandbox", "--disable-features=WebRtcHideLocalIpsWithMdns"],
    },
  },
  webServer: [
    {
      // Signaling server thật, không có env Metered -> /ice-servers trả STUN fallback
      command: `npm --prefix ../signaling run build && node ../signaling/dist/index.js`,
      url: `http://localhost:${SIGNALING_PORT}/health`,
      env: { PORT: String(SIGNALING_PORT), METERED_APP_NAME: "", METERED_API_KEY: "" },
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: `npx vite build --outDir dist-e2e --emptyOutDir && npx vite preview --outDir dist-e2e --port ${APP_PORT} --strictPort`,
      url: `http://localhost:${APP_PORT}/`,
      env: { VITE_SIGNALING_URL: `http://localhost:${SIGNALING_PORT}` },
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
