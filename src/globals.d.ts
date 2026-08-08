// Globals provided by the vendored classic scripts and non-standard browser APIs.

declare var firebase: any;

declare var global: any;

declare var module: { exports: any };

declare var FIREBASE_CONFIG: {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
};

interface SyncApi {
  state: unknown;
  online: boolean;
  isConfigured(): boolean;
  getInitError(): string | null;
  isPaired(): boolean;
  getCode(): string;
  getLog(): SyncLogEntry[];
  isDirty(): boolean;
  getSyncError(): string | null;
  init(opts?: { onRemote?: () => void }): void;
  start(): Promise<unknown>;
  pair(code: string): Promise<unknown>;
  unpair(): void;
  onLocalChange(): void;
  onStatus(cb: () => void): void;
}

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: string }>;
}

interface Window {
  Sync: SyncApi;
  webkitAudioContext?: typeof AudioContext;
}

declare function qrcode(
  typeNumber: number,
  errorCorrectionLevel: string
): {
  addData(data: string): void;
  make(): void;
  createImgTag(cellSize?: number, margin?: number): HTMLImageElement;
};

interface Navigator {
  standalone?: boolean;
}
