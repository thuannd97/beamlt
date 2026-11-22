<template>
  <div v-if="visible" class="install-hint" role="note">
    <!-- iOS < 16.4: chỉ Safari mới thêm được vào màn hình chính -->
    <span v-if="browser !== 'safari' && !thirdPartyCanInstall" data-browser="unsupported">
      📲 To install BeamLT, open this page in <strong>Safari</strong>, then tap <strong>Share</strong> →
      <strong>Add to Home Screen</strong>.
    </span>
    <span v-else-if="browser === 'chrome' || browser === 'edge'" :data-browser="browser">
      📲 Install BeamLT: tap <strong>Share</strong>
      <svg class="share-icon" viewBox="0 0 24 24" aria-hidden="true"><path :d="SHARE_ICON" /></svg>
      in the address bar (or <strong>⋯</strong> → <strong>Share</strong>), then <strong>Add to Home Screen</strong>.
    </span>
    <span v-else-if="browser === 'firefox'" data-browser="firefox">
      📲 Install BeamLT: tap <strong>☰</strong> → <strong>Share</strong>, then <strong>Add to Home Screen</strong>.
    </span>
    <span v-else data-browser="safari">
      📲 Install BeamLT: tap <strong>Share</strong>
      <svg class="share-icon" viewBox="0 0 24 24" aria-hidden="true"><path :d="SHARE_ICON" /></svg>
      then <strong>Add to Home Screen</strong>.
    </span>
    <button type="button" aria-label="Dismiss" @click="dismiss">✕</button>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";

// Chỉ hiện trên iPhone/iPad khi chưa chạy ở chế độ đã cài (standalone).
// Android/Chrome có nút cài đặt riêng của trình duyệt nên không cần.
const KEY = "beamlt-install-hint-dismissed";
const SHARE_ICON = "M12 3v12M7 8l5-5 5 5M5 12v8h14v-8";

const ua = navigator.userAgent;
const isIos = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);

// Mọi trình duyệt trên iOS đều dùng WebKit; phân biệt qua user agent để chỉ đúng chỗ nút Chia sẻ.
const browser: "safari" | "chrome" | "edge" | "firefox" = /CriOS/.test(ua)
  ? "chrome"
  : /EdgiOS/.test(ua)
    ? "edge"
    : /FxiOS/.test(ua)
      ? "firefox"
      : "safari";

// Từ iOS 16.4 các trình duyệt khác Safari mới được thêm web app vào màn hình chính.
// iPadOS báo user agent giống Mac (không có số phiên bản iOS): coi như đủ mới.
const iosVersion = /OS (\d+)_(\d+)/.exec(ua);
const thirdPartyCanInstall =
  !iosVersion || Number(iosVersion[1]) > 16 || (Number(iosVersion[1]) === 16 && Number(iosVersion[2]) >= 4);
const isStandalone =
  window.matchMedia?.("(display-mode: standalone)").matches ||
  (navigator as unknown as { standalone?: boolean }).standalone === true;

function wasDismissed() {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

const visible = ref(isIos && !isStandalone && !wasDismissed());

const dismiss = () => {
  visible.value = false;
  try {
    localStorage.setItem(KEY, "1");
  } catch {
    /* private mode: chỉ ẩn trong phiên này */
  }
};
</script>

<style scoped>
.install-hint {
  display: flex;
  align-items: center;
  gap: 12px;
  max-width: 600px;
  margin: 0 auto 20px;
  padding: 12px 16px;
  background: rgba(255, 255, 255, 0.95);
  color: #333;
  border-radius: 12px;
  font-size: 0.95rem;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
}

.install-hint span {
  flex: 1;
}

.share-icon {
  width: 1.1em;
  height: 1.1em;
  vertical-align: -0.15em;
  color: #007aff;
}

.share-icon path {
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.install-hint button {
  border: none;
  background: none;
  font-size: 1.1rem;
  color: #666;
  cursor: pointer;
  padding: 4px 8px;
}
</style>
