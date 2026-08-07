const TARGET_ROOTS = [
  "00_Inbox",
  "01_Favorites",
  "10_Work_Projects",
  "20_Development_Engineering",
  "30_AI_Agents",
  "40_Cybersecurity",
  "50_Learning_Research",
  "60_Servers_Self_Hosting",
  "70_Online_Tools_Services",
  "80_Career_Jobs",
  "90_Personal_Life",
  "99_Archive"
];

// These keys match the source folders currently used by the migrated bookmark tree.
// Update this map if the source folder names change in your Chrome profile.
const TOP_LEVEL_MAP = {
  在线工具: ["70_Online_Tools_Services"],
  计算机学习: ["20_Development_Engineering"],
  爬虫: ["20_Development_Engineering"],
  "Cyber Sec": ["40_Cybersecurity"],
  Home: ["90_Personal_Life"],
  常用: ["01_Favorites"],
  AI: ["30_AI_Agents"],
  工作: ["10_Work_Projects"],
  product: ["10_Work_Projects"],
  Jobs: ["80_Career_Jobs"]
};

const LOYD_MAP = {
  工作: ["10_Work_Projects", "LOYD_Work"],
  Home: ["90_Personal_Life", "LOYD_Home"],
  邮箱: ["90_Personal_Life", "Email"],
  VPN: ["60_Servers_Self_Hosting", "VPN"],
  服务器商: ["60_Servers_Self_Hosting", "Server_Providers"],
  其他: ["99_Archive", "LOYD_Other"]
};

function isBookmark(node) {
  return Boolean(node && node.url);
}

function countBookmarks(node) {
  if (isBookmark(node)) return 1;
  return (node.children || []).reduce((sum, child) => sum + countBookmarks(child), 0);
}

function findChild(parent, title) {
  return (parent.children || []).find((child) => child.title === title);
}

function findBookmarkBar(tree) {
  const candidates = new Set(["书签栏", "Bookmarks bar", "Bookmarks Bar", "Bookmarks Bar"]);
  const queue = [...tree];

  while (queue.length > 0) {
    const node = queue.shift();
    if (node.id === "1" || candidates.has(node.title)) return node;
    queue.push(...(node.children || []));
  }

  return null;
}

async function getTree() {
  return chrome.bookmarks.getTree();
}

// chrome.bookmarks.get() does not include children, so load them explicitly before
// checking for existing folders. This keeps folder creation idempotent.
async function getNode(id) {
  const nodes = await chrome.bookmarks.get(id);
  const node = nodes[0];

  if (node && !node.url) {
    node.children = await chrome.bookmarks.getChildren(id);
  }

  return node;
}

async function ensureFolder(parentId, title) {
  const parent = await getNode(parentId);
  const existing = findChild(parent, title);

  if (existing && !existing.url) return existing;
  return chrome.bookmarks.create({ parentId, title });
}

async function ensurePath(parentId, path) {
  let current = await getNode(parentId);

  for (const title of path) {
    current = await ensureFolder(current.id, title);
  }

  return current;
}

function addFolderAction(actions, node, destination, note = "") {
  actions.push({
    kind: "folder",
    id: node.id,
    source: node.title,
    destination,
    count: countBookmarks(node),
    note
  });
}

function addBookmarkAction(actions, node, destination, note = "") {
  actions.push({
    kind: "bookmark",
    id: node.id,
    source: node.title,
    destination,
    count: 1,
    note
  });
}

function makePlan(tree) {
  const bar = findBookmarkBar(tree);
  if (!bar) throw new Error("Could not find the Chrome bookmarks bar.");

  const actions = [];
  const targetSet = new Set(TARGET_ROOTS);

  for (const node of bar.children || []) {
    if (targetSet.has(node.title)) continue;

    if (node.title === "已导入") {
      addFolderAction(
        actions,
        node,
        ["99_Archive", "Imported_Safari"],
        "Keep the original Safari tree intact."
      );
      continue;
    }

    if (node.title === "LOYD") {
      const directBookmarks = (node.children || []).filter(isBookmark);

      for (const bookmark of directBookmarks) {
        addBookmarkAction(
          actions,
          bookmark,
          ["00_Inbox", "LOYD_Direct"],
          "A direct bookmark under LOYD needs manual review."
        );
      }

      for (const child of node.children || []) {
        if (isBookmark(child)) continue;

        const destination = LOYD_MAP[child.title] || ["99_Archive", "LOYD_Other"];
        addFolderAction(actions, child, destination, `Source path: LOYD / ${child.title}`);
      }

      actions.push({
        kind: "folder",
        id: node.id,
        source: node.title,
        destination: ["99_Archive", "Original_Folders"],
        count: 0,
        note: "Keep an empty source marker after its children are moved."
      });
      continue;
    }

    const destination = TOP_LEVEL_MAP[node.title] || ["00_Inbox"];
    addFolderAction(actions, node, destination, `Source top-level folder: ${node.title}`);
  }

  for (const node of bar.children || []) {
    if (isBookmark(node)) {
      addBookmarkAction(actions, node, ["00_Inbox"], "A bookmark directly on the bookmarks bar.");
    }
  }

  return {
    targetRoots: TARGET_ROOTS,
    actionCount: actions.length,
    bookmarkCount: actions.reduce((sum, action) => sum + action.count, 0),
    actions
  };
}

