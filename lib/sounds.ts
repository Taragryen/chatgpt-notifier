export interface Sound {
  id: string;
  name: string;
  freqs: number[];
  type: OscillatorType;
}

export const CUSTOM_SOUND_ID = 'custom';
export const CUSTOM_SOUND_DATA_KEY = 'chatgpt_notifier_custom_sound_data_url';
export const CUSTOM_SOUND_NAME_KEY = 'chatgpt_notifier_custom_sound_name';

export const SOUNDS: Sound[] = [
  { id: 'default', name: 'Default', freqs: [], type: 'sine' },
  { id: 'tritone', name: 'Tri-tone', freqs: [587.33, 739.99, 880], type: 'sine' },
  { id: 'glass', name: 'Glass', freqs: [1396.91], type: 'triangle' },
  { id: 'pop', name: 'Pop', freqs: [330, 523.25], type: 'sine' },
  { id: 'knock', name: 'Knock', freqs: [784], type: 'square' },
  { id: 'doorbell', name: 'Doorbell', freqs: [440, 587.33], type: 'triangle' },
  { id: 'harp', name: 'Harp', freqs: [523.25, 659.25, 783.99, 1046.5], type: 'sine' },
  { id: 'ping', name: 'Ping', freqs: [2093, 1760], type: 'sine' },
  { id: 'bubble', name: 'Bubble', freqs: [440, 880], type: 'sine' },
  { id: CUSTOM_SOUND_ID, name: 'Custom', freqs: [], type: 'sine' },
];

export function playTone(freqs: number[], volume: number, type: OscillatorType) {
  const ctx = new AudioContext();
  const gain = ctx.createGain();
  gain.connect(ctx.destination);
  gain.gain.value = volume * 0.6;

  const noteDuration = 0.12;
  freqs.forEach((freq, i) => {
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    osc.connect(gain);
    osc.start(ctx.currentTime + i * noteDuration);
    osc.stop(ctx.currentTime + i * noteDuration + 0.06);
  });

  setTimeout(() => ctx.close(), 1000);
  return ctx;
}
