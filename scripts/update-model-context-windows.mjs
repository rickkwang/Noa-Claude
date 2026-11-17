const response = await fetch('https://models.dev/api.json', {
  signal: AbortSignal.timeout(15_000),
})
if (!response.ok) throw new Error(`Models.dev returned ${response.status}`)
const catalog = await response.json()
const snapshot = {}
for (const provider of ['openai', 'openrouter']) {
  const windows = Object.entries(catalog[provider].models)
    .flatMap(([id, { limit }]) => {
      if (!Number.isSafeInteger(limit?.context) || limit.context <= 0) return []
      const input = limit.input
      return [[id, Number.isSafeInteger(input) && input > 0
        ? Math.min(limit.context, input)
        : limit.context]]
    })
    .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
  if (windows.length === 0) throw new Error(`No context limits for ${provider}`)
  snapshot[provider] = Object.fromEntries(windows)
}
await Bun.write(new URL('../src/utils/model/modelContextWindows.json', import.meta.url),
  JSON.stringify(snapshot, null, 2) + '\n')
