export const DEFAULT_FIREBASE_CDN_VERSION = "12.11.0";

const REQUIRED_FIREBASE_FIELDS = [
  "apiKey",
  "projectId",
  "messagingSenderId",
  "appId"
];

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

export function normalizeFirebaseConfig(firebaseConfig) {
  const normalized = Object.fromEntries(
    Object.entries(firebaseConfig || {}).filter(([, value]) => value !== undefined && value !== null && `${value}`.trim() !== "")
  );

  const missing = REQUIRED_FIREBASE_FIELDS.filter((field) => !isNonEmptyString(normalized[field]));
  if (missing.length > 0) {
    throw new Error(`Missing Firebase config field(s): ${missing.join(", ")}`);
  }

  return normalized;
}

export function normalizeServiceWorkerPath(serviceWorkerName = "firebase-messaging-sw.js") {
  const sanitized = `${serviceWorkerName}`.replace(/^\/+/, "");
  return `/${sanitized}`;
}

export function buildClientModule({
  firebaseConfig,
  vapidKey,
  serviceWorkerPath = "/firebase-messaging-sw.js",
  appName = "fcm-web"
}) {
  const normalizedConfig = normalizeFirebaseConfig(firebaseConfig);

  if (!isNonEmptyString(vapidKey)) {
    throw new Error("A public VAPID key is required to generate the browser FCM client module.");
  }

  return `import { getApps, initializeApp } from "firebase/app";
import {
  deleteToken as deleteFirebaseToken,
  getMessaging,
  getToken as getFirebaseToken,
  isSupported,
  onMessage
} from "firebase/messaging";

export const firebaseConfig = ${JSON.stringify(normalizedConfig, null, 2)};
export const FCM_VAPID_KEY = ${JSON.stringify(vapidKey)};
export const FCM_SERVICE_WORKER_PATH = ${JSON.stringify(serviceWorkerPath)};
export const FCM_APP_NAME = ${JSON.stringify(appName)};
export const FCM_STORAGE_KEY = ${JSON.stringify(`fcm-web:${appName}:state`)};

function getLocalStorage() {
  if (typeof localStorage === "undefined") {
    return null;
  }

  try {
    return localStorage;
  } catch {
    return null;
  }
}

function getNotificationPermissionValue() {
  if (typeof Notification === "undefined") {
    return "unsupported";
  }

  return Notification.permission;
}

export function getFCMSetupState() {
  const storage = getLocalStorage();
  const currentPermission = getNotificationPermissionValue();
  const fallback = {
    token: null,
    tokenIssued: false,
    permission: currentPermission,
    updatedAt: null
  };

  if (!storage) {
    return fallback;
  }

  const rawValue = storage.getItem(FCM_STORAGE_KEY);
  if (!rawValue) {
    return fallback;
  }

  try {
    const parsed = JSON.parse(rawValue);
    return {
      token: typeof parsed.token === "string" && parsed.token.length > 0 ? parsed.token : null,
      tokenIssued: parsed.tokenIssued === true,
      permission: currentPermission === "unsupported" ? fallback.permission : currentPermission,
      updatedAt: typeof parsed.updatedAt === "string" && parsed.updatedAt.length > 0 ? parsed.updatedAt : null
    };
  } catch {
    return fallback;
  }
}

function persistFCMSetupState(state) {
  const storage = getLocalStorage();
  const nextState = {
    token: typeof state.token === "string" && state.token.length > 0 ? state.token : null,
    tokenIssued: state.tokenIssued === true,
    permission:
      state.permission === "granted" ||
      state.permission === "denied" ||
      state.permission === "default" ||
      state.permission === "unsupported"
        ? state.permission
        : getNotificationPermissionValue(),
    updatedAt: new Date().toISOString()
  };

  if (!storage) {
    return nextState;
  }

  storage.setItem(FCM_STORAGE_KEY, JSON.stringify(nextState));
  return nextState;
}

export function getStoredFCMToken() {
  return getFCMSetupState().token;
}

export function isFCMConfigured() {
  const state = getFCMSetupState();
  return state.permission === "granted" && state.tokenIssued;
}

function getFirebaseApp() {
  const existingApp = getApps().find((app) => app.name === FCM_APP_NAME);
  return existingApp ?? initializeApp(firebaseConfig, FCM_APP_NAME);
}

async function ensureMessagingSupport() {
  const supported = await isSupported();
  if (!supported) {
    throw new Error("Firebase Cloud Messaging is not supported in this browser.");
  }
}

function getNotificationApi() {
  if (typeof Notification === "undefined") {
    throw new Error("Notifications are not available in this environment.");
  }

  return Notification;
}

function getServiceWorkerContainer() {
  if (typeof navigator === "undefined" || !navigator.serviceWorker) {
    throw new Error("Service workers are not available in this environment.");
  }

  return navigator.serviceWorker;
}

export async function registerFCMServiceWorker(customPath = FCM_SERVICE_WORKER_PATH) {
  const serviceWorkerContainer = getServiceWorkerContainer();
  return serviceWorkerContainer.register(customPath);
}

export async function getFCMMessaging() {
  await ensureMessagingSupport();
  return getMessaging(getFirebaseApp());
}

export async function requestNotificationPermission() {
  const notificationApi = getNotificationApi();

  if (notificationApi.permission === "granted") {
    persistFCMSetupState({
      ...getFCMSetupState(),
      permission: notificationApi.permission
    });
    return notificationApi.permission;
  }

  const permission = await notificationApi.requestPermission();

  persistFCMSetupState({
    token: permission === "granted" ? getStoredFCMToken() : null,
    tokenIssued: permission === "granted" ? isFCMConfigured() : false,
    permission
  });

  return permission;
}

export async function getFCMToken({ serviceWorkerRegistration, vapidKey = FCM_VAPID_KEY } = {}) {
  if (!vapidKey) {
    throw new Error("A public VAPID key is required to request an FCM token.");
  }

  const messaging = await getFCMMessaging();
  const registration = serviceWorkerRegistration ?? (await registerFCMServiceWorker());

  const token = await getFirebaseToken(messaging, {
    vapidKey,
    serviceWorkerRegistration: registration
  });

  persistFCMSetupState({
    token,
    tokenIssued: typeof token === "string" && token.length > 0,
    permission: getNotificationPermissionValue()
  });

  return token;
}

export async function requestPermissionAndGetFCMToken(options = {}) {
  const permission = await requestNotificationPermission();

  if (permission !== "granted") {
    return null;
  }

  return getFCMToken(options);
}

export async function deleteFCMToken() {
  const messaging = await getFCMMessaging();
  const deleted = await deleteFirebaseToken(messaging);

  persistFCMSetupState({
    token: null,
    tokenIssued: false,
    permission: getNotificationPermissionValue()
  });

  return deleted;
}

export async function onFCMForegroundMessage(listener) {
  const messaging = await getFCMMessaging();
  return onMessage(messaging, listener);
}

export const browserFCM = {
  getSetupState: getFCMSetupState,
  getStoredToken: getStoredFCMToken,
  isConfigured: isFCMConfigured,
  getMessaging: getFCMMessaging,
  registerServiceWorker: registerFCMServiceWorker,
  requestPermission: requestNotificationPermission,
  getToken: getFCMToken,
  requestPermissionAndGetToken: requestPermissionAndGetFCMToken,
  deleteToken: deleteFCMToken,
  onForegroundMessage: onFCMForegroundMessage
};
`;
}

