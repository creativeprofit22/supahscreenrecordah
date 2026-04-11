// Splash screen renderer — loading messages + ready listener

const messages = [
  'INITIALIZING...',
  'LOADING MODULES...',
  'PREPARING CANVAS...',
  'ALMOST READY...',
];
let msgIdx = 0;
const loadingText = document.getElementById('loadingText')!;
setInterval(() => {
  msgIdx = (msgIdx + 1) % messages.length;
  loadingText.textContent = messages[msgIdx];
}, 800);

// Listen for ready signal from main process
declare global {
  interface Window {
    splashAPI?: {
      onReady: (callback: () => void) => void;
      getVersion: () => Promise<string>;
    };
  }
}

if (window.splashAPI) {
  window.splashAPI.onReady(() => {
    document.getElementById('splash')?.classList.add('fade-out');
  });

  void window.splashAPI.getVersion().then((v) => {
    const el = document.getElementById('versionText');
    if (el) el.textContent = 'v' + v;
  });
}
