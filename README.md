# Worktree Explorer

Cursor / VS Code 侧边栏插件：列出当前仓库的全部 git worktree，给分支加本机备注，并用 Cursor 或 IntelliJ IDEA 打开。

## 功能

- 侧边栏列出当前工作区所属仓库的全部 worktree
- 当前打开的 worktree 标为 `current`
- 每条可写备注（只存在本机，不进 Git）
- 行内按钮：Open in Cursor / Open in IDEA / Edit Note

## 本地调试

1. 用 Cursor 打开本目录
2. `npm install`
3. F5 启动 Extension Development Host
4. 在新窗口左侧 Activity Bar 打开 **Worktrees**

## 安装 VSIX

```bash
npm install
npx @vscode/vsce package
```

在 Cursor 里：Extensions → `...` → Install from VSIX。

## 设置

- `worktreeExplorer.ideaCommand`：打开 IDEA 的命令，默认 `idea`
- `worktreeExplorer.cursorCommand`：不在 Cursor 内运行时用来打开 Cursor 的命令，默认 `cursor`

用 IDEA 打开前，请在 IDEA 中执行 **Tools → Create Command-line Launcher**，或把 `ideaCommand` 设为绝对路径。macOS 会依次尝试配置命令、JetBrains Toolbox `idea` 脚本、`open -a "IntelliJ IDEA"`。
