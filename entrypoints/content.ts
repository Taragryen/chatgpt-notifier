import { SOUNDS, playTone } from '@/lib/sounds';

export default defineContentScript({
  matches: ['https://chatgpt.com/*'],

  main() {
    const AUDIO_URL = chrome.runtime.getURL('notification.mp3');
    const audio = new Audio(AUDIO_URL);
    const VOLUME_STORAGE_KEY = 'chatgpt_notifier_volume';
    const SOUND_STORAGE_KEY = 'chatgpt_notifier_sound_id';

    let currentSoundId = 'default';
    let currentVolume = 0.5;

    // Initialize volume and sound from storage
    chrome.storage.local.get([VOLUME_STORAGE_KEY, SOUND_STORAGE_KEY], (result) => {
      const vol = result[VOLUME_STORAGE_KEY];
      if (typeof vol === 'number') {
        currentVolume = vol;
        audio.volume = vol;
      }

      const soundId = result[SOUND_STORAGE_KEY] as string | undefined;
      if (soundId) {
        currentSoundId = soundId;
      }
    });

    // Listen for changes from popup
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;

      if (changes[VOLUME_STORAGE_KEY]) {
        const newVol = changes[VOLUME_STORAGE_KEY].newValue;
        if (typeof newVol === 'number') {
          currentVolume = newVol;
          audio.volume = newVol;
        }
      }

      if (changes[SOUND_STORAGE_KEY]) {
        const newSound = changes[SOUND_STORAGE_KEY].newValue as string | undefined;
        currentSoundId = newSound || 'default';
      }
    });

    function playNotification() {
      const sound = SOUNDS.find((s) => s.id === currentSoundId);
      if (sound && sound.freqs.length > 0) {
        playTone(sound.freqs, currentVolume, sound.type);
      } else {
        audio.play().catch(() => {
          /* ignore autoplay restrictions */
        });
      }
    }

    /**
     * All known "streaming" DOM selectors.
     * If OpenAI changes the UI again, just add new selectors here.
     */
    const STREAM_SELECTORS = [
      '.result-streaming',
      'button[data-testid$="stop-button"]',
      '[data-testid="assistant-response-spinner"]',
      // 2026-11 logged-in UI. Both last through thinking and tool phases and
      // clear when the reply completes or is cancelled. markdown-animated is
      // there from send; in_progress starts a few seconds later but does not
      // depend on animation. Keep both.
      '[data-talvt-turn-state="in_progress"]',
      '[data-markdown-animated]',
      // 2026-11 logged-out UI
      '[data-message-streaming]',
      // Do not match the new UI's button[aria-label="Stop"]: a hidden composer
      // keeps a stale one, and a selector that never clears silences every
      // notification.
    ].join(',');

    let isStreaming = false;
    let doneTimerId: ReturnType<typeof setTimeout> | null = null;
    const DEBOUNCE_MS = 300;

    function checkStreaming() {
      const stillStreaming = document.querySelector(STREAM_SELECTORS) !== null;

      if (stillStreaming) {
        isStreaming = true;
        clearTimeout(doneTimerId!);
        doneTimerId = null;
      } else if (isStreaming && !doneTimerId) {
        doneTimerId = setTimeout(() => {
          if (document.querySelector(STREAM_SELECTORS) === null) {
            playNotification();
            chrome.runtime.sendMessage({
              type: 'CHATGPT_REPLY_DONE',
              payload: {
                title: 'ChatGPT Notifier',
                message: 'ChatGPT has finished responding.',
              },
            });
            isStreaming = false;
          }
          doneTimerId = null;
        }, DEBOUNCE_MS);
      }
    }

    const observer = new MutationObserver(() => {
      queueMicrotask(checkStreaming);
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      // Must include every attribute STREAM_SELECTORS matches on.
      attributeFilter: [
        'class',
        'data-testid',
        'aria-busy',
        'data-talvt-turn-state',
        'data-markdown-animated',
        'data-message-streaming',
      ],
    });

    checkStreaming();
  },
});
