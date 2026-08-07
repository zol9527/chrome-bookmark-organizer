import { mkdir, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Command } from 'commander';
import { NM_HOST_NAME } from '@cborg/shared';

/** 开发期扩展 ID 占位：写入 manifest 的 allowed_origins，用户自行替换为真实扩展 ID。 */
export const EXTENSION_ID_PLACEHOLDER = 'EXTENSION_ID_PLACEHOLDER';

/** Chrome 系浏览器的 NativeMessagingHosts 目录（相对 ~/Library/Application Support）。 */
export const NM_BROWSER_DIRS = [
  'Google/Chrome/NativeMessagingHosts',
  'Microsoft Edge/NativeMessagingHosts',
  'BraveSoftware/Brave-Browser/NativeMessagingHosts',
  'Arc/User Data/NativeMessagingHosts',
  'Zen/NativeMessagingHosts',
] as const;

/**
 * 当前模块文件的 file:// URL。
 * ESM 运行时用 import.meta.url；CJS 产物（esbuild 把 import.meta 置为空对象）回退 __filename。
 * `typeof __filename` 在 ESM 下是安全的（undeclared 标识符 typeof 不抛错）。
 */
function moduleFileUrl(): string {
  return typeof __filename === 'string' ? pathToFileURL(__filename).href : import.meta.url;
}

/** 本包根目录（src/cli/register.ts → ../..）。 */
export const PACKAGE_ROOT = fileURLToPath(new URL('../..', moduleFileUrl()));

/**
 * 写入 manifest 的 host 启动命令。
 *
 * Chrome 的 connectNative 把 manifest 的 path 当**单一可执行文件**原样 spawn，**不拆参数**。
 * 因此 path 必须是纯 bin 路径，不能写 `<bin> host`（Chrome 会把它当一个文件名找，找不到）。
 *
 * bin/mcp-host.js 在 cli/index.ts 顶部检测 `chrome-extension://<id>/` argv，自动进入
 * host 子命令（host-B 模式）。NM host manifest 只需写纯 bin 路径。
 *
 * --path 选项保留为 escape hatch（指向自定义启动器脚本）。
 */
export const DEFAULT_HOST_BIN = join(PACKAGE_ROOT, 'bin', 'mcp-host.js');

/** host-B 子命令名（doctor 显式 spawn 测试用）。 */
export const HOST_B_COMMAND = 'host';

/** 默认写进 manifest 的 path 字段：纯 bin 路径（NM invocation 自动检测）。 */
export const DEFAULT_HOST_PATH = DEFAULT_HOST_BIN;

/** macOS 上某浏览器的 manifest 绝对路径。 */
export function nmManifestPath(browserDir: string): string {
  return join(homedir(), 'Library', 'Application Support', browserDir, `${NM_HOST_NAME}.json`);
}

function manifestContent(hostBin: string): Record<string, unknown> {
  return {
    name: NM_HOST_NAME,
    description: 'chrome-bookmark-organizer native messaging host (MCP bridge to extension service worker)',
    path: hostBin,
    type: 'stdio',
    allowed_origins: [`chrome-extension://${EXTENSION_ID_PLACEHOLDER}/`],
  };
}

/**
 * register：注册（或 --unregister 删除）NM host manifest。
 * 逐个浏览器目录尝试，目录不存在/不可写则跳过，不中断。
 */
export function registerCommand(): Command {
  return new Command('register')
    .description('Register the Native Messaging host manifest for Chrome-family browsers (macOS)')
    .option('--unregister', 'remove existing manifests instead of writing them')
    .option('--path <path>', 'override the host binary path written into the manifest (absolute, or relative to cwd; used verbatim, no " host" suffix appended)')
    .action(async (options: { unregister?: boolean; path?: string }) => {
      // 默认写成 `<bin 绝对路径> host`（host-B 模式）；--path 由用户完全接管
      const hostBin = options.path ? join(process.cwd(), options.path) : DEFAULT_HOST_PATH;
      let wrote = 0;
      for (const dir of NM_BROWSER_DIRS) {
        const target = nmManifestPath(dir);
        try {
          if (options.unregister) {
            await rm(target, { force: true });
            console.log(`unregistered: ${target}`);
          } else {
            await mkdir(join(homedir(), 'Library', 'Application Support', dir), { recursive: true });
            await writeFile(target, JSON.stringify(manifestContent(hostBin), null, 2) + '\n', 'utf8');
            console.log(`registered:   ${target}`);
            wrote += 1;
          }
        } catch (err) {
          console.warn(`skipped ${dir}: ${String(err)}`);
        }
      }
      if (!options.unregister && wrote > 0) {
        console.warn(
          `\n${EXTENSION_ID_PLACEHOLDER}: replace with your real extension ID in each manifest's allowed_origins (chrome://extensions → "Copy ID").`,
        );
        if (!options.path) {
          console.warn(
            'note: manifest path is the plain host binary. bin/mcp-host.js auto-detects Native',
          );
          console.warn(
            'Messaging invocation (chrome-extension://... argv) and enters host-B mode automatically.',
          );
        }
      }
    });
}
