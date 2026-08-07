# Chrome Bookmark Organizer — top-level Make targets
# 完整说明见 README.md 与 docs/
#
# 常用流程：
#   make install     # 装依赖
#   make build       # 构建（extension/dist/ 可直接 Load unpacked 到 Chrome）
#   make register    # 注册 NM host manifest（需先拿扩展 ID）
#   make doctor      # 诊断
#   make load        # 在 Chrome 打开 chrome://extensions/

SHELL := /bin/bash
.DEFAULT_GOAL := help

CYAN  := \033[36m
GREEN := \033[32m
YELLOW := \033[33m
RESET := \033[0m

EXTENSION_DIST := packages/extension/dist
MCP_HOST_BIN   := packages/mcp-host/bin/mcp-host.js

.PHONY: help install build extension mcp-host dev test typecheck lint format clean register unregister doctor load serve

help: ## 显示所有 target
	@printf "$(CYAN)Chrome Bookmark Organizer$(RESET) — Make targets\n\n"
	@awk 'BEGIN {FS = ":.*?## "} /^[a-zA-Z_-]+:.*?## / {printf "  $(GREEN)%-12s$(RESET) %s\n", $$1, $$2}' $(MAKEFILE_LIST)
	@printf "\n详见 $(CYAN)README.md$(RESET) 与 $(CYAN)docs/$(RESET)\n"

install: ## 安装依赖（pnpm workspace 全包）
	pnpm install
	@printf "$(GREEN)✓$(RESET) 依赖已安装。下一步：$(CYAN)make build$(RESET)\n"

build: ## 构建所有包（重点是 extension/dist 可直接 Load unpacked 到 Chrome）
	pnpm build
	@printf "\n$(GREEN)✓$(RESET) 构建完成。\n"
	@printf "  Chrome 扩展产物：$(CYAN)$(EXTENSION_DIST)/$(RESET)（Load unpacked 选这个目录）\n"
	@printf "  MCP host 产物：  $(CYAN)packages/mcp-host/dist/$(RESET)\n"

extension: ## 只构建 Chrome 扩展（packages/extension/dist）
	pnpm --filter @cborg/extension build
	@printf "$(GREEN)✓$(RESET) Chrome 扩展已构建：$(CYAN)$(EXTENSION_DIST)/$(RESET)\n"

mcp-host: ## 只构建 MCP host（packages/mcp-host/dist）
	pnpm --filter @cborg/mcp-host build
	@printf "$(GREEN)✓$(RESET) MCP host 已构建：$(CYAN)packages/mcp-host/dist/$(RESET)\n"

dev: ## 启动开发模式（extension HMR + mcp-host watch 并行）
	pnpm dev

test: ## 运行所有测试（110 tests）
	pnpm test

typecheck: ## TypeScript 类型检查（全包）
	pnpm typecheck

lint: ## ESLint 检查
	pnpm lint

format: ## Prettier 格式化全部代码
	pnpm format

clean: ## 清理所有构建产物（dist / .vite / *.tsbuildinfo）
	@pnpms=$$(which pnpm) && $$pnpms -r exec rm -rf dist .vite *.tsbuildinfo 2>/dev/null || \
	  find packages -maxdepth 3 \( -name dist -o -name .vite \) -type d -exec rm -rf {} + 2>/dev/null; \
	  find packages -name '*.tsbuildinfo' -delete 2>/dev/null; \
	  true
	@printf "$(GREEN)✓$(RESET) 已清理 dist/.vite/*.tsbuildinfo\n"

register: ## 注册 Native Messaging host manifest（提示替换扩展 ID）
	@printf "$(YELLOW)提示$(RESET)：register 写入的 manifest allowed_origins 是 EXTENSION_ID_PLACEHOLDER。\n"
	@printf "        需手动编辑 manifest 把它替换成真实扩展 ID（chrome://extensions → Copy ID）。\n"
	@printf "        详见 $(CYAN)docs/development.md$(RESET) §真实 Chrome 联调\n\n"
	node $(MCP_HOST_BIN) register

unregister: ## 移除 Native Messaging host manifest
	node $(MCP_HOST_BIN) register --unregister

doctor: ## 诊断 NM host 环境（manifest / 扩展 ID / endpoint / TCP ping / host-B self-spawn）
	node $(MCP_HOST_BIN) doctor

load: ## 在 Chrome 中打开 chrome://extensions/ 以便 Load unpacked（macOS）
	@printf "$(CYAN)在 Chrome 中打开 chrome://extensions/$(RESET)\n"
	@printf "  1. 右上角开启 $(GREEN)Developer mode$(RESET)\n"
	@printf "  2. 点 $(GREEN)Load unpacked$(RESET) 选 $(CYAN)$(EXTENSION_DIST)/$(RESET)\n"
	@printf "  3. 在扩展卡片上 $(GREEN)Copy ID$(RESET)，然后跑 $(CYAN)make register$(RESET)\n\n"
	@open -a "Google Chrome" "chrome://extensions/" 2>/dev/null || \
	  printf "$(YELLOW)未自动打开，请手动访问 chrome://extensions/$(RESET)\n"

serve: ## 启动 MCP host 的 stdio server（调试；真实使用由 AI client 自动 spawn）
	@printf "$(YELLOW)提示$(RESET)：直接 background 启动会让 stdin 立即 EOF 触发 shutdown。\n"
	@printf "        手动测试请用：$(CYAN)sleep 30 | make serve$(RESET)\n"
	@printf "        真实使用时由 AI client spawn，不会有此问题。详见 $(CYAN)docs/development.md$(RESET)\n\n"
	node $(MCP_HOST_BIN) serve
