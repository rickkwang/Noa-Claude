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
  test('plain string tips from user settings join the rotation', async () => {
    const dir = useConfigDir()
    writeUserSettings(dir, {
      spinnerTipsOverride: {
        excludeDefault: true,
        tips: ['first tip', 'second tip'],
      },
    })

    const tips = await getRelevantTips()
    expect(tips.map(t => t.id)).toEqual([
      'org-tip:custom-tip-userSettings-inline-0',
      'org-tip:custom-tip-userSettings-inline-1',
    ])
    expect(await customTipContents()).toEqual(['first tip', 'second tip'])
  })

  test('object tips from user settings keep id, cooldown and priority', async () => {
    const dir = useConfigDir()
    writeUserSettings(dir, {
      spinnerTipsOverride: {
        excludeDefault: true,
        tips: [{ id: 'my-tip', text: 'hello', cooldownSessions: 5, priority: 2 }],
      },
    })

    const tips = await getRelevantTips()
    expect(tips).toHaveLength(1)
    expect(tips[0].id).toBe('org-tip:my-tip')
    expect(tips[0].cooldownSessions).toBe(5)
    expect(tips[0].priority).toBe(2)
    expect(await tips[0].content()).toBe('hello')
  })

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

  test('a non-numeric cooldownSessions/priority coerces to 0 instead of NaN', async () => {
    const dir = useConfigDir()
    writeUserSettings(dir, {
      spinnerTipsOverride: {
        excludeDefault: true,
        tips: [{ id: 'nan-tip', text: 'x', cooldownSessions: 'lots', priority: 'high' }],
      },
    })

    const tips = await getRelevantTips()
    expect(tips).toHaveLength(1)
    expect(tips[0].cooldownSessions).toBe(0)
    expect(tips[0].priority).toBe(0)
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

  test('label prefixes the tips declared alongside it', async () => {
    const dir = useConfigDir()
    writeUserSettings(dir, {
      spinnerTipsOverride: {
        excludeDefault: true,
        label: 'Acme: ',
        tips: ['tip one'],
      },
    })

    expect(await customTipContents()).toEqual(['Acme: tip one'])
  })

  test('label gets the same Unicode net as tip text', async () => {
    const dir = useConfigDir()
    writeUserSettings(dir, {
      spinnerTipsOverride: {
        excludeDefault: true,
        label: 'Ev\u200bal\nCo: ',
        tips: ['tip'],
      },
    })

    const [content] = await customTipContents()
    expect(content).toBe('Eval Co: tip')
  })

  test('an over-long label is truncated to 64 chars, not dropped', async () => {
    const dir = useConfigDir()
    writeUserSettings(dir, {
      spinnerTipsOverride: {
        excludeDefault: true,
        label: `${'L'.repeat(100)} `,
        tips: ['tip'],
      },
    })

    const [content] = await customTipContents()
    expect(content).toBe(`${'L'.repeat(64)} tip`)
  })

  test('cooldownSessions is enforced for custom tips', async () => {
    const dir = useConfigDir()
    writeUserSettings(dir, {
      spinnerTipsOverride: {
        excludeDefault: true,
        tips: [
          { id: 'cooled', text: 'recently shown', cooldownSessions: 5 },
          { id: 'ready', text: 'never shown' },
        ],
      },
    })
    saveGlobalConfig(c => ({
      ...c,
      numStartups: 10,
      tipsHistory: { 'org-tip:cooled': 10 },
    }))

    const tips = await getRelevantTips()
    expect(tips.map(t => t.id)).toEqual(['org-tip:ready'])
  })

  test('excludeDefault with every custom tip cooling down shows nothing', async () => {
    const dir = useConfigDir()
    writeUserSettings(dir, {
      spinnerTipsOverride: {
        excludeDefault: true,
        tips: [{ id: 'cooled', text: 'x', cooldownSessions: 5 }],
      },
    })
    saveGlobalConfig(c => ({
      ...c,
      numStartups: 10,
      tipsHistory: { 'org-tip:cooled': 10 },
    }))

    // Gated on "configured", not "eligible right now": no silent fallback to
    // built-in tips.
    expect(await getRelevantTips()).toEqual([])
  })

  test('tipsFile entries load with the file namespace', async () => {
    const dir = useConfigDir()
    const tipsFile = join(dir, 'tips.json')
    writeFileSync(
      tipsFile,
      JSON.stringify(['file string', { id: 'file-obj', text: 'file object' }]),
    )
    writeUserSettings(dir, {
      spinnerTipsOverride: {
        excludeDefault: true,
        tips: ['inline string'],
        tipsFile,
      },
    })

    const tips = await getRelevantTips()
    expect(tips.map(t => t.id)).toEqual([
      'org-tip:custom-tip-userSettings-inline-0',
      'org-tip:file:custom-tip-userSettings-file-0',
      'org-tip:file:file-obj',
    ])
    expect(await customTipContents()).toEqual([
      'inline string',
      'file string',
      'file object',
    ])
  })

  test('a missing tipsFile is a no-op, not an error', async () => {
    const dir = useConfigDir()
    writeUserSettings(dir, {
      spinnerTipsOverride: {
        excludeDefault: true,
        tips: ['inline'],
        tipsFile: join(dir, 'does-not-exist.json'),
      },
    })

    expect(await customTipContents()).toEqual(['inline'])
  })

  test('object tips from flag settings are honored (trusted source)', async () => {
    useConfigDir()
    const flagDir = freshDir('noa-tips-flag-')
    const flagPath = join(flagDir, 'flag-settings.json')
    writeFileSync(
      flagPath,
      JSON.stringify({
        spinnerTipsOverride: {
          excludeDefault: true,
          tips: [{ id: 'flag-tip', text: 'from flag' }],
        },
      }),
    )
    setFlagSettingsPath(flagPath)

    expect(await customTipContents()).toEqual(['from flag'])
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