async function executePlan(plan) {
  const tree = await getTree();
  const bar = findBookmarkBar(tree);
  if (!bar) throw new Error("Could not find the Chrome bookmarks bar.");

  for (const title of TARGET_ROOTS) {
    await ensureFolder(bar.id, title);
  }

  const results = [];

  for (const action of plan.actions) {
    const node = await getNode(action.id).catch(() => null);

    if (!node) {
      results.push({ ...action, status: "missing" });
      continue;
    }

    const destination = await ensurePath(bar.id, action.destination);

    if (node.id === destination.id || (action.kind === "folder" && action.id === destination.id)) {
      results.push({ ...action, status: "skipped_self" });
      continue;
    }

    if (action.kind === "folder" && action.source === "已导入") {
      await chrome.bookmarks.update(node.id, { title: "Imported_Safari" });
    }

    await chrome.bookmarks.move(node.id, { parentId: destination.id });
    results.push({ ...action, status: "moved" });
  }

  return {
    actionCount: results.length,
    movedCount: results.filter((item) => item.status === "moved").length,
    missingCount: results.filter((item) => item.status === "missing").length,
    results
  };
}

async function repairDuplicateTargetRoots() {
  const tree = await getTree();
  const bar = findBookmarkBar(tree);
  if (!bar) throw new Error("Could not find the Chrome bookmarks bar.");

  const directChildren = await chrome.bookmarks.getChildren(bar.id);
  const canonical = new Map();
  const duplicates = [];

  for (const node of directChildren) {
    if (!TARGET_ROOTS.includes(node.title)) continue;

    if (!canonical.has(node.title)) canonical.set(node.title, node);
    else duplicates.push(node);
  }

  for (const title of TARGET_ROOTS) {
    if (!canonical.has(title)) canonical.set(title, await ensureFolder(bar.id, title));
  }

  let movedChildCount = 0;

  for (const duplicate of duplicates) {
    const destination = canonical.get(duplicate.title);
    const children = await chrome.bookmarks.getChildren(duplicate.id);

    for (const child of children) {
      await chrome.bookmarks.move(child.id, { parentId: destination.id });
      movedChildCount += 1;
    }

    await chrome.bookmarks.removeTree(duplicate.id);
  }

  let nestedMigrationFolderCount = 0;
  let nestedMigrationMovedChildCount = 0;
  const pending = canonical.get("00_Inbox");
  const pendingChildren = await chrome.bookmarks.getChildren(pending.id);
  const directFolders = pendingChildren.filter(
    (node) => !node.url && node.title === "LOYD_Direct"
  );

  if (directFolders.length > 1) {
    const destination = directFolders[0];

    for (const duplicate of directFolders.slice(1)) {
      const children = await chrome.bookmarks.getChildren(duplicate.id);

      for (const child of children) {
        await chrome.bookmarks.move(child.id, { parentId: destination.id });
        nestedMigrationMovedChildCount += 1;
      }

      await chrome.bookmarks.removeTree(duplicate.id);
      nestedMigrationFolderCount += 1;
    }
  }

  let flattenedSafariFolderCount = 0;
  let flattenedSafariMovedChildCount = 0;
  const archive = canonical.get("99_Archive");
  const archiveChildren = await chrome.bookmarks.getChildren(archive.id);
  const safariArchive = archiveChildren.find(
    (node) => !node.url && node.title === "Imported_Safari"
  );

  if (safariArchive) {
    const nestedChildren = await chrome.bookmarks.getChildren(safariArchive.id);
    const nestedSafariFolders = nestedChildren.filter(
      (node) => !node.url && node.title === "Imported_Safari"
    );

    for (const nested of nestedSafariFolders) {
      const children = await chrome.bookmarks.getChildren(nested.id);

      for (const child of children) {
        await chrome.bookmarks.move(child.id, { parentId: safariArchive.id });
        flattenedSafariMovedChildCount += 1;
      }

      await chrome.bookmarks.removeTree(nested.id);
      flattenedSafariFolderCount += 1;
    }
  }

  return {
    duplicateFolderCount: duplicates.length,
    movedChildCount,
    removedEmptyFolderCount: duplicates.length,
    nestedMigrationFolderCount,
    nestedMigrationMovedChildCount,
    flattenedSafariFolderCount,
    flattenedSafariMovedChildCount
  };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    try {
      if (message.type === "plan") {
        const tree = await getTree();
        sendResponse({ ok: true, plan: makePlan(tree) });
        return;
      }

      if (message.type === "execute") {
        const tree = await getTree();
        const plan = makePlan(tree);
        const result = await executePlan(plan);
        sendResponse({ ok: true, plan, result });
        return;
      }

      if (message.type === "repair") {
        const result = await repairDuplicateTargetRoots();
        sendResponse({ ok: true, result });
        return;
      }

      sendResponse({ ok: false, error: "Unknown operation." });
    } catch (error) {
      sendResponse({ ok: false, error: error.message || String(error) });
    }
  })();

  return true;
});
