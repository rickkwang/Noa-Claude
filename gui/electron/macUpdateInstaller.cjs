const fs = require('fs');
const https = require('https');
const path = require('path');
const { spawn } = require('child_process');
const { createHash, timingSafeEqual } = require('crypto');

const DOWNLOAD_IDLE_TIMEOUT_MS = 30000;
const GITHUB_OWNER = 'rickkwang';
const GITHUB_REPO = 'Noa-Claude';
const TRUSTED_HOSTS = new Set([
  'github.com',
  'api.github.com',
  'objects.githubusercontent.com',
  'github-releases.githubusercontent.com',
  'release-assets.githubusercontent.com',
]);

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'"'"'`)}'`;
}

function isTrustedUpdateUrl(urlString) {
  try {
    const parsed = new URL(urlString);
    return TRUSTED_HOSTS.has(parsed.hostname);
  } catch {
    return false;
  }
}

function getReleasePageUrl(version) {
  if (!version) return `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases`;
  return `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/tag/gui-v${version}`;
}

function getReleaseAssetUrl(version, assetName) {
  return `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/download/gui-v${encodeURIComponent(version)}/${encodeURIComponent(assetName)}`;
}

function normalizeSha512(value) {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const normalized = value.trim();
  const decoded = Buffer.from(normalized, 'base64');
  return decoded.length === 64 && decoded.toString('base64') === normalized ? decoded : null;
}

function resolveTrustedAssetUrl(version, candidate) {
  if (/^https?:\/\//i.test(candidate)) {
    return isTrustedUpdateUrl(candidate) ? candidate : null;
  }
  const assetName = path.posix.basename(candidate);
  return assetName.endsWith('.zip') ? getReleaseAssetUrl(version, assetName) : null;
}

function selectVerifiedUpdateAsset({ version, updateInfo }) {
  const candidates = [];
  for (const file of updateInfo?.files || []) {
    if (file?.url) candidates.push({ url: file.url, sha512: file.sha512 });
  }
  if (updateInfo?.path) {
    candidates.push({ url: updateInfo.path, sha512: updateInfo.sha512 });
  }

  for (const candidate of candidates) {
    if (typeof candidate.url !== 'string' || !candidate.url.endsWith('.zip')) continue;
    const url = resolveTrustedAssetUrl(version, candidate.url);
    const sha512 = normalizeSha512(candidate.sha512);
    if (url && sha512) return { url, sha512 };
  }

  throw new Error('Update metadata does not contain a trusted ZIP asset with a valid SHA-512 digest.');
}

function downloadFileWithProgress(sourceUrl, outputPath, onProgress) {
  return new Promise((resolve, reject) => {
    let resStream = null;
    let fileStream = null;

    const cleanup = () => {
      if (resStream) {
        resStream.removeAllListeners();
        resStream.resume();
        resStream = null;
      }
      if (fileStream) {
        fileStream.removeAllListeners();
        fileStream.destroy();
        fileStream = null;
      }
    };

    const request = (urlString, redirectCount = 0) => {
      if (!isTrustedUpdateUrl(urlString)) {
        reject(new Error('Blocked untrusted download URL.'));
        return;
      }

      const requestUrl = new URL(urlString);
      const req = https.get(requestUrl, (res) => {
        resStream = res;

        if (
          res.statusCode &&
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location
        ) {
          if (redirectCount >= 5) {
            cleanup();
            reject(new Error('Too many redirects while downloading update.'));
            return;
          }
          const redirectUrl = new URL(res.headers.location, requestUrl).toString();
          cleanup();
          request(redirectUrl, redirectCount + 1);
          return;
        }

        if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
          cleanup();
          reject(new Error(`Download failed with status ${res.statusCode || 'unknown'}`));
          return;
        }

        const total = Number(res.headers['content-length'] || 0);
        let downloaded = 0;
        fileStream = fs.createWriteStream(outputPath);

        res.on('data', (chunk) => {
          downloaded += chunk.length;
          if (typeof onProgress === 'function' && total > 0) {
            const percent = Math.max(1, Math.min(100, Math.round((downloaded / total) * 100)));
            onProgress(percent);
          }
        });

        res.on('error', () => {
          cleanup();
          reject(new Error('Download stream error.'));
        });

        fileStream.on('error', () => {
          cleanup();
          reject(new Error('File write error.'));
        });

        fileStream.on('finish', () => {
          fileStream.close(() => resolve(outputPath));
        });

        res.pipe(fileStream);
      });

      // A connection that goes quiet mid-download would otherwise hang the update forever.
      req.setTimeout(DOWNLOAD_IDLE_TIMEOUT_MS, () => req.destroy(new Error('Download stalled.')));
      req.on('error', (error) => {
        cleanup();
        reject(new Error(error?.message === 'Download stalled.' ? 'Download stalled. Check your connection and try again.' : 'Request failed.'));
      });
    };

    request(sourceUrl);
  });
}

