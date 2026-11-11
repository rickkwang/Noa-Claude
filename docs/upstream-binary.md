# Upstream binary and model catalog


上游 Claude Code 二进制装在 `~/.local/share/claude/versions/<version>`（Bun 单文件产物，~200MB，每天可能新增一版）。里面**未压缩**嵌着完整 JS bundle 和一份 baked model catalog —— 后者是核对 Noa 模型能力表的 ground truth，比 `claude-api` skill 的缓存表新。

抽取方法：扫描二进制里长度 >= 100000 的可打印字节连续段（`9<=b<=13 or 32<=b<=126 or b>=128`），拼起来约 25MB JS。**catalog 不在这些大段里**，要按 marker（如 `advisor_rank`、`supports_1m_beta`、`schema_version`）在原始 buffer 里直接搜。真正的 catalog 是一簇密集连续命中；散落在别处的零星命中是读取 catalog 的代码，不是数据。**不要记硬编码偏移**，每个版本都会变。

大段扫描会漏掉 TUI/懒加载 chunk（粘贴处理、imagePaste、imageResizer 等）：源码被零散控制字节切成小段，>=100KB 规则抓不到。做法：取原始 buffer，把 `[\x00-\x08\x0e-\x1f\x7f]+` 替换成分隔符再 grep；每个 chunk 以 `// @bun @bytecode` 开头、`export{...}` 结尾，按 `import{...}from"/$bunfs/root/chunk-xxx.js"` 追依赖。更靠前的命中是字节码常量表，只有字符串没有逻辑。

注意 minifier 按 chunk 复用标识符，`dc`/`hg`/`Rm` 这类短名在不同 region 含义不同 —— 必须在同一 region 内解析。（2.1.319 的二进制里 `function dc` 出现多次，指向不同函数，印证这一点。）

catalog 大致形如 `{schema_version, pricing_tiers, models:[{id, family, provider_ids, context, max_output_tokens, pricing, capabilities, advisor_rank}], aliases}`。**字段名会随版本漂移**（例如 `context` 的子字段），每次核对都要重新读结构，不要照抄这里的字段名。

上游代码通过 `dc(id)` / `hg(id,capability)` 查这张表，Noa 把同一张表拆成了散落的 `.includes()` 链（`src/utils/thinking.ts`、`effort.ts`、`betas.ts`、`context.ts`、`modelCost.ts`、`advisor.ts`），这是模型能力漂移的根源。`dc`/`hg` 的具体签名未经本次核对确认，使用前在当前版本里重新确认。

关键：catalog 不是唯一真相 —— 上游对若干模型有 by-name 短路，而 `hg()` 返回 `true|undefined` 从不返回 `false`，所以调用方常有 fall-through 兜底。**只看 capabilities 数组会得出错误结论，必须连消费函数一起读。**

上游另有一层 Noa 完全没有的能力：400 错误分类 + 剥字段重试 + 会话内 latch。这是上游敢"乐观发送"、不需要保守白名单的原因；Noa 没有这层，所以白名单必须保持准确。
