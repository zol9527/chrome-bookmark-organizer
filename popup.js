const analyzeButton = document.getElementById("analyze");
const executeButton = document.getElementById("execute");
const repairButton = document.getElementById("repair");
const statusBox = document.getElementById("status");
let currentPlan = null;

function renderPlan(response) {
  if (!response.ok) {
    statusBox.textContent = `Error: ${response.error}`;
    executeButton.disabled = true;
    return;
  }

  currentPlan = response.plan;
  executeButton.disabled = currentPlan.actionCount === 0;

  const lines = [
    `Bookmarks to process: ${currentPlan.bookmarkCount}`,
    `Actions: ${currentPlan.actionCount}`,
    "",
    "Destinations:"
  ];

  for (const action of currentPlan.actions.slice(0, 80)) {
    lines.push(
      `- ${action.source} → ${action.destination.join(" / ")} (${action.count} bookmark${action.count === 1 ? "" : "s"})${action.note ? `; ${action.note}` : ""}`
    );
  }

  if (currentPlan.actions.length > 80) {
    lines.push(`… ${currentPlan.actions.length - 80} more actions omitted`);
  }

  statusBox.textContent = lines.join("\n");
}

function requestPlan() {
  statusBox.textContent = "Reading the current bookmark tree…";
  chrome.runtime.sendMessage({ type: "plan" }, renderPlan);
}

analyzeButton.addEventListener("click", requestPlan);

executeButton.addEventListener("click", () => {
  if (!currentPlan) return;

  const confirmed = window.confirm(
    `Execute the first-phase migration?\n\nAbout ${currentPlan.bookmarkCount} bookmarks will be processed.\nDuplicates will not be deleted, and URLs/titles will not be changed.`
  );

  if (!confirmed) return;

  executeButton.disabled = true;
  analyzeButton.disabled = true;
  statusBox.textContent = "Executing. Please wait…";

  chrome.runtime.sendMessage({ type: "execute" }, (response) => {
    if (!response.ok) {
      statusBox.textContent = `Migration failed: ${response.error}`;
      analyzeButton.disabled = false;
      return;
    }

    statusBox.textContent = [
      "First-phase migration complete.",
      `Total actions: ${response.result.actionCount}`,
      `Moved: ${response.result.movedCount}`,
      `Missing nodes: ${response.result.missingCount}`,
      "",
      "Reopen Bookmark Manager to inspect the result."
    ].join("\n");
  });
});

repairButton.addEventListener("click", () => {
  const confirmed = window.confirm(
    "Repair duplicate target folders?\n\nThis merges same-name target folders, moves their contents, and removes only confirmed empty folder shells. No bookmarks will be deleted."
  );

  if (!confirmed) return;

  analyzeButton.disabled = true;
  executeButton.disabled = true;
  repairButton.disabled = true;
  statusBox.textContent = "Merging duplicate target folders. Please wait…";

  chrome.runtime.sendMessage({ type: "repair" }, (response) => {
    if (!response.ok) {
      statusBox.textContent = `Repair failed: ${response.error}`;
      analyzeButton.disabled = false;
      repairButton.disabled = false;
      return;
    }

    statusBox.textContent = [
      "Duplicate target-folder repair complete.",
      `Merged folders: ${response.result.duplicateFolderCount}`,
      `Moved contained items: ${response.result.movedChildCount}`,
      `Removed empty folder shells: ${response.result.removedEmptyFolderCount}`,
      `Merged migration-generated nested folders: ${response.result.nestedMigrationFolderCount}`,
      `Moved nested-folder contents: ${response.result.nestedMigrationMovedChildCount}`,
      `Flattened redundant Safari wrappers: ${response.result.flattenedSafariFolderCount}`,
      `Moved Safari wrapper contents: ${response.result.flattenedSafariMovedChildCount}`,
      "No bookmarks were deleted."
    ].join("\n");
  });
});

requestPlan();
