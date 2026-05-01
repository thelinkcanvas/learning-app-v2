#!/usr/bin/env node
/**
 * Vision API + Socratic Engine CLI テストツール
 *
 * Usage:
 *   tsx scripts/vision-test.ts analyze --image ./test-images/grade1-math.jpg
 *   tsx scripts/vision-test.ts analyze --image ./test-images/grade3-math.jpg --subject 算数
 *   tsx scripts/vision-test.ts socratic --image ./test-images/grade1-math.jpg --grade 1
 *   tsx scripts/vision-test.ts dry-run --image ./test-images/grade1-math.jpg
 *   tsx scripts/vision-test.ts help
 *
 * 必須環境変数 (analyze / socratic):
 *   NEXT_PUBLIC_GEMINI_API_KEY または GOOGLE_API_KEY または GEMINI_API_KEY
 */

import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import chalk from 'chalk';
import { analyzeImage, VisionApiError } from '../src/lib/vision/api-client';
import {
  startDialogue,
  continueDialogue,
  isDialogueReadyToConclude,
  SocraticEngineError,
} from '../src/lib/vision/socratic-engine';
import { createOverlaysFromVisionResult } from '../src/lib/vision/spatial-reasoning';
import { hashBase64 } from '../src/lib/vision/cache';
import type {
  SubjectName,
  VisionAnalysisResult,
  StumblingPoint,
  SocraticDialogueState,
} from '../src/lib/types/vision';

// ============================================================================
// 引数パース
// ============================================================================

interface CliArgs {
  command?: string;
  image?: string;
  subject?: SubjectName;
  grade?: number;
  context?: string;
  maxTurns?: number;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { command: argv[0] };
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    const next = argv[i + 1];
    if (a === '--image' && next) {
      args.image = next;
      i++;
    } else if (a === '--subject' && next) {
      args.subject = next as SubjectName;
      i++;
    } else if (a === '--grade' && next) {
      args.grade = parseInt(next, 10);
      i++;
    } else if (a === '--context' && next) {
      args.context = next;
      i++;
    } else if (a === '--max-turns' && next) {
      args.maxTurns = parseInt(next, 10);
      i++;
    }
  }
  return args;
}

// ============================================================================
// 画像読み込み
// ============================================================================

interface LoadedImage {
  base64: string;
  mimeType: string;
  sizeBytes: number;
  filename: string;
}

function loadImage(filePath: string): LoadedImage {
  const absolute = path.resolve(filePath);
  if (!fs.existsSync(absolute)) {
    throw new Error(`画像ファイルが見つかりません: ${absolute}`);
  }
  const buffer = fs.readFileSync(absolute);
  const ext = path.extname(absolute).toLowerCase();
  const mimeMap: Record<string, string> = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
  };
  const mimeType = mimeMap[ext];
  if (!mimeType) {
    throw new Error(`対応していない画像形式です: ${ext} (jpg/png/webp)`);
  }
  return {
    base64: buffer.toString('base64'),
    mimeType,
    sizeBytes: buffer.length,
    filename: path.basename(absolute),
  };
}

// ============================================================================
// ヘルプ
// ============================================================================

function printHelp(): void {
  console.log(chalk.cyan.bold('\n  Vision API + Socratic Engine CLI\n'));
  console.log('Commands:');
  console.log(chalk.green('  analyze --image <path> [--subject <name>] [--context <text>]'));
  console.log('    画像を Gemini Vision API で解析。stumbling_points を表示\n');
  console.log(chalk.green('  socratic --image <path> [--grade N] [--max-turns N]'));
  console.log('    解析後、最初の StumblingPoint について対話セッションを開始\n');
  console.log(chalk.green('  dry-run --image <path>'));
  console.log('    API を呼ばず、画像読み込み + ハッシュ計算のみ確認\n');
  console.log(chalk.green('  help'));
  console.log('    このメッセージを表示\n');
  console.log('Subject options: 国語, 算数, 理科, 社会, 英語, 生活, 不明');
  console.log('Grade: 1-6 (省略時は学年指定なし)\n');
  console.log(chalk.gray('Examples:'));
  console.log(chalk.gray('  tsx scripts/vision-test.ts analyze --image ./test-images/grade1-math.jpg'));
  console.log(chalk.gray('  tsx scripts/vision-test.ts socratic --image ./test-images/grade3-math.jpg --grade 3\n'));
}

// ============================================================================
// analyze コマンド
// ============================================================================

