// Provider types that can be set up with just an endpoint and a key. Sign-in based types stay in /login.
interface CatalogEntry {
  type: string
  label: string
  baseUrl: string
  // The CLI preset's default model; empty where the user must name their own (an Azure deployment).
  model: string
  description: string
  // Local servers run without a key.
  keyless?: boolean
}

export const PROVIDER_CATALOG: CatalogEntry[] = [
  { type: "openai", label: "OpenAI", baseUrl: "https://api.openai.com/v1", model: "gpt-4o", description: "GPT models" },
  { type: "gemini", label: "Google Gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", model: "gemini-2.5-pro", description: "Gemini models" },
  { type: "deepseek", label: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", model: "deepseek-flash", description: "DeepSeek V4 and reasoning models" },
  { type: "kimi", label: "Kimi Code", baseUrl: "https://api.kimi.com/coding", model: "kimi-for-coding", description: "Kimi coding plan" },
  { type: "moonshot", label: "Moonshot", baseUrl: "https://api.moonshot.cn/v1", model: "kimi-k2.6", description: "Kimi models through the open platform" },
  { type: "minimax", label: "MiniMax", baseUrl: "https://api.minimaxi.com/anthropic", model: "MiniMax-M2.7", description: "MiniMax M-series models" },
  { type: "glm", label: "Z.AI GLM", baseUrl: "https://open.bigmodel.cn/api/coding/paas/v4", model: "glm-5.3", description: "GLM coding plan" },
  { type: "mimo", label: "Xiaomi MiMo", baseUrl: "https://api.xiaomimimo.com/v1", model: "mimo-v2.5-pro", description: "MiMo models" },
  { type: "mistral", label: "Mistral", baseUrl: "https://api.mistral.ai/v1", model: "mistral-large-latest", description: "Mistral and Codestral models" },
  { type: "groq", label: "Groq", baseUrl: "https://api.groq.com/openai/v1", model: "llama-3.3-70b-versatile", description: "Fast hosted open models" },
  { type: "together", label: "Together AI", baseUrl: "https://api.together.xyz/v1", model: "meta-llama/Llama-3.3-70B-Instruct-Turbo", description: "Hosted open models" },
  { type: "openrouter", label: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", model: "openrouter/auto", description: "One key for many providers" },
  { type: "github", label: "GitHub Models", baseUrl: "https://models.inference.ai.dev/api", model: "gpt-4o", description: "Models through a GitHub token" },
  { type: "azure-openai", label: "Azure OpenAI", baseUrl: "https://YOUR-RESOURCE.openai.azure.com/openai/deployments/YOUR-DEPLOYMENT", model: "", description: "Your own Azure deployment" },
  { type: "ollama", label: "Ollama", baseUrl: "http://localhost:11434/v1", model: "llama3", description: "Models running on this computer", keyless: true },
  { type: "lmstudio", label: "LM Studio", baseUrl: "http://localhost:1234/v1", model: "local-model", description: "Models running on this computer", keyless: true },
]

export interface ProviderDraft {
  id?: string
  type?: string
  name: string
  baseUrl: string
  apiKey: string
  model: string
}
