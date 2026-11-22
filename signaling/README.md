# BeamLT Signaling Server

WebRTC signaling server for BeamLT P2P file transfer.

## Deploy to Render

### 1. Push to GitHub
```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin YOUR_GITHUB_REPO
git push -u origin main
```

### 2. Create Render Service
1. Go to [render.com](https://render.com)
2. Sign up/Login
3. Click "New +" → "Web Service"
4. Connect your GitHub repo
5. Configure:
   - **Name**: `beamlt-signaling`
   - **Environment**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Plan**: Free

### 3. Environment Variables (Optional)
Add in Render dashboard:
```
PORT=3000
```

### 4. Deploy
- Click "Create Web Service"
- Wait for deployment
- Copy the URL (e.g., `https://beamlt-signaling.onrender.com`)

### 5. Update Client
Update `client/.env`:
```
VITE_SIGNALING_URL=https://beamlt-signaling.onrender.com
```

## Local Development
```bash
npm install
npm run dev
```

## Production Build
```bash
npm run build
npm start
```

## Environment Variables
- `PORT` - Server port (default: 3000)
- `METERED_APP_NAME` - Metered app name (phần subdomain trong `<app>.metered.live`)
- `METERED_API_KEY` - Metered TURN API key (chỉ đặt trên server, KHÔNG đưa vào client)

Nếu thiếu hai biến Metered, `/ice-servers` sẽ trả STUN Google làm fallback (chỉ chạy tốt trong LAN / NAT dễ).

## API
- WebSocket connection on root path
- Events: `create-room`, `join-room`, `signal`
- `GET /ice-servers` - trả `RTCIceServer[]` (STUN + TURN của Metered, cache 10 phút) cho client dùng khi tạo `RTCPeerConnection`
