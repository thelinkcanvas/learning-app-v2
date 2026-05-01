#!/usr/bin/env node
/**
 * Classroom 統合 CLI
 *
 * Usage:
 *   tsx scripts/classroom-sync.ts auth-url --role teacher
 *   tsx scripts/classroom-sync.ts exchange --code <auth_code> --user-id teacher1 --role teacher
 *   tsx scripts/classroom-sync.ts list-courses --user-id teacher1
 *   tsx scripts/classroom-sync.ts create-course --user-id teacher1 --grade 3 --subject math --class-code A1
 *   tsx scripts/classroom-sync.ts list-mappings --class-code A1
 *
 * 必須環境変数：
 *   GOOGLE_CLIENT_ID
 *   GOOGLE_CLIENT_SECRET
 *   GOOGLE_REDIRECT_URI
 */

import * as path from 'path';
import chalk from 'chalk';
import {
  buildAuthorizationUrl,
  exchangeCodeForTokens,
  JsonFileTokenStore,
} from '../src/lib/classroom/auth';
import { ClassroomApiClient } from '../src/lib/classroom/api-client';
import {
  buildCourseAlias,
  generateAllMappings,
} from '../src/lib/classroom/aliases';
import type { Subject, Grade } from '../src/lib/prompt-templates';
import { SUBJECT_LABELS_JA } from '../src/lib/prompt-templates';
import type { OAuthRole } from '../src/lib/types/classroom';

const TOKEN_STORE_DIR = path.join(process.cwd(), '.tokens');

function getEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(chalk.red(`環境変数 ${name} が設定されていません`));
    process.exit(1);
  }
  return v;
}

function makeClient(): ClassroomApiClient {
  return new ClassroomApiClient({
    clientId: getEnv('GOOGLE_CLIENT_ID'),
    clientSecret: getEnv('GOOGLE_CLIENT_SECRET'),
    verbose: true,
  });
}

function getStore(): JsonFileTokenStore {
  return new JsonFileTokenStore(TOKEN_STORE_DIR);
}

interface CliArgs {
  command?: string;
  role?: 'teacher' | 'student';
  code?: string;
  userId?: string;
  grade?: Grade;
  subject?: Subject;
  classCode?: string;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { command: argv[0] };
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--role': args.role = argv[++i] as 'teacher' | 'student'; break;
      case '--code': args.code = argv[++i]; break;
      case '--user-id': args.userId = argv[++i]; break;
      case '--grade': args.grade = parseInt(argv[++i], 10) as Grade; break;
      case '--subject': args.subject = argv[++i] as Subject; break;
      case '--class-code': args.classCode = argv[++i]; break;
    }
  }
  return args;
}

// ============================================================================
// コマンド実装
// ============================================================================

async function cmdAuthUrl(args: CliArgs): Promise<void> {
  if (!args.role) {
    console.error(chalk.red('--role <teacher|student> が必要'));
    process.exit(1);
  }
  const url = buildAuthorizationUrl({
    clientId: getEnv('GOOGLE_CLIENT_ID'),
    redirectUri: getEnv('GOOGLE_REDIRECT_URI'),
    role: args.role,
    state: `cli_${Date.now()}`,
    prompt: 'consent',
  });
  console.log(chalk.cyan('\nブラウザで以下を開いて認可してください:\n'));
  console.log(url);
  console.log(chalk.gray('\n認可後、リダイレクト先 URL から code パラメータをコピーし、'));
  console.log(chalk.gray('次のコマンドを実行:'));
  console.log(chalk.bold(`\n  tsx scripts/classroom-sync.ts exchange --code <CODE> --user-id <YOUR_ID> --role ${args.role}\n`));
}

async function cmdExchange(args: CliArgs): Promise<void> {
  if (!args.code || !args.userId || !args.role) {
    console.error(chalk.red('--code, --user-id, --role すべて必要'));
    process.exit(1);
  }
  const tokens = await exchangeCodeForTokens({
    clientId: getEnv('GOOGLE_CLIENT_ID'),
    clientSecret: getEnv('GOOGLE_CLIENT_SECRET'),
    redirectUri: getEnv('GOOGLE_REDIRECT_URI'),
    code: args.code,
  });
  const role: OAuthRole = { role: args.role, userId: args.userId };
  await getStore().save(args.userId, role, tokens);
  console.log(chalk.green(`✓ トークンを保存しました: ${TOKEN_STORE_DIR}/${args.userId}.json`));
  console.log(chalk.gray(`  expires_at: ${new Date(tokens.expiresAt).toISOString()}`));
  console.log(chalk.gray(`  scope: ${tokens.scope}`));
}

