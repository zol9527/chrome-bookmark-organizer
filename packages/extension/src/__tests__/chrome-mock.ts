/**
 * chrome.* API 的内存 mock（vitest node 环境用）。
 *
 * 用法：
 *   import { installChromeMock } from './chrome-mock';
 *   beforeEach(() => { installChromeMock(); });
 *
 * 覆盖实现用到的 API：
 *   - chrome.bookmarks: getTree / getSubTree / getChildren / get / create / move /
 *     update / remove / removeTree / search（与真实语义一致：get() 不带 children）
 *   - chrome.storage: local / session（Promise 风格 get / set / remove）
 *   - chrome.runtime: onMessage / onInstalled / onConnect / sendMessage /
 *     connectNative（未注册 host 时模拟立即 disconnect + lastError）/ lastError
 */
import type { Plan } from '@cborg/shared';

export interface MockBookmarkNode {
  id: string;
  parentId?: string;
  index?: number;
  url?: string;
  title: string;
  dateAdded: number;
  dateGroupModified?: number;
  children?: MockBookmarkNode[];
}

type AnyListener = (...args: any[]) => void;

/** 极简事件发射器，模拟 chrome.events.Event 的 addListener/removeListener/dispatch */
class MockEvent<T extends AnyListener> {
  private listeners = new Set<T>();

  addListener(fn: T): void {
    this.listeners.add(fn);
  }

  removeListener(fn: T): void {
    this.listeners.delete(fn);
  }

  hasListener(fn: T): boolean {
    return this.listeners.has(fn);
  }

  dispatch(...args: Parameters<T>): void {
    for (const fn of [...this.listeners]) fn(...args);
  }
}

/** 模拟 chrome.storage.StorageArea（Promise 风格） */
class MockStorageArea {
  private data = new Map<string, unknown>();

  async get(keys?: string | string[] | Record<string, unknown> | null): Promise<Record<string, unknown>> {
    if (keys == null) return Object.fromEntries(this.data);
    if (typeof keys === 'string') {
      return this.data.has(keys) ? { [keys]: structuredClone(this.data.get(keys)) } : {};
    }
    if (Array.isArray(keys)) {
      const out: Record<string, unknown> = {};
      for (const k of keys) if (this.data.has(k)) out[k] = structuredClone(this.data.get(k));
      return out;
    }
    // 对象形式：键为默认值，已存储值覆盖
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(keys)) {
      out[k] = this.data.has(k) ? structuredClone(this.data.get(k)) : structuredClone(v);
    }
    return out;
  }

  async set(items: Record<string, unknown>): Promise<void> {
    for (const [k, v] of Object.entries(items)) this.data.set(k, structuredClone(v));
  }

  async remove(keys: string | string[]): Promise<void> {
    for (const k of Array.isArray(keys) ? keys : [keys]) this.data.delete(k);
  }

  reset(): void {
    this.data.clear();
  }

  dump(): Record<string, unknown> {
    return Object.fromEntries(this.data);
  }
}

/** 模拟 chrome.runtime.connectNative 返回的 Port */
class MockPort {
  readonly name: string;
  readonly onMessage = new MockEvent<(message: unknown) => void>();
  readonly onDisconnect = new MockEvent<() => void>();
  posted: unknown[] = [];
  disconnected = false;

  constructor(name: string) {
    this.name = name;
  }

  postMessage(message: unknown): void {
    if (!this.disconnected) this.posted.push(message);
  }

  disconnect(): void {
    if (this.disconnected) return;
    this.disconnected = true;
    this.onDisconnect.dispatch();
  }

  emitMessage(message: unknown): void {
    this.onMessage.dispatch(message);
  }

  emitDisconnect(): void {
    this.disconnect();
  }
}

/** 模拟 chrome.bookmarks（内存树 + 自增 id） */
class MockBookmarks {
  private nodes = new Map<string, MockBookmarkNode>();
  private nextId = 100;

  constructor() {
    this.reset();
  }

