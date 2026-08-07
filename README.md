# Chrome Bookmark Organizer

A local Manifest V3 Chrome extension for previewing and organizing bookmarks.

## Safety boundaries

- Requires only the `bookmarks` permission.
- Keeps the original Safari-imported tree intact.
- Separates preview generation from execution.
- Does not send bookmark data to a remote service.
- The first-phase migration moves folders and bookmarks only; it does not delete bookmarks or rewrite URLs.
- Duplicate-folder repair removes only folder shells after their children have been moved.

## Load locally

1. Open `chrome://extensions` in Chrome.
2. Enable **Developer mode**.
3. Choose **Load unpacked**.
4. Select this project directory.

The extension is intentionally dependency-free. Edit `background.js`, `popup.html`, or `popup.js`, then use **Reload** on the extension card.

## Current folder model

The target folder names use English labels with numeric prefixes:

- `00_Inbox`
- `01_Favorites`
- `10_Work_Projects`
- `20_Development_Engineering`
- `30_AI_Agents`
- `40_Cybersecurity`
- `50_Learning_Research`
- `60_Servers_Self_Hosting`
- `70_Online_Tools_Services`
- `80_Career_Jobs`
- `90_Personal_Life`
- `99_Archive`

The source-folder maps still include the Chinese names from the existing migrated Chrome tree. Update `TOP_LEVEL_MAP` and `LOYD_MAP` if your source folders have been renamed.
