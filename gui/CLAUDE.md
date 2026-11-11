# gui/ — Noa desktop app

## Verify every GUI change in the real app

After every GUI change, restart the Noa Agent desktop app (`gui/`) so the update takes effect, then verify the result visually before reporting.

**Why:** The user wants each iteration judged in the real desktop shell, not only by typecheck/build.

**How to apply:** Stop the running Electron process (find its PID as in "Bring the window forward by PID" below), and `bun run server` in `gui/` too if the change touches the server. Then run `bun run desktop` in `gui/` (sets `NOA_GUI_DEV=1`, so the window serves the current source). Report what was verified and anything that could not be.

## Bring the window forward by PID

Do not use `open_application` with "Electron" to show the Noa GUI window. It can resolve to the default Electron demo app of another project, so the wrong window comes up.

**Why:** Noa's Electron build uses the default bundle id `com.github.Electron` (verified), so name-based lookup is ambiguous. The user had to correct this repeatedly.

**How to apply:** Get the PID with `pgrep -f 'gui/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'` (the main process), then run `osascript -e 'tell application "System Events" to set frontmost of (first process whose unix id is <PID>) to true'`, then take the screenshot. Don't click or type in windows that aren't Noa's.

## Borrowing from another app

用户让 GUI 某块"参照"另一个应用优化时，有两条边界：

1. 只借鉴视觉度量：上下间距、行高、图标尺寸、字号/字体。不要 1:1 复刻结构、交互或新增功能（右键菜单、重命名、自动展开、层级引导线、工具栏重排等）。
2. 用户截图指出要对齐的部分时，范围就是截图里的那几个组件（例如 Recents 的 ⋯ 菜单、Composer 齿轮环境菜单）。不要以"保持一致"为由改相邻区域（分组标题、Projects 标题、行缩进等）。"全部"指之前提过的几处，不是整个侧栏。

**Why:** 照搬了参照应用的整套结构和功能，用户要求撤回重做，并明确不需要高亮层级；另一次顺手改了相邻的分组标题和行缩进，也被要求撤回。

**How to apply:** 动手前列出范围（参照的视觉度量、截图对应的组件）；想加的结构、功能或相邻区域的改动只在汇报里列为建议，等用户同意。参照对象也不是 Claude Code，除非用户点名。桌面端样式参照见下一节。

## Claude desktop app as style reference

用户对 Noa GUI 样式不满意时会说"参考 Claude Code 桌面端"。它的前端打包在 `/Applications/Claude.app/Contents/Resources/ion-dist.asar`，用 `bunx --bun @electron/asar extract` 解到 scratchpad，文案在 `i18n/en-US.json`（按 id 反查 `assets/v1/*.js` 里的组件 className）。

它的风格偏克制：状态用 footnote 字号的纯文字/小 pill（如断连只把文字染成 `text-danger`），不做卡片、不用强调色按钮。（2026-11-06 观察的快照，未重新抽取核实；ion-dist.asar 路径已核实存在。）

借鉴时只取视觉度量，见上一节；注释里不写参照来源，见根目录 CLAUDE.md 的 Conventions。
