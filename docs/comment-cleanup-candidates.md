# 注释清理候选清单

由启发式提取 + 人工筛除生成。仅覆盖 `src/`。

> 2026-11-13：第 1 步已应用，62 条已删除；`typecheck` 与 `check:docs` 均通过。下方第 1 步表格为应用前记录，行号已失效。

## 第 1 步：高置信度删除（62 条）

下一行已完整表达注释含义，删除不损失信息。建议一次纯注释提交。

| # | 位置 | 注释 | 下一行 |
|---:|---|---|---|
| 1 | `src/Task.ts:108` | Task ID prefixes | `const TASK_ID_PREFIXES: Record<string, string> = {` |
| 2 | `src/bootstrap/state.ts:439` | Main thread agent type | `mainThreadAgentType: undefined,` |
| 3 | `src/bootstrap/state.ts:441` | Remote mode | `isRemoteMode: false,` |
| 4 | `src/bootstrap/state.ts:448` | Direct connect server URL | `directConnectServerUrl: undefined,` |
| 5 | `src/cli/handlers/plugins.ts:240` | plugin validate | `export async function pluginValidateHandler(` |
| 6 | `src/cli/handlers/util.tsx:51` | install handler | `export async function installHandler(target: string | undefined, options: {` |
| 7 | `src/cli/transports/WebSocketTransport.ts:386` | Unregister session activity callback | `unregisterSessionActivityCallback()` |
| 8 | `src/cli/transports/WebSocketTransport.ts:568` | Unregister session activity callback | `unregisterSessionActivityCallback()` |
| 9 | `src/commands/plugin/BrowseMarketplace.tsx:317` | Install selected plugins | `const installSelectedPlugins = async () => {` |
| 10 | `src/commands/plugin/DiscoverPlugins.tsx:128` | Empty state reason | `const [emptyReason, setEmptyReason] = useState<EmptyMarketplaceReason | null>(null);` |
| 11 | `src/commands/plugin/DiscoverPlugins.tsx:236` | Install selected plugins | `const installSelectedPlugins = async () => {` |
| 12 | `src/commands/plugin/ManagePlugins.tsx:819` | Sort standalone MCPs by name | `standaloneMcpsInScope.sort((a_1, b_1) => a_1.name.localeCompare(b_1.name));` |
| 13 | `src/commands/sandbox-toggle/sandbox-toggle.tsx:69` | Unknown subcommand | `const message = color('error', themeName)(`Error: Unknown subcommand "${subcommand}". Available` |
| 14 | `src/commands/security-review.ts:210` | Parse allowed tools from frontmatter | `const allowedTools = parseSlashCommandToolsFromFrontmatter(` |
| 15 | `src/components/ResumeTask.tsx:49` | Detect current repository | `const detectedRepo = await detectCurrentRepository();` |
| 16 | `src/components/Stats.tsx:1249` | Row 2: Sessions | Longest session | `lines.push(row('Sessions', formatNumber(stats.totalSessions), 'Longest session', stats.longestS` |
| 17 | `src/components/Stats.tsx:1299` | Fun factoid | `const factoid = generateFunFactoid(stats);` |
| 18 | `src/components/StatusLine.tsx:267` | Debounce timer ref | `const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);` |
| 19 | `src/components/mcp/MCPListPanel.tsx:78` | Group servers by scope | `function groupServersByScope(serverList: ServerInfo[]): Map<ConfigScope, ServerInfo[]> {` |
| 20 | `src/components/permissions/FilePermissionDialog/FilePermissionDialog.tsx:44` | IDE diff support | `ideDiffSupport?: IDEDiffSupport<T>;` |
| 21 | `src/hooks/useTypeahead.tsx:54` | No new suggestions | `if (newSuggestions.length === 0) {` |
| 22 | `src/ink/components/App.tsx:426` | Exit on Ctrl+C | `if (input === '\x03' && this.props.exitOnCtrlC) {` |
| 23 | `src/ink/ink.tsx:1627` | Show cursor | `writeSync(1, SHOW_CURSOR);` |
| 24 | `src/ink/layout/yoga.ts:81` | Layout | `calculateLayout(width?: number, _height?: number): void {` |
| 25 | `src/ink/termio.ts:24` | Parser | `export { Parser } from './termio/parser.js'` |
| 26 | `src/ink/termio/esc.ts:66` | Unknown | `return { type: 'unknown', sequence: `\x1b${chars}` }` |
| 27 | `src/keybindings/KeybindingProviderSetup.tsx:193` | Subscribe to changes | `const unsubscribe = subscribeToKeybindingChanges(result_0 => {` |
| 28 | `src/keybindings/loadUserBindings.ts:402` | Register cleanup | `registerCleanup(async () => disposeKeybindingWatcher())` |
| 29 | `src/main.tsx:2748` | Log model config at startup | `logEvent('tengu_startup_manual_model_config', {` |
| 30 | `src/native-ts/yoga-layout/index.ts:1355` | Resolve gap | `const gapMain = resolveGap(` |
| 31 | `src/state/AppStateStore.ts:389` | Fast mode | `fastMode?: boolean` |
| 32 | `src/tasks/LocalAgentTask/LocalAgentTask.tsx:721` | Register task in AppState | `registerTask(taskState, setAppState);` |
| 33 | `src/tools/BashTool/readOnlyValidation.ts:395` | Buffer size | `'--buffer-size': 'string',` |
| 34 | `src/tools/BashTool/readOnlyValidation.ts:400` | Batch size | `'--batch-size': 'number',` |
| 35 | `src/tools/LSPTool/formatters.ts:403` | Group by file | `const byFile = groupByFile(validSymbols, cwd)` |
| 36 | `src/types/hooks.ts:44` | Sync hook response schema | `export const syncHookResponseSchema = lazySchema(() =>` |
| 37 | `src/types/hooks.ts:166` | Async hook response schema | `const asyncHookResponseSchema = z.object({` |
| 38 | `src/utils/agenticSessionSearch.ts:211` | Tag | `if (log.tag) {` |
| 39 | `src/utils/agenticSessionSearch.ts:216` | Git branch | `if (log.gitBranch) {` |
| 40 | `src/utils/agenticSessionSearch.ts:221` | Summary | `if (log.summary) {` |
| 41 | `src/utils/ansiToPng.ts:308` | IHDR | `const ihdr = Buffer.alloc(13)` |
| 42 | `src/utils/context.ts:25` | Default max output tokens | `const MAX_OUTPUT_TOKENS_DEFAULT = 32_000` |
| 43 | `src/utils/conversationRecovery.ts:701` | Copy file history for resume | `void copyFileHistoryForResume(log)` |
| 44 | `src/utils/gracefulShutdown.ts:131` | Show cursor | `writeSync(1, SHOW_CURSOR)` |
| 45 | `src/utils/headlessProfiler.ts:139` | Time to query start | `const queryStartTime = checkpointTimes.get('query_started')` |
| 46 | `src/utils/heatmap.ts:141` | Day labels | `const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']` |
| 47 | `src/utils/hooks/execAgentHook.ts:289` | Condition was met | `logForDebugging(`Hooks: Agent hook condition was met`)` |
| 48 | `src/utils/hooks/execPromptHook.ts:171` | Condition was met | `logForDebugging(`Hooks: Prompt hook condition was met`)` |
| 49 | `src/utils/hooks/hooksConfigManager.ts:270` | Group hooks by event and matcher | `export function groupHooksByEventAndMatcher(` |
| 50 | `src/utils/mtls.ts:47` | Client key | `if (process.env.CLAUDE_CODE_CLIENT_KEY) {` |
| 51 | `src/utils/mtls.ts:62` | Key passphrase | `if (process.env.CLAUDE_CODE_CLIENT_KEY_PASSPHRASE) {` |
| 52 | `src/utils/nativeInstaller/installer.ts:130` | User bin | `executable: join(getUserBinDir(), executableName),` |
| 53 | `src/utils/permissions/permissionSetup.ts:976` | Load all permission rules from disk | `const rulesFromDisk = loadAllPermissionRulesFromDisk()` |
| 54 | `src/utils/plugins/lspRecommendation.ts:238` | Get all LSP plugins from marketplaces | `const allLspPlugins = await getLspPluginsFromMarketplaces()` |
| 55 | `src/utils/plugins/mcpbHandler.ts:822` | Generate content hash | `const contentHash = generateContentHash(mcpbData)` |
| 56 | `src/utils/promptEditor.ts:151` | Write expanded prompt to temp file | `writeFileSync_DEPRECATED(tempFile, expandedPrompt, {` |
| 57 | `src/utils/shell/readOnlyCommandValidation.ts:666` | Context | `'-A': 'number', // After context` |
| 58 | `src/utils/shell/readOnlyCommandValidation.ts:683` | Threads | `'--threads': 'number',` |
| 59 | `src/utils/stats.ts:835` | Peak activity day | `const peakActivityDay =` |
| 60 | `src/utils/swarm/spawnInProcess.ts:190` | Register task in AppState | `registerTask(taskState, setAppState)` |
| 61 | `src/utils/teleport.tsx:222` | Upstream is already set | `logForDebugging(`Branch '${branchName}' already has upstream set`);` |
| 62 | `src/utils/toolResultStorage.ts:179` | Generate a preview | `const { preview, hasMore } = generatePreview(contentStr, PREVIEW_SIZE_BYTES)` |

## 待定：分组/导航标签（47 条，建议保留或整体重构）

这些注释标的是一个代码块或一组声明，不是单行复述；单独删会破坏分组。行号已按清理后的工作区更新。

| # | 位置 | 注释 | 下一行 |
|---:|---|---|---|
| 1 | `src/commands/plugin/BrowseMarketplace.tsx:61` | View state | `const [viewState, setViewState] = useState<ViewState>('marketplace-list');` |
| 2 | `src/commands/plugin/BrowseMarketplace.tsx:636` | Plugin details view | `if (viewState === 'plugin-details' && selectedPlugin) {` |
| 3 | `src/commands/plugin/DiscoverPlugins.tsx:61` | View state | `const [viewState, setViewState] = useState<ViewState>('plugin-list');` |
| 4 | `src/commands/plugin/DiscoverPlugins.tsx:70` | Search state | `const [isSearchMode, setIsSearchModeRaw] = useState(false);` |
| 5 | `src/commands/plugin/DiscoverPlugins.tsx:515` | Plugin details view | `if (viewState === 'plugin-details' && selectedPlugin) {` |
| 6 | `src/commands/plugin/ManagePlugins.tsx:417` | Search state | `const [isSearchMode, setIsSearchModeRaw] = useState(false);` |
| 7 | `src/commands/plugin/ManagePlugins.tsx:428` | View state | `const [viewState, setViewState] = useState<ViewState>('plugin-list');` |
| 8 | `src/commands/plugin/ManagePlugins.tsx:1997` | Plugin details view | `if (viewState === 'plugin-details' && selectedPlugin) {` |
| 9 | `src/commands/plugin/ManagePlugins.tsx:2135` | MCP detail view | `if (typeof viewState === 'object' && viewState.type === 'mcp-detail') {` |
| 10 | `src/commands/plugin/ManagePlugins.tsx:2206` | MCP tools view | `if (typeof viewState === 'object' && viewState.type === 'mcp-tools') {` |
| 11 | `src/commands/plugin/ManagePlugins.tsx:2262` | MCP tool detail view | `if (typeof viewState === 'object' && viewState.type === 'mcp-tool-detail') {` |
| 12 | `src/components/ManagedSettingsSecurityDialog/utils.ts:138` | Hooks | `if (dangerous.hasHooks) {` |
| 13 | `src/main.tsx:3793` | Plugin list command | `pluginCmd.command('list').description('List installed plugins').option('--json', 'Output as JSO` |
| 14 | `src/main.tsx:3843` | Plugin install command | `pluginCmd.command('install <plugin>').alias('i').description('Install a plugin from available m` |
| 15 | `src/main.tsx:3854` | Plugin uninstall command | `pluginCmd.command('uninstall <plugin>').alias('remove').alias('rm').description('Uninstall an i` |
| 16 | `src/main.tsx:3866` | Plugin enable command | `pluginCmd.command('enable <plugin>').description('Enable a disabled plugin').option('-s, --scop` |
| 17 | `src/main.tsx:3877` | Plugin disable command | `pluginCmd.command('disable [plugin]').description('Disable an enabled plugin').option('-a, --al` |
| 18 | `src/main.tsx:3889` | Plugin update command | `pluginCmd.command('update <plugin>').description('Update a plugin to the latest version (restar` |
| 19 | `src/main.tsx:3901` | Setup token command | `program.command('setup-token').description('Set up a long-lived authentication token (requires ` |
| 20 | `src/main.tsx:4063` | Doctor command - check installation health | `program.command('doctor').description('Check the health of your Noa Claude installation and set` |
| 21 | `src/main.tsx:4131` | noa install | `program.command('install [target]').description('Show Noa Claude reinstall instructions. Use [t` |
| 22 | `src/screens/REPL.tsx:826` | notifications | `useModelMigrationNotifications();` |
| 23 | `src/screens/REPL.tsx:2133` | Auto-run /issue state | `const [autoRunIssueReason, setAutoRunIssueReason] = useState<AutoRunIssueReason | null>(null);` |
| 24 | `src/tools/AgentTool/built-in/claudeCodeGuideAgent.ts:156` | 4. Plugin commands | `const pluginCommands = commands.filter(` |
| 25 | `src/tools/MCPTool/classifyForCollapse.ts:73` | Brave Search | `'brave_web_search',` |
| 26 | `src/tools/MCPTool/classifyForCollapse.ts:85` | Stripe | `'search_stripe_resources',` |
| 27 | `src/tools/MCPTool/classifyForCollapse.ts:98` | Firecrawl | `'firecrawl_search',` |
| 28 | `src/tools/MCPTool/classifyForCollapse.ts:100` | Exa | `'web_search_exa',` |
| 29 | `src/tools/MCPTool/classifyForCollapse.ts:106` | Perplexity | `'perplexity_search',` |
| 30 | `src/tools/MCPTool/classifyForCollapse.ts:109` | Tavily | `'tavily_search',` |
| 31 | `src/tools/MCPTool/classifyForCollapse.ts:477` | Firecrawl | `'firecrawl_scrape',` |
| 32 | `src/tools/MCPTool/classifyForCollapse.ts:483` | Exa | `'get_code_context_exa',` |
| 33 | `src/tools/MCPTool/classifyForCollapse.ts:488` | Perplexity | `'perplexity_ask',` |
| 34 | `src/tools/MCPTool/classifyForCollapse.ts:492` | Tavily | `'tavily_extract',` |
| 35 | `src/tools/MCPTool/classifyForCollapse.ts:536` | Neo4j | `'get_neo4j_schema',` |
| 36 | `src/utils/claudemd.ts:160` | Swift | `'.swift',` |
| 37 | `src/utils/forkedAgent.ts:438` | AbortController | `abortController,` |
| 38 | `src/utils/forkedAgent.ts:758` | Query tracking | `...(queryTracking` |
| 39 | `src/utils/powershell/parser.ts:1334` | Content | `cat: 'Get-Content',` |
| 40 | `src/utils/powershell/parser.ts:1371` | Process | `ps: 'Get-Process',` |
| 41 | `src/utils/powershell/parser.ts:1380` | Output | `echo: 'Write-Output',` |
| 42 | `src/utils/powershell/parser.ts:1384` | Help | `help: 'Get-Help',` |
| 43 | `src/utils/powershell/parser.ts:1388` | Service | `gsv: 'Get-Service',` |
| 44 | `src/utils/powershell/parser.ts:1393` | History | `h: 'Get-History',` |
| 45 | `src/utils/powershell/parser.ts:1396` | Invoke | `iex: 'Invoke-Expression',` |
| 46 | `src/utils/stats.ts:63` | Streaks | `streaks: StreakInfo` |
| 47 | `src/utils/stats.ts:84` | Speculation time saved | `totalSpeculationTimeSavedMs: number` |

## 附录：重构候选（长函数编号步骤，不直接删）

这些编号注释编码了权限判定顺序或初始化顺序。先抽函数并加测试，再删注释。

共 58 条，分布在 17 个文件。

### `src/bridge/initReplBridge.ts`（1 条）

- `src/bridge/initReplBridge.ts:134` 1. Runtime gate → `if (!(await isBridgeEnabledBlocking())) {`（外围 `initReplBridge`）

### `src/bridge/replBridge.ts`（2 条）

- `src/bridge/replBridge.ts:319` 5. Register bridge environment → `const rawApi = createBridgeApiClient({`（外围 `initBridgeCore`）
- `src/bridge/replBridge.ts:1671` 8. Register cleanup for graceful shutdown → `const unregister = registerCleanup(() => doTeardownImpl?.())`（外围 `initBridgeCore`）

### `src/services/lsp/LSPClient.ts`（5 条）

- `src/services/lsp/LSPClient.ts:98` 1. Spawn LSP server process → `process = spawn(command, args, {`（外围 `createLSPClient`）
- `src/services/lsp/LSPClient.ts:181` 2. Create JSON-RPC connection → `const reader = new StreamMessageReader(process.stdout)`（外围 `createLSPClient`）
- `src/services/lsp/LSPClient.ts:210` 3. Start listening for messages → `connection.listen()`（外围 `createLSPClient`）
- `src/services/lsp/LSPClient.ts:229` 4. Apply any queued notification handlers → `for (const { method, handler } of pendingHandlers) {`（外围 `createLSPClient`）
- `src/services/lsp/LSPClient.ts:238` 5. Apply any queued request handlers → `for (const { method, handler } of pendingRequestHandlers) {`（外围 `createLSPClient`）

### `src/test/utils/effort.test.ts`（1 条）

- `src/test/utils/effort.test.ts:60` 4.8 supports xhigh/max as opt-in levels... → `expect(getSupportedEffortLevelsForModel('claude-opus-4-8')).toEqual([`（外围 `resetEnv`）

### `src/tools/AgentTool/built-in/claudeCodeGuideAgent.ts`（5 条）

- `src/tools/AgentTool/built-in/claudeCodeGuideAgent.ts:122` 1. Custom skills → `const customCommands = commands.filter(cmd => cmd.type === 'prompt')`（外围 `getFeedbackGuideline`）
- `src/tools/AgentTool/built-in/claudeCodeGuideAgent.ts:133` 2. Custom agents from .noa/agents/ → `const customAgents =`（外围 `getFeedbackGuideline`）
- `src/tools/AgentTool/built-in/claudeCodeGuideAgent.ts:147` 3. MCP servers → `const mcpClients = toolUseContext.options.mcpClients`（外围 `getFeedbackGuideline`）
- `src/tools/AgentTool/built-in/claudeCodeGuideAgent.ts:156` 4. Plugin commands → `const pluginCommands = commands.filter(`（外围 `getFeedbackGuideline`）
- `src/tools/AgentTool/built-in/claudeCodeGuideAgent.ts:167` 5. User settings → `const settings = getSettings_DEPRECATED()`（外围 `getFeedbackGuideline`）

### `src/tools/BashTool/bashPermissions.ts`（3 条）

- `src/tools/BashTool/bashPermissions.ts:1062` 1. Check exact match first → `const exactMatchResult = bashToolCheckExactMatchPermission(`（外围 `bashToolCheckPermission`）
- `src/tools/BashTool/bashPermissions.ts:1149` 5. Allow if command has an allow rule → `if (matchingAllowRules[0] !== undefined) {`（外围 `bashToolCheckPermission`）
- `src/tools/BashTool/bashPermissions.ts:1171` 6. Check for mode-specific permission handling → `const modeResult = checkPermissionMode(input, toolPermissionContext)`（外围 `bashToolCheckPermission`）

### `src/tools/ConfigTool/ConfigTool.ts`（2 条）

- `src/tools/ConfigTool/ConfigTool.ts:136` 2. GET operation → `if (value === undefined) {`（外围 `?`）
- `src/tools/ConfigTool/ConfigTool.ts:312` 4. Write to storage → `try {`（外围 `?`）

### `src/tools/FileEditTool/FileEditTool.ts`（7 条）

- `src/tools/FileEditTool/FileEditTool.ts:439` 1. Get current state → `const fs = getFsImplementation()`（外围 `?`）
- `src/tools/FileEditTool/FileEditTool.ts:516` 3. Use findActualString to handle quote normalization → `const actualOldString =`（外围 `?`）
- `src/tools/FileEditTool/FileEditTool.ts:527` 4. Generate patch → `const { patch, updatedFile } = getPatchForEdit({`（外围 `?`）
- `src/tools/FileEditTool/FileEditTool.ts:536` 5. Write to disk → `const writtenAt = writeTextContent(`（外围 `?`）
- `src/tools/FileEditTool/FileEditTool.ts:570` 6. Update read timestamp, to invalidate stale writes → `readFileState.set(absoluteFilePath, {`（外围 `?`）
- `src/tools/FileEditTool/FileEditTool.ts:578` 7. Log events → `if (absoluteFilePath.endsWith(`${sep}CLAUDE.md`)) {`（外围 `?`）
- `src/tools/FileEditTool/FileEditTool.ts:611` 8. Yield result → `const data = {`（外围 `?`）

### `src/tools/PowerShellTool/pathValidation.ts`（5 条）

- `src/tools/PowerShellTool/pathValidation.ts:872` 1. Check deny rules first → `const denyRule = matchingRuleForInput(`（外围 `isPathAllowed`）
- `src/tools/PowerShellTool/pathValidation.ts:900` 2.5. For write/create operations, check safety validations → `if (operationType !== 'read') {`（外围 `isPathAllowed`）
- `src/tools/PowerShellTool/pathValidation.ts:930` 3.5. For read operations, check internal readable paths → `if (operationType === 'read') {`（外围 `isPathAllowed`）
- `src/tools/PowerShellTool/pathValidation.ts:962` 4. Check allow rules → `const allowRule = matchingRuleForInput(`（外围 `isPathAllowed`）
- `src/tools/PowerShellTool/pathValidation.ts:976` 5. Path is not allowed → `return { allowed: false }`（外围 `isPathAllowed`）

### `src/tools/PowerShellTool/powershellPermissions.ts`（5 条）

- `src/tools/PowerShellTool/powershellPermissions.ts:442` 1. Check exact match first → `const exactMatchResult = powershellToolCheckExactMatchPermission(`（外围 `powershellToolCheckPermission`）
- `src/tools/PowerShellTool/powershellPermissions.ts:456` 2. Find all matching rules (prefix or exact) → `const { matchingDenyRules, matchingAskRules, matchingAllowRules } =`（外围 `powershellToolCheckPermission`）
- `src/tools/PowerShellTool/powershellPermissions.ts:489` 4. Allow if command has an allow rule → `if (matchingAllowRules[0] !== undefined) {`（外围 `powershellToolCheckPermission`）
- `src/tools/PowerShellTool/powershellPermissions.ts:676` 2. Check prefix/wildcard rules → `const { matchingDenyRules, matchingAskRules } = matchingRulesForInput(`（外围 `powershellToolHasPermission`）
- `src/tools/PowerShellTool/powershellPermissions.ts:1629` 6. Some sub-commands need approval — build suggestions → `const decisionReason = {`（外围 `powershellToolHasPermission`）

### `src/utils/bash/commands.ts`（2 条）

- `src/utils/bash/commands.ts:172` 1. Collapse adjacent strings and globs → `for (const part of parsed) {`（外围 `splitCommandWithOperators`）
- `src/utils/bash/commands.ts:194` 2. Map tokens to strings → `const stringParts = parts`（外围 `splitCommandWithOperators`）

### `src/utils/permissions/filesystem.ts`（4 条）

- `src/utils/permissions/filesystem.ts:1307` 6. Allow reads in working directories → `const isInWorkingDir = pathInAllowedWorkingPath(`（外围 `checkReadPermissionForTool`）
- `src/utils/permissions/filesystem.ts:1331` 8. Check for allow rules → `const allowRule = matchingRuleForInput(`（外围 `checkReadPermissionForTool`）
- `src/utils/permissions/filesystem.ts:1567` 4. Check for allow rules → `const allowRule = matchingRuleForInput(`（外围 `checkWritePermissionForTool`）
- `src/utils/permissions/filesystem.ts:1585` 5. Default to asking for permission → `return {`（外围 `checkWritePermissionForTool`）

### `src/utils/permissions/pathValidation.ts`（3 条）

- `src/utils/permissions/pathValidation.ts:156` 1. Check deny rules first (they take precedence) → `const denyRule = matchingRuleForInput(`（外围 `isPathAllowed`）
- `src/utils/permissions/pathValidation.ts:253` 4. Check allow rules for the operation type → `const allowRule = matchingRuleForInput(`（外围 `isPathAllowed`）
- `src/utils/permissions/pathValidation.ts:267` 5. Path is not allowed → `return { allowed: false, isInWorkingDir }`（外围 `isPathAllowed`）

### `src/utils/permissions/permissions.ts`（1 条）

- `src/utils/permissions/permissions.ts:1620` 3. Convert "passthrough" to "ask" → `const result: PermissionDecision =`（外围 `hasPermissionsToUseToolInner`）

### `src/utils/plugins/installedPluginsManager.ts`（1 条）

- `src/utils/plugins/installedPluginsManager.ts:1071` Step 4: Save to single file (V2 format) → `if (!fileExists || updatedCount > 0 || addedCount > 0) {`（外围 `migrateFromEnabledPlugins`）

### `src/utils/plugins/pluginLoader.ts`（9 条）

- `src/utils/plugins/pluginLoader.ts:1442` Step 3a: Process additional command paths from manifest → `if (manifest.commands) {`（外围 `createPluginFromPath`）
- `src/utils/plugins/pluginLoader.ts:1578` Step 4: Register agents directory if detected → `const agentsPath = join(pluginPath, 'agents')`（外围 `createPluginFromPath`）
- `src/utils/plugins/pluginLoader.ts:1584` Step 4a: Process additional agent paths from manifest → `if (manifest.agents) {`（外围 `createPluginFromPath`）
- `src/utils/plugins/pluginLoader.ts:1606` Step 4b: Register skills directory if detected → `const skillsPath = join(pluginPath, 'skills')`（外围 `createPluginFromPath`）
- `src/utils/plugins/pluginLoader.ts:1612` Step 4c: Process additional skill paths from manifest → `if (manifest.skills) {`（外围 `createPluginFromPath`）
- `src/utils/plugins/pluginLoader.ts:1634` Step 4d: Register output-styles directory if detected → `const outputStylesPath = join(pluginPath, 'output-styles')`（外围 `createPluginFromPath`）
- `src/utils/plugins/pluginLoader.ts:1664` Step 4f: Register themes directory if detected → `const themesPath = join(pluginPath, 'themes')`（外围 `createPluginFromPath`）
- `src/utils/plugins/pluginLoader.ts:1670` Step 4g: Process additional theme paths from manifest → `const manifestThemes = manifest.experimental?.themes ?? manifest.themes`（外围 `createPluginFromPath`）
- `src/utils/plugins/pluginLoader.ts:1693` Step 5: Load hooks configuration → `let mergedHooks: HooksSettings | undefined`（外围 `createPluginFromPath`）

### `src/utils/settings/settings.ts`（2 条）

- `src/utils/settings/settings.ts:946` 1. Remote (highest priority) → `const remoteSettings = getRemoteManagedSettingsSyncFromCache()`（外围 `loadSettingsFromDisk`）
- `src/utils/settings/settings.ts:969` 3. managed-settings.json + managed-settings.d/ (file-based, requires admin) → `if (!policySettings) {`（外围 `loadSettingsFromDisk`）

## 未列入

- CIDR 网段说明（`src/utils/ssrf.ts`、`src/utils/hooks/ssrfGuard.ts`）：代码无法自解释网段，保留。
- 类型契约、时序语义、条件说明：`src/tools/LSPTool/LSPTool.ts:364`、`src/hooks/useDoublePress.ts:44`、`src/cli/handlers/mcp.tsx:175`。
- 表/列表分组：`src/ink/termio/csi.ts:71,82,90`、`src/query/deps.ts:20,27`。
- 空 `//` 行 471 条：多行注释的段落间隔，保留。
- 小文件分隔线 71 条：纯装饰，留待格式化时统一处理。
