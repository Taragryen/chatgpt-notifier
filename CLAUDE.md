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
| `entrypoints/background.ts` | Service worker. Listens for `CHATGPT_REPLY_DONE` from the content script and creates a system notification when enabled. |
| `entrypoints/content.ts` | Injected into `chatgpt.com`. Tracks logical response cycles across thinking/generation phases, plays the selected sound once completion is confirmed, and notifies the background worker. |
| `entrypoints/popup/` | Extension popup. Sound selection, custom audio, volume, and system-notification settings persisted via `chrome.storage.local`. |

### Shared State (`chrome.storage.local` keys)

- `chatgpt_notifier_volume` — `number` (0–1)
- `chatgpt_notifier_system_notification_enabled` — `boolean`
- `chatgpt_notifier_sound_id` — selected built-in/custom sound ID
- `chatgpt_notifier_sound_collapsed` — sound-picker collapse state
- `chatgpt_notifier_custom_sound_data_url` — custom sound data URL
- `chatgpt_notifier_custom_sound_name` — custom sound filename

### Detection Logic (`entrypoints/content.ts`)

The content script watches ChatGPT's DOM with a `MutationObserver` plus a 500 ms polling fallback.

Generation signals include legacy streaming state, Stop buttons, and busy assistant messages. The assistant response spinner is classified separately as **activity-only**, so thinking/tool transitions do not count as terminal completion.

Each logical response has one response-cycle ID. When active generation/activity signals disappear:

1. wait 750 ms and re-check for resumed activity;
2. confirm completion from the current/new assistant response's completed-response controls (primarily Copy-response actions);
3. keep the same response cycle open across temporary thinking/tool gaps;
4. allow only one notification per cycle;
5. use a 30-second quiet fallback only when generation was observed but ChatGPT's completion markup cannot be found.

The assistant-turn selectors support both classic conversation-turn markup and the newer grouped `data-turn-key` renderer.

### Audio

Built-in synthesized sounds are defined in `lib/sounds.ts`. The bundled fallback sound is `public/notification.mp3`.

Custom sounds are stored as data URLs, decoded into a cached `AudioBuffer`, and played through Web Audio. If custom playback fails, the bundled default sound is attempted as a fallback.

### WXT Config

`wxt.config.ts` defines the manifest: permissions (`storage`, `notifications`), icon, and `web_accessible_resources` for `notification.mp3`.

### Static Assets

- `public/logo.png` — extension icon (128px)
- `public/notification.mp3` — bundled notification sound
- `assets/demo.png` — README screenshot (not shipped in the extension)

## Branch Strategy

- `main` — stable, published version
- Feature branches created off `main`
