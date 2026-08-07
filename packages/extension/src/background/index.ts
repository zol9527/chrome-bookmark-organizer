/**
 * Background service worker 入口：只做装配，业务逻辑委托给下方模块。
 * 阶段 1 各模块均为 stub，阶段 2 接入 nm-bridge / plan-engine / snapshot-store。
 */
import { startNmBridge } from './nm-bridge';

function bindRuntimeEvents(): void {
  chrome.runtime.onInstalled.addListener((details) => {
    console.info('[cborg] onInstalled:', details.reason);
  });

  chrome.runtime.onConnect.addListener((port) => {
    console.info('[cborg] port connected:', port.name);
    port.onMessage.addListener((message: unknown) => {
      // TODO phase2: 路由 InternalRequest → nm-bridge / plan-engine，经 port.postMessage 回包
      console.info('[cborg] port message (stub):', message);
    });
    port.onDisconnect.addListener(() => {
      console.info('[cborg] port disconnected:', port.name);
    });
  });
}

function boot(): void {
  bindRuntimeEvents();

  // 阶段 1：native host 尚未安装，startNmBridge 抛 TODO；
  // 阶段 2 移除 try/catch，让 SW 与 host 建立常驻连接。
  try {
    startNmBridge();
  } catch (error) {
    console.warn('[cborg] NM bridge unavailable in phase 1:', error);
  }

  console.info('[cborg] background ready');
}

boot();