async function cmdListCourses(args: CliArgs): Promise<void> {
  if (!args.userId) {
    console.error(chalk.red('--user-id が必要'));
    process.exit(1);
  }
  const stored = await getStore().load(args.userId);
  if (!stored) {
    console.error(chalk.red('トークンが見つかりません。先に auth-url + exchange を実行してください'));
    process.exit(1);
  }

  const client = makeClient();
  const result = await client.listCourses({ tokens: stored.tokens });

  console.log(chalk.cyan(`\n=== コース一覧 (${result.courses?.length ?? 0} 件) ===\n`));
  result.courses?.forEach(c => {
    console.log(`  ${chalk.bold(c.name)} ${chalk.gray(`(id: ${c.id})`)}`);
    if (c.section) console.log(chalk.gray(`    section: ${c.section}`));
    console.log(chalk.gray(`    state: ${c.courseState}`));
  });
  if (!result.courses?.length) {
    console.log(chalk.yellow('  コースなし'));
  }
}

async function cmdCreateCourse(args: CliArgs): Promise<void> {
  if (!args.userId || !args.grade || !args.subject || !args.classCode) {
    console.error(chalk.red('--user-id, --grade, --subject, --class-code すべて必要'));
    process.exit(1);
  }
  const stored = await getStore().load(args.userId);
  if (!stored || stored.role.role !== 'teacher') {
    console.error(chalk.red('教員のトークンが必要（コース作成は教員権限）'));
    process.exit(1);
  }

  const subjectJa = SUBJECT_LABELS_JA[args.subject];
  const alias = buildCourseAlias({
    grade: args.grade,
    subject: args.subject,
    classCode: args.classCode,
  });

  const client = makeClient();
  const auth = { tokens: stored.tokens };

  console.log(chalk.cyan(`\nコース作成: 小${args.grade}${subjectJa} / class=${args.classCode}`));
  console.log(chalk.gray(`alias: ${alias}\n`));

  // 1. コース作成
  const course = await client.createCourse(auth, {
    name: `小${args.grade} ${subjectJa} (${args.classCode})`,
    section: `Grade ${args.grade}`,
    description: `学習アプリ自動連携用のコース`,
    descriptionHeading: `${subjectJa} 個別最適化学習`,
    courseState: 'ACTIVE',
    ownerId: 'me',
  });
  console.log(chalk.green(`✓ コース作成完了 id=${course.id}`));

  // 2. エイリアス付与
  await client.createAlias(auth, course.id, { alias });
  console.log(chalk.green(`✓ エイリアス付与: ${alias}`));

  console.log(chalk.cyan(`\n以降、courseId に "${alias}" を使って API 呼び出し可能`));
}

async function cmdListMappings(args: CliArgs): Promise<void> {
  if (!args.classCode) {
    console.error(chalk.red('--class-code が必要'));
    process.exit(1);
  }
  const mappings = generateAllMappings(args.classCode);
  console.log(chalk.cyan(`\n=== マッピング一覧 (class=${args.classCode}, 24 件) ===\n`));
  mappings.forEach(m => {
    const subjectJa = SUBJECT_LABELS_JA[m.subject];
    console.log(`  小${m.grade} ${subjectJa.padEnd(2)} → ${chalk.bold(m.alias)}`);
  });
}

function printHelp(): void {
  console.log(`
Classroom 統合 CLI

使い方:
  tsx scripts/classroom-sync.ts <command> [options]

コマンド:
  auth-url --role <teacher|student>
    認可 URL を生成（ブラウザで開いてログイン）

  exchange --code <auth_code> --user-id <id> --role <teacher|student>
    認可コードをトークンに交換して保存

  list-courses --user-id <id>
    そのユーザーがアクセス可能なコース一覧を表示

  create-course --user-id <teacher_id> --grade <1-6> --subject <math|japanese|science|social> --class-code <code>
    新規コース + エイリアスを作成（教員トークン必須）

  list-mappings --class-code <code>
    そのクラスの 24 マッピング（4教科×6学年）を表示

必須環境変数:
  GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI
`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  switch (args.command) {
    case 'auth-url':       await cmdAuthUrl(args); break;
    case 'exchange':       await cmdExchange(args); break;
    case 'list-courses':   await cmdListCourses(args); break;
    case 'create-course':  await cmdCreateCourse(args); break;
    case 'list-mappings':  await cmdListMappings(args); break;
    case 'help':
    case undefined:        printHelp(); break;
    default:
      console.error(chalk.red(`不明なコマンド: ${args.command}`));
      printHelp();
      process.exit(1);
  }
}

main().catch(err => {
  console.error(chalk.red('Fatal:'), err);
  process.exit(1);
});
