import { afterAll, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ENV_KEYS = [
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_AUTH_TOKEN',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_USE_FOUNDRY',
  'CLAUDE_CODE_USE_OPENAI',
  'NOA_CLAUDE_SIMPLE_SYSTEM_PROMPT',
  'CLAUDE_CODE_SIMPLE_SYSTEM_PROMPT',
  'NOA_CLAUDE_THIRD_PARTY_PROMPT_POLICY',
  'CLAUDE_CODE_SIMPLE',
] as const

const isolatedConfigDir = mkdtempSync(join(tmpdir(), 'noa-prompt-budget-'))
// Two halves have to be isolated, not one. CLAUDE_CONFIG_DIR covers the user
// settings cascade; the project half (settings, skills, agents, output style)
// is keyed off cwd, so rendering from the repo root would count whatever
// .noa/settings*.json the developer happens to have as prompt growth.
//
// Out-of-process because the cwd seam is global mutable state: setCwdState /
// setOriginalCwd for the duration of this file poisons memoized git-root
// lookups for every test file that runs after it in the same bun process.
const isolatedProjectDir = mkdtempSync(join(tmpdir(), 'noa-prompt-budget-cwd-'))

afterAll(() => {
  rmSync(isolatedConfigDir, { recursive: true, force: true })
  rmSync(isolatedProjectDir, { recursive: true, force: true })
})

const RENDER_SCRIPT = `
const repo = process.env.NOA_PROMPT_BUDGET_REPO
globalThis.MACRO = {
  VERSION: '0',
  DISPLAY_VERSION: '0',
  BUILD_TIME: '',
  PACKAGE_URL: '',
}
const [
  { enableConfigs },
  { getAllBaseTools },
  { getDefaultAppState },
  { getSystemPrompt },
  { toolToAPISchema },
] = await Promise.all([
  import(repo + '/src/utils/config.js'),
  import(repo + '/src/tools.js'),
  import(repo + '/src/state/AppStateStore.js'),
  import(repo + '/src/constants/prompts.js'),
  import(repo + '/src/utils/api.js'),
])
enableConfigs()
const model = process.env.NOA_PROMPT_BUDGET_MODEL
const tools = getAllBaseTools().filter(tool => tool.name !== 'TestingPermission')
const permissionContext = getDefaultAppState().toolPermissionContext
const system = (await getSystemPrompt(tools, model)).join('\\n')
const schemas = await Promise.all(
  tools.map(tool =>
    toolToAPISchema(tool, {
      getToolPermissionContext: async () => permissionContext,
      tools,
      agents: [],
      model,
    }),
  ),
)
const toolJson = JSON.stringify(schemas)
console.log(JSON.stringify({
  system: system.length,
  tools: toolJson.length,
  total: system.length + toolJson.length,
}))
`

function render(
  model: string,
  baseUrl?: string,
): { system: number; tools: number; total: number } {
  const result = spawnSync('bun', ['--eval', RENDER_SCRIPT], {
    cwd: isolatedProjectDir,
    encoding: 'utf8',
    env: {
      ...process.env,
      ...Object.fromEntries(ENV_KEYS.map(key => [key, undefined])),
      CLAUDE_CONFIG_DIR: isolatedConfigDir,
      ANTHROPIC_API_KEY: 'sk-ant-test',
      ANTHROPIC_BASE_URL: baseUrl,
      NOA_PROMPT_BUDGET_REPO: process.cwd(),
      NOA_PROMPT_BUDGET_MODEL: model,
    } as NodeJS.ProcessEnv,
  })
  if (result.status !== 0) throw new Error(result.stderr)
  return JSON.parse(result.stdout)
}

test('base system prompt and built-in tool matrix stays within model-aware budgets', () => {
  const verbose = render('claude-sonnet-4-6')
  const lean = render('claude-opus-5')
  const thirdParty = render('claude-opus-5', 'https://third-party.invalid')
  expect(verbose.total).toBeLessThanOrEqual(130_000)
  expect(lean.total).toBeLessThanOrEqual(85_000)
  expect(thirdParty.total).toBeLessThanOrEqual(130_000)
  // Compression gates: tighter than the aggregate request caps so tool-schema
  // growth cannot hide prompt-text regressions.
  //
  // The verbose gate is a ratchet, not just a growth guard — it sits below the
  // pre-compression size, so restoring the old long-form text fails here on
  // purpose. If a bullet genuinely has to come back, cut elsewhere in the
  // verbose head rather than raising this number.
  expect(verbose.system).toBeLessThanOrEqual(23_000)
  expect(thirdParty.system).toBeLessThanOrEqual(23_000)
  // The lean gate is the opposite case and has far less headroom. The lean head
  // is a verbatim upstream port pinned by leanPromptPortIntegrity, so when an
  // upstream sync pushes it over this line, RAISE THIS NUMBER. Do not compress
  // the port to fit: that trades a byte count for port fidelity and breaks the
  // digest, which is the more expensive of the two.
  expect(lean.system).toBeLessThanOrEqual(13_100)
  expect(lean.total).toBeLessThan(verbose.total * 0.7)
  // Floors, because every gate above is an upper bound: a head that collapsed
  // to a fraction of itself passes all of them, so a section silently dropping
  // out of the assembly would read as a compression win. Set well below the
  // current sizes — these catch a missing section, not a further compression
  // pass.
  expect(verbose.system).toBeGreaterThan(14_000)
  expect(thirdParty.system).toBeGreaterThan(14_000)
  expect(lean.system).toBeGreaterThan(11_000)
})
