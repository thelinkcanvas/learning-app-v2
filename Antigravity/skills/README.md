# learning-app-project: Project Skills (Antigravity Layer P)

このディレクトリは **AG Governance v5.0 の 3 層 Skills 構造の Layer P（Project Skills）** です。

## 役割

- learning-app-project **固有** の failures / patterns / decisions を記録
- Global Skills (`/AG_Root/Antigravity/skills/`) と独立して運用
- バイアス分離: 他プロジェクトの誤った学習が伝播しない

## ファイル

| ファイル | 内容 | フォーマット |
|---------|------|------------|
| `failures.md` | learning-app 固有の失敗・回避策 | 日付 / 問題 / 原因 / 回避策 |
| `patterns.md` | learning-app 固有の正規パターン | 日付 / パターン名 / 概要 / 使用条件 |
| `decisions.md` | learning-app 固有の判断記録 | 日付 / 状況 / 判断 / 理由 |

## AG 判定優先順位

1. このファイル（Project skills）が **Global より優先**
2. Global と矛盾する場合: Local 優先 + Global は warning として表示
3. 同じパターンが N=3 プロジェクトで detected → Global 昇格候補

## 既存 `/learning-app-project/skills/` との違い

| ディレクトリ | 用途 |
|------------|------|
| `/learning-app-project/skills/` | スキル**定義**（vision-api-spec.md, classroom-integration.md など、自動化スクリプト設計書） |
| `/learning-app-project/Antigravity/skills/` | **学習ログ**（failures/patterns/decisions、AG 判定用） |

混同しないこと。
