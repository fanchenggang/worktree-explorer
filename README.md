# Worktree Explorer

Cursor / VS Code 侧边栏插件：列出当前仓库的全部 git worktree，给分支加本机备注，并用 Cursor 或 IntelliJ IDEA 打开。

## 功能

- 侧边栏列出当前工作区所属仓库的全部 worktree
- 当前打开的 worktree 标为 `current`
- 每条可写备注（只存在本机，不进 Git）
- 右键 worktree 分支可从当前分支创建新的 worktree 分支
  - 新分支名默认 `feature/`，可修改
  - 新 worktree 目录默认在当前工作目录下生成，可修改
  - 创建时显式使用 `--no-track`，新分支不会设置 upstream
  - 创建完成后会把当前分支的 `.cursor` 目录覆盖到新 worktree 的 `.cursor`
- 右键 worktree 分支可删除该 worktree，带二次确认
  - 可选择仅移除 worktree，或同时强制删除对应分支
- 行内按钮：Open in Cursor / Open in IDEA / Edit Note

## 本地调试

1. 用 Cursor 打开本目录
2. `npm install`
3. F5 启动 Extension Development Host
4. 在新窗口左侧 Activity Bar 打开 **Worktrees**

## 安装 VSIX

本地打包：

```bash
npm install
npm run package
```

推送到 `main` 后，GitHub Actions 会打包 VSIX 并发布到 [Releases](https://github.com/fanchenggang/worktree-explorer/releases)，可直接下载。

在 Cursor 里：Extensions → `...` → Install from VSIX。

## 设置

- `worktreeExplorer.ideaCommand`：打开 IDEA 的命令，默认 `idea`
- `worktreeExplorer.cursorCommand`：不在 Cursor 内运行时用来打开 Cursor 的命令，默认 `cursor`

用 IDEA 打开前，请在 IDEA 中执行 **Tools → Create Command-line Launcher**，或把 `ideaCommand` 设为绝对路径。macOS 会依次尝试配置命令、JetBrains Toolbox `idea` 脚本、`open -a "IntelliJ IDEA"`。
