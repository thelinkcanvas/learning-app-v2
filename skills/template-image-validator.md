---
name: テンプレート画像検証
description: Day 4用：WebP形式・解像度・ファイルサイズを自動チェック
type: skill
trigger: manual
---

# テンプレート画像検証スキル

## 目的
Day 4でテンプレート画像を生成する際、以下を自動確認：
- ✅ WebP形式か
- ✅ 解像度が1280×800か
- ✅ ファイルサイズが200KB以下か
- ✅ 全4教科（算数・国語・理科・社会）に画像があるか

## 実行方法
```bash
node scripts/validate-images.js
```

## 出力例
```
✓ /public/images/math/sample-1.webp (156KB, 1280x800)
✓ /public/images/japanese/sample-1.webp (189KB, 1280x800)
⚠ /public/images/science/sample-1.png (PNG形式 - WebPに変換必要)
✗ /public/images/social/ (画像なし)
```

## チェックリスト
- [ ] WebP形式確認
- [ ] 解像度確認（1280×800）
- [ ] ファイルサイズ確認（200KB以下）
- [ ] 全教科に画像があるか
- [ ] メタデータ確認（作成日時）
