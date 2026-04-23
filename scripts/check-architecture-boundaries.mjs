#!/usr/bin/env node
import { promises as fs } from 'fs';
import path from 'path';

const repoRoot = process.cwd();
const srcRoot = path.join(repoRoot, 'src');
const strictMode = process.argv.includes('--strict');

const SOURCE_PATTERNS = [/\.ts$/, /\.tsx$/];
const IMPORT_RE = /\b(?:import|export)\s+(?:type\s+)?(?:[^'";]+?\s+from\s+)?['"]([^'";]+)['"]/g;

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function walkSourceFiles(dir) {
  const results = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.git') {
      continue;
    }

    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await walkSourceFiles(fullPath)));
      continue;
    }

    if (SOURCE_PATTERNS.some(pattern => pattern.test(entry.name))) {
      results.push(fullPath);
    }
  }

  return results;
}

function toPosixRelative(absolutePath) {
  return path.relative(repoRoot, absolutePath).split(path.sep).join('/');
}

function classifyLayer(relativePath) {
  if (relativePath.startsWith('src/entrypoints/bootstrap/')) return 'entrypoints-bootstrap';
  if (relativePath.startsWith('src/entrypoints/modes/')) return 'entrypoints-modes';
  if (relativePath.startsWith('src/services/resources/')) return 'services-resources';
  if (relativePath.startsWith('src/services/extensions/')) return 'services-extensions';
  if (relativePath.startsWith('src/services/runtime/')) return 'services-runtime';
  if (relativePath.startsWith('src/entrypoints/')) return 'entrypoints-other';
  if (relativePath.startsWith('src/services/')) return 'services-other';
  if (relativePath.startsWith('src/screens/')) return 'screens';
  return 'other';
}

async function resolveImportPath(filePath, specifier) {
  if (specifier.startsWith('src/')) {
    return specifier;
  }

  if (!specifier.startsWith('.')) {
    return null;
  }

  const basePath = path.resolve(path.dirname(filePath), specifier);
  const candidates = [
    basePath,
    `${basePath}.ts`,
    `${basePath}.tsx`,
    `${basePath}.js`,
    `${basePath}.mjs`,
    path.join(basePath, 'index.ts'),
    path.join(basePath, 'index.tsx'),
    path.join(basePath, 'index.js'),
  ];

  for (const candidate of candidates) {
    if (await pathExists(candidate)) {
      return toPosixRelative(candidate);
    }
  }

  return null;
}

function violatesBoundary(sourceLayer, targetPath) {
  if (
    (sourceLayer === 'services-resources' ||
      sourceLayer === 'services-extensions' ||
      sourceLayer === 'services-runtime') &&
    targetPath.startsWith('src/entrypoints/')
  ) {
    return 'services layer should not depend on entrypoints layer';
  }

  if (
    sourceLayer === 'entrypoints-modes' &&
    targetPath.startsWith('src/screens/')
  ) {
    return 'entrypoints/modes should inject into screens, not import screens directly';
  }

  if (
    sourceLayer === 'services-resources' &&
    targetPath.startsWith('src/screens/')
  ) {
    return 'services/resources should stay screen-agnostic';
  }

  return null;
}

async function main() {
  const files = await walkSourceFiles(srcRoot);
  const violations = [];

  for (const filePath of files) {
    const sourceRelativePath = toPosixRelative(filePath);
    const sourceLayer = classifyLayer(sourceRelativePath);
    if (sourceLayer === 'other') {
      continue;
    }

    const content = await fs.readFile(filePath, 'utf8');
    IMPORT_RE.lastIndex = 0;

    for (let match = IMPORT_RE.exec(content); match; match = IMPORT_RE.exec(content)) {
      const specifier = match[1];
      const resolved = await resolveImportPath(filePath, specifier);
      if (!resolved) {
        continue;
      }

      const reason = violatesBoundary(sourceLayer, resolved);
      if (reason) {
        violations.push({
          file: sourceRelativePath,
          importPath: specifier,
          resolved,
          reason,
        });
      }
    }
  }

  if (violations.length === 0) {
    console.log('[architecture] no boundary violations detected');
    return;
  }

  console.warn(
    `[architecture] ${violations.length} potential boundary issue(s) found (soft gate):`,
  );

  for (const violation of violations) {
    console.warn(
      `- ${violation.file}: ${violation.importPath} -> ${violation.resolved} (${violation.reason})`,
    );
  }

  if (strictMode) {
    process.exitCode = 1;
  }
}

await main();
