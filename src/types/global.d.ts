// @ts-nocheck
declare global {
  const MACRO: {
    VERSION: string
    BUILD_TIME?: string
    FEEDBACK_CHANNEL: string
    ISSUES_EXPLAINER: string
    PACKAGE_URL?: string
    NATIVE_PACKAGE_URL?: string
    VERSION_CHANGELOG?: string
  }

  namespace NodeJS {
    interface ProcessEnv {
      USER_TYPE?: string
      CLAUDE_BRIDGE_OAUTH_TOKEN?: string
      CLAUDE_BRIDGE_BASE_URL?: string
      CLAUDE_CODE_CCR_MIRROR?: string
      CLAUDE_BRIDGE_USE_CCR_V2?: string
      CLAUDE_BRIDGE_SESSION_INGRESS_URL?: string
      CLAUDE_TRUSTED_DEVICE_TOKEN?: string
      CLAUDE_CODE_GIT_BASH_PATH?: string
      CLAUDE_DEBUG?: string
      CLAUDE_CODE_UNDERCOVER?: string
      GITHUB_ACTIONS?: string
      GITHUB_ACTOR?: string
      GITHUB_ACTOR_ID?: string
      GITHUB_REPOSITORY?: string
      GITHUB_REPOSITORY_ID?: string
      GITHUB_REPOSITORY_OWNER?: string
      GITHUB_REPOSITORY_OWNER_ID?: string
      COO_CREATOR?: string
      SHELL?: string
      TMUX?: string
      HOME?: string
      XDG_STATE_HOME?: string
      XDG_CACHE_HOME?: string
      XDG_DATA_HOME?: string
      TMPDIR?: string
      MAX_THINKING_TOKENS?: string
      BASH_DEFAULT_TIMEOUT_MS?: string
      BASH_MAX_TIMEOUT_MS?: string
      ENABLE_TOOL_SEARCH?: string
      CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS?: string
      ANTHROPIC_BASE_URL?: string
      CLAUDE_CODE_ENABLE_TELEMETRY?: string
      CLAUDE_CODE_OTEL_SHUTDOWN_TIMEOUT_MS?: string
      OTEL_LOGS_EXPORT_INTERVAL?: string
      OTEL_TRACES_EXPORT_INTERVAL?: string
      CLAUDE_CODE_OTEL_FLUSH_TIMEOUT_MS?: string
      OTEL_EXPORTER_OTLP_HEADERS?: string
      OTEL_EXPORTER_OTLP_ENDPOINT?: string
      OTEL_LOG_USER_PROMPTS?: string
      OTEL_LOG_TOOL_CONTENT?: string
      CLAUDE_CODE_ENHANCED_TELEMETRY_BETA?: string
      ENABLE_ENHANCED_TELEMETRY_BETA?: string
      CLAUDE_CODE_ACCOUNT_TAGGED_ID?: string
      CCR_FORCE_BUNDLE?: string
      CCR_ENABLE_BUNDLE?: string
      CLAUDE_CODE_PERFETTO_TRACE?: string
      CLAUDE_CODE_PERFETTO_WRITE_INTERVAL_S?: string
      BETA_TRACING_ENDPOINT?: string
      BETA_TRACING_HEADERS?: string
      CLAUDE_CODE_REMOTE_SESSION_ID?: string
      SESSION_INGRESS_URL?: string
      CLAUDE_CODE_REMOTE?: string
      CLAUDE_CODE_SIMPLE?: string
      CLAUDE_CODE_LOCAL_ONLY?: string
      CLAUDE_CODE_ABLATION_BASELINE?: string
      CLAUDE_CODE_ENTRYPOINT?: string
      CLAUDE_CODE_REMOTE_CONTROL?: string
      CLAUDE_CODE_STREAM_CLOSE_TIMEOUT?: string
      CLAUDE_CODE_SKIP_AUTH?: string
      CLAUDE_CODE_DEBUG?: string
      CLAUDE_CODE_REMOTE_SESSION_PATH?: string
      CLAUDE_CODE_REMOTE_BASE_URL?: string
      CLAUDE_CODE_REMOTE_ORG_ID?: string
    }
  }
}

declare module 'react/compiler-runtime' {
  export const c: any
}

export {}
