# Workflow

## Real-browser repro checklist

1. Build the browser-specific artifact.
2. Verify the manifest in the expected output directory.
3. Launch a fresh browser instance with the unpacked extension.
4. Confirm the worker/pages before continuing.
5. Reproduce the issue.
6. Read live DOM/runtime state after the repro, not just screenshots.
7. If needed, add temporary instrumentation to the extension-local layer and rebuild.

## When the user already has Chrome open

Use this path first when:
- the site requires the user's existing login state
- the target page is already open and reproducing the issue
- the extension is already installed in that running Chrome
- the user explicitly says not to start a new Chrome instance

Do this:
1. Attach to the existing `Google Chrome` window with `mcp__computer_use__`.
2. Keep the user's current repro tab. Do not replace it with a fresh browser profile.
3. If you rebuilt the extension, open `chrome://extensions/` in the same running Chrome and click `重新加载` on the target extension card.
4. Return to the original repro page in the same window and reload that page if needed.
5. Reproduce with real clicks, scrolls, and tab changes in the live window.
6. If DevTools is already open in that same window, treat that DevTools view as the source of truth for:
   - Elements
   - Console
   - Performance live metrics such as INP
7. Verify the fix with live evidence from that same logged-in session.

Important limitation:
- `mcp__chrome_devtools__` does not automatically attach to an arbitrary Chrome the user already has open.
- If that Chrome was not started with `--remote-debugging-port`, the DevTools MCP will not control it.
- In that case, use `mcp__computer_use__` plus Chrome's own built-in DevTools UI inside the running window.

Good evidence from this workflow:
- the same GitHub page that was previously laggy can now scroll and accept clicks
- a real link click in that window navigates successfully
- live INP drops back to a normal value after interaction
- the extension's injected UI is visibly present or absent exactly as expected
- `chrome://extensions/` shows the unpacked extension reload succeeded

If you temporarily changed site rules to isolate the bug, such as adding `github.com` to a blacklist, remove that temporary rule before final verification.

## How to reason about UI bugs

### Tooltip / popover bugs

Do not stop at "the node still exists."

Inspect:
- `data-open`
- `data-closed`
- `data-starting-style`
- `data-ending-style`
- computed `opacity`
- computed `visibility`
- computed `pointer-events`
- whether the close event actually fired

Important distinction:
- If `onOpenChange(false)` never fires, the event chain is wrong.
- If `onOpenChange(false)` fires but the element remains visible, the closed-state styling or unmount flow is wrong.

### Hover bugs

Inspect `relatedTarget` on leave events.

If the pointer leaves the trigger and lands on the tooltip's own overlay or positioner, the hover chain is contaminated. In those cases:
- the tooltip overlay may need `pointer-events-none`
- the extension-local tooltip wrapper may need a stronger closed-state style

### Build-only bugs

When a bug appears only after `build`:
- reproduce against the built artifact first
- do not assume the dev server path is relevant
- compare dev/build only after you have real evidence from the built version

## Read-frog page-translation capture recipe

1. Build the extension.
2. Launch Edge with a fresh profile and the unpacked build.
3. Open the target content page first.
4. Open `chrome-extension://<id>/popup.html`.
5. From the popup page, use `chrome.storage.local` to set:
   - `language.targetCode = 'cmn'`
   - `translate.providerId = 'microsoft-translate-default'`
   - `translate.page.range = 'all'`
   - `translate.requestQueueConfig = { rate: 1, capacity: 1 }`
   - `translate.batchQueueConfig = { maxItemsPerBatch: 1, maxCharactersPerBatch: 160 }`
6. Trigger page translation by sending:

```js
await chrome.runtime.sendMessage({
  id: Date.now(),
  type: 'tryToSetEnablePageTranslationByTabId',
  data: { tabId, enabled: true },
  timestamp: Date.now(),
});
```

7. Wait for loading evidence:

```js
await page.waitForFunction(
  () => document.querySelectorAll('.read-frog-spinner').length >= 4,
  null,
  { timeout: 45000 },
);
```

8. Record DOM evidence at capture time:
   - spinner count
   - sample inline spinner style strings
9. Take the raw screenshot.
10. Keep waiting until translated wrapper nodes contain Chinese text to prove the run was real.

## Honesty rules for screenshots

- Raw before and raw after screenshots are the source of truth.
- A crop is a crop, not a raw full-page screenshot.
- A stitched comparison board is a comparison graphic, not a raw screenshot.
- If the element is tiny and hard to see in a full-page shot, keep the raw shot and add a labeled crop as supplemental evidence.

## Common signals for read-frog

Loading-time signals:
- `.read-frog-spinner`
- inline spinner style strings

Completion-time signals:
- `.read-frog-translated-content-wrapper`
- Chinese characters in translated text
- translated page title

## Common pitfall seen in this workflow

The popup could show a recovery-mode error like `e?.trim is not a function` while the content-page translation flow still worked. Treat that as a separate issue and verify the actual target behavior directly.
