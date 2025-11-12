#!/bin/bash

echo "🚀 BeamLT Client Deploy"
echo "======================="
echo ""

# Check if vercel is installed
if ! command -v vercel &> /dev/null
then
    echo "❌ Vercel CLI not found"
    echo "Install it: npm install -g vercel"
    exit 1
fi

echo "✅ Vercel CLI found"
echo ""

# Build
echo "📦 Building..."
npm run build

if [ $? -ne 0 ]; then
    echo "❌ Build failed"
    exit 1
fi

echo "✅ Build successful"
echo ""

# Deploy
echo "🚀 Deploying to Vercel..."
vercel --prod

echo ""
echo "✅ Deploy complete!"
echo ""
echo "📝 Next steps:"
echo "1. Open the deployment URL"
echo "2. Test file transfer"
echo "3. Share with friends! 🎉"