export function buildServiceWorker({
  firebaseConfig,
  firebaseCdnVersion = DEFAULT_FIREBASE_CDN_VERSION,
  defaultClickUrl = "/"
}) {
  const normalizedConfig = normalizeFirebaseConfig(firebaseConfig);

  return `self.addEventListener("notificationclick", (event) => {
  event.notification?.close();

  const targetUrl = event.notification?.data?.link || ${JSON.stringify(defaultClickUrl)};

  event.waitUntil(
    (async () => {
      const resolvedTargetUrl = new URL(targetUrl, self.location.origin).href;
      const openClients = await clients.matchAll({
        type: "window",
        includeUncontrolled: true
      });

      for (const client of openClients) {
        if ("focus" in client) {
          const clientUrl = new URL(client.url, self.location.origin).href;
          if (clientUrl === resolvedTargetUrl) {
            await client.focus();
            return;
          }
        }
      }

      if (clients.openWindow) {
        await clients.openWindow(resolvedTargetUrl);
      }
    })()
  );
});

importScripts("https://www.gstatic.com/firebasejs/${firebaseCdnVersion}/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/${firebaseCdnVersion}/firebase-messaging-compat.js");

firebase.initializeApp(${JSON.stringify(normalizedConfig, null, 2)});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const notification = payload.notification || {};
  const data = payload.data || {};

  const title = notification.title || data.title || "New notification";
  const options = {
    body: notification.body || data.body || "",
    icon: notification.icon || data.icon,
    image: notification.image || data.image,
    data: {
      link: payload.fcmOptions?.link || data.link || ${JSON.stringify(defaultClickUrl)}
    }
  };

  self.registration.showNotification(title, options);
});
`;
}
