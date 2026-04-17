#!/usr/bin/env node

import { readFileSync } from 'fs';
import { spawnSync } from 'child_process';

const args = process.argv.slice(2);

function getArg(name, fallback) {
  const withEq = args.find(arg => arg.startsWith(`${name}=`));
  if (withEq) return withEq.slice(name.length + 1);
  const idx = args.indexOf(name);
  if (idx >= 0 && args[idx + 1]) return args[idx + 1];
  return fallback;
}

const failOn = (getArg('--fail-on', 'high') || 'high').toLowerCase();
const jsonOutput = args.includes('--json');
const diffFile = getArg('--diff-file');
const baseRef = getArg('--base');
const headRef = getArg('--head');
const severityRank = { low: 1, medium: 2, high: 3 };
const ignoreFiles = new Set(['scripts/pr-intent-scan.mjs']);

function getDiffText() {
  if (diffFile) {
    return readFileSync(diffFile, 'utf8');
  }
  if (baseRef && headRef) {
    const result = spawnSync(
      'git',
      ['diff', '--no-color', '-U0', `${baseRef}...${headRef}`],
      { encoding: 'utf8' },
    );
    if (result.status !== 0) {
      throw new Error(result.stderr || 'failed to load git diff');
    }
    return result.stdout;
  }
  const result = spawnSync('git', ['diff', '--no-color', '-U0', '--cached'], {
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || 'failed to load staged git diff');
  }
  return result.stdout;
}

const rules = [
  {
    id: 'shortened-url',
    severity: 'high',
    regex: /https?:\/\/(?:bit\.ly|t\.co|tinyurl\.com|is\.gd|goo\.gl|ow\.ly|buff\.ly|rebrand\.ly|tiny\.cc)\//i,
    message: 'Shortened URL in added line',
  },
  {
    id: 'suspicious-download-link',
    severity: 'high',
    regex: /https?:\/\/[^\s'"`]+?\.(?:zip|dmg|pkg|exe|msi|bat|ps1|sh)(?:\?[^\s'"`]*)?/i,
    message: 'Download link to executable/archive',
  },
  {
    id: 'suspicious-download-command',
    severity: 'high',
    regex: /(?:curl|wget)[^|\n;]*(?:\|\s*(?:bash|sh|zsh|pwsh|powershell)|>\s*\/tmp\/|>\s*~\/|chmod\s+\+x)/i,
    message: 'Suspicious download-and-execute pattern',
  },
  {
    id: 'long-base64-segment',
    severity: 'medium',
    regex: /(?:^|[^A-Za-z0-9+/=])[A-Za-z0-9+/]{120,}={0,2}(?:[^A-Za-z0-9+/=]|$)/,
    message: 'Long base64-like segment',
  },
  {
    id: 'long-token-like-string',
    severity: 'medium',
    regex: /(?:^|[\s'"`])[A-Za-z0-9_-]{64,}(?:[\s'"`]|$)/,
    message: 'Long token-like string',
  },
];

function parseAddedLines(diffText) {
  const findings = [];
  const lines = diffText.split('\n');
  let file = '';
  let newLine = 0;
  for (const line of lines) {
    if (line.startsWith('+++ b/')) {
      file = line.slice(6);
      continue;
    }
    if (line.startsWith('@@')) {
      const m = line.match(/\+(\d+)(?:,(\d+))?/);
      newLine = m ? Number(m[1]) : 0;
      continue;
    }
    if (!file || ignoreFiles.has(file)) {
      if (line.startsWith('+') && !line.startsWith('+++')) newLine += 1;
      if (line.startsWith('-')) continue;
      continue;
    }
    if (line.startsWith('+') && !line.startsWith('+++')) {
      const content = line.slice(1);
      for (const rule of rules) {
        if (rule.regex.test(content)) {
          findings.push({
            severity: rule.severity,
            rule: rule.id,
            message: rule.message,
            file,
            line: newLine,
            sample: content.slice(0, 200),
          });
        }
      }
      newLine += 1;
      continue;
    }
    if (!line.startsWith('-')) {
      newLine += 1;
    }
  }
  return findings;
}

function printText(findings) {
  if (findings.length === 0) {
    console.log('[pr-intent-scan] no suspicious additions found');
    return;
  }
  console.log(`[pr-intent-scan] findings: ${findings.length}`);
  for (const finding of findings) {
    console.log(
      `[${finding.severity}] ${finding.rule} ${finding.file}:${finding.line} ${finding.message}`,
    );
  }
}

try {
  const diffText = getDiffText();
  const findings = parseAddedLines(diffText);
  const highest = findings.reduce(
    (max, finding) => Math.max(max, severityRank[finding.severity] || 0),
    0,
  );
  const failThreshold = severityRank[failOn] || severityRank.high;
  const shouldFail = highest >= failThreshold && findings.length > 0;

  if (jsonOutput) {
    console.log(
      JSON.stringify(
        {
          findings,
          summary: {
            count: findings.length,
            highestSeverity:
              Object.entries(severityRank).find(([, rank]) => rank === highest)?.[0] ??
              'none',
            failOn,
            shouldFail,
          },
        },
        null,
        2,
      ),
    );
  } else {
    printText(findings);
  }

  process.exit(shouldFail ? 1 : 0);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[pr-intent-scan] error: ${message}`);
  process.exit(2);
}
