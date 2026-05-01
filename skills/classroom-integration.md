---
name: Google Classroom 統合
description: 学習アプリ ↔ Classroom 双方向同期（提出・採点・親通知）
type: skill
trigger: manual / event-driven
---

# Google Classroom 統合スキル

## 目的

学習アプリと Google Classroom 間で、課題提出と採点情報をシームレスに同期する。
教員は Classroom で採点するだけ、学生は学習アプリでセッションを完了するだけで、
両側のデータが自動連携する仕組みを構築する。

## アーキテクチャ

```
┌─ 教員（Classroom） ──────────────────┐
│   採点 → Pub/Sub Webhook 発火         │
└──────────────┬───────────────────────┘
               │ (UPDATED event)
               ▼
┌─ 学習アプリ webhook receiver ────────┐
│  /api/classroom/webhook              │
│   ↓ decodePubSubMessage              │
│   ↓ getSubmission（教員トークン）    │
│   ↓ extractParentVisibleGrade        │
│   ↓ assignedGrade のみ親 DB 更新     │
└──────────────────────────────────────┘

┌─ 学生（学習アプリ） ─────────────────┐
│   セッション完了 → reportUrl 生成    │
│        ↓                              │
│   modifyAttachments（学生トークン）  │
│        ↓                              │
│   turnIn（学生トークン、body={}）    │
│        ↓                              │
│   Classroom 上で TURNED_IN 表示      │
└──────────────────────────────────────┘
```

## モジュール構成

| ファイル | 役割 |
|---------|------|
| `src/lib/types/classroom.ts` | Course/CourseWork/StudentSubmission 等の型 |
| `src/lib/classroom/auth.ts` | OAuth 2.0 + リフレッシュトークン自動更新 |
| `src/lib/classroom/error-handling.ts` | 403/404/400 別ディスパッチ + 指数バックオフ |
| `src/lib/classroom/api-client.ts` | REST 直叩きクライアント（fetch ベース） |
| `src/lib/classroom/aliases.ts` | `d:lapp_g3_math_A1` 形式のエイリアス命名 |
| `src/lib/classroom/submissions.ts` | modifyAttachments + turnIn 連続処理 |
| `src/lib/classroom/pubsub-handler.ts` | Webhook ペイロード処理 + 親通知 |
| `src/app/api/classroom/webhook/route.ts` | Pub/Sub Push 受信エンドポイント |
| `scripts/classroom-sync.ts` | CLI（auth-url, exchange, list, create） |

## 設計の核心（Research Prompt 3 由来）

### 1. エイリアス命名でマッピング簡潔化
```
d:lapp_g3_math_A1
   └─ デベロッパープロジェクトスコープ（"d:" 必須）
       └─ アプリ識別子
           └─ 学年
                └─ 教科
                    └─ クラスコード
```
DB 対応表が不要。`courseId` パラメータに直接エイリアスを渡せる。

### 2. プロジェクト権限境界
- **CourseWork は同じ GCP プロジェクトの教員トークンで作成**
- **turnIn は学生トークンで実行**（仕様要件）
- 異なるプロジェクトで作られた CourseWork に turnIn → `403 @ProjectPermissionDenied`
- → UI フォールバック: 「Classroom の画面から手動提出してください」

### 3. turnIn の落とし穴
- リクエストボディは **`{}` 必須**（空オブジェクト、null/undefined では失敗）
- メソッドは POST だが「状態遷移」のみ（成果物は事前に modifyAttachments で添付）

### 4. Pub/Sub イベント駆動（ポーリング禁止）
- 採点変更検知は `registrations.create` でトピック購読
- ペイロードに個人情報・スコアは含まれない（ID のみ）
- 受信後 `getSubmission` で詳細取得
- **登録は1週間で expire** → Cron で再登録ループ必須

### 5. 採点二段階の正しい扱い
- `draftGrade`: 教員途中入力 → **親には表示しない**
- `assignedGrade`: 教員「返却」後に確定 → **親通知トリガー**

### 6. クォータ管理
- 1 ユーザー / 1 分 1,200 クエリ
- 1 クライアント / 1 分 3,000 クエリ
- 1 クライアント / 1 日 4,000,000 クエリ
- → ジッター付き指数バックオフで Thundering Herd 防止