function calculateFileSha512(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha512');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', () => reject(new Error('Unable to read the downloaded update for verification.')));
    stream.on('end', () => resolve(hash.digest()));
  });
}

async function verifyFileSha512(filePath, expectedDigest) {
  const expected = Buffer.isBuffer(expectedDigest)
    ? expectedDigest
    : normalizeSha512(expectedDigest);
  if (!expected) throw new Error('Update metadata contains an invalid SHA-512 digest.');
  const actual = await calculateFileSha512(filePath);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw new Error('Downloaded update failed SHA-512 verification.');
  }
}

// Runs ditto as a child process the main process does not wait on: unpacking takes several seconds,
// and a blocked main process stops delivering clicks and keys to the window.
function extractZipArchive(zipPath, extractDir) {
  return new Promise((resolve, reject) => {
    const child = spawn('/usr/bin/ditto', ['-x', '-k', zipPath, extractDir], { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || 'Unable to extract update package.'));
    });
  });
}

function findAppBundle(dir, appName) {
  const direct = path.join(dir, `${appName}.app`);
  if (fs.existsSync(direct)) return direct;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const entryPath = path.join(dir, entry.name);
    if (entry.name.endsWith('.app')) return entryPath;
    const nested = findAppBundle(entryPath, appName);
    if (nested) return nested;
  }
  return null;
}

function getCurrentAppBundlePath(app) {
  const executablePath = app.getPath('exe');
  return path.resolve(path.dirname(path.dirname(path.dirname(executablePath))));
}

function getInstallTargetAppPath(app) {
  const currentAppPath = getCurrentAppBundlePath(app);
  if (currentAppPath.includes('/AppTranslocation/')) {
    return path.join('/Applications', `${app.getName()}.app`);
  }
  if (currentAppPath.startsWith('/Applications/')) {
    return currentAppPath;
  }
  return currentAppPath;
}

function assertWritableInstallTarget(targetAppPath) {
  const parentDir = path.dirname(targetAppPath);
  try {
    fs.accessSync(parentDir, fs.constants.W_OK);
  } catch {
    throw new Error(
      `Install target is not writable: ${parentDir}. Move the app into /Applications and try again.`,
    );
  }
}

function buildInstallScript({ sourceAppPath, targetAppPath, backupAppPath, extractDir, zipPath, logPath, appPid, releasePageUrl }) {
  return `#!/bin/bash
set -euo pipefail

SOURCE_APP=${shellQuote(sourceAppPath)}
TARGET_APP=${shellQuote(targetAppPath)}
BACKUP_APP=${shellQuote(backupAppPath)}
EXTRACT_DIR=${shellQuote(extractDir)}
ZIP_PATH=${shellQuote(zipPath)}
LOG_FILE=${shellQuote(logPath)}
RELEASE_PAGE_URL=${shellQuote(releasePageUrl)}
APP_PID=${appPid}

exec >>"$LOG_FILE" 2>&1
echo "[noa-update] started at $(date)"

restore_backup() {
  if [ -d "$BACKUP_APP" ]; then
    if [ -d "$TARGET_APP" ]; then
      /bin/rm -rf "$TARGET_APP" || true
    fi
    mv "$BACKUP_APP" "$TARGET_APP" || true
  fi
}

on_error() {
  code=$?
  echo "[noa-update] failed with code $code"
  restore_backup
  /bin/rm -rf "$EXTRACT_DIR" "$ZIP_PATH" >/dev/null 2>&1 || true
  /usr/bin/open "$RELEASE_PAGE_URL" >/dev/null 2>&1 || true
  exit "$code"
}

trap on_error ERR

if [ ! -d "$SOURCE_APP" ]; then
  echo "[noa-update] source app missing"
  exit 11
fi

for _ in {1..150}; do
  if ! kill -0 "$APP_PID" >/dev/null 2>&1; then
    break
  fi
  sleep 0.2
done

if kill -0 "$APP_PID" >/dev/null 2>&1; then
  echo "[noa-update] app still running after timeout"
  exit 21
fi

if [ -d "$TARGET_APP" ]; then
  mv "$TARGET_APP" "$BACKUP_APP"
fi

/usr/bin/ditto "$SOURCE_APP" "$TARGET_APP"

if /usr/bin/open -a "$TARGET_APP"; then
  /bin/rm -rf "$BACKUP_APP" >/dev/null 2>&1 || true
  /bin/rm -rf "$EXTRACT_DIR" "$ZIP_PATH" >/dev/null 2>&1 || true
  echo "[noa-update] install completed"
else
  echo "[noa-update] unable to launch installed app"
  restore_backup
  /bin/rm -rf "$EXTRACT_DIR" "$ZIP_PATH" >/dev/null 2>&1 || true
  /usr/bin/open "$RELEASE_PAGE_URL" >/dev/null 2>&1 || true
  exit 31
fi
`;
}

