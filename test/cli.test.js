import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { createBrowserFCMClient } from "../src/index.js";
import { buildClientModule, buildServiceWorker } from "../src/scaffold.js";

test("buildClientModule includes config and helper exports", () => {
  const output = buildClientModule({
    firebaseConfig: {
      apiKey: "api-key",
      projectId: "project-id",
      messagingSenderId: "123456789",
      appId: "app-id"
    },
    vapidKey: "vapid-key"
  });

  assert.match(output, /export const firebaseConfig/);
  assert.match(output, /requestPermissionAndGetFCMToken/);
  assert.match(output, /getStoredFCMToken/);
  assert.match(output, /isFCMConfigured/);
  assert.match(output, /browserFCM/);
});

test("buildServiceWorker includes compat scripts and notification handler", () => {
  const output = buildServiceWorker({
    firebaseConfig: {
      apiKey: "api-key",
      projectId: "project-id",
      messagingSenderId: "123456789",
      appId: "app-id"
    }
  });

  assert.match(output, /firebase-app-compat/);
  assert.match(output, /notificationclick/);
  assert.match(output, /onBackgroundMessage/);
});

test("CLI init scaffolds module and service worker with JSON output", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "fcm-web-test-"));

  try {
    const configPath = join(tempDir, "firebase.web.json");
    writeFileSync(
      configPath,
      JSON.stringify(
        {
          apiKey: "api-key",
          projectId: "project-id",
          messagingSenderId: "123456789",
          appId: "app-id"
        },
        null,
        2
      )
    );

    const result = spawnSync(
      process.execPath,
      [
        resolve("src/cli.js"),
        "init",
        "--config",
        configPath,
        "--vapid-key",
        "vapid-key",
        "--target",
        tempDir,
        "--json"
      ],
      {
        cwd: process.cwd(),
        encoding: "utf8"
      }
    );

    assert.equal(result.status, 0, result.stderr);

    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, true);

    const clientModulePath = join(tempDir, "src/lib/fcm.js");
    const serviceWorkerPath = join(tempDir, "public/firebase-messaging-sw.js");

    assert.equal(payload.createdFiles.clientModule, clientModulePath);
    assert.equal(payload.createdFiles.serviceWorker, serviceWorkerPath);

    assert.match(readFileSync(clientModulePath, "utf8"), /api-key/);
    assert.match(readFileSync(serviceWorkerPath, "utf8"), /firebase-messaging-compat/);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("CLI AI mode supports config JSON, dry-run, and default init command", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "fcm-web-ai-test-"));

  try {
    writeFileSync(
      join(tempDir, "package.json"),
      JSON.stringify(
        {
          name: "web-app",
          version: "1.0.0",
          devDependencies: {
            typescript: "^5.0.0"
          }
        },
        null,
        2
      )
    );

    const result = spawnSync(
      process.execPath,
      [
        resolve("src/cli.js"),
        "--ai",
        "--config-json",
        JSON.stringify({
          apiKey: "api-key",
          projectId: "project-id",
          messagingSenderId: "123456789",
          appId: "app-id"
        }),
        "--vapid-key",
        "vapid-key",
        "--target",
        tempDir,
        "--dry-run"
      ],
      {
        cwd: process.cwd(),
        encoding: "utf8"
      }
    );

    assert.equal(result.status, 0, result.stderr);

    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, true);
    assert.equal(payload.aiMode, true);
    assert.equal(payload.dryRun, true);
    assert.equal(payload.installRequested, true);
    assert.equal(payload.resolved.configSource, "config-json");
    assert.equal(payload.resolved.srcDir, "src/lib");
    assert.equal(payload.resolved.moduleName, "fcm.ts");
    assert.equal(payload.actions[0].status, "planned");
    assert.equal(payload.actions[2].type, "install");
    assert.equal(existsSync(join(tempDir, "src", "lib", "fcm.ts")), false);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("CLI detect reports inferred project layout", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "fcm-web-detect-test-"));

  try {
    writeFileSync(
      join(tempDir, "package.json"),
      JSON.stringify(
        {
          name: "next-app",
          version: "1.0.0",
          dependencies: {
            next: "15.0.0"
          }
        },
        null,
        2
      )
    );
    writeFileSync(join(tempDir, "tsconfig.json"), "{}");
    writeFileSync(join(tempDir, "firebase.web.json"), "{}");

    const result = spawnSync(process.execPath, [resolve("src/cli.js"), "detect", "--target", tempDir, "--json"], {
      cwd: process.cwd(),
      encoding: "utf8"
    });

    assert.equal(result.status, 0, result.stderr);

    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, true);
    assert.equal(payload.mode, "detect");
    assert.equal(payload.detection.framework, "next");
    assert.equal(payload.detection.usesTypeScript, true);
    assert.equal(payload.detection.recommended.srcDir, "lib");
    assert.equal(payload.detection.recommended.publicDir, "public");
    assert.equal(payload.detection.recommended.moduleName, "fcm.ts");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("Browser FCM client can read stored notification setup state", async () => {
  const originalNotification = globalThis.Notification;
  const originalLocalStorage = globalThis.localStorage;
  const store = new Map();

  globalThis.localStorage = {
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      store.set(key, String(value));
    },
    removeItem(key) {
      store.delete(key);
    }
  };

  globalThis.Notification = {
    permission: "default",
    async requestPermission() {
      this.permission = "granted";
      return this.permission;
    }
  };

  try {
    const client = createBrowserFCMClient({
      firebaseConfig: {
        apiKey: "api-key",
        projectId: "project-id",
        messagingSenderId: "123456789",
        appId: "app-id"
      },
      vapidKey: "vapid-key",
      appName: "test-app"
    });

    assert.equal(client.isNotificationConfigured(), false);
    assert.equal(client.getStoredToken(), null);

    await client.requestPermission();

    const storageKey = "fcm-web:test-app:state";
    const initialState = JSON.parse(store.get(storageKey));
    assert.equal(initialState.permission, "granted");
    assert.equal(initialState.tokenIssued, false);

    store.set(
      storageKey,
      JSON.stringify({
        token: "stored-token",
        tokenIssued: true,
        permission: "granted",
        updatedAt: "2026-04-03T00:00:00.000Z"
      })
    );

    assert.equal(client.getStoredToken(), "stored-token");
    assert.equal(client.isNotificationConfigured(), true);
    assert.deepEqual(client.getNotificationSetup(), {
      token: "stored-token",
      tokenIssued: true,
      permission: "granted",
      updatedAt: "2026-04-03T00:00:00.000Z"
    });

    globalThis.Notification.permission = "denied";

    assert.equal(client.isNotificationConfigured(), false);
    assert.equal(client.getNotificationSetup().permission, "denied");
  } finally {
    if (originalNotification === undefined) {
      delete globalThis.Notification;
    } else {
      globalThis.Notification = originalNotification;
    }

    if (originalLocalStorage === undefined) {
      delete globalThis.localStorage;
    } else {
      globalThis.localStorage = originalLocalStorage;
    }
  }
});