### 7. エラー分類と対応
| ステータス | 対応 |
|-----------|------|
| 401 AUTH_EXPIRED | リフレッシュトークンで自動更新 |
| 403 PERMISSION_DENIED | 永続エラー、UI フォールバック表示 |
| 404 NOT_FOUND | ローカル DB を論理削除 |
| 400 FAILED_PRECONDITION | Drive 共有設定修復 or 教員アラート |
| 429 / 5xx | 指数バックオフリトライ |
| その他 4xx | 永続エラー（コード bug 疑い） |

## 利用方法

### セットアップ
```bash
# 1. GCP プロジェクト作成 + Classroom API 有効化
# 2. OAuth 2.0 クライアント ID 発行
# 3. 環境変数設定
export GOOGLE_CLIENT_ID="xxx.apps.googleusercontent.com"
export GOOGLE_CLIENT_SECRET="GOCSPX-xxx"
export GOOGLE_REDIRECT_URI="http://localhost:3000/auth/callback"
```

### 教員の認証
```bash
# 1. 認可 URL 生成
npm run classroom -- auth-url --role teacher

# 2. ブラウザで開いて認可、リダイレクト URL から code をコピー
npm run classroom -- exchange --code <CODE> --user-id horikatu --role teacher

# 3. アクセス確認
npm run classroom -- list-courses --user-id horikatu
```

### 新規コース作成
```bash
# 小3 算数のコースを作成（class-code は任意の英数字）
npm run classroom -- create-course \
  --user-id horikatu \
  --grade 3 \
  --subject math \
  --class-code A1
# → コース作成 + alias "d:lapp_g3_math_A1" 付与
```

### マッピング一覧確認
```bash
# class-code の 24 マッピングを表示
npm run classroom -- list-mappings --class-code A1
```

### Pub/Sub 設定（本番デプロイ時）
```bash
# 1. GCP Pub/Sub トピック作成
gcloud pubsub topics create classroom-notifications

# 2. Classroom サービスアカウントに publish 権限付与
gcloud pubsub topics add-iam-policy-binding classroom-notifications \
  --member='serviceAccount:classroom-notifications@system.gserviceaccount.com' \
  --role='roles/pubsub.publisher'

# 3. Push サブスクリプション作成（エンドポイント指定）
gcloud pubsub subscriptions create classroom-webhook \
  --topic=classroom-notifications \
  --push-endpoint=https://your-app.vercel.app/api/classroom/webhook \
  --push-auth-service-account=YOUR_SERVICE_ACCOUNT@PROJECT.iam.gserviceaccount.com

# 4. Classroom 側で購読登録（API 経由）
# scripts/classroom-sync.ts に register コマンド追加予定
```

## コスト試算

| 項目 | 1万ユーザー | 100万ユーザー |
|------|------------|---------------|
| Classroom API リクエスト | $0（無料） | $0（無料） |
| Pub/Sub メッセージ（月） | 1M 件 ≒ 2GB | 100M 件 ≒ 200GB |
| Pub/Sub コスト（無料枠 10GiB/月） | **$0** | ~$7.4/月 |

## チェックリスト

- [x] OAuth 2.0 トークン管理（auto refresh 含む）
- [x] エイリアス命名規則（疎結合マッピング）
- [x] modifyAttachments + turnIn 連続処理
- [x] Pub/Sub Webhook 受信（API Route）
- [x] 採点逆方向同期（assignedGrade のみ親通知）
- [x] 3 層エラーハンドリング（403/404/400）
- [x] ジッター付き指数バックオフ
- [x] CLI（auth, list, create）
- [ ] Pub/Sub OIDC token 厳格検証（現在は簡易チェックのみ）
- [ ] Cron による登録自動再延長（1週間 expire 対策）
- [ ] Bach API 対応（リクエスト数最適化）
- [ ] KMS 暗号化トークンストア（現在は JSON ファイル平文）

## 既知の制約

- **個人 Gmail でも一部機能は動くが**、本格的な学校導入には Google Workspace for Education が必要
- **JSON ファイルストアは開発用**。本番は KMS + DB に置き換え必須
- **Pub/Sub Webhook は最小実装**。同期処理は Cloud Tasks 等への enqueue 推奨
- **JWT 検証は TODO**。本番デプロイ前に必ず実装

## 関連ファイル

- `src/lib/classroom/` - 全モジュール
- `scripts/classroom-sync.ts` - CLI
- `src/app/api/classroom/webhook/route.ts` - Webhook 受信
