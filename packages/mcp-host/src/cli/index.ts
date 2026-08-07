import { Command } from 'commander';
import { serveCommand } from './serve.js';
import { registerCommand } from './register.js';
import { doctorCommand } from './doctor.js';
import { runNmHost } from '../native/host.js';

/** 与 package.json 保持一致（version 硬编码，避免 rootDir 之外 import JSON）。 */
const VERSION = '0.1.0';

/**
 * 构建 CLI。
 * 子命令：serve（默认）/ register / doctor；host 为隐藏命令（NM host 模式）。
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

  // 隐藏命令：被 Chrome 的 NM manifest（register 写的 path）或 doctor 自测 spawn 时进入 host 模式。
  // phase 2：register 的 manifest path 应指向专用 host 启动器（bin/nm-host.js 或 `mcp-host host`）。
  const hostCmd = new Command('host')
    .description('run as a Native Messaging host (spawned by chrome.runtime.connectNative)')
    .action(async () => {
      await runNmHost();
    });
  program.addCommand(hostCmd, { hidden: true });

  return program;
}

// 不用顶层 await：CJS 产物不支持 TLA，且 cli/index 同时被 ESM/CJS 两种格式构建。
void createCli()
  .parseAsync(process.argv)
  .catch((err: unknown) => {
    console.error(`cborg-mcp-host: ${String(err)}`);
    process.exit(1);
  });