  reset(): void {
    this.nodes.clear();
    const bar: MockBookmarkNode = { id: '1', title: 'Bookmarks bar', dateAdded: 1, children: [] };
    const other: MockBookmarkNode = { id: '2', title: 'Other bookmarks', dateAdded: 1, children: [] };
    const mobile: MockBookmarkNode = { id: '3', title: 'Mobile bookmarks', dateAdded: 1, children: [] };
    this.nodes.set('1', bar);
    this.nodes.set('2', other);
    this.nodes.set('3', mobile);
    this.nextId = 100;
  }

  async getTree(): Promise<MockBookmarkNode[]> {
    return ['1', '2', '3'].map((id) => this.cloneTree(this.nodes.get(id)!));
  }

  async getSubTree(id: string): Promise<MockBookmarkNode[]> {
    const node = this.nodes.get(id);
    return node ? [this.cloneTree(node)] : [];
  }

  async getChildren(id: string): Promise<MockBookmarkNode[]> {
    return (this.nodes.get(id)?.children ?? []).map((c) => this.cloneNode(c));
  }

  async get(idOrIds: string | string[]): Promise<MockBookmarkNode[]> {
    const ids = Array.isArray(idOrIds) ? idOrIds : [idOrIds];
    return ids
      .map((id) => this.nodes.get(id))
      .filter((n): n is MockBookmarkNode => Boolean(n))
      .map((n) => this.cloneNode(n));
  }

  async create(details: { parentId?: string; title?: string; url?: string; index?: number }): Promise<MockBookmarkNode> {
    const parent = this.nodes.get(details.parentId ?? '1');
    if (!parent) throw new Error(`Parent folder not found: ${details.parentId}`);
    const node: MockBookmarkNode = {
      id: String(this.nextId++),
      title: details.title ?? '',
      parentId: parent.id,
      dateAdded: Date.now(),
      ...(details.url ? { url: details.url } : {}),
    };
    if (!parent.children) parent.children = [];
    const children = parent.children;
    const index = details.index ?? children.length;
    children.splice(Math.min(index, children.length), 0, node);
    this.fixIndices(children);
    this.nodes.set(node.id, node);
    return this.cloneNode(node);
  }

  async move(id: string, dest: { parentId?: string; index?: number }): Promise<MockBookmarkNode> {
    const node = this.nodes.get(id);
    if (!node) throw new Error(`Bookmark not found: ${id}`);
    const oldParent = node.parentId ? this.nodes.get(node.parentId) : undefined;
    if (oldParent?.children) {
      oldParent.children = oldParent.children.filter((c) => c.id !== id);
      this.fixIndices(oldParent.children);
    }
    const newParent = this.nodes.get(dest.parentId ?? node.parentId ?? '1');
    if (!newParent) throw new Error(`Parent folder not found: ${dest.parentId}`);
    if (!newParent.children) newParent.children = [];
    const children = newParent.children;
    const index = dest.index ?? children.length;
    children.splice(Math.min(index, children.length), 0, node);
    this.fixIndices(children);
    node.parentId = newParent.id;
    return this.cloneNode(node);
  }

  async update(id: string, changes: { title?: string; url?: string }): Promise<MockBookmarkNode> {
    const node = this.nodes.get(id);
    if (!node) throw new Error(`Bookmark not found: ${id}`);
    if (changes.title !== undefined) node.title = changes.title;
    if (changes.url !== undefined) {
      if (changes.url === null || changes.url === '') delete node.url;
      else node.url = changes.url;
    }
    return this.cloneNode(node);
  }

  async remove(id: string): Promise<void> {
    const node = this.nodes.get(id);
    if (!node) throw new Error(`Bookmark not found: ${id}`);
    if (node.children && node.children.length > 0) throw new Error(`Cannot remove a folder with children: ${id}`);
    this.detach(id);
  }

  async removeTree(id: string): Promise<void> {
    const node = this.nodes.get(id);
    if (!node) throw new Error(`Bookmark not found: ${id}`);
    for (const n of this.collectSubtree(id)) {
      this.nodes.delete(n.id);
    }
    this.detach(id);
  }

