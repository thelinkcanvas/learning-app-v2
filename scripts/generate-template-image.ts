#!/usr/bin/env node
/**
 * 教材テンプレート画像生成 CLI
 *
 * Usage:
 *   tsx scripts/generate-template-image.ts --subject math --grade 3
 *   tsx scripts/generate-template-image.ts --subject japanese --grade 1 --title "ことば"
 *   tsx scripts/generate-template-image.ts --all   # 4教科×6学年=24枚を一括生成
 *
 * 出力先：public/images/{subject}/g{grade}-{title}-v{variation}.webp
 */

import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import {
  buildPrompt,
  lintPrompt,
  type Subject,
  type Grade,
  SUBJECT_LABELS_JA,
} from '../src/lib/prompt-templates';
import {
  generateTemplateImage,
  ImageGenerationError,
} from '../src/lib/image-generator';
import {
  processToTemplateWebP,
  validateSpec,
} from '../src/lib/image-pipeline';

interface CliArgs {
  subject?: Subject;
  grade?: Grade;
  title?: string;
  variation?: number;
  all?: boolean;
  dryRun?: boolean;
  outDir?: string;
}

const SUBJECTS: Subject[] = ['math', 'japanese', 'science', 'social'];
const GRADES: Grade[] = [1, 2, 3, 4, 5, 6];

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--subject':
        args.subject = argv[++i] as Subject;
        break;
      case '--grade':
        args.grade = parseInt(argv[++i], 10) as Grade;
        break;
      case '--title':
        args.title = argv[++i];
        break;
      case '--variation':
        args.variation = parseInt(argv[++i], 10);
        break;
      case '--all':
        args.all = true;
        break;
      case '--dry-run':
        args.dryRun = true;
        break;
      case '--out-dir':
        args.outDir = argv[++i];
        break;
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
    }
  }
  return args;
}

function printHelp(): void {
  console.log(`
教材テンプレート画像生成 CLI

使い方:
  tsx scripts/generate-template-image.ts [options]

オプション:
  --subject <math|japanese|science|social>   教科を指定
  --grade <1-6>                              学年を指定
  --title <string>                           描画タイトル（10文字以下推奨）
  --variation <number>                       バリエーション ID（1-2）
  --all                                      4教科×6学年を一括生成
  --dry-run                                  プロンプトだけ表示し API 呼ばない
  --out-dir <path>                           出力ディレクトリ（デフォルト public/images）
  --help                                     ヘルプ表示

例:
  tsx scripts/generate-template-image.ts --subject math --grade 3
  tsx scripts/generate-template-image.ts --all --dry-run
`);
}

interface GenerationJob {
  subject: Subject;
  grade: Grade;
  title?: string;
  variation: number;
}

async function runJob(job: GenerationJob, outDir: string, dryRun: boolean): Promise<boolean> {
  const { subject, grade, title, variation } = job;
  const labelJa = SUBJECT_LABELS_JA[subject];

  console.log(
    chalk.cyan(`\n→ ${labelJa} / 小${grade} / variation ${variation}`)
  );

  // 1. プロンプト生成
  const prompt = buildPrompt({ subject, grade, title, variationId: variation });
  const lint = lintPrompt(prompt);
  if (!lint.ok) {
    lint.warnings.forEach(w => console.log(chalk.yellow(`  ⚠ ${w}`)));
  }

  if (dryRun) {
    console.log(chalk.gray('  [dry-run] プロンプト:'));
    console.log(chalk.gray(prompt.split('\n').map(l => `    ${l}`).join('\n')));
    return true;
  }

  try {
    // 2. 画像生成（オーバーサンプリング）
    console.log(chalk.gray('  Gemini 呼び出し中（thinkingLevel=high, 2K, 16:9）...'));
    const generated = await generateTemplateImage({
      prompt,
      thinkingLevel: 'high',
      imageSize: '2K',
      aspectRatio: '16:9',
    });
    console.log(chalk.gray(`  ✓ 生成完了 model=${generated.modelUsed} mime=${generated.mimeType}`));

    // 3. Sharp 後処理（1280×800 WebP ≤200KB）
    console.log(chalk.gray('  Sharp 後処理中（crop → resize → WebP）...'));
    const processed = await processToTemplateWebP(generated.buffer);
    const validation = validateSpec(processed);
    if (!validation.ok) {
      validation.errors.forEach(e => console.log(chalk.red(`  ✗ ${e}`)));
      return false;
    }

    // 4. ファイル保存
    const fileName = `g${grade}-${subject}-v${variation}.webp`;
    const subjectDir = path.join(outDir, subject);
    fs.mkdirSync(subjectDir, { recursive: true });
    const outPath = path.join(subjectDir, fileName);
    fs.writeFileSync(outPath, processed.buffer);

    console.log(
      chalk.green(
        `  ✓ 保存: ${outPath} ` +
          `(${(processed.sizeBytes / 1024).toFixed(1)}KB, ` +
          `${processed.width}×${processed.height}, q=${processed.qualityUsed})`
      )
    );
    return true;
  } catch (err) {
    if (err instanceof ImageGenerationError && err.safetyBlocked) {
      console.log(chalk.red(`  ✗ Safety blocked: ${err.message}`));
    } else if (err instanceof Error) {
      console.log(chalk.red(`  ✗ Error: ${err.message}`));
    } else {
      console.log(chalk.red(`  ✗ Unknown error: ${String(err)}`));
    }
    return false;
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const outDir = args.outDir ?? path.join(process.cwd(), 'public', 'images');

  console.log(chalk.bold('\n=== 教材テンプレート画像生成 ===\n'));
  console.log(chalk.gray(`出力先: ${outDir}`));
  if (args.dryRun) console.log(chalk.yellow('モード: dry-run (API 呼び出しなし)'));

  const jobs: GenerationJob[] = [];

  if (args.all) {
    for (const subject of SUBJECTS) {
      for (const grade of GRADES) {
        jobs.push({ subject, grade, variation: 1 });
      }
    }
  } else {
    if (!args.subject || !args.grade) {
      console.error(chalk.red('エラー: --subject と --grade は必須（または --all を指定）'));
      printHelp();
      process.exit(1);
    }
    jobs.push({
      subject: args.subject,
      grade: args.grade,
      title: args.title,
      variation: args.variation ?? 1,
    });
  }

  let ok = 0;
  let ng = 0;
  for (const job of jobs) {
    const success = await runJob(job, outDir, args.dryRun ?? false);
    if (success) ok++;
    else ng++;
  }

  console.log(chalk.bold(`\n=== 完了: 成功 ${ok} / 失敗 ${ng} ===\n`));
  process.exit(ng > 0 ? 1 : 0);
}

main().catch(err => {
  console.error(chalk.red('Fatal:'), err);
  process.exit(1);
});
