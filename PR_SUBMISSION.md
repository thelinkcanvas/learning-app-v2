# Pull Request Submission Guide

## PR Details

**Repository**: thelinkanvas/learning-app  
**Branch**: main  
**Type**: Feature - MVP Implementation (Day 1-4)

---

## Option 1: Automated Submission (Recommended)

### Step 1: Get GitHub Token
1. Visit: https://github.com/settings/tokens/new
2. Token name: `claude-code-learning-app-pr`
3. Expiration: 90 days
4. Select scopes:
   - ✓ `repo` (full control of repositories)
   - ✓ `workflow` (write GitHub Actions workflows)
5. Click "Generate token"
6. Copy the token (save it securely)

### Step 2: Export Token & Create PR
```bash
export GITHUB_TOKEN="your_token_here"
cd /Users/admin/AG_Root/learning-app-project

# Authenticate gh CLI
gh auth login --with-token < <(echo $GITHUB_TOKEN)

# Push code
git push -u origin main

# Create PR
gh pr create \
  --title "MVP: Gemini家庭教師型学習PWA完成（Day 1-4）" \
  --body "$(cat <<'BODY'
# 📚 Gemini家庭教師型学習PWA - MVP実装完成

## 🎯 概要

ソクラテス式対話を用いた小学生向けAI家庭教師PWAの初版実装（Day 1-4）が完成しました。Gemini 1.5 Flash API連携、Chromebook対応、週末学習シミュレーション対応済みです。

## ✅ 実装完了内容

### Day 1: コアアプリケーション実装
- **Gemini API連携**
  - ✅ システムプロンプト実装（ソクラテス式対話）
    - 答えを教えない（ヒントのみ）
    - 学年+1の漢字まで対応
    - 2回失敗後に答え開示
    - 20%の意図的ハルシネーション（批判的思考力育成）
    - 褒め中心トーン（\"すごいやん！✨👍\"）

- **UI実装**
  - ✅ ホームページ: 4教科グリッド選択（算数・国語・理科・社会）
  - ✅ 学習ページ: 2列レイアウト（左：教材画像、右：チャット）
  - ✅ ChatPane: 自動スクロール、エラーハンドリング、タッチフレンドリー
  - ✅ ImagePane: 前後ナビゲーション、遅延読み込み対応
  - ✅ API Routes: `/api/images` で教科別画像リスト取得

### Day 2: テンプレート画像検証スクリプト
- ✅ `validate-images.ts`
  - WebP形式チェック
  - 1280×800解像度検証
  - ≤200KB ファイルサイズ確認
  - カラーコード出力（CI/CD互換）

### Day 3: 親向け週末学習報告書 + Chromebook最適化
- ✅ `generate-report.ts`
  - localStorage からセッションデータ読み込み
  - Markdown + HTML レポート自動生成
  - 質問数分析、トピック抽出、成長ポイント表示

- ✅ **Chromebook レスポンシブ最適化**（1280×800 横向き）
  - グリッド 4列 (MD: 2列)
  - タッチターゲット 44px以上
  - 小学生向け可読性（text-base md:text-lg）
  - ホバー＆アクティブフィードバック

### Day 4: PWA + Service Worker
- ✅ PWA対応
  - manifest.json ホーム画面追加対応
  - ランドスケープ強制（1280×800）
  - ショートカット搭載（算数・国語直接起動）

- ✅ Service Worker (`/public/sw.js`)
  - Cache-first戦略（静的アセット）
  - Network-first（API呼び出し）
  - オフライン対応（キャッシュフォールバック）
  - 古いキャッシュ自動削除

## 🛠 技術スタック

| 項目 | 選択 |
|------|------|
| フレームワーク | Next.js 15+ (App Router) |
| 言語 | TypeScript |
| スタイル | Tailwind CSS |
| 状態管理 | React Context + localStorage |
| AI API | Google Gemini 1.5 Flash |
| デプロイ | Vercel (Free Tier) |
| PWA | Manifest.json + Service Worker |

## 📱 対応環境

- **Chromebook**: 1280×800 横向き（学校配付端末最適化）
- **Fire Tablet**: 1024×768 横向き対応
- **スマートフォン**: レスポンシブ対応（375×812）
- **オフライン**: Service Worker + localStorage 対応

## 🚀 本番デプロイ状況

✅ **Vercel Production**: https://learning-app-project-et2887av5-thelinkcanvas.vercel.app
- ビルド時間: 23秒
- ステータス: Ready
- エンドポイント: Fully operational

## 💰 コスト構成（月額）

| 項目 | 費用 |
|------|------|
| Vercel | ¥0（Free Tier） |
| Gemini API | ¥0-500（¥0.125/1M tokens） |
| Domain | ¥0（vercel.app） |
| **合計** | **¥0-500/月** |

## 📊 実装統計

- **ファイル数**: 20+ (components, pages, styles, config)
- **コンポーネント**: 5個 (Layout, Home, LearnPage, ChatPane, ImagePane)
- **API Endpoints**: 2個 (/api/images, Gemini API)
- **スクリプト**: 2個 (validator, reporter)
- **総コード行数**: ~1200行（コア機能）

## ✨ 主な特徴

1. **シンプル設計**: パターン分析は V2 以降に延期（MVP は複雑化回避）
2. **拡張可能**: モジュール化された構成で将来の機能追加が容易
3. **運用負荷ゼロ初版**: ユーザーが `/public/images/[subject]/` に画像を置くだけで運用開始可能
4. **小学生向けUI**: 大きなボタン、わかりやすい配色、絵文字活用
5. **オフライン対応**: 会話履歴・教材画像をキャッシュ

## 📋 検証方法

### 自動テスト
```bash
npm run validate-images
npm run generate-report
npm run build
```

### 手動テスト
1. Chromebook/Fire Tablet で起動
2. トップページから「算数」を選択
3. 教材画像表示確認
4. Gemini チャットで対話確認
5. ホーム画面追加で PWA インストール確認

## 🔄 次のステップ（V2以降）

1. **パターン分析エンジン**: エラーパターン自動検出・個別化学習
2. **Google Classroom 連携**: 学校ツール統合
3. **複数学習者対応**: きょうだい管理機能
4. **AI テンプレート自動生成**: 各教科の画像を自動生成

## 📝 ファイル構成

```
learning-app-project/
├── app/
│   ├── layout.tsx              # PWA メタタグ・Service Worker登録
│   ├── page.tsx                # ホームページ（4教科選択）
│   └── learn/[subject]/
│       └── page.tsx            # 学習ページ（2列レイアウト）
├── src/
│   ├── components/
│   │   ├── ChatPane.tsx        # AI対話UI
│   │   └── ImagePane.tsx       # 教材画像表示
│   ├── lib/
│   │   └── gemini.ts           # Gemini API + プロンプト
│   └── app/api/
│       └── images/
│           └── route.ts        # 画像リスト API
├── public/
│   ├── sw.js                   # Service Worker
│   ├── manifest.json           # PWA設定
│   ├── images/[subject]/       # 教科別教材画像
│   └── icons/                  # PWA アイコン
├── scripts/
│   ├── validate-images.ts      # 画像検証
│   └── generate-report.ts      # 報告書生成
└── package.json
```

## 🎓 実装リード & 仕様書

- **実装**: Claude Code（AI）
- **設計・監査**: AG（ユーザー）
- **デプロイプラットフォーム**: Vercel
- **言語モデル**: Google Gemini 1.5 Flash
- **準拠**: CLAUDE.md project governance

---

**デプロイ完了日**: 2026-04-18  
**ビルド環境**: Vercel Washington D.C.  
**Node.js**: 20.x  
**Next.js**: 15.0.3  

✅ **すべてのMVP要件実装完了。週末学習シミュレーション対応済み。**
BODY
)"
```

---

## Option 2: Manual PR Creation (Web UI)

If token setup is complex, use GitHub Web UI:

### Steps:
1. Go to: https://github.com/thelinkanvas/learning-app
2. Click "Compare & Pull Request" button
3. Fill in:
   - **Title**: `MVP: Gemini家庭教師型学習PWA完成（Day 1-4）`
   - **Body**: Copy the full text from this file's "PR Body" section
4. Click "Create Pull Request"

### PR Body (Copy this text):

```markdown
# 📚 Gemini家庭教師型学習PWA - MVP実装完成

[Full body text from Option 1 above]
```

---

## Verification Checklist

After PR creation, verify:

- [ ] PR title is clear and descriptive
- [ ] PR body includes Day 1-4 implementation summary  
- [ ] All commits are visible in PR
- [ ] Vercel deployment preview link is working
- [ ] Code changes are listed in "Files changed" tab
- [ ] Reviewers can comment and request changes

---

## Contact & Support

If you encounter issues:
1. Check GitHub Settings > Personal access tokens
2. Verify token has `repo` + `workflow` scopes
3. Ensure token hasn't expired
4. Try manual Web UI approach as fallback

**Questions?** Refer to deployment logs or CLAUDE.md project governance.
