// @ts-nocheck
/**
 * Ant-internal homespace data collection for /insights.
 * All functions are no-ops for non-ant users (USER_TYPE !== 'ant').
 */
import { constants as fsConstants } from 'fs'
import { copyFile, mkdir, mkdtemp, readdir, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { execFileNoThrow } from '../utils/execFileNoThrow.js'
import { jsonParse } from '../utils/slowOperations.js'

export type RemoteHostInfo = {
  name: string
  sessionCount: number
}

/* eslint-disable custom-rules/no-process-env-top-level */
export const getRunningRemoteHosts: () => Promise<string[]> =
  process.env.USER_TYPE === 'ant'
    ? async () => {
        const { stdout, code } = await execFileNoThrow(
          'coder',
          ['list', '-o', 'json'],
          { timeout: 30000 },
        )
        if (code !== 0) return []
        try {
          const workspaces = jsonParse(stdout) as Array<{
            name: string
            latest_build?: { status?: string }
          }>
          return workspaces
            .filter(w => w.latest_build?.status === 'running')
            .map(w => w.name)
        } catch {
          return []
        }
      }
    : async () => []

const getRemoteHostSessionCount: (hs: string) => Promise<number> =
  process.env.USER_TYPE === 'ant'
    ? async (homespace: string) => {
        const { stdout, code } = await execFileNoThrow(
          'ssh',
          [
            `${homespace}.coder`,
            'find /root/.claude-agent/projects -name "*.jsonl" 2>/dev/null | wc -l',
          ],
          { timeout: 30000 },
        )
        if (code !== 0) return 0
        return parseInt(stdout.trim(), 10) || 0
      }
    : async () => 0

const collectFromRemoteHost: (
  hs: string,
  destDir: string,
) => Promise<{ copied: number; skipped: number }> =
  process.env.USER_TYPE === 'ant'
    ? async (homespace: string, destDir: string) => {
        const result = { copied: 0, skipped: 0 }
        const tempDir = await mkdtemp(join(tmpdir(), 'claude-hs-'))
        try {
          const scpResult = await execFileNoThrow(
            'scp',
            ['-rq', `${homespace}.coder:/root/.claude-agent/projects/`, tempDir],
            { timeout: 300000 },
          )
          if (scpResult.code !== 0) return result

          const projectsDir = join(tempDir, 'projects')
          let projectDirents: Awaited<ReturnType<typeof readdir>>
          try {
            projectDirents = await readdir(projectsDir, { withFileTypes: true })
          } catch {
            return result
          }

          await Promise.all(
            projectDirents.map(async dirent => {
              if (!dirent.isDirectory()) return
              const projectPath = join(projectsDir, dirent.name)
              const destProjectPath = join(destDir, `${dirent.name}__${homespace}`)
              try {
                await mkdir(destProjectPath, { recursive: true })
              } catch {
                // Directory may already exist
              }
              let files: Awaited<ReturnType<typeof readdir>>
              try {
                files = await readdir(projectPath, { withFileTypes: true })
              } catch {
                return
              }
              await Promise.all(
                files.map(async fileDirent => {
                  if (!fileDirent.name.endsWith('.jsonl')) return
                  const srcFile = join(projectPath, fileDirent.name)
                  const destFile = join(destProjectPath, fileDirent.name)
                  try {
                    await copyFile(srcFile, destFile, fsConstants.COPYFILE_EXCL)
                    result.copied++
                  } catch {
                    result.skipped++
                  }
                }),
              )
            }),
          )
        } finally {
          try {
            await rm(tempDir, { recursive: true, force: true })
          } catch {
            // Ignore cleanup errors
          }
        }
        return result
      }
    : async () => ({ copied: 0, skipped: 0 })

export const collectAllRemoteHostData: (destDir: string) => Promise<{
  hosts: RemoteHostInfo[]
  totalCopied: number
  totalSkipped: number
}> =
  process.env.USER_TYPE === 'ant'
    ? async (destDir: string) => {
        const rHosts = await getRunningRemoteHosts()
        const result: RemoteHostInfo[] = []
        let totalCopied = 0
        let totalSkipped = 0

        const hostResults = await Promise.all(
          rHosts.map(async hs => {
            const sessionCount = await getRemoteHostSessionCount(hs)
            if (sessionCount > 0) {
              const { copied, skipped } = await collectFromRemoteHost(hs, destDir)
              return { name: hs, sessionCount, copied, skipped }
            }
            return { name: hs, sessionCount, copied: 0, skipped: 0 }
          }),
        )

        for (const hr of hostResults) {
          result.push({ name: hr.name, sessionCount: hr.sessionCount })
          totalCopied += hr.copied
          totalSkipped += hr.skipped
        }

        return { hosts: result, totalCopied, totalSkipped }
      }
    : async () => ({ hosts: [], totalCopied: 0, totalSkipped: 0 })
/* eslint-enable custom-rules/no-process-env-top-level */
