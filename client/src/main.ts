import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import { config } from './config';

// Đánh thức signaling server (Render free tier ngủ sau 15 phút) ngay khi mở trang,
// để lúc người dùng chọn xong file thì server đã sẵn sàng. no-cors: chỉ cần request tới nơi.
fetch(`${config.signalingUrl}/health`, { mode: 'no-cors' }).catch(() => {});

const app = createApp(App);
const pinia = createPinia();

app.use(pinia);
app.mount('#app');

// PWA: service worker (chỉ bản build production; dev server không cần)
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => console.warn('[SW] register failed:', err));
  });
}
