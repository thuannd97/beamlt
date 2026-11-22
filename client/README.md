# BeamLT client

Vue 3 + TypeScript + Vite. Gửi file P2P qua WebRTC DataChannel.

## Chạy local

```bash
npm install
npm run dev        # http://localhost:5173, cần signaling server ở VITE_SIGNALING_URL
```

## Test e2e

Playwright tự khởi động signaling server (`../signaling`, port 3100) và bản build của client (port 4180),
rồi dùng 2–3 browser context để gửi file thật và so SHA-256.

```bash
npx playwright install chromium          # lần đầu
npm run test:e2e

# Dùng Chromium có sẵn trên máy thay vì bản của Playwright
PW_CHROMIUM_PATH=/usr/bin/chromium npm run test:e2e
```

Các test relay / ICE restart cần `turnserver` (coturn) trong PATH, nếu không sẽ bị bỏ qua.

## PWA

App cài được lên màn hình chính (manifest + service worker trong `public/`).
Trên iPhone/iPad: Safari → Chia sẻ → **Thêm vào MH chính**. Trong app đã cài, bên nhận nhập mã room 6 ký tự
hiển thị trên máy gửi (quét QR bằng camera sẽ mở Safari chứ không mở app).
Trên điện thoại, file nhận xong được mở bằng Share sheet (**Lưu ảnh** / **Lưu vào Tệp**).

## Tham số URL dùng khi debug

| Tham số | Tác dụng |
|---|---|
| `relay=1` | Ép kết nối đi qua TURN |
| `sink=opfs` / `sink=memory` / `sink=fs-access` | Ép cách lưu file bên nhận |
| `debug=1` | Gắn trạng thái vào `window.__beamlt` |
