import { Command } from 'commander';
import { serveCommand } from './serve.js';
import { registerCommand } from './register.js';
import { doctorCommand } from './doctor.js';
import { hostCommand } from './host.js';

/** 与 package.json 保持一致（version 硬编码，避免 rootDir 之外 import JSON）。 */
const VERSION = '0.1.0';

/**
 * Chrome 启动 NM host 时，把调用方扩展的 origin（`chrome-extension://<id>/`）作为
 * 唯一命令行参数传给 host 进程。manifest 的 path 是单一可执行文件路径，Chrome **不拆分参数**，
 * 所以不能在 path 里写 `<bin> host` —— 改为在 bin 入口检测 NM 调用，自动注入 host 子命令。
 *
 * 参考：https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging
 */
const NM_INVOCATION_PREFIX = 'chrome-extension://';
const KNOWN_SUBCOMMANDS = new Set(['host', 'serve', 'register', 'doctor']);

function detectNativeMessagingInvocation(): void {
  const positional = process.argv.slice(2);
  const hasNmOrigin = positional.some((a) => a.startsWith(NM_INVOCATION_PREFIX));
  const hasExplicitSubcommand = positional.some((a) => KNOWN_SUBCOMMANDS.has(a));
  if (hasNmOrigin && !hasExplicitSubcommand) {
    process.argv.splice(2, 0, 'host');
  }
}

detectNativeMessagingInvocation();

/**
 * 构建 CLI。
 * 子命令：serve（默认）/ register / doctor / host（host-B 桥，被 Chrome 或 doctor 拉起）。
 */
export function createCli(): Command {
  const program = new Command();
  program
    .name('cborg-mcp-host')
    .description('MCP server + Native Messaging host + CLI for chrome-bookmark-organizer')
    .version(VERSION);

  program.addCommand(serveCommand(), { isDefault: true });
  program.addCommand(registerCommand());
  program.addCommand(doctorCommand());
  // host 子命令：被 Chrome 的 NM manifest（register 写的 path）或 doctor 自测 spawn 时
  // 进入 host-B 模式（见 native/messaging.ts 三进程方案）。
  program.addCommand(hostCommand());

  return program;
}

// 不用顶层 await：CJS 产物不支持 TLA，且 cli/index 同时被 ESM/CJS 两种格式构建。
void createCli()
  .parseAsync(process.argv)
  .catch((err: unknown) => {
    console.error(`cborg-mcp-host: ${String(err)}`);
    process.exit(1);
  });
