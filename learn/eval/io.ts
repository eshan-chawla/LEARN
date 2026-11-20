import { randomBytes } from 'node:crypto';
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/** Repo root, assuming scripts run from learn/ (npm scripts and `npx tsx eval/...`). */
export function repoPath(...segments: string[]): string {
  return resolve(process.cwd(), '..', ...segments);
}

export function parseJsonl<T = unknown>(text: string): T[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T);
}

export function readJsonl<T = unknown>(path: string): T[] {
  return parseJsonl<T>(readFileSync(path, 'utf8'));
}

export function appendJsonl(path: string, row: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(row)}\n`);
}

/** `<prefix>-<ISO timestamp, filesystem-safe>-<6 hex>` */
export function newRunId(prefix: string): string {
  const stamp = new Date().toISOString().replace(/\..+$/, '').replace(/:/g, '-');
  return `${prefix}-${stamp}-${randomBytes(3).toString('hex')}`;
}
