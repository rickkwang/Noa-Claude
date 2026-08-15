import { afterAll, beforeAll, expect, test } from 'bun:test'
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
  'CLAUDE_CONFIG_DIR',
] as const
const originalEnv = Object.fromEntries(
  ENV_KEYS.map(key => [key, process.env[key]]),
)
const originalApiKey = process.env.ANTHROPIC_API_KEY
const isolatedConfigDir = mkdtempSync(join(tmpdir(), 'noa-prompt-budget-'))
type MacroGlobals = typeof globalThis & {
  MACRO?: {
    VERSION: string
    DISPLAY_VERSION: string
    BUILD_TIME: string
    PACKAGE_URL: string
  }
}
const globals = globalThis as MacroGlobals
const originalMacro = globals.MACRO

beforeAll(() => {
  for (const key of ENV_KEYS) delete process.env[key]
  process.env.ANTHROPIC_API_KEY = 'sk-ant-test'
  process.env.CLAUDE_CONFIG_DIR = isolatedConfigDir
})

afterAll(() => {
  for (const key of ENV_KEYS) {
    const value = originalEnv[key]
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  if (originalApiKey === undefined) delete process.env.ANTHROPIC_API_KEY
  else process.env.ANTHROPIC_API_KEY = originalApiKey
  if (originalMacro === undefined) delete globals.MACRO
  else globals.MACRO = originalMacro
  rmSync(isolatedConfigDir, { recursive: true, force: true })
})

async function render(model: string, baseUrl?: string) {
  if (baseUrl) process.env.ANTHROPIC_BASE_URL = baseUrl
  else delete process.env.ANTHROPIC_BASE_URL
  globals.MACRO ??= {
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
    { clearSystemPromptSections },
    { toolToAPISchema },
    { clearToolSchemaCache },
  ] = await Promise.all([
    import('../../utils/config.js'),
    import('../../tools.js'),
    import('../../state/AppStateStore.js'),
    import('../../constants/prompts.js'),
    import('../../constants/systemPromptSections.js'),
    import('../../utils/api.js'),
    import('../../utils/toolSchemaCache.js'),
  ])
  enableConfigs()
  clearSystemPromptSections()
  clearToolSchemaCache()
  const tools = getAllBaseTools().filter(tool => tool.name !== 'TestingPermission')
  const permissionContext = getDefaultAppState().toolPermissionContext
  const system = (await getSystemPrompt(tools, model)).join('\n')
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
  const budget = {
    system: system.length,
    tools: toolJson.length,
    total: system.length + toolJson.length,
  }
  clearSystemPromptSections()
  clearToolSchemaCache()
  return budget
}

test('base system prompt and built-in tool matrix stays within model-aware budgets', async () => {
  const verbose = await render('claude-sonnet-4-6')
  const lean = await render('claude-opus-5')
  const thirdParty = await render('claude-opus-5', 'https://third-party.invalid')
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
})
