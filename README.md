# Claude Agent

开源重建的终端 AI 编程助手。基于 Claude Code 泄露源码重构。

## 核心改动

相比官方版本做了三个关键修改：

1. **遥测已移除** — 所有出站 OpenTelemetry、GrowthBook 分析、Sentry 错误上报均已禁用
2. **安全护栏已剥离** — 对话中的系统级注入指令（硬编码拒绝模式、网络风险指令块）已移除
3. **实验特性已解锁** — 68 个可编译的 feature flag 全部启用

## 快速安装

```bash
curl -fsSL https://raw.githubusercontent.com/rickkwang/Claude-Agent/main/install.sh | bash
```

或手动构建：

```bash
git clone https://github.com/rickkwang/Claude-Agent.git && cd Claude-Agent
bun run compile
./dist/cli --version
```

## 构建命令

| 命令 | 输出 | 说明 |
|------|------|------|
| `bun run build` | `dist/main.js` | 需 bun 运行 |
| `bun run compile` | `dist/cli` | standalone 可执行文件 |
| `bun run build:dev:full` | `dist/main-dev.js` | 开发版 + 全部实验特性 |

## 支持的提供商

| 提供商 | 环境变量 |
|--------|----------|
| Anthropic (默认) | `ANTHROPIC_API_KEY` |
| AWS Bedrock | `ANTHROPIC_BASE_URL` + Bedrock 凭证 |
| Google Vertex | `ANTHROPIC_BASE_URL` + Vertex 凭证 |

## 主要命令

- `/fork` - 分叉会话为可恢复分支
- `/workflows` - 管理本地可复用工作流
- `/summary` - 生成结构化会话摘要
- `/share` - 导出会话快照

## 技术栈

Bun + TypeScript, React + Ink (终端 UI), Commander.js, Zod, MCP/LSP 协议

## 隐私声明

本构建内置硬编码的隐私策略（无需配置）：

- 所有遥测路径硬禁用
- GrowthBook 远程拉取硬禁用
- 远程策略覆盖硬禁用

## 验证

```bash
bun run build && ./dist/cli --version
```

## 免责声明

- 本项目是独立/私人工程衍生项目
- 非 Anthropic 官方发布或支持产品
- Anthropic、Claude、Claude Code 名称保留给各自所有者
