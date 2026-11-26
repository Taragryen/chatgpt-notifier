# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Development

```bash
pnpm dev              # Dev mode with HMR (opens browser, auto-reloads extension)
pnpm build            # Production build → .output/chrome-mv3/
pnpm zip              # Production build + .zip for Chrome Web Store upload
npx tsc --noEmit      # TypeScript type check only (no emit)
```

`pnpm` is the package manager. Build scripts for esbuild/spawn-sync must be approved in `pnpm-workspace.yaml` — do not remove that file.

## Architecture

This is a **WXT**-based Chrome extension (Manifest V3). The framework provides `defineBackground`, `defineContentScript`, and popup HTML-first entrypoints — all auto-detected from `entrypoints/`.

### Entrypoints

| Entrypoint | What it does |
|---|---|
| `entrypoints/background.ts` | Service worker. Listens for `CHATGPT_REPLY_DONE` message from content script, creates system notification if the user enabled it. |
| `entrypoints/content.ts` | Injected into `chatgpt.com`. Watches DOM for streaming indicators, plays audio when ChatGPT finishes, sends message to background. |
| `entrypoints/popup/` | Extension popup (260px wide card). Volume slider + system notification toggle. Settings persisted via `chrome.storage.local`. |

### Shared State (chrome.storage.local keys)

- `chatgpt_notifier_volume` — `number` (0–1), read by content script, written by popup
- `chatgpt_notifier_system_notification_enabled` — `boolean`, read by background, written by popup

The content script creates an `Audio` object once and updates `audio.volume` reactively via `chrome.storage.onChanged` — no re-creation on volume change.

### Detection Logic (content script)

Uses a `MutationObserver` on `document.body` (childList, subtree, attributes) to watch for "streaming" DOM nodes. Each mutation fires a `queueMicrotask`-debounced check against a CSS selector list:

- `.result-streaming` — legacy reply container
- `button[data-testid$="stop-button"]` — stop-generating button
- `[data-testid="assistant-response-spinner"]` — new spinner
- `[data-talvt-turn-state="in_progress"]`, `[data-markdown-animated]` — logged-in UI as of 2026-11
- `[data-message-streaming]` — logged-out UI as of 2026-11

The list is an OR: a selector that never clears blocks every notification, so only add signals that disappear when the reply ends. The new UI's `button[aria-label="Stop"]` does not qualify (a hidden composer keeps a stale one). Attributes used here must also be in the observer's `attributeFilter`.

When streaming stops, a 300ms debounce timer fires, then re-checks selectors before playing audio and messaging the background. If new streaming starts before the timer fires, it's cancelled.

### WXT Config

`wxt.config.ts` defines the manifest: permissions (`storage`, `notifications`), icon, and `web_accessible_resources` for `notification.mp3` (needed by content script's `chrome.runtime.getURL()`).

### Static Assets

- `public/logo.png` — extension icon (128px)
- `public/notification.mp3` — notification sound, played by content script
- `assets/demo.png` — README screenshot (not shipped in the extension)

## Branch Strategy

- `main` — stable, published version
- Feature branches created off `main`
