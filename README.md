# Worktree Explorer

Cursor / VS Code 侧边栏插件：列出当前仓库的全部 git worktree，给分支加本机备注，并用 Cursor、VS Code 或 IntelliJ IDEA 打开。

## 功能

- 侧边栏列出当前工作区所属仓库的全部 worktree
  - 当前打开的 worktree 标为 `current`
  - 显示未提交变更数、领先/落后远程状态、upstream 名称和最后提交时间
  - 本地分支与远程分支名不一致时显示 ⚠ 警告
  - 显示 lock / prunable 状态，可锁定、解锁 worktree
  - 多仓库工作区可选择要展示的仓库
  - 当前窗口获得焦点时自动防抖刷新（可配置）
- 创建 worktree 向导
  - 可从当前分支、其他本地分支、远程分支创建新分支
  - 可检出已有本地分支，或从 commit/tag 创建 detached worktree
  - **默认使用 `--no-track`**；仅当基准为远程分支且用户主动选择时才会使用 `--track`
  - 新分支名默认 `feature/`，可配置前缀
  - 新 worktree 目录默认 `<仓库根>/<分支名>`，并校验父目录和冲突路径
  - 可选择复制 `.cursor` / `.vscode` 等设置目录（默认复制 `.cursor`，可配置）
  - 创建完成后可直接在 Cursor / 当前窗口 / 终端打开
- 右键操作
  - Open in Cursor / VS Code / IDEA / Current Window / Terminal
  - Reveal in File Explorer、Copy Path
  - Pull、Push、Fetch、Merge
    - Pull 无 upstream 时可选择设置 upstream 后拉取
    - 输出写入 `Worktree Explorer` OutputChannel，可一键复制
  - 编辑/清除备注（只存本机，不进 Git）
  - Lock / Unlock worktree（可填写锁定原因）
  - Delete worktree
    - 当前窗口打开的 worktree、主 worktree 禁止删除
    - 有未提交改动、已锁定、分支在其他 worktree 检出时都有前置检查
- 批量操作
  - Fetch All Remotes
  - Pull Selected Worktrees（多选，汇总成功/失败）
  - Prune Worktrees（带 dry-run 确认，并清理失效备注）
- 快速跳转：`Go to Worktree...` 支持按分支名、路径、备注模糊搜索

## 本地调试

1. 用 Cursor 打开本目录
2. `npm install`
3. F5 启动 Extension Development Host
4. 在新窗口左侧 Activity Bar 打开 **Worktrees**

## 安装 VSIX

本地打包：

```bash
npm install
npm test
npm run package
```

推送到 `main` 后，GitHub Actions 会运行测试并打包 VSIX 发布到 [Releases](https://github.com/fanchenggang/worktree-explorer/releases)。

在 Cursor 里：Extensions → `...` → Install from VSIX。

## 发布到 VS Code Marketplace

1. 准备一个拥有 VS Code Marketplace 发布权限的 Personal Access Token。
2. 在 GitHub 仓库的 **Settings → Secrets and variables → Actions** 中添加 `VSCE_PAT`。
3. 在 **Actions → Publish to VS Code Marketplace → Run workflow** 手动触发，或推送 `v*` 标签。

也可以在本地发布：

```bash
VSCE_PAT=<your-token> npx --yes @vscode/vsce@3.9.2 publish
```

## 设置

| 设置 | 默认值 | 说明 |
|------|--------|------|
| `worktreeExplorer.ideaCommand` | `idea` | 打开 IDEA 的命令。 |
| `worktreeExplorer.cursorCommand` | `cursor` | 不在 Cursor 内运行时用来打开 Cursor 的命令。 |
| `worktreeExplorer.vscodeCommand` | `code` | 用来打开 VS Code 的命令。 |
| `worktreeExplorer.defaultBranchPrefix` | `feature/` | 创建本地新分支时的默认前缀。 |
| `worktreeExplorer.autoRefresh` | `onFocus` | 自动刷新模式：`manual` / `onFocus` / `interval`。 |
| `worktreeExplorer.refreshIntervalSeconds` | `60` | `interval` 模式下的刷新间隔。 |
| `worktreeExplorer.copyDirs` | `[".cursor"]` | 创建 worktree 时复制的相对设置目录。 |
| `worktreeExplorer.confirmCopyDirs` | `false` | 复制设置目录前是否确认。 |
| `worktreeExplorer.noteMaxLength` | `60` | 树中备注显示的最大长度。 |
| `worktreeExplorer.statusCacheSeconds` | `0` | 状态缓存秒数，0 为禁用。 |
| `worktreeExplorer.statusConcurrency` | `4` | 并行读取 worktree 状态的最大 git 进程数。 |

用 IDEA 打开前，请在 IDEA 中执行 **Tools → Create Command-line Launcher**，或把 `ideaCommand` 设为绝对路径。macOS 会依次尝试配置命令、JetBrains Toolbox `idea` 脚本、`open -a "IntelliJ IDEA"`；Linux/Windows 也会尝试 Toolbox 常见路径。