function spawnDetachedInstallScript(scriptPath) {
  const child = spawn('/bin/bash', [scriptPath], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
}

// Verified downloads live here, one folder per version, so a restart does not download the update again.
function stagedUpdatesRoot(app) {
  return path.join(app.getPath('userData'), 'updates');
}

// Removes every staged update except keepVersion: superseded releases, or all of them once none is newer.
async function pruneStagedUpdates(app, keepVersion) {
  const root = stagedUpdatesRoot(app);
  if (!fs.existsSync(root)) return;
  for (const name of fs.readdirSync(root)) {
    if (name !== keepVersion) await fs.promises.rm(path.join(root, name), { recursive: true, force: true });
  }
}

// Downloads (or reuses an earlier verified download of) the update, verifies it and writes its install
// script. Nothing is replaced yet: call launch() once the app is quitting, so the script only starts
// after the quit is confirmed.
async function prepareMacUpdate({ app, updateInfo, onProgress }) {
  const version = updateInfo?.version || app.getVersion();
  const productName = app.getName();
  const releasePageUrl = getReleasePageUrl(version);
  const targetAppPath = getInstallTargetAppPath(app);
  assertWritableInstallTarget(targetAppPath);

  await pruneStagedUpdates(app, version);
  const workDir = path.join(stagedUpdatesRoot(app), version);
  const zipPath = path.join(workDir, 'update.zip');
  const extractDir = path.join(workDir, 'extracted');
  const logPath = path.join(workDir, 'install.log');

  let scriptPath = null;
  let sourceAppPath = null;
  // Any failure before the detached installer owns workDir must clean it up, so a bad download is not reused.
  try {
    fs.mkdirSync(workDir, { recursive: true });
    const updateAsset = selectVerifiedUpdateAsset({ version, updateInfo });
    // A zip left by an earlier session counts only if it still matches the release digest; a partial
    // download from a quit mid-way fails the check and is fetched again.
    const reusable = fs.existsSync(zipPath) && await verifyFileSha512(zipPath, updateAsset.sha512).then(() => true, () => false);
    if (reusable) {
      onProgress?.(100);
    } else {
      fs.rmSync(zipPath, { force: true });
      await downloadFileWithProgress(updateAsset.url, zipPath, onProgress);
      await verifyFileSha512(zipPath, updateAsset.sha512);
    }
    await fs.promises.rm(extractDir, { recursive: true, force: true });
    fs.mkdirSync(extractDir, { recursive: true });
    await extractZipArchive(zipPath, extractDir);

    sourceAppPath = findAppBundle(extractDir, productName);
    if (!sourceAppPath) {
      throw new Error(`Extracted update package does not contain ${productName}.app.`);
    }
    const backupAppPath = `${targetAppPath}.backup.${Date.now()}`;
    scriptPath = path.join(workDir, 'install.sh');
    fs.writeFileSync(
      scriptPath,
      buildInstallScript({
        sourceAppPath,
        targetAppPath,
        backupAppPath,
        extractDir,
        zipPath,
        logPath,
        appPid: process.pid,
        releasePageUrl,
      }),
      'utf8',
    );
    fs.chmodSync(scriptPath, 0o755);
  } catch (error) {
    await fs.promises.rm(workDir, { recursive: true, force: true });
    throw error;
  }

  return {
    version,
    logPath,
    // The install script stops without relaunching if the new app is gone, so check before quitting for it.
    isStaged: () => fs.existsSync(sourceAppPath) && fs.existsSync(scriptPath),
    launch: () => spawnDetachedInstallScript(scriptPath),
    // Not installed this session: drop the extracted app but keep the verified zip for the next launch.
    discard: () => fs.rmSync(extractDir, { recursive: true, force: true }),
  };
}

module.exports = {
  buildInstallScript,
  getReleasePageUrl,
  prepareMacUpdate,
  pruneStagedUpdates,
  normalizeSha512,
  selectVerifiedUpdateAsset,
  verifyFileSha512,
};
