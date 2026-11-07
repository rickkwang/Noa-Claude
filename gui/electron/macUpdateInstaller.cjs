const fs = require('fs');
const https = require('https');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { createHash, timingSafeEqual } = require('crypto');

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

      req.on('error', () => {
        cleanup();
        reject(new Error('Request failed.'));
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

function extractZipArchive(zipPath, extractDir) {
  const result = spawnSync('/usr/bin/ditto', ['-x', '-k', zipPath, extractDir], {
    encoding: 'utf8',
  });

  if (result.status !== 0) {
    const errorText = (result.stderr || result.stdout || 'Unable to extract update package.').trim();
    throw new Error(errorText);
  }
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

async function installMacUpdate({ app, updateInfo, onProgress }) {
  const version = updateInfo?.version || app.getVersion();
  const productName = app.getName();
  const releasePageUrl = getReleasePageUrl(version);
  const targetAppPath = getInstallTargetAppPath(app);
  assertWritableInstallTarget(targetAppPath);

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'noa-update-'));
  const zipPath = path.join(workDir, 'update.zip');
  const extractDir = path.join(workDir, 'extracted');
  const logPath = path.join(workDir, 'install.log');

  // Any failure before the detached installer owns workDir must clean it up, or aborted updates accumulate in tmp.
  try {
    fs.mkdirSync(extractDir, { recursive: true });

    const updateAsset = selectVerifiedUpdateAsset({ version, updateInfo });
    await downloadFileWithProgress(updateAsset.url, zipPath, onProgress);
    await verifyFileSha512(zipPath, updateAsset.sha512);
    extractZipArchive(zipPath, extractDir);

    const sourceAppPath = findAppBundle(extractDir, productName);
    if (!sourceAppPath) {
      throw new Error(`Extracted update package does not contain ${productName}.app.`);
    }
    const backupAppPath = `${targetAppPath}.backup.${Date.now()}`;
    const scriptPath = path.join(workDir, 'install.sh');
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
    spawnDetachedInstallScript(scriptPath);
  } catch (error) {
    fs.rmSync(workDir, { recursive: true, force: true });
    throw error;
  }

  return {
    ok: true,
    reason: 'external-installer-started',
    message: `Downloaded v${version}. Restarting to install...`,
    version,
    logPath,
  };
}

module.exports = {
  buildInstallScript,
  getReleasePageUrl,
  installMacUpdate,
  normalizeSha512,
  selectVerifiedUpdateAsset,
  verifyFileSha512,
};
