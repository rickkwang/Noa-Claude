#!/usr/bin/env bun

import { access, copyFile, mkdir, readdir, readlink, stat, symlink } from 'fs/promises';
import { constants } from 'fs';
import { join } from 'path';
import { DEFAULT_PRODUCT_DIR, LEGACY_CONFIG_DIR } from '../launcher-config.js';

const EXCLUDED_NAMES = new Set([
  '.DS_Store',
  'cache',
  'debug',
  'telemetry',
  'traces',
]);

function parseFlag(argv, names) {
  const args = argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    for (const name of names) {
      if (arg === name) {
        return typeof args[i + 1] === 'string' ? args[i + 1] : null;
      }
      if (arg.startsWith(`${name}=`)) {
        return arg.slice(name.length + 1);
      }
    }
  }
  return null;
}

async function pathExists(path) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function copyTree(sourceDir, destinationDir) {
  const entries = await readdir(sourceDir, { withFileTypes: true });
  await mkdir(destinationDir, { recursive: true });

  for (const entry of entries) {
    if (EXCLUDED_NAMES.has(entry.name) || entry.name.endsWith('.lock')) {
      continue;
    }

    const sourcePath = join(sourceDir, entry.name);
    const destinationPath = join(destinationDir, entry.name);

    if (await pathExists(destinationPath)) {
      continue;
    }

    if (entry.isDirectory()) {
      await copyTree(sourcePath, destinationPath);
      continue;
    }

    if (entry.isSymbolicLink()) {
      const target = await readlink(sourcePath);
      await symlink(target, destinationPath);
      continue;
    }

    if (entry.isFile()) {
      await copyFile(sourcePath, destinationPath);
    }
  }
}

const sourceDir =
  parseFlag(process.argv, ['--source', '-s']) ??
  process.env.CLAUDE_CODE_IMPORT_SOURCE_DIR ??
  LEGACY_CONFIG_DIR;

const destinationDir =
  parseFlag(process.argv, ['--dest', '--target', '-d']) ??
  process.env.CLAUDE_CODE_IMPORT_DEST_DIR ??
  DEFAULT_PRODUCT_DIR;

if (!(await pathExists(sourceDir))) {
  console.error(`No legacy config directory found at ${sourceDir}`);
  process.exit(1);
}

await copyTree(sourceDir, destinationDir);

console.log(`Imported legacy Claude config from ${sourceDir} to ${destinationDir}`);
