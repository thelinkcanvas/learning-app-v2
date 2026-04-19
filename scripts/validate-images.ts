#!/usr/bin/env node

import sharp from 'sharp';
import { glob } from 'glob';
import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';

interface ImageInfo {
  path: string;
  subject: string;
  filename: string;
  format: string;
  width?: number;
  height?: number;
  size: number;
  errors: string[];
}

const SUBJECTS = ['math', 'japanese', 'science', 'social'];
const REQUIRED_WIDTH = 1280;
const REQUIRED_HEIGHT = 800;
const MAX_SIZE_KB = 200;
const MAX_SIZE_BYTES = MAX_SIZE_KB * 1024;

async function validateImage(filePath: string): Promise<ImageInfo> {
  const stat = fs.statSync(filePath);
  const filename = path.basename(filePath);
  const subjectMatch = filePath.match(/\/images\/([^/]+)\//);
  const subject = subjectMatch ? subjectMatch[1] : 'unknown';
  const ext = path.extname(filename).toLowerCase();
  const errors: string[] = [];

  const info: ImageInfo = {
    path: filePath,
    subject,
    filename,
    format: ext.replace('.', '').toUpperCase() || 'UNKNOWN',
    size: stat.size,
    errors,
  };

  // Check format
  if (ext !== '.webp') {
    errors.push(`形式が WebP ではありません（${ext}）`);
  }

  // Check file size
  if (stat.size > MAX_SIZE_BYTES) {
    errors.push(
      `ファイルサイズが大きすぎます（${(stat.size / 1024).toFixed(1)}KB > ${MAX_SIZE_KB}KB）`
    );
  }

  // Check dimensions (only for webp)
  if (ext === '.webp') {
    try {
      const metadata = await sharp(filePath).metadata();
      info.width = metadata.width;
      info.height = metadata.height;

      if (metadata.width !== REQUIRED_WIDTH || metadata.height !== REQUIRED_HEIGHT) {
        errors.push(
          `解像度が正しくありません（${metadata.width}×${metadata.height} != ${REQUIRED_WIDTH}×${REQUIRED_HEIGHT}）`
        );
      }
    } catch (err) {
      errors.push(`画像ファイルの読み込みに失敗しました`);
    }
  }

  return info;
}

async function main() {
  console.log(chalk.bold.cyan('\n📊 テンプレート画像検証スクリプト\n'));

  const imagesDir = path.join(process.cwd(), 'public', 'images');

  if (!fs.existsSync(imagesDir)) {
    console.log(chalk.red(`❌ ${imagesDir} が見つかりません`));
    process.exit(1);
  }

  // Find all image files
  const pattern = path.join(imagesDir, '*', '*.webp');
  const files = await glob(pattern);

  if (files.length === 0) {
    console.log(chalk.yellow('⚠️  WebP 画像が見つかりません'));
    console.log(`検索パス: ${pattern}\n`);
    process.exit(0);
  }

  // Validate all images
  const results: ImageInfo[] = [];
  for (const file of files) {
    const info = await validateImage(file);
    results.push(info);
  }

  // Group by subject
  const bySubject: Record<string, ImageInfo[]> = {};
  SUBJECTS.forEach((s) => (bySubject[s] = []));
  results.forEach((r) => {
    if (bySubject[r.subject]) {
      bySubject[r.subject].push(r);
    }
  });

  // Display results
  let totalErrors = 0;
  let totalValid = 0;

  SUBJECTS.forEach((subject) => {
    const images = bySubject[subject];
    console.log(chalk.bold(`\n${subject.toUpperCase()}`));
    console.log('─'.repeat(80));

    if (images.length === 0) {
      console.log(chalk.yellow(`  ⚠️  画像がありません`));
      return;
    }

    images.forEach((img) => {
      const status =
        img.errors.length === 0
          ? chalk.green('✓')
          : chalk.red('✗');
      const size = `${(img.size / 1024).toFixed(1)}KB`;
      const dims = img.width && img.height ? `${img.width}×${img.height}` : 'N/A';

      console.log(
        `  ${status} ${img.filename.padEnd(30)} ${dims.padEnd(12)} ${size.padEnd(10)}`
      );

      if (img.errors.length > 0) {
        img.errors.forEach((err) => {
          console.log(chalk.red(`      → ${err}`));
        });
        totalErrors++;
      } else {
        totalValid++;
      }
    });
  });

  // Summary
  console.log(chalk.bold('\n📈 検証結果'));
  console.log('─'.repeat(80));
  console.log(`  ${chalk.green(`✓ 正常: ${totalValid}`)} / ${chalk.red(`✗ エラー: ${totalErrors}`)} / 合計: ${results.length}`);

  // Detailed error report
  if (totalErrors > 0) {
    console.log(chalk.bold.red('\n❌ 修正が必要な項目：'));
    results
      .filter((r) => r.errors.length > 0)
      .forEach((img) => {
        console.log(`  • ${img.subject}/${img.filename}`);
        img.errors.forEach((err) => console.log(`    - ${err}`));
      });
    process.exit(1);
  }

  console.log(chalk.bold.green('\n✨ すべての画像が正常です！\n'));
  process.exit(0);
}

main().catch((err) => {
  console.error(chalk.red('エラーが発生しました:'), err);
  process.exit(1);
});
