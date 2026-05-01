---
name: 手作業セットアップタスク統合版
description: Research Prompt 1, 3, 4 を実機で動かすために必要なユーザー手作業のリスト
type: setup-checklist
status: pending-user-action
priority: 後続作業の前提条件
---

# 手作業セットアップタスク（統合版）

このリストは、これまで実装した 3 つの Research Prompt（画像生成・Classroom 統合・Vision API）を実機で動かすために、ユーザー（horikatu）が手作業で実施する必要があるタスクをまとめたものです。

実装コードは全て準備済み。**外部サービスとの接続情報のみ手作業が必要**。

---

## A. Google Cloud Platform (GCP) セットアップ

### A-1. プロジェクト作成
- [ ] **GCP Console** (https://console.cloud.google.com/) にアクセス
- [ ] 新規プロジェクト作成
  - プロジェクト名: `learning-app-prod` (推奨)
  - プロジェクト ID: 自動生成またはカスタム
- [ ] 課金アカウントを紐付け（Pub/Sub・Vision API は無料枠あり、超過時のみ請求）

### A-2. API 有効化
GCP Console → APIs & Services → Library から以下を全て **Enable**:

- [ ] **Generative Language API** (Gemini Image 生成 + Vision)
- [ ] **Google Classroom API**
- [ ] **Cloud Pub/Sub API**
- [ ] **Cloud Tasks API** (Webhook 非同期処理用、本番のみ)
- [ ] **Cloud KMS API** (トークン暗号化、本番のみ)
- [ ] **Vertex AI API** (Vision API のエンタープライズ版利用時)

### A-3. OAuth 2.0 クライアント発行 (Classroom 用)
GCP Console → APIs & Services → Credentials:

- [ ] **OAuth consent screen** の設定
  - User Type: **External** (テスト時) / **Internal** (Workspace 利用時)
  - App name: `Learning App`
  - User support email: horikatu791225@gmail.com
  - Scopes: 後で追加するので一旦スキップでOK
  - Test users: horikatu791225@gmail.com を追加（External の場合）

- [ ] **OAuth 2.0 Client ID** 作成
  - Application type: **Web application**
  - Name: `Learning App Web Client`
  - Authorized redirect URIs:
    - `http://localhost:3000/auth/callback` (開発)
    - `https://your-app.vercel.app/auth/callback` (本番、後で追加可)
  - 発行された **Client ID** と **Client Secret** をコピー保存

### A-4. Gemini API キー発行 (画像生成 + Vision)
- [ ] **Google AI Studio** (https://aistudio.google.com/app/apikey) にアクセス
- [ ] **Create API Key** → 上記の GCP プロジェクトを選択
- [ ] 発行された API キーをコピー保存
  - 注意: GCP の OAuth クライアントとは別物。API キーは Gemini 専用。

---

## B. 環境変数の設定 (ユーザー手作業)

**重要: `.env.local` ファイルは秘密情報を含むため、Claude Code は作成できません。ユーザーが手動で作成してください。**

### ステップ B-1: テンプレートをコピー
```bash
cd learning-app-project
cp .env.local.example .env.local
```

### ステップ B-2: `.env.local` をテキストエディタで開く
お好みのエディタで開いてください (VS Code, Sublime Text など)

### ステップ B-3: 以下の値を手動で入力

```bash
# ─── Gemini API (A-4 で取得した値) ────────────────────────
NEXT_PUBLIC_GEMINI_API_KEY=AIza...YOUR_KEY
GOOGLE_API_KEY=AIza...SAME_KEY

# ─── Google Classroom OAuth (A-3 で取得した値) ──────────
GOOGLE_CLIENT_ID=xxxxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-xxxxx
GOOGLE_REDIRECT_URI=http://localhost:3000/auth/callback

# ─── Pub/Sub (本番デプロイ後に追加) ──────────────────────
# NODE_ENV=development (デフォルト)
```

### ステップ B-4: ファイルを保存

- [ ] `.env.local` が作成され、API キーが入力済み
- [ ] `.gitignore` に `.env.local` が含まれていることを確認 (含まれていないと秘密がコミットされる危険)
  ```bash
  cat .gitignore | grep env.local
  ```

---

## C. Pub/Sub セットアップ (Classroom Webhook 用)

開発時はスキップ可。本番デプロイ前に実施。

### C-1. Pub/Sub トピック作成
```bash
gcloud config set project learning-app-prod
gcloud pubsub topics create classroom-notifications
```

### C-2. Classroom サービスアカウントに publish 権限付与
```bash
gcloud pubsub topics add-iam-policy-binding classroom-notifications \
  --member='serviceAccount:cloud-pubsub@system.gserviceaccount.com' \
  --role='roles/pubsub.publisher'
```

### C-3. Push サブスクリプション作成
```bash
# 専用サービスアカウント作成 (推奨)
gcloud iam service-accounts create classroom-webhook \
  --display-name='Classroom Webhook Push Auth'

# Push サブスクリプション作成
gcloud pubsub subscriptions create classroom-webhook \
  --topic=classroom-notifications \
  --push-endpoint=https://your-app.vercel.app/api/classroom/webhook \
  --push-auth-service-account=classroom-webhook@learning-app-prod.iam.gserviceaccount.com
```

### C-4. Cloud Tasks キュー作成 (Webhook 非同期処理)
```bash
gcloud tasks queues create classroom-sync-queue \
  --location=asia-northeast1 \
  --max-attempts=3 \
  --max-backoff=300s
```

---

## D. テスト用画像の準備 (Vision API 用)

Phase B 実装後に Vision API をテストするための画像:

- [ ] `learning-app-project/test-images/` ディレクトリ作成
- [ ] 各教科 × 各学年で 1-3 枚ずつ撮影:
  - `grade1-math.jpg` (1 年生算数: さくらんぼ算 + 鉛筆で○)
  - `grade1-japanese.jpg` (1 年生国語: 文章 + ○マーク)
  - `grade3-math.jpg` (3 年生算数: 分数 + ○マーク)
  - `grade3-science.jpg` (3 年生理科: 観察スケッチ + ○マーク)
  - `grade5-social.jpg` (5 年生社会: 地図 + ○マーク)
  - ...等
- [ ] 各画像で意図的に「○ で囲む箇所」を 1-3 つ作る
- [ ] 確実な認識テストのため、太い鉛筆で大きめに○を描く

---

## E. 動作確認手順 (実装後)

### E-1. 画像生成 (Research Prompt 1)
```bash
# 単一テンプレート画像生成
npm run generate-template -- --grade 1 --subject math --unit "さくらんぼ算"

# 全 24 パターン dry-run
npm run generate-templates:dry

# 実際に全生成 (API キー必要)
npm run generate-templates:all
```

### E-2. Classroom 統合 (Research Prompt 3)
```bash
# 1. 教師として認可
npm run classroom -- auth-url --role teacher
# → ブラウザで開いて認可、コードをコピー

npm run classroom -- exchange --code <コード> --user-id horikatu --role teacher

# 2. アクセス確認
npm run classroom -- list-courses --user-id horikatu

# 3. コース作成
npm run classroom -- create-course \
  --user-id horikatu \
  --grade 3 \
  --subject math \
  --class-code A1
```

### E-3. Vision API (Research Prompt 4) - Phase B 完了後
```bash
# 画像解析テスト (Phase B 実装後に利用可能)
npm run vision -- analyze --image ./test-images/grade1-math.jpg

# ソクラテス式対話開始
npm run vision -- socratic --image ./test-images/grade1-math.jpg --grade 1
```

---

## F. 本番デプロイ (Vercel)

開発フェーズ完了後に実施。

### F-1. Vercel プロジェクト作成
- [ ] Vercel ダッシュボードで GitHub リポジトリ連携
- [ ] Framework: Next.js 自動検出

### F-2. Vercel 環境変数設定
- [ ] 上記 `.env.local` の内容を全て Vercel Environment Variables に追加
- [ ] `GOOGLE_REDIRECT_URI` を本番 URL に変更
  - 例: `https://learning-app-xxx.vercel.app/auth/callback`

### F-3. GCP 側の本番 URL 追加
- [ ] OAuth Client の Authorized redirect URIs に本番 URL を追加
- [ ] Pub/Sub Push サブスクリプションの endpoint を本番 URL に変更

### F-4. JWT 検証実装 (本番必須)
- [ ] `src/app/api/classroom/webhook/route.ts` の OIDC token 検証を厳格化
- [ ] `google-auth-library` または手動で JWT 署名を検証
- [ ] Phase B-Webhook Hardening タスクとして別途実装

---

## G. セキュリティ・プライバシー対応 (本番前必須)

### G-1. トークンストアの強化
- [ ] 現状: `JsonFileTokenStore` (平文 JSON、開発のみ)
- [ ] 本番: KMS で暗号化した DB (Firestore / Postgres)
- [ ] 該当ファイル: `src/lib/classroom/auth.ts`

### G-2. Cron による Push 登録の自動延長
- [ ] Classroom Push 登録は **1 週間で expire**
- [ ] Vercel Cron または GitHub Actions で 6 日ごとに `registrations.create` を再実行
- [ ] 該当: `scripts/classroom-renew-registration.ts` (要新規作成)

### G-3. PII マスキング (Vision)
- [ ] 児童の名前・住所が画像に写った場合の自動マスキング
- [ ] Phase C で TensorFlow.js を使ったローカル処理を実装

---

## H. コスト管理

### H-1. 課金アラート設定
- [ ] GCP Console → Billing → Budgets & alerts
- [ ] 月額予算: $20 (推奨、開発フェーズ)
- [ ] 50% / 80% / 100% で通知

### H-2. API クォータ確認
- [ ] **Gemini API**: 1 分 1,200 リクエスト / 1 ユーザー
- [ ] **Classroom API**: 1 分 1,200 リクエスト / 1 ユーザー
- [ ] **Pub/Sub**: 月 10 GiB まで無料
- [ ] **Vision API**: トークン課金 (Gemini 3.1 Pro: $2-4/1M 入力)

### H-3. キャッシング有効化 (Phase B-4 完了後)
- [ ] ローカル画像ハッシュキャッシュで再撮影時の API 節約
- [ ] Implicit Caching でプレフィックス一致時の自動割引

---

## I. 想定スケジュール

| ステップ | 想定時間 | 備考 |
|---------|---------|------|
| A. GCP セットアップ | 30 分 | プロジェクト作成 + API 有効化 + OAuth 発行 |
| B. 環境変数設定 | 5 分 | コピペ作業 |
| C. Pub/Sub セットアップ | 20 分 | 本番デプロイ前 |
| D. テスト画像準備 | 30 分 | 撮影 + ファイル名整理 |
| E. 動作確認 | 60 分 | 各 Research Prompt の動作確認 |
| F. Vercel デプロイ | 30 分 | 環境変数移行 + 動作確認 |
| G. セキュリティ強化 | 別スプリント | 本番前必須 |
| **合計 (開発まで)** | **2-3 時間** | A〜E のみ |

---

## J. ステータストラッカー

実施したタスクをチェックしていく:

### 開発フェーズ (今すぐ実施)
- [ ] A-1. GCP プロジェクト作成
- [ ] A-2. API 有効化 (Gemini + Classroom)
- [ ] A-3. OAuth クライアント発行
- [ ] A-4. Gemini API キー発行
- [ ] B. .env.local 設定
- [ ] D. テスト画像 1 セット準備
- [ ] E-1. 画像生成テスト (1 枚)
- [ ] E-2. Classroom 認可テスト

### Phase B 実装後
- [ ] E-3. Vision API テスト

### 本番デプロイ前
- [ ] C. Pub/Sub セットアップ
- [ ] F. Vercel デプロイ
- [ ] G-1. KMS トークンストア
- [ ] G-2. Cron 登録延長
- [ ] G-3. PII マスキング (Phase C)
- [ ] H-1. 課金アラート

---

## K. トラブルシューティング

### よくある問題

**Q1: OAuth で「This app isn't verified」エラー**
- A: External 設定 + Test users にメールアドレスを追加していれば、警告を「Continue」で進める

**Q2: Classroom API が 403 PERMISSION_DENIED**
- A: 同じ GCP プロジェクトで作成された CourseWork のみ操作可。プロジェクトをまたぐと不可

**Q3: Pub/Sub Push が届かない**
- A:
  1. サブスクリプションの endpoint URL が正しいか
  2. Webhook 側が 2xx を 30 秒以内に返しているか
  3. OIDC token validation が落ちていないか

**Q4: Gemini Vision で box_2d が画像とずれる**
- A: 画像の orientation (EXIF) が原因の可能性。撮影時は landscape 推奨、または `sharp.rotate()` で正規化

---

## L. 次の人 (将来の自分) へのメモ

このセットアップが完了すれば、以下が動きます:
- 学習アプリ → Gemini で教材画像を自動生成
- 教師 → Classroom で課題作成・配布
- 学生 → アプリでセッション完了 → Classroom に自動 turnIn
- 学生 → 困った問題を撮影 → AI が空間認識でつまずきを特定 → ソクラテス式対話

未完了の手作業タスクが残っていても、コードはすでに動作可能な状態です。
GCP 認証情報を `.env.local` に入れるだけで Phase B 実装に進めます。
