<template>
  <div v-if="visible" class="install-hint" role="note">
    <span>
      📲 Install BeamLT: tap <strong>Share</strong>
      <svg class="share-icon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 3v12M7 8l5-5 5 5M5 12v8h14v-8" fill="none" stroke="currentColor" stroke-width="2"
          stroke-linecap="round" stroke-linejoin="round" />
      </svg>
      then <strong>Add to Home Screen</strong>.
    </span>
    <button type="button" aria-label="Dismiss" @click="dismiss">✕</button>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";

// Chỉ hiện trên iPhone/iPad Safari khi chưa chạy ở chế độ đã cài (standalone).
// Android/Chrome có nút cài đặt riêng của trình duyệt nên không cần.
const KEY = "beamlt-install-hint-dismissed";

const isIos =
  /iPhone|iPad|iPod/.test(navigator.userAgent) ||
  (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
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

.install-hint button {
  border: none;
  background: none;
  font-size: 1.1rem;
  color: #666;
  cursor: pointer;
  padding: 4px 8px;
}
</style>
