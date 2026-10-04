import { defineConfig } from 'wxt';

export default defineConfig({
  manifest: {
    name: 'ChatGPT Notifier',
    version: '1.6.4',
    description: 'A Chrome extension that notifies you when ChatGPT has finished processing your request.',
    permissions: ['storage', 'notifications'],
    icons: {
      '128': '/logo.png',
    },
    web_accessible_resources: [
      {
        resources: ['notification.mp3'],
        matches: ['https://chatgpt.com/*'],
      },
    ],
  },
});