async function cmdAnalyze(args: CliArgs): Promise<void> {
  if (!args.image) {
    console.error(chalk.red('エラー: --image <path> が必要です'));
    process.exit(1);
  }

  const img = loadImage(args.image);
  console.log(chalk.cyan(`画像読み込み: ${img.filename} (${(img.sizeBytes / 1024).toFixed(1)} KB)`));

  const hash = await hashBase64(img.base64);
  console.log(chalk.gray(`SHA-256: ${hash.substring(0, 16)}...`));

  if (args.subject) {
    console.log(chalk.gray(`教科ヒント: ${args.subject}`));
  }

  console.log(chalk.cyan('\nGemini Vision API へ送信中...\n'));

  try {
    const response = await analyzeImage({
      image_base64: img.base64,
      mime_type: img.mimeType,
      subject_hint: args.subject,
      user_context: args.context,
    });

    printVisionResult(response.result, response.processing_time_ms, response.input_tokens, response.output_tokens);
  } catch (err) {
    handleVisionError(err);
  }
}

function printVisionResult(
  result: VisionAnalysisResult,
  processingTimeMs: number,
  inputTokens?: number,
  outputTokens?: number
): void {
  console.log(chalk.green.bold('=== Vision Analysis Result ===\n'));

  // メタデータ
  console.log(chalk.bold('Document Metadata:'));
  console.log(`  教科: ${chalk.yellow(result.document_metadata.subject)}`);
  console.log(`  単元: ${chalk.yellow(result.document_metadata.unit_name)}`);
  if (result.document_metadata.grade_estimate) {
    console.log(`  推定学年: 小学 ${result.document_metadata.grade_estimate} 年`);
  }
  if (result.document_metadata.page_type) {
    console.log(`  ページ種別: ${result.document_metadata.page_type}`);
  }

  // 画像品質
  console.log(chalk.bold('\nImage Quality:'));
  const eduIcon = result.image_quality.is_educational_content ? chalk.green('✓') : chalk.red('✗');
  const readIcon = result.image_quality.is_readable ? chalk.green('✓') : chalk.red('✗');
  console.log(`  ${eduIcon} 学習教材として認識`);
  console.log(`  ${readIcon} 文字が読み取れる`);
  if (result.image_quality.warnings && result.image_quality.warnings.length > 0) {
    console.log(`  警告: ${result.image_quality.warnings.join(', ')}`);
  }

  // つまずきポイント
  console.log(chalk.bold(`\nStumbling Points (${result.stumbling_points.length} 件):\n`));
  if (result.stumbling_points.length === 0) {
    console.log(chalk.gray('  (手書きマークが検出されませんでした)'));
  }
  result.stumbling_points.forEach((p, idx) => {
    printStumblingPoint(p, idx);
  });

  // 統計
  console.log(chalk.gray(`\n処理時間: ${processingTimeMs}ms`));
  if (inputTokens || outputTokens) {
    console.log(chalk.gray(`トークン: input=${inputTokens ?? '?'}, output=${outputTokens ?? '?'}`));
  }
}

function printStumblingPoint(p: StumblingPoint, idx: number): void {
  const conf = p.confidence ?? 0;
  const confColor = conf >= 0.7 ? chalk.green : conf >= 0.5 ? chalk.yellow : chalk.red;
  console.log(`${chalk.bold(`[${idx + 1}] ${p.mark_id}`)} ${chalk.gray(`(${p.mark_type})`)}`);
  console.log(`    box_2d: [${p.box_2d.join(', ')}]`);
  console.log(`    問題: ${chalk.cyan(truncate(p.extracted_problem, 80))}`);
  console.log(`    概念: ${chalk.magenta(p.identified_concept)}`);
  console.log(`    認知的問題: ${truncate(p.cognitive_issue, 100)}`);
  console.log(`    信頼度: ${confColor(conf.toFixed(2))}\n`);
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.substring(0, n) + '...' : s;
}

// ============================================================================
// dry-run コマンド (API キー不要)
// ============================================================================

async function cmdDryRun(args: CliArgs): Promise<void> {
  if (!args.image) {
    console.error(chalk.red('エラー: --image <path> が必要です'));
    process.exit(1);
  }

  const img = loadImage(args.image);
  const hash = await hashBase64(img.base64);

  console.log(chalk.green('\n=== Dry Run (API 呼び出しなし) ===\n'));
  console.log(`ファイル名: ${img.filename}`);
  console.log(`サイズ: ${img.sizeBytes} bytes (${(img.sizeBytes / 1024).toFixed(1)} KB)`);
  console.log(`MIME type: ${img.mimeType}`);
  console.log(`SHA-256: ${hash}`);
  console.log(`Base64 長さ: ${img.base64.length} 文字`);

  if (img.sizeBytes > 5 * 1024 * 1024) {
    console.log(chalk.yellow('\n警告: 5 MB を超えています。送信前に圧縮が必要です。'));
  } else {
    console.log(chalk.green('\nファイルサイズ OK (5 MB 以下)'));
  }
  console.log();
}

// ============================================================================
// socratic コマンド (対話)
// ============================================================================

