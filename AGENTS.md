# Codex 项目工作流

## 仓库概览

- 本仓库是 pnpm workspace + Lerna 管理的微前端 monorepo。
- 框架核心在 `packages/jieshu-core`；框架适配包在 `packages/jieshu-react`、`packages/jieshu-vue3`。
- `examples/*` 是各框架示例，`docs/` 是 VitePress 文档站点。
- 以根目录 `package.json` 的 `packageManager` 字段为准，使用 pnpm 11.13.0；不要混用 npm 或 yarn 安装依赖。
- `.codex/config.toml` 提供受信任仓库的共享 Codex 默认权限；不要在其中放置密钥、个人账号或机器专属路径。

## 开发约定

1. 先阅读与任务有关的实现、测试、文档和已有 CI；保持修改范围最小。
2. 工作区可能包含其他人未提交的改动。不得覆盖、还原或格式化无关文件。
3. 修改核心行为时，同步更新或新增 `packages/jieshu-core/__test__` 下的测试；修改公开 API 时，同步更新 `docs/`。
4. 不提交构建产物、`node_modules`、测试覆盖率、Playwright 下载的浏览器或本地密钥。
5. 不修改发布、标签、npm 发布和 GitHub Release 配置，除非任务明确要求。

## 框架适配包的强制测试规则

- 本节适用于 `packages/jieshu-react`、`packages/jieshu-vue3`。
- 两个包的 UI 测试和单元测试必须完整覆盖其公开行为、组件交互、生命周期、事件、属性透传、异常路径及兼容性边界，不允许以类型检查或 lint 代替行为测试。
- 两个包的单元测试覆盖率要求为 100%，包括 statements、branches、functions 和 lines；新增或修改代码时必须同步补齐测试，不得降低覆盖率。
- 任何改动只要触及上述任一包，都必须执行该包的 UI 测试、单元测试和完整 `test` 脚本；同时改动多个包时，逐包执行对应测试。即使改动仅涉及类型、构建配置或测试代码，也不得跳过。
- 如果目标包尚未提供独立的 UI、单元测试或覆盖率命令，本次改动必须先补齐相应测试脚本和覆盖率阈值，再执行验证；不能以“暂无脚本”为由省略测试。
- 交付时必须逐包列出实际执行的命令、测试结果和覆盖率结果；未达到 100% 或存在失败用例时，不得宣称任务完成。

## 常用命令

```bash
pnpm install
pnpm test
pnpm --filter @cloud/jieshu-core test:unit
pnpm --filter @cloud/jieshu-core test:integration
pnpm --filter @cloud/jieshu-react test
pnpm --filter @cloud/jieshu-vue3 test
pnpm --filter jieshu-docs docs:build
pnpm start
```

- 集成测试中的旧版 examples 构建依赖 `NODE_OPTIONS=--openssl-legacy-provider`；相关脚本已设置该选项。
- 集成测试会下载/使用 Chromium 并启动多个示例服务，优先先运行单元测试；仅在改动影响集成行为或任务明确要求时运行集成测试。
- 根目录没有只读 lint 脚本；`packages/jieshu-core` 的 `lint` 会带 `--fix`，除非用户要求，不要把它当作无副作用检查执行。

## 完成前检查

1. 检查 `git diff --check` 与 `git status --short`，确认只包含本任务的改动。
2. 运行与改动相称的验证；触及框架适配包时，严格执行上述强制测试规则，并在交付时逐包说明命令、结果和覆盖率。
3. 提交信息遵循 `CONTRIBUTING.md` 中的 Conventional Commits 规则；不要自行创建提交，除非用户明确要求。
4. 提交 Pull Request 前，使用 Codex `/review` 审查未提交变更或相对 `master` 的分支差异；审查只报告问题，不应改动工作树。

## Code Review Rules

- 优先指出会导致隔离失效、跨应用状态泄漏、生命周期顺序错误、路由/资源加载回归或兼容性破坏的问题。
- 审查公开接口变更时，检查类型声明、框架适配包和文档是否保持一致。
- 对测试、文档和仅重构的改动，避免提出与行为无关的格式化意见。
