import {
  CUSTOM_SOUND_DATA_KEY,
  CUSTOM_SOUND_ID,
  SOUNDS,
  playTone,
} from '@/lib/sounds';

export default defineContentScript({
  matches: ['https://chatgpt.com/*'],

  main() {
    const AUDIO_URL = chrome.runtime.getURL('notification.mp3');
    const defaultAudio = new Audio(AUDIO_URL);
    const VOLUME_STORAGE_KEY = 'chatgpt_notifier_volume';
    const SOUND_STORAGE_KEY = 'chatgpt_notifier_sound_id';

    let currentSoundId = 'default';
    let currentVolume = 0.5;
    let customSoundDataUrl = '';
    let customSoundBuffer: AudioBuffer | null = null;
    let customSoundDecodePromise: Promise<void> | null = null;
    let customSoundDecodeVersion = 0;

    function dataUrlToArrayBuffer(dataUrl: string) {
      const commaIndex = dataUrl.indexOf(',');
      if (commaIndex < 0) throw new Error('Invalid custom sound data URL.');

      const metadata = dataUrl.slice(0, commaIndex);
      const encodedData = dataUrl.slice(commaIndex + 1);

      if (/;base64(?:;|$)/i.test(metadata)) {
        const binary = atob(encodedData);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i += 1) {
          bytes[i] = binary.charCodeAt(i);
        }
        return bytes.buffer;
      }

      return new TextEncoder().encode(decodeURIComponent(encodedData)).buffer;
    }

    async function decodeCustomSound(dataUrl: string, version: number) {
      let decodeContext: AudioContext | null = null;

      try {
        const audioData = dataUrlToArrayBuffer(dataUrl);
        decodeContext = new AudioContext();
        const buffer = await decodeContext.decodeAudioData(audioData.slice(0));

        if (version !== customSoundDecodeVersion || dataUrl !== customSoundDataUrl) return;
        customSoundBuffer = buffer;
      } catch {
        if (version !== customSoundDecodeVersion || dataUrl !== customSoundDataUrl) return;
        customSoundBuffer = null;
      } finally {
        if (decodeContext) {
          void decodeContext.close().catch(() => {
            // The temporary context is only used to decode the cached audio buffer.
          });
        }
      }
    }

    function setCustomSoundData(dataUrl: string) {
      customSoundDataUrl = dataUrl;
      customSoundBuffer = null;
      customSoundDecodeVersion += 1;
      const version = customSoundDecodeVersion;

      if (!dataUrl) {
        customSoundDecodePromise = null;
        return;
      }

      customSoundDecodePromise = decodeCustomSound(dataUrl, version);
    }

    async function playCustomSound() {
      if (!customSoundBuffer && customSoundDecodePromise) {
        await customSoundDecodePromise;
      }

      if (!customSoundBuffer) {
        throw new Error('Custom sound could not be decoded.');
      }

      const ctx = new AudioContext();
      try {
        if (ctx.state === 'suspended') await ctx.resume();

        const source = ctx.createBufferSource();
        const gain = ctx.createGain();
        source.buffer = customSoundBuffer;
        gain.gain.value = currentVolume;
        source.connect(gain);
        gain.connect(ctx.destination);
        source.addEventListener('ended', () => {
          void ctx.close().catch(() => {
            // Playback already completed; context cleanup is best-effort.
          });
        }, { once: true });
        const playbackLeadTimeSeconds = 0.12;
        const scheduledStartTime = ctx.currentTime + playbackLeadTimeSeconds;
        source.start(scheduledStartTime);
      } catch (error) {
        void ctx.close().catch(() => {
          // Preserve the original playback error.
        });
        throw error;
      }
    }

    chrome.storage.local.get(
      [VOLUME_STORAGE_KEY, SOUND_STORAGE_KEY, CUSTOM_SOUND_DATA_KEY],
      (result) => {
        const vol = result[VOLUME_STORAGE_KEY];
        if (typeof vol === 'number') {
          currentVolume = vol;
          defaultAudio.volume = vol;
        }

        const soundId = result[SOUND_STORAGE_KEY] as string | undefined;
        if (soundId) currentSoundId = soundId;

        setCustomSoundData((result[CUSTOM_SOUND_DATA_KEY] as string) || '');
      },
    );

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;

      if (changes[VOLUME_STORAGE_KEY]) {
        const newVol = changes[VOLUME_STORAGE_KEY].newValue;
        if (typeof newVol === 'number') {
          currentVolume = newVol;
          defaultAudio.volume = newVol;
        }
      }

      if (changes[SOUND_STORAGE_KEY]) {
        const newSound = changes[SOUND_STORAGE_KEY].newValue as string | undefined;
        currentSoundId = newSound || 'default';
      }

      if (changes[CUSTOM_SOUND_DATA_KEY]) {
        setCustomSoundData((changes[CUSTOM_SOUND_DATA_KEY].newValue as string) || '');
      }
    });

    async function playNotification() {
      if (currentSoundId === CUSTOM_SOUND_ID && customSoundDataUrl) {
        try {
          await playCustomSound();
        } catch {
          defaultAudio.volume = currentVolume;
          defaultAudio.currentTime = 0;
          void defaultAudio.play().catch(() => {
            // If custom playback fails, the bundled sound is a best-effort fallback.
          });
        }
        return;
      }

      const sound = SOUNDS.find((s) => s.id === currentSoundId);
      if (sound && sound.freqs.length > 0) {
        try {
          playTone(sound.freqs, currentVolume, sound.type);
        } catch {
          // Playback failures should not interfere with response detection.
        }
        return;
      }

      defaultAudio.volume = currentVolume;
      defaultAudio.currentTime = 0;
      void defaultAudio.play().catch(() => {
        // Playback failures should not interfere with response detection.
      });
    }

    type StreamingSignal = {
      kind: 'generation' | 'activity';
    };

    const GENERATION_STREAM_SELECTORS = [
      '.result-streaming',
      'button[data-testid$="stop-button"]',
      'button[aria-label="Stop"]',
      'button[aria-label="Stop generating"]',
      '[data-message-author-role="assistant"][aria-busy="true"]',
    ];
    const ACTIVITY_STREAM_SELECTORS = [
      '[data-testid="assistant-response-spinner"]',
    ];

    // ChatGPT currently has more than one turn renderer in production. Keep the
    // selectors deliberately redundant so a response can be recognized in the
    // classic turn layout as well as the newer grouped data-turn-key layout.
    const ASSISTANT_TURN_SELECTORS = [
      'section[data-turn="assistant"]',
      'article[data-turn="assistant"]',
      '[data-testid^="conversation-turn-"][data-turn="assistant"]',
      '[data-testid^="conversation-turn-"][data-message-author-role="assistant"]',
      '[data-testid^="conversation-turn-"]:has([data-message-author-role="assistant"])',
      '[data-turn-key]:has([data-conversation-role="assistant"], [data-chatgpt-agent-turn-start])',
      '[data-message-author-role="assistant"]',
      '[data-role="assistant"]',
    ];

    // Completed assistant responses expose response actions (most reliably
    // Copy). Thinking/tool-phase transitions do not. This gives us a terminal
    // signal without treating a temporary Stop-button gap as completion.
    const FINAL_RESPONSE_ACTION_SELECTORS = [
      'button[data-testid="copy-turn-action-button"]',
      'button[aria-label*="Copy response" i]',
      '.turn-action-controls button[data-testid*="copy" i]',
      '.turn-action-controls button[aria-label*="Copy" i]',
    ];

    let responseCycleActive = false;
    let responseCycleId = 0;
    let notifiedCycleId = 0;
    let doneTimerId: ReturnType<typeof setTimeout> | null = null;
    let pollTimerId: ReturnType<typeof setInterval> | null = null;

    let idleAssistantTurn: Element | null = null;
    let idleAssistantHadFinalAction = false;
    let idleFinalActions = new Set<Element>();

    let cycleBaselineAssistantTurn: Element | null = null;
    let cycleBaselineAssistantHadFinalAction = false;
    let cycleBaselineFinalActions = new Set<Element>();
    let cycleAssistantTurn: Element | null = null;
    let cycleSawFinalActionAbsent = false;
    let cycleSawGenerationSignal = false;
    let completionWaitStartedAt = 0;

    const COMPLETION_SETTLE_MS = 750;
    const FINAL_ACTION_FALLBACK_MS = 30000;
    const COMPLETION_RECHECK_MS = 250;
    const POLL_INTERVAL_MS = 500;

    function findStreamingSignal(): StreamingSignal | null {
      for (const selector of GENERATION_STREAM_SELECTORS) {
        if (document.querySelector(selector)) return { kind: 'generation' };
      }

      const matchingButton = Array.from(
        document.querySelectorAll<HTMLButtonElement>('button[aria-label]'),
      ).find((button) => {
        const label = (button.getAttribute('aria-label') || '').trim().toLowerCase();
        return label === 'stop' || label.startsWith('stop generat') || label === 'stop response';
      });

      if (matchingButton) {
        return { kind: 'generation' };
      }

      for (const selector of ACTIVITY_STREAM_SELECTORS) {
        if (document.querySelector(selector)) return { kind: 'activity' };
      }

      return null;
    }

    function getLatestAssistantTurn() {
      const selector = ASSISTANT_TURN_SELECTORS.join(', ');
      const turns = Array.from(document.querySelectorAll<HTMLElement>(selector));
      return turns.length > 0 ? turns[turns.length - 1] : null;
    }

    function getFinalActions(root: ParentNode = document) {
      const seen = new Set<Element>();
      const actions: Element[] = [];

      for (const selector of FINAL_RESPONSE_ACTION_SELECTORS) {
        root.querySelectorAll(selector).forEach((element) => {
          const button = element as HTMLButtonElement;
          if (button.disabled || seen.has(element)) return;
          seen.add(element);
          actions.push(element);
        });
      }

      return actions;
    }

    function hasFinalResponseAction(turn: Element | null) {
      if (!turn) return false;
      return getFinalActions(turn).length > 0;
    }

    function refreshIdleAssistantSnapshot() {
      idleAssistantTurn = getLatestAssistantTurn();
      idleAssistantHadFinalAction = hasFinalResponseAction(idleAssistantTurn);
      idleFinalActions = new Set(getFinalActions());
    }

    function findNewGlobalFinalAction() {
      return getFinalActions().find((action) => !cycleBaselineFinalActions.has(action)) || null;
    }

    function updateCycleCompletionState() {
      if (!responseCycleActive) {
        return {
          currentTurnFinalActionPresent: false,
          newGlobalFinalActionPresent: false,
        };
      }

      const latestTurn = getLatestAssistantTurn();
      const latestTurnHasFinalAction = hasFinalResponseAction(latestTurn);
      const isNewTurn = Boolean(latestTurn && latestTurn !== cycleBaselineAssistantTurn);
      const baselineTurnBecameActive = Boolean(
        latestTurn
        && latestTurn === cycleBaselineAssistantTurn
        && cycleBaselineAssistantHadFinalAction
        && !latestTurnHasFinalAction
      );
      const baselineTurnWasAlreadyActive = Boolean(
        latestTurn
        && latestTurn === cycleBaselineAssistantTurn
        && !cycleBaselineAssistantHadFinalAction
      );

      if (latestTurn && (isNewTurn || baselineTurnBecameActive || baselineTurnWasAlreadyActive)) {
        cycleAssistantTurn = latestTurn;
        if (!latestTurnHasFinalAction) {
          cycleSawFinalActionAbsent = true;
        }
      }

      const currentTurnFinalActionPresent = Boolean(
        cycleAssistantTurn
        && cycleAssistantTurn === latestTurn
        && latestTurnHasFinalAction
        && cycleSawFinalActionAbsent
      );
      const newGlobalFinalActionPresent = Boolean(findNewGlobalFinalAction());

      return {
        currentTurnFinalActionPresent,
        newGlobalFinalActionPresent,
      };
    }

    function startResponseCycle() {
      responseCycleId += 1;
      responseCycleActive = true;
      cycleBaselineAssistantTurn = idleAssistantTurn;
      cycleBaselineAssistantHadFinalAction = idleAssistantHadFinalAction;
      cycleBaselineFinalActions = new Set(idleFinalActions);
      cycleAssistantTurn = null;
      cycleSawFinalActionAbsent = false;
      cycleSawGenerationSignal = false;
      completionWaitStartedAt = 0;

      updateCycleCompletionState();
    }

    function finishResponseCycle() {
      responseCycleActive = false;
      cycleBaselineAssistantTurn = null;
      cycleBaselineAssistantHadFinalAction = false;
      cycleBaselineFinalActions = new Set<Element>();
      cycleAssistantTurn = null;
      cycleSawFinalActionAbsent = false;
      cycleSawGenerationSignal = false;
      completionWaitStartedAt = 0;
      refreshIdleAssistantSnapshot();
    }

    function notifyDone() {
      if (!responseCycleActive || notifiedCycleId === responseCycleId) {
        return;
      }

      notifiedCycleId = responseCycleId;
      void playNotification();

      void chrome.runtime.sendMessage({
        type: 'CHATGPT_REPLY_DONE',
        payload: {
          title: 'ChatGPT Notifier',
          message: 'ChatGPT has finished responding.',
        },
      }).catch(() => {
        // The sound should still play even if the background worker is unavailable.
      });
    }

    function clearDoneTimer() {
      if (doneTimerId) {
        clearTimeout(doneTimerId);
      }
      doneTimerId = null;
    }

    function recordStreamingSignal(signal: StreamingSignal) {
      if (!responseCycleActive) {
        startResponseCycle();
      }

      if (signal.kind === 'generation') cycleSawGenerationSignal = true;
      updateCycleCompletionState();
      clearDoneTimer();
    }

    function confirmCompletionAfterQuiet() {
      doneTimerId = null;
      if (!responseCycleActive) return;

      const resumedSignal = findStreamingSignal();
      if (resumedSignal) {
        recordStreamingSignal(resumedSignal);
        return;
      }

      const completionState = updateCycleCompletionState();
      if (
        completionState.currentTurnFinalActionPresent
        || completionState.newGlobalFinalActionPresent
      ) {
        notifyDone();
        finishResponseCycle();
        return;
      }

      const quietElapsedMs = Date.now() - completionWaitStartedAt;
      if (quietElapsedMs < FINAL_ACTION_FALLBACK_MS) {
        doneTimerId = setTimeout(confirmCompletionAfterQuiet, COMPLETION_RECHECK_MS);
        return;
      }

      if (cycleSawGenerationSignal) {
        notifyDone();
      }

      finishResponseCycle();
    }

    function checkStreaming() {
      const signal = findStreamingSignal();

      if (signal) {
        recordStreamingSignal(signal);
        return;
      }

      if (!responseCycleActive) {
        refreshIdleAssistantSnapshot();
        return;
      }

      updateCycleCompletionState();
      if (doneTimerId) return;

      completionWaitStartedAt = Date.now();
      doneTimerId = setTimeout(confirmCompletionAfterQuiet, COMPLETION_SETTLE_MS);
    }

    refreshIdleAssistantSnapshot();

    const observer = new MutationObserver(() => {
      queueMicrotask(checkStreaming);
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: [
        'class',
        'data-testid',
        'aria-label',
        'aria-busy',
        'data-turn',
        'data-turn-key',
        'data-conversation-role',
        'data-chatgpt-agent-turn-start',
        'disabled',
      ],
    });

    pollTimerId = setInterval(checkStreaming, POLL_INTERVAL_MS);

    window.addEventListener('pagehide', () => {
      observer.disconnect();
      clearDoneTimer();
      if (pollTimerId) clearInterval(pollTimerId);
    });

    checkStreaming();
  },
});
