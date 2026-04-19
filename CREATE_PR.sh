#!/bin/bash
# Quick PR Creation Script
# Requires: GitHub Personal Access Token with 'repo' scope

TOKEN="${1:-}"

if [ -z "$TOKEN" ]; then
    cat << 'EOF'
❌ GitHub Personal Access Token Required

Quick Setup (2 minutes):
========================

1️⃣  CREATE TOKEN:
   Visit: https://github.com/settings/tokens/new

   Settings:
   - Token name: "claude-code-learning-app"
   - Expiration: 90 days
   - Scopes: ☑️ repo, ☑️ workflow

   Click "Generate token" and copy it

2️⃣  RUN THIS SCRIPT:
   ./CREATE_PR.sh "ghp_your_token_here"

3️⃣  DONE! PR will be created automatically

─────────────────────────────────────────

EXAMPLE:
  ./CREATE_PR.sh "ghp_1234567890abcdefghijk"

If you don't want to use a token, create the PR manually:
  https://github.com/thelinkanvas/learning-app/compare/main?expand=1

EOF
    exit 1
fi

set -e

OWNER="thelinkanvas"
REPO="learning-app"
BRANCH="main"
BASE_BRANCH="main"

# Generate PR body
PR_BODY=$(cat <<'BODY'
# 📚 MVP実装完成: Gemini家庭教師型学習PWA（Day 1-4）

## 🎯 概要
ソクラテス式対話を用いた小学生向けAI家庭教師PWAのMVP（Day 1-4）が完成しました。

## ✅ 実装内容

### Day 1: コアアプリケーション
- ✅ Gemini API連携（ソクラテス式対話システムプロンプト）
- ✅ ホームページ（4教科グリッド選択）
- ✅ 学習ページ（2列レイアウト: 画像 + チャット）
- ✅ ChatPane（自動スクロール、エラーハンドリング）
- ✅ ImagePane（前後ナビゲーション）
- ✅ /api/images エンドポイント

### Day 2: 検証スクリプト
- ✅ template-image-validator.ts
  - WebP形式チェック
  - 1280×800解像度検証
  - ≤200KB ファイルサイズ確認

### Day 3: 親向け機能 + Chromebook最適化
- ✅ weekend-progress-report.ts（学習報告書自動生成）
- ✅ Chromebook最適化（1280×800 横向き）
  - タッチターゲット 44px+
  - 小学生向け可読性

### Day 4: PWA + Service Worker
- ✅ PWA対応（ホーム画面追加）
- ✅ Service Worker（オフライン対応）
- ✅ Cache-first戦略（静的アセット）
- ✅ Network-first戦略（API呼び出し）

## 🛠 技術スタック
- Next.js 15 + TypeScript + Tailwind CSS
- Google Gemini 1.5 Flash API
- React Context + localStorage
- Service Worker + manifest.json
- Vercel Deployment

## 📊 統計
- Files: 20+
- Components: 5
- Scripts: 2
- Total LOC: ~1200

## 🚀 本番デプロイ
✅ Vercel: https://learning-app-project-et2887av5-thelinkcanvas.vercel.app
- Status: Ready
- Build time: 23s

## 💰 月額コスト
- Vercel: ¥0（Free）
- Gemini API: ¥0-500
- Domain: ¥0
- **合計: ¥0-500/月**

## 📝 次のステップ（V2）
- パターン分析エンジン
- Google Classroom連携
- 複数学習者対応
- AI画像生成テンプレート

---
実装者: Claude Code
監査: AG（ユーザー）
BODY
)

echo "🚀 Creating PR..."
echo "📦 Repository: $OWNER/$REPO"
echo "🌿 Branch: $BRANCH → $BASE_BRANCH"

# Use GitHub REST API to create PR
RESPONSE=$(curl -s -X POST \
  -H "Authorization: token $TOKEN" \
  -H "Accept: application/vnd.github.v3+json" \
  "https://api.github.com/repos/$OWNER/$REPO/pulls" \
  -d @- << JSON
{
  "title": "MVP: Gemini家庭教師型学習PWA完成（Day 1-4）",
  "head": "$BRANCH",
  "base": "$BASE_BRANCH",
  "body": $(echo "$PR_BODY" | jq -R -s '.')
}
JSON
)

# Parse response
PR_URL=$(echo "$RESPONSE" | jq -r '.html_url // empty')
PR_NUMBER=$(echo "$RESPONSE" | jq -r '.number // empty')
ERROR=$(echo "$RESPONSE" | jq -r '.message // empty')

if [ -n "$PR_URL" ] && [ "$PR_URL" != "null" ]; then
    echo ""
    echo "✅ PR Created Successfully!"
    echo ""
    echo "📌 PR URL:"
    echo "   $PR_URL"
    echo ""
    echo "🎉 Next steps:"
    echo "   1. Review the PR"
    echo "   2. Add reviewers if needed"
    echo "   3. Merge to main branch"
else
    echo ""
    echo "❌ Error creating PR"
    if [ -n "$ERROR" ] && [ "$ERROR" != "null" ]; then
        echo "Error message: $ERROR"
    fi
    echo ""
    echo "Response:"
    echo "$RESPONSE" | jq .
    exit 1
fi
