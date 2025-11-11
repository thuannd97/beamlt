# 🚀 Deploy BeamLT Server

## Quick Start với Render.com (Miễn phí)

### Bước 1: Chuẩn bị Git
```bash
cd d:\projects\beamlt
git init
git add .
git commit -m "Initial commit"
```

### Bước 2: Push lên GitHub
1. Tạo repo mới trên GitHub: https://github.com/new
2. Copy URL repo (vd: `https://github.com/username/beamlt.git`)
3. Chạy:
```bash
git remote add origin https://github.com/username/beamlt.git
git branch -M main
git push -u origin main
```

### Bước 3: Deploy trên Render
1. Vào https://render.com → Sign up
2. Click **"New +"** → **"Web Service"**
3. Connect GitHub repo `beamlt`
4. Cấu hình:
   ```
   Name: beamlt-signaling
   Root Directory: signaling
   Environment: Node
   Build Command: npm install
   Start Command: npm start
   Plan: Free
   ```
5. Click **"Create Web Service"**

### Bước 4: Lấy URL
Sau khi deploy xong, copy URL:
```
https://beamlt-signaling.onrender.com
```

### Bước 5: Update Client
Sửa file `client/.env`:
```env
VITE_SIGNALING_URL=https://beamlt-signaling.onrender.com
```

### Bước 6: Test
```bash
cd client
npm run dev
```

Mở browser, tạo room → Share link → Mở trên iPad/điện thoại!

---

## Các nền tảng khác:

### Railway.app
```bash
# Install Railway CLI
npm install -g @railway/cli

# Login & deploy
railway login
cd signaling
railway up
```

### Fly.io
```bash
# Install Fly CLI
# Windows: https://fly.io/docs/hands-on/install-flyctl/

# Deploy
cd signaling
fly launch
fly deploy
```

### Heroku
```bash
# Install Heroku CLI
# https://devcenter.heroku.com/articles/heroku-cli

cd signaling
heroku create beamlt-signaling
git push heroku main
```

---

## ⚠️ Lưu ý

**Free tier của Render:**
- Server sleep sau 15 phút không dùng
- Lần đầu connect sẽ chậm (~30s)
- Đủ cho demo/personal use

**Để luôn active:** Nâng cấp lên $7/tháng hoặc dùng Railway/Fly.io
