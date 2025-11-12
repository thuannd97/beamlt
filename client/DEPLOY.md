# 🚀 Deploy BeamLT Client

## Option 1: Vercel (Recommend - Nhanh nhất)

### Bước 1: Install Vercel CLI
```bash
npm install -g vercel
```

### Bước 2: Deploy
```bash
cd client
vercel
```

Làm theo prompts:
- Setup? **Y**
- Scope: Chọn account
- Link? **N**
- Project name: `beamlt`
- Directory: `./`
- Override settings? **N**

### Bước 3: Set Environment Variable
```bash
vercel env add VITE_SIGNALING_URL
```
Nhập: `https://beamlt-signaling.onrender.com`

### Bước 4: Deploy Production
```bash
vercel --prod
```

URL sẽ là: `https://beamlt.vercel.app` hoặc custom domain

---

## Option 2: Netlify (UI Deploy)

### Bước 1: Push to GitHub
```bash
cd ..  # Root project
git add .
git commit -m "Add client deploy config"
git push
```

### Bước 2: Deploy trên Netlify
1. Vào https://app.netlify.com
2. Click **"Add new site"** → **"Import an existing project"**
3. Connect GitHub → Chọn repo `beamlt`
4. Configure:
   ```
   Base directory: client
   Build command: npm run build
   Publish directory: client/dist
   ```
5. **Environment variables**:
   - Key: `VITE_SIGNALING_URL`
   - Value: `https://beamlt-signaling.onrender.com`
6. Click **"Deploy site"**

URL sẽ là: `https://random-name.netlify.app`

---

## Option 3: Vercel (UI Deploy)

1. Vào https://vercel.com
2. Click **"Add New"** → **"Project"**
3. Import repo `beamlt`
4. Configure:
   ```
   Framework Preset: Vite
   Root Directory: client
   Build Command: npm run build
   Output Directory: dist
   ```
5. **Environment Variables**:
   - `VITE_SIGNALING_URL` = `https://beamlt-signaling.onrender.com`
6. Click **"Deploy"**

---

## Option 4: GitHub Pages (Miễn phí nhưng cần config thêm)

### Cài đặt gh-pages
```bash
cd client
npm install -D gh-pages
```

### Thêm scripts vào package.json
```json
{
  "scripts": {
    "predeploy": "npm run build",
    "deploy": "gh-pages -d dist"
  }
}
```

### Update vite.config.ts
```typescript
export default defineConfig({
  base: '/beamlt/',  // Thay bằng tên repo
  // ...
})
```

### Deploy
```bash
npm run deploy
```

URL: `https://username.github.io/beamlt`

---

## 🎯 So sánh

| Platform | Speed | Setup | Custom Domain | SSL |
|----------|-------|-------|---------------|-----|
| **Vercel** | ⚡⚡⚡ | Easy | ✅ Free | ✅ |
| **Netlify** | ⚡⚡⚡ | Easy | ✅ Free | ✅ |
| **GitHub Pages** | ⚡⚡ | Medium | ✅ | ✅ |

**Recommend: Vercel** - Nhanh, dễ, tích hợp GitHub tốt

---

## Test sau deploy

1. Mở URL deploy
2. Chọn file → Create Room
3. Share link/QR
4. Mở trên thiết bị khác
5. Download file thành công ✅

## Troubleshooting

**Lỗi: Cannot connect to server**
- Kiểm tra `VITE_SIGNALING_URL` đúng chưa
- Đảm bảo server đã deploy và running

**Lỗi: 404 on refresh**
- Vercel/Netlify tự động handle
- GitHub Pages: Cần thêm 404.html redirect

**Build failed**
- Check Node version >= 18
- Xóa `node_modules`, `npm install` lại