  async search(query: string): Promise<MockBookmarkNode[]> {
    const q = query.toLowerCase();
    const out: MockBookmarkNode[] = [];
    for (const node of this.nodes.values()) {
      const hay = `${node.title} ${node.url ?? ''}`.toLowerCase();
      if (hay.includes(q)) out.push(this.cloneNode(node));
    }
    return out;
  }

  private detach(id: string): void {
    const node = this.nodes.get(id);
    const parent = node?.parentId ? this.nodes.get(node.parentId) : undefined;
    if (parent?.children) {
      parent.children = parent.children.filter((c) => c.id !== id);
      this.fixIndices(parent.children);
    }
    this.nodes.delete(id);
  }

  private collectSubtree(id: string): MockBookmarkNode[] {
    const out: MockBookmarkNode[] = [];
    const walk = (n: MockBookmarkNode): void => {
      out.push(n);
      (n.children ?? []).forEach(walk);
    };
    const root = this.nodes.get(id);
    if (root) walk(root);
    return out;
  }

  /** 克隆但不带 children（对应真实 get() 语义：不返回子节点） */
  private cloneNode(n: MockBookmarkNode): MockBookmarkNode {
    const { children: _children, ...rest } = n;
    return structuredClone(rest);
  }

  private cloneTree(n: MockBookmarkNode): MockBookmarkNode {
    return structuredClone(n);
  }

  private fixIndices(children: MockBookmarkNode[]): void {
    children.forEach((c, i) => {
      c.index = i;
    });
  }
}

/** 模拟 chrome.runtime */
class MockRuntime {
  lastError: { message: string } | undefined;
  readonly onInstalled = new MockEvent<(details: { reason: string }) => void>();
  readonly onConnect = new MockEvent<(port: MockPort) => void>();
  readonly onMessage = new MockEvent<
    (message: unknown, sender: unknown, sendResponse: (response?: unknown) => void) => void
  >();

  private hostRegistry = new Map<string, boolean>();
  private ports: MockPort[] = [];

  registerHost(name: string, available = true): void {
    this.hostRegistry.set(name, available);
  }

  connectNative(name: string): MockPort {
    const available = this.hostRegistry.get(name) ?? false;
    const port = new MockPort(name);
    this.ports.push(port);
    if (!available) {
      // 模拟 host 未注册：connectNative 返回的 port 立即断开并设置 lastError
      this.lastError = { message: 'Specified native messaging host not found.' };
      setTimeout(() => {
        port.emitDisconnect();
        this.lastError = undefined;
      }, 0);
    }
    return port;
  }

  async sendMessage(message: unknown): Promise<void> {
    this.onMessage.dispatch(message, {}, () => {});
  }

  get connectedPorts(): MockPort[] {
    return this.ports;
  }

  reset(): void {
    this.lastError = undefined;
    this.ports = [];
    this.hostRegistry.clear();
  }
}

export interface ChromeMock {
  bookmarks: MockBookmarks;
  runtime: MockRuntime;
  storage: { local: MockStorageArea; session: MockStorageArea };
  reset: () => void;
}

/**
 * 安装 mock 到 globalThis.chrome 并返回句柄。
 * 每个测试应在 beforeEach 调用一次以获得干净状态。
 */
export function installChromeMock(): ChromeMock {
  const mock: ChromeMock = {
    bookmarks: new MockBookmarks(),
    runtime: new MockRuntime(),
    storage: { local: new MockStorageArea(), session: new MockStorageArea() },
    reset() {
      this.bookmarks.reset();
      this.runtime.reset();
      this.storage.local.reset();
      this.storage.session.reset();
    },
  };
  (globalThis as Record<string, unknown>).chrome = mock as unknown as typeof chrome;
  return mock;
}

/** 便捷构造：一个最小 Plan（测试用） */
export function makePlan(overrides: Partial<Plan> = {}): Plan {
  return {
    id: 'p1',
    title: 'test plan',
    actions: [],
    status: 'pending',
    createdAt: 1,
    updatedAt: 1,
    createdBy: 'manual',
    ...overrides,
  };
}
