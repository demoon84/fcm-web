import { getApps, initializeApp } from "firebase/app";
import {
  deleteToken as deleteFirebaseToken,
  getMessaging,
  getToken as getFirebaseToken,
  isSupported as isMessagingSupported,
  onMessage
} from "firebase/messaging";

function getStorageKey(appName) {
  return `fcm-web:${appName}:state`;
}

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

function readStoredState(appName) {
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

  const rawValue = storage.getItem(getStorageKey(appName));
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

function writeStoredState(appName, nextState) {
  const storage = getLocalStorage();
  if (!storage) {
    return nextState;
  }

  storage.setItem(getStorageKey(appName), JSON.stringify(nextState));
  return nextState;
}

function getFirebaseApp(firebaseConfig, appName) {
  const existingApp = getApps().find((app) => app.name === appName);
  return existingApp ?? initializeApp(firebaseConfig, appName);
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

function requireVapidKey(vapidKey) {
  if (typeof vapidKey !== "string" || vapidKey.trim().length === 0) {
    throw new Error("A public VAPID key is required to request an FCM token.");
  }

  return vapidKey;
}

export async function isFirebaseMessagingSupported() {
  return isMessagingSupported();
}

export function createBrowserFCMClient({
  firebaseConfig,
  vapidKey,
  serviceWorkerPath = "/firebase-messaging-sw.js",
  appName = "fcm-web",
  autoRegisterServiceWorker = true
}) {
  let cachedServiceWorkerRegistration;

  async function ensureMessagingSupport() {
    const supported = await isFirebaseMessagingSupported();
    if (!supported) {
      throw new Error("Firebase Cloud Messaging is not supported in this browser environment.");
    }
  }

  function getAppInstance() {
    return getFirebaseApp(firebaseConfig, appName);
  }

  function getNotificationSetup() {
    return readStoredState(appName);
  }

  function getStoredToken() {
    return getNotificationSetup().token;
  }

  function isNotificationConfigured() {
    const state = getNotificationSetup();
    return state.permission === "granted" && state.tokenIssued;
  }

  function persistNotificationState(state) {
    return writeStoredState(appName, {
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
    });
  }

  async function getMessagingInstance() {
    await ensureMessagingSupport();
    return getMessaging(getAppInstance());
  }

  async function requestPermission() {
    const notificationApi = getNotificationApi();

    if (notificationApi.permission === "granted") {
      persistNotificationState({
        ...getNotificationSetup(),
        permission: notificationApi.permission
      });
      return notificationApi.permission;
    }

    const permission = await notificationApi.requestPermission();

    persistNotificationState({
      token: permission === "granted" ? getStoredToken() : null,
      tokenIssued: permission === "granted" ? isNotificationConfigured() : false,
      permission
    });

    return permission;
  }

  async function registerServiceWorker(customPath = serviceWorkerPath) {
    const serviceWorkerContainer = getServiceWorkerContainer();
    cachedServiceWorkerRegistration = await serviceWorkerContainer.register(customPath);
    return cachedServiceWorkerRegistration;
  }

  async function resolveServiceWorkerRegistration(serviceWorkerRegistration) {
    if (serviceWorkerRegistration) {
      return serviceWorkerRegistration;
    }

    if (cachedServiceWorkerRegistration) {
      return cachedServiceWorkerRegistration;
    }

    if (!autoRegisterServiceWorker) {
      return undefined;
    }

    return registerServiceWorker();
  }

  async function getToken(options = {}) {
    const messaging = await getMessagingInstance();
    const registration = await resolveServiceWorkerRegistration(options.serviceWorkerRegistration);
    const token = await getFirebaseToken(messaging, {
      vapidKey: requireVapidKey(options.vapidKey ?? vapidKey),
      serviceWorkerRegistration: registration
    });

    persistNotificationState({
      token,
      tokenIssued: typeof token === "string" && token.length > 0,
      permission: getNotificationPermissionValue()
    });

    return token;
  }

  async function requestPermissionAndGetToken(options = {}) {
    const permission = await requestPermission();

    if (permission !== "granted") {
      return null;
    }

    return getToken(options);
  }

  async function deleteToken() {
    const messaging = await getMessagingInstance();
    const deleted = await deleteFirebaseToken(messaging);

    persistNotificationState({
      token: null,
      tokenIssued: false,
      permission: getNotificationPermissionValue()
    });

    return deleted;
  }

  async function onForegroundMessage(listener) {
    const messaging = await getMessagingInstance();
    return onMessage(messaging, listener);
  }

  return {
    firebaseConfig,
    vapidKey,
    serviceWorkerPath,
    appName,
    isSupported: isFirebaseMessagingSupported,
    getNotificationSetup,
    getStoredToken,
    isNotificationConfigured,
    getMessaging: getMessagingInstance,
    requestPermission,
    registerServiceWorker,
    getToken,
    requestPermissionAndGetToken,
    deleteToken,
    onForegroundMessage
  };
}
