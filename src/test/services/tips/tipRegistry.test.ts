import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getRelevantTips } from '../../../services/tips/tipRegistry.js'
import {
  getOriginalCwd,
  setFlagSettingsPath,
  setOriginalCwd,
} from '../../../bootstrap/state.js'
import { saveGlobalConfig } from '../../../utils/config.js'
import { getSettingsForSource } from '../../../utils/settings/settings.js'
import { resetSettingsCache } from '../../../utils/settings/settingsCache.js'

const originalConfigDir = process.env.CLAUDE_CONFIG_DIR
const originalCwd = getOriginalCwd()
const tempDirs: string[] = []

function freshDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

// Point user settings at a fresh config dir; returns the dir to write
// settings.json into.
function useConfigDir(): string {
  const dir = freshDir('noa-tips-config-')
  process.env.CLAUDE_CONFIG_DIR = dir
  return dir
}

function writeUserSettings(dir: string, settings: unknown): void {
  writeFileSync(join(dir, 'settings.json'), JSON.stringify(settings))
}

function writeProjectSettings(dir: string, settings: unknown): void {
  mkdirSync(join(dir, '.noa'), { recursive: true })
  writeFileSync(join(dir, '.noa', 'settings.json'), JSON.stringify(settings))
  setOriginalCwd(dir)
}

async function customTipContents(): Promise<string[]> {
  const tips = await getRelevantTips()
  return Promise.all(tips.map(t => t.content()))
}

beforeEach(() => {
  resetSettingsCache()
  saveGlobalConfig(c => ({ ...c, numStartups: 0, tipsHistory: {} }))
})

afterEach(() => {
  resetSettingsCache()
  setOriginalCwd(originalCwd)
  setFlagSettingsPath(undefined)
  if (originalConfigDir === undefined) {
    delete process.env.CLAUDE_CONFIG_DIR
  } else {
    process.env.CLAUDE_CONFIG_DIR = originalConfigDir
  }
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('spinnerTipsOverride via getRelevantTips', () => {
  test('bad object entries drop individually without taking the file down', async () => {
    const dir = useConfigDir()
    writeUserSettings(dir, {
      permissions: { allow: ['Bash(ls)'] },
      spinnerTipsOverride: {
        excludeDefault: true,
        tips: [
          'good string',
          { id: 'no-text' },
          { text: 'no id' },
          { id: 'bad id!', text: 'x' },
          { id: 'dup', text: 'first wins' },
          { id: 'dup', text: 'second drops' },
          { id: 'too-long', text: 'x'.repeat(501) },
        ],
      },
    })

    const contents = await customTipContents()
    expect(contents).toEqual(['good string', 'first wins'])

    // The loose schema is the whole point: a bad tip entry must not null out
    // the rest of the settings file.
    expect(
      getSettingsForSource('userSettings')?.permissions?.allow,
    ).toEqual(['Bash(ls)'])
  })

  test('tip text is folded to one line and stripped of control/format chars', async () => {
    const dir = useConfigDir()
    writeUserSettings(dir, {
      spinnerTipsOverride: {
        excludeDefault: true,
        // ESC starts an erase-line sequence; ZWSP is invisible.
        tips: ['line1\nline2\u001b[2K\u200b  end'],
      },
    })

    const [content] = await customTipContents()
    expect(content).not.toContain('\n')
    expect(content).not.toContain('\u001b')
    expect(content).not.toContain('\u200b')
    expect(content).not.toMatch(/ {2,}/)
    expect(content).toBe('line1 line2[2K end')
  })

  test('project settings may only contribute plain strings', async () => {
    useConfigDir()
    const projectDir = freshDir('noa-tips-project-')
    const tipsFile = join(projectDir, 'tips.json')
    writeFileSync(tipsFile, JSON.stringify(['from file']))
    writeProjectSettings(projectDir, {
      spinnerTipsOverride: {
        excludeDefault: true,
        label: 'EvilCorp: ',
        tips: [
          'project string',
          { id: 'project-obj', text: 'should be dropped' },
        ],
        tipsFile,
      },
    })

    // Object entries, tipsFile and label are user/managed/flag-only: a shared
    // repo must not brand tips or point the CLI at an arbitrary local file.
    const tips = await getRelevantTips()
    expect(tips.map(t => t.id)).toEqual([
      'org-tip:custom-tip-projectSettings-inline-0',
    ])
    expect(await customTipContents()).toEqual(['project string'])
  })
})
