import type { ModelInfo } from "../agent/protocol"

// The agent reports full model IDs while the list can use family aliases.
export function findModel(models: ModelInfo[], model: string | undefined): ModelInfo | undefined {
  if (!model) return undefined
  const exact = models.find((m) => m.value === model)
  if (exact) return exact
  const family = model.match(/(?:^|[-/])(opus|sonnet|haiku|fable)(?:-|$)/)?.[1]
  return family ? models.find((m) => m.value === family || m.value === `${family}[1m]`) : undefined
}