async function cmdSocratic(args: CliArgs): Promise<void> {
  if (!args.image) {
    console.error(chalk.red('エラー: --image <path> が必要です'));
    process.exit(1);
  }

  const img = loadImage(args.image);
  console.log(chalk.cyan(`画像読み込み: ${img.filename}`));
  console.log(chalk.cyan('Vision API で解析中...\n'));

  let visionResult: VisionAnalysisResult;
  try {
    const response = await analyzeImage({
      image_base64: img.base64,
      mime_type: img.mimeType,
      subject_hint: args.subject,
    });
    visionResult = response.result;
  } catch (err) {
    handleVisionError(err);
    return;
  }

  if (visionResult.stumbling_points.length === 0) {
    console.log(chalk.yellow('\n手書きマークが検出されませんでした。○ で囲んだ画像を使ってください。'));
    return;
  }

  // 最初の StumblingPoint を選択
  const target = visionResult.stumbling_points[0];
  console.log(chalk.green('\n対象とする問題:'));
  printStumblingPoint(target, 0);

  // 対話セッション開始
  console.log(chalk.cyan('\n=== ソクラテス式問答 開始 ===\n'));
  let session: SocraticDialogueState;
  let firstQuestion: string;
  try {
    const result = await startDialogue(visionResult, target.mark_id, {
      childGrade: args.grade,
    });
    session = result.state;
    firstQuestion = result.firstQuestion;
  } catch (err) {
    handleSocraticError(err);
    return;
  }

  console.log(chalk.bold(`先生: ${firstQuestion}\n`));

  // 対話ループ
  const maxTurns = args.maxTurns ?? 5;
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const ask = (prompt: string): Promise<string> =>
    new Promise((resolve) => rl.question(prompt, resolve));

  try {
    while (session.turn_count <= maxTurns && !isDialogueReadyToConclude(session)) {
      const userInput = (await ask(chalk.green('あなた (児童役): '))).trim();
      if (userInput === 'exit' || userInput === 'quit' || userInput === '/end') {
        console.log(chalk.gray('\n対話を終了します。'));
        break;
      }
      if (userInput.length === 0) continue;

      const result = await continueDialogue(session, visionResult, userInput, {
        childGrade: args.grade,
      });
      session = result.state;

      if (result.modeTransition) {
        console.log(chalk.gray(`\n[${result.modeTransition}]`));
      }
      console.log(chalk.bold(`\n先生: ${result.nextQuestion}\n`));
    }
  } catch (err) {
    handleSocraticError(err);
  } finally {
    rl.close();
  }

  // セッションサマリー
  console.log(chalk.cyan('\n=== セッション終了 ===\n'));
  console.log(`  ターン数: ${session.turn_count}`);
  console.log(`  最終モード: ${session.mode}`);
  console.log(`  理解度スコア: ${session.concept_understanding_score.toFixed(2)}`);
  console.log(`  次の戦略: ${session.next_question_strategy}`);

  // オーバーレイ情報のサンプル出力 (架空のサイズで)
  const sampleW = 1280;
  const sampleH = 800;
  const overlays = createOverlaysFromVisionResult(visionResult, sampleW, sampleH);
  if (overlays.length > 0) {
    console.log(chalk.gray(`\n  (参考) ${sampleW}×${sampleH} 想定での絶対座標:`));
    overlays.forEach((o) => {
      console.log(
        chalk.gray(
          `    ${o.mark_id}: x=${o.absolute_box.x}, y=${o.absolute_box.y}, w=${o.absolute_box.width}, h=${o.absolute_box.height}`
        )
      );
    });
  }
  console.log();
}

// ============================================================================
// エラーハンドリング
// ============================================================================

function handleVisionError(err: unknown): never {
  if (err instanceof VisionApiError) {
    console.error(chalk.red.bold(`\nVision API Error: ${err.details.category}`));
    console.error(chalk.red(`  ${err.details.message}`));
    if (err.details.validation_errors) {
      console.error(chalk.red('  バリデーションエラー:'));
      err.details.validation_errors.forEach((e) => console.error(chalk.red(`    - ${e}`)));
    }
    if (err.details.retryable) {
      console.error(chalk.gray('  (リトライ可能なエラー。後で再試行できます)'));
    }
  } else {
    console.error(chalk.red(`\n予期しないエラー: ${(err as Error).message}`));
  }
  process.exit(1);
}

function handleSocraticError(err: unknown): never {
  if (err instanceof SocraticEngineError) {
    console.error(chalk.red.bold(`\nSocratic Engine Error: ${err.message}`));
  } else {
    console.error(chalk.red(`\n予期しないエラー: ${(err as Error).message}`));
  }
  process.exit(1);
}

// ============================================================================
// メイン
// ============================================================================

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  switch (args.command) {
    case 'analyze':
      await cmdAnalyze(args);
      break;
    case 'socratic':
      await cmdSocratic(args);
      break;
    case 'dry-run':
      await cmdDryRun(args);
      break;
    case 'help':
    case undefined:
      printHelp();
      break;
    default:
      console.error(chalk.red(`不明なコマンド: ${args.command}`));
      printHelp();
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(chalk.red('Fatal error:'), err);
  process.exit(1);
});
