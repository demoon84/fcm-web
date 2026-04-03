import type { FirebaseOptions } from "firebase/app";
import type { MessagePayload, Messaging } from "firebase/messaging";

export interface BrowserFCMClientOptions {
  firebaseConfig: FirebaseOptions;
  vapidKey: string;
  serviceWorkerPath?: string;
  appName?: string;
  autoRegisterServiceWorker?: boolean;
}

export interface BrowserFCMTokenOptions {
  serviceWorkerRegistration?: ServiceWorkerRegistration;
  vapidKey?: string;
}

export interface BrowserFCMSetupState {
  token: string | null;
  tokenIssued: boolean;
  permission: NotificationPermission | "unsupported";
  updatedAt: string | null;
}

export interface BrowserFCMClient {
  firebaseConfig: FirebaseOptions;
  vapidKey: string;
  serviceWorkerPath: string;
  appName: string;
  isSupported(): Promise<boolean>;
  getNotificationSetup(): BrowserFCMSetupState;
  getStoredToken(): string | null;
  isNotificationConfigured(): boolean;
  getMessaging(): Promise<Messaging>;
  requestPermission(): Promise<NotificationPermission>;
  registerServiceWorker(customPath?: string): Promise<ServiceWorkerRegistration>;
  getToken(options?: BrowserFCMTokenOptions): Promise<string | null>;
  requestPermissionAndGetToken(options?: BrowserFCMTokenOptions): Promise<string | null>;
  deleteToken(): Promise<boolean>;
  onForegroundMessage(listener: (payload: MessagePayload) => void): Promise<() => void>;
}

export declare function isFirebaseMessagingSupported(): Promise<boolean>;
export declare function createBrowserFCMClient(options: BrowserFCMClientOptions): BrowserFCMClient;
