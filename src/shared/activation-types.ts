export interface PermissionStatus {
  camera: 'granted' | 'denied' | 'not-determined';
  microphone: 'granted' | 'denied' | 'not-determined';
  screenRecording: 'granted' | 'denied' | 'not-determined';
  accessibility: 'granted' | 'denied' | 'not-determined';
}

export interface DependencyStatus {
  ffmpeg: { installed: boolean; path?: string };
}

export interface InstallProgress {
  dependency: string;
  status: 'downloading' | 'installing' | 'done' | 'error';
  progress?: number;
  error?: string;
}

export interface OnboardingAPI {
  checkPermissions: () => Promise<PermissionStatus>;
  requestPermission: (
    type: 'camera' | 'microphone' | 'screenRecording' | 'accessibility'
  ) => Promise<boolean>;
  checkDependencies: () => Promise<DependencyStatus>;
  installDependency: (name: string) => Promise<void>;
  onInstallProgress: (callback: (progress: InstallProgress) => void) => () => void;
  completeOnboarding: () => void;
  quit: () => void;
  openExternal: (url: string) => Promise<void>;
}
