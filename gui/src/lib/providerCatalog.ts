// Provider types that can be set up with just an endpoint and a key. Sign-in based types stay in /login.
export interface CatalogEntry {
  type: string
  label: string
  baseUrl: string
  description: string
  // Local servers run without a key.
  keyless?: boolean
}

export const PROVIDER_CATALOG: CatalogEntry[] = [
  { type: "openai", label: "OpenAI", baseUrl: "https://api.openai.com/v1", description: "GPT models" },
  { type: "gemini", label: "Google Gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", description: "Gemini models" },
  { type: "deepseek", label: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", description: "DeepSeek V4 and reasoning models" },
  { type: "kimi", label: "Kimi Code", baseUrl: "https://api.kimi.com/coding", description: "Kimi coding plan" },
  { type: "moonshot", label: "Moonshot", baseUrl: "https://api.moonshot.cn/v1", description: "Kimi models through the open platform" },
  { type: "minimax", label: "MiniMax", baseUrl: "https://api.minimaxi.com/anthropic", description: "MiniMax M-series models" },
  { type: "glm", label: "Z.AI GLM", baseUrl: "https://open.bigmodel.cn/api/coding/paas/v4", description: "GLM coding plan" },
  { type: "mimo", label: "Xiaomi MiMo", baseUrl: "https://api.xiaomimimo.com/v1", description: "MiMo models" },
  { type: "mistral", label: "Mistral", baseUrl: "https://api.mistral.ai/v1", description: "Mistral and Codestral models" },
  { type: "groq", label: "Groq", baseUrl: "https://api.groq.com/openai/v1", description: "Fast hosted open models" },
  { type: "together", label: "Together AI", baseUrl: "https://api.together.xyz/v1", description: "Hosted open models" },
  { type: "openrouter", label: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", description: "One key for many providers" },
  { type: "github", label: "GitHub Models", baseUrl: "https://models.inference.ai.dev/api", description: "Models through a GitHub token" },
  { type: "azure-openai", label: "Azure OpenAI", baseUrl: "https://YOUR-RESOURCE.openai.azure.com/openai/deployments/YOUR-DEPLOYMENT", description: "Your own Azure deployment" },
  { type: "ollama", label: "Ollama", baseUrl: "http://localhost:11434/v1", description: "Models running on this computer", keyless: true },
  { type: "lmstudio", label: "LM Studio", baseUrl: "http://localhost:1234/v1", description: "Models running on this computer", keyless: true },
]

export interface ProviderDraft {
  id?: string
  type?: string
  name: string
  baseUrl: string
  apiKey: string
  model: string
}
