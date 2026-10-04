import {
  CUSTOM_SOUND_DATA_KEY,
  CUSTOM_SOUND_ID,
  CUSTOM_SOUND_NAME_KEY,
  SOUNDS,
  playTone,
} from '@/lib/sounds';

document.addEventListener('DOMContentLoaded', () => {
  const slider = document.getElementById('volumeSlider') as HTMLInputElement;
  const valueDisplay = document.getElementById('volumeValue')!;
  const systemNotifyToggle = document.getElementById('systemNotifyToggle') as HTMLInputElement;
  const soundList = document.getElementById('soundList')!;
  const soundOptions = document.getElementById('soundOptions')!;
  const customSoundControls = document.getElementById('customSoundControls')!;
  const customSoundInput = document.getElementById('customSoundInput') as HTMLInputElement;
  const chooseCustomSoundButton = document.getElementById('chooseCustomSound') as HTMLButtonElement;
  const resetCustomSoundButton = document.getElementById('resetCustomSound') as HTMLButtonElement;
  const previewCustomSoundButton = document.getElementById('previewCustomSound') as HTMLButtonElement;
  const customSoundNameLabel = document.getElementById('customSoundName')!;
  const customSoundMeta = document.getElementById('customSoundMeta')!;
  const customSoundStatus = document.getElementById('customSoundStatus')!;
  const VOLUME_STORAGE_KEY = 'chatgpt_notifier_volume';
  const SYSTEM_NOTIFICATION_KEY = 'chatgpt_notifier_system_notification_enabled';
  const SOUND_STORAGE_KEY = 'chatgpt_notifier_sound_id';
  const SOUND_COLLAPSED_KEY = 'chatgpt_notifier_sound_collapsed';
  const MAX_CUSTOM_SOUND_BYTES = 5 * 1024 * 1024;

  const defaultAudio = new Audio(chrome.runtime.getURL('notification.mp3'));
  let customAudio: HTMLAudioElement | null = null;
  let customSoundDataUrl = '';
  let customSoundName = '';


  // Set version from manifest
  const versionLabel = document.getElementById('versionLabel')!;
  versionLabel.textContent = `v${chrome.runtime.getManifest().version}`;

  // --- Sound collapsible ---
  const soundHeader = document.getElementById('soundHeader')!;
  const soundChevron = document.getElementById('soundChevron')!;

  function setSoundOpen(open: boolean) {
    soundOptions.classList.toggle('collapsed', !open);
    soundChevron.classList.toggle('open', open);
  }

  soundHeader.addEventListener('click', () => {
    const collapsed = soundOptions.classList.contains('collapsed');
    setSoundOpen(collapsed);
    chrome.storage.local.set({ [SOUND_COLLAPSED_KEY]: collapsed });
  });

  // --- Sound list ---
  let activeSoundId = 'default';

  function setStatus(message: string, isError = false) {
    customSoundStatus.textContent = message;
    customSoundStatus.classList.toggle('error', isError);
  }

  function updateCustomSoundUi() {
    const isCustomSelected = activeSoundId === CUSTOM_SOUND_ID;
    customSoundControls.classList.toggle('visible', isCustomSelected);
    customSoundNameLabel.textContent = customSoundName;
    customSoundMeta.hidden = !customSoundDataUrl;
  }

  function setCustomAudio(dataUrl: string) {
    customSoundDataUrl = dataUrl;
    customAudio?.pause();
    customAudio = dataUrl ? new Audio(dataUrl) : null;
    if (customAudio) {
      customAudio.volume = parseFloat(slider.value || '0.5');
    }
  }

  function preview(soundId: string) {
    const vol = parseFloat(slider.value);

    if (soundId === CUSTOM_SOUND_ID) {
      if (!customAudio) {
        setStatus('Choose an audio file first.');
        customSoundInput.click();
        return;
      }

      customAudio.volume = vol;
      customAudio.currentTime = 0;
      void customAudio.play().catch(() => {
        setStatus('This audio file could not be played.', true);
      });
      return;
    }

    const sound = SOUNDS.find((s) => s.id === soundId);
    if (!sound) return;

    if (sound.freqs.length > 0) {
      try {
        playTone(sound.freqs, vol, sound.type);
      } catch {
        // Preview failures should not break the popup controls.
      }
      return;
    }

    defaultAudio.volume = vol;
    defaultAudio.currentTime = 0;
    void defaultAudio.play().catch(() => {
      // Preview failures should not break the popup controls.
    });
  }

  function renderSoundList() {
    soundList.innerHTML = '';
    SOUNDS.forEach((sound) => {
      const item = document.createElement('div');
      item.className = `sound-item${sound.id === activeSoundId ? ' active' : ''}`;

      item.innerHTML = `<span class="sound-dot"></span><span class="sound-name">${sound.name}</span>`;

      item.addEventListener('click', () => {
        activeSoundId = sound.id;
        chrome.storage.local.set({ [SOUND_STORAGE_KEY]: sound.id });
        renderSoundList();
        updateCustomSoundUi();
        if (sound.id !== CUSTOM_SOUND_ID || customSoundDataUrl) {
          preview(sound.id);
        }
      });

      soundList.appendChild(item);
    });
  }

  function fileToDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  }

  chooseCustomSoundButton.addEventListener('click', () => {
    customSoundInput.click();
  });

  previewCustomSoundButton.addEventListener('click', () => {
    preview(CUSTOM_SOUND_ID);
  });

  customSoundInput.addEventListener('change', async () => {
    const file = customSoundInput.files?.[0];
    customSoundInput.value = '';
    if (!file) return;

    const recognizedAudio =
      file.type.startsWith('audio/') || /\.(mp3|wav|ogg|m4a|aac|flac|webm)$/i.test(file.name);

    if (!recognizedAudio) {
      setStatus('Choose a supported audio file.', true);
      return;
    }

    if (file.size > MAX_CUSTOM_SOUND_BYTES) {
      setStatus('Custom sounds must be 5 MB or smaller.', true);
      return;
    }

    try {
      const dataUrl = await fileToDataUrl(file);
      chrome.storage.local.set(
        {
          [CUSTOM_SOUND_DATA_KEY]: dataUrl,
          [CUSTOM_SOUND_NAME_KEY]: file.name,
          [SOUND_STORAGE_KEY]: CUSTOM_SOUND_ID,
        },
        () => {
          if (chrome.runtime.lastError) {
            setStatus(`Could not save sound: ${chrome.runtime.lastError.message}`, true);
            return;
          }

          customSoundName = file.name;
          setCustomAudio(dataUrl);
          activeSoundId = CUSTOM_SOUND_ID;
          updateCustomSoundUi();
          renderSoundList();
          setStatus('Custom sound saved.');
          preview(CUSTOM_SOUND_ID);
        },
      );
    } catch {
      setStatus('Could not read that audio file.', true);
    }
  });

  resetCustomSoundButton.addEventListener('click', () => {
    const updates: Record<string, string> = {};
    if (activeSoundId === CUSTOM_SOUND_ID) {
      activeSoundId = 'default';
      updates[SOUND_STORAGE_KEY] = 'default';
    }

    chrome.storage.local.remove([CUSTOM_SOUND_DATA_KEY, CUSTOM_SOUND_NAME_KEY], () => {
      if (Object.keys(updates).length > 0) {
        chrome.storage.local.set(updates);
      }
      customSoundName = '';
      setCustomAudio('');
      updateCustomSoundUi();
      renderSoundList();
      setStatus('Custom sound removed.');
    });
  });


  // --- Volume ---
  function updateDisplay(val: number) {
    valueDisplay.textContent = String(Math.round(val * 100));
  }

  function updateSliderBackground(target: HTMLInputElement) {
    const val = parseFloat(target.value);
    const percentage = val * 100;
    target.style.background = `linear-gradient(to right, #343541 ${percentage}%, #ececf1 ${percentage}%)`;
  }

  slider.addEventListener('change', () => {
    const vol = parseFloat(slider.value);
    defaultAudio.volume = vol;
    if (customAudio) customAudio.volume = vol;
    preview(activeSoundId);
  });

  chrome.storage.local.get(
    [
      VOLUME_STORAGE_KEY,
      SYSTEM_NOTIFICATION_KEY,
      SOUND_STORAGE_KEY,
      SOUND_COLLAPSED_KEY,
      CUSTOM_SOUND_DATA_KEY,
      CUSTOM_SOUND_NAME_KEY,
    ],
    (result) => {
      let vol: number = result[VOLUME_STORAGE_KEY] as number;
      if (typeof vol !== 'number') vol = 0.5;
      slider.value = String(vol);
      defaultAudio.volume = vol;
      updateDisplay(vol);
      updateSliderBackground(slider);

      systemNotifyToggle.checked = result[SYSTEM_NOTIFICATION_KEY] === true;

      customSoundName = (result[CUSTOM_SOUND_NAME_KEY] as string) || '';
      setCustomAudio((result[CUSTOM_SOUND_DATA_KEY] as string) || '');

      activeSoundId = (result[SOUND_STORAGE_KEY] as string) || 'default';
      if (activeSoundId === CUSTOM_SOUND_ID && !customSoundDataUrl) {
        activeSoundId = 'default';
        chrome.storage.local.set({ [SOUND_STORAGE_KEY]: 'default' });
      }

      setSoundOpen(result[SOUND_COLLAPSED_KEY] !== false);
      updateCustomSoundUi();
      renderSoundList();
    },
  );

  slider.addEventListener('input', (e) => {
    const val = parseFloat((e.target as HTMLInputElement).value);
    updateDisplay(val);
    updateSliderBackground(e.target as HTMLInputElement);
    chrome.storage.local.set({ [VOLUME_STORAGE_KEY]: val });
  });

  systemNotifyToggle.addEventListener('change', (e) => {
    chrome.storage.local.set({
      [SYSTEM_NOTIFICATION_KEY]: (e.target as HTMLInputElement).checked,
    });
  });
});
