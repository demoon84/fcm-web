#!/usr/bin/env node

import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import {
  DEFAULT_FIREBASE_CDN_VERSION,
  buildClientModule,
  buildServiceWorker,
  normalizeFirebaseConfig,
  normalizeServiceWorkerPath
} from "./scaffold.js";

const DEFAULT_AI_CONFIG_ENV = "FIREBASE_WEB_CONFIG_JSON";
const DEFAULT_AI_VAPID_ENV = "FCM_WEB_VAPID_KEY";
const AUTO_CONFIG_FILES = ["firebase.web.json", "firebase.config.json"];

function toCamelCase(value) {
  return value.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}

function parseArgs(argv) {
  const parsed = { _: [] };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (!token.startsWith("-")) {
      parsed._.push(token);
      continue;
    }

    if (token === "-h") {
      parsed.help = true;
      continue;
    }

    if (token === "-f") {
      parsed.force = true;
      continue;
    }

    if (!token.startsWith("--")) {
      throw new Error(`Unknown option: ${token}`);
    }

    if (token.startsWith("--no-")) {
      parsed[toCamelCase(token.slice(5))] = false;
      continue;
    }

    const [rawFlag, inlineValue] = token.slice(2).split("=", 2);
    const key = toCamelCase(rawFlag);

    if (inlineValue !== undefined) {
      parsed[key] = inlineValue;
      continue;
    }

    const nextToken = argv[index + 1];
    if (nextToken && !nextToken.startsWith("-")) {
      parsed[key] = nextToken;
      index += 1;
      continue;
    }

    parsed[key] = true;
  }

  return parsed;
}

function pathExists(filePath) {
  return existsSync(filePath);
}

function readJsonFile(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(`Failed to read JSON file ${filePath}: ${error.message}`);
  }
}

function parseJsonValue(rawValue, label) {
  try {
    return JSON.parse(rawValue);
  } catch (error) {
    throw new Error(`Failed to parse JSON from ${label}: ${error.message}`);
  }
}

function readPackageJson(targetDir) {
  const packageJsonPath = join(targetDir, "package.json");
  if (!pathExists(packageJsonPath)) {
    return null;
  }

  return {
    path: packageJsonPath,
    data: readJsonFile(packageJsonPath)
  };
}

function hasDependency(packageJson, name) {
  if (!packageJson) {
    return false;
  }

  const dependencies = {
    ...packageJson.dependencies,
    ...packageJson.devDependencies,
    ...packageJson.peerDependencies
  };

  return typeof dependencies[name] === "string";
}

function detectFramework(packageJson) {
  if (!packageJson) {
    return "unknown";
  }

  if (hasDependency(packageJson, "next")) {
    return "next";
  }

  if (hasDependency(packageJson, "vite")) {
    return "vite";
  }

  if (hasDependency(packageJson, "react-scripts")) {
    return "cra";
  }

  if (hasDependency(packageJson, "@sveltejs/kit")) {
    return "sveltekit";
  }

  return "unknown";
}

function detectTypeScript(targetDir, packageJson) {
  return pathExists(join(targetDir, "tsconfig.json")) || hasDependency(packageJson, "typescript");
}

function detectSourceDir(targetDir, framework) {
  if (pathExists(join(targetDir, "src", "lib"))) {
    return "src/lib";
  }

  if (pathExists(join(targetDir, "lib"))) {
    return "lib";
  }

  if (pathExists(join(targetDir, "src"))) {
    return "src/lib";
  }

  if (framework === "next") {
    return "lib";
  }

  return "src/lib";
}

function detectPublicDir(targetDir) {
  if (pathExists(join(targetDir, "public"))) {
    return "public";
  }

  if (pathExists(join(targetDir, "static"))) {
    return "static";
  }

  if (pathExists(join(targetDir, "wwwroot"))) {
    return "wwwroot";
  }

  return "public";
}

function detectProjectLayout(targetDir) {
  const packageJsonFile = readPackageJson(targetDir);
  const packageJson = packageJsonFile?.data ?? null;
  const framework = detectFramework(packageJson);
  const usesTypeScript = detectTypeScript(targetDir, packageJson);

  return {
    framework,
    usesTypeScript,
    packageJsonPath: packageJsonFile?.path ?? null,
    recommended: {
      srcDir: detectSourceDir(targetDir, framework),
      publicDir: detectPublicDir(targetDir),
      moduleName: usesTypeScript ? "fcm.ts" : "fcm.js"
    }
  };
}

function resolveFirebaseConfig(options, targetDir) {
  let configSource = "flags";
  let baseConfig = {};

  if (typeof options.configJson === "string") {
    baseConfig = parseJsonValue(options.configJson, "--config-json");
    configSource = "config-json";
  } else if (typeof options.configEnv === "string") {
    const rawValue = process.env[options.configEnv];
    if (!rawValue) {
      throw new Error(`Environment variable ${options.configEnv} is not set.`);
    }

    baseConfig = parseJsonValue(rawValue, `environment variable ${options.configEnv}`);
    configSource = `env:${options.configEnv}`;
  } else if (options.ai && process.env[DEFAULT_AI_CONFIG_ENV]) {
    baseConfig = parseJsonValue(process.env[DEFAULT_AI_CONFIG_ENV], `environment variable ${DEFAULT_AI_CONFIG_ENV}`);
    configSource = `env:${DEFAULT_AI_CONFIG_ENV}`;
  } else if (typeof options.config === "string") {
    const resolvedPath = resolve(targetDir, options.config);
    baseConfig = readJsonFile(resolvedPath);
    configSource = `file:${resolvedPath}`;
  } else {
    const discoveredPath = AUTO_CONFIG_FILES
      .map((fileName) => join(targetDir, fileName))
      .find((candidatePath) => pathExists(candidatePath));

    if (discoveredPath) {
      baseConfig = readJsonFile(discoveredPath);
      configSource = `file:${discoveredPath}`;
    }
  }

  return {
    firebaseConfig: normalizeFirebaseConfig({
      ...baseConfig,
      apiKey: options.apiKey ?? baseConfig.apiKey,
      authDomain: options.authDomain ?? baseConfig.authDomain,
      projectId: options.projectId ?? baseConfig.projectId,
      storageBucket: options.storageBucket ?? baseConfig.storageBucket,
      messagingSenderId: options.messagingSenderId ?? baseConfig.messagingSenderId,
      appId: options.appId ?? baseConfig.appId,
      measurementId: options.measurementId ?? baseConfig.measurementId
    }),
    configSource
  };
}

function resolveVapidKey(options) {
  if (typeof options.vapidKey === "string" && options.vapidKey.trim().length > 0) {
    return {
      vapidKey: options.vapidKey,
      vapidKeySource: "flag"
    };
  }

  const envName =
    (typeof options.vapidKeyEnv === "string" && options.vapidKeyEnv) || (options.ai ? DEFAULT_AI_VAPID_ENV : null);

  if (!envName) {
    return {
      vapidKey: null,
      vapidKeySource: null
    };
  }

  const rawValue = process.env[envName];
  if (!rawValue) {
    throw new Error(`Environment variable ${envName} is not set.`);
  }

  return {
    vapidKey: rawValue,
    vapidKeySource: `env:${envName}`
  };
}

function ensureWritable(filePath, force) {
  if (pathExists(filePath) && !force) {
    throw new Error(`Refusing to overwrite existing file without --force: ${filePath}`);
  }
}

function writeFile(filePath, content) {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, content, "utf8");
}

function detectPackageManager(targetDir, preferred) {
  if (preferred && preferred !== "auto") {
    return preferred;
  }

  if (pathExists(join(targetDir, "pnpm-lock.yaml"))) {
    return "pnpm";
  }

  if (pathExists(join(targetDir, "yarn.lock"))) {
    return "yarn";
  }

  if (pathExists(join(targetDir, "bun.lock")) || pathExists(join(targetDir, "bun.lockb"))) {
    return "bun";
  }

  return "npm";
}

function getInstallCommand(packageManager) {
  switch (packageManager) {
    case "pnpm":
      return { command: "pnpm", args: ["add", "firebase"] };
    case "yarn":
      return { command: "yarn", args: ["add", "firebase"] };
    case "bun":
      return { command: "bun", args: ["add", "firebase"] };
    case "npm":
      return { command: "npm", args: ["install", "firebase"] };
    default:
      throw new Error(`Unsupported package manager: ${packageManager}`);
  }
}

function installFirebase(targetDir, packageManager, jsonOutput) {
  const installCommand = getInstallCommand(packageManager);
  const result = spawnSync(installCommand.command, installCommand.args, {
    cwd: targetDir,
    stdio: jsonOutput ? "pipe" : "inherit",
    encoding: "utf8"
  });

  if (result.status !== 0) {
    throw new Error(
      `Failed to install firebase with ${installCommand.command} ${installCommand.args.join(" ")}${
        result.stderr ? `: ${result.stderr.trim()}` : ""
      }`
    );
  }

  return `${installCommand.command} ${installCommand.args.join(" ")}`;
}

function writeResultFile(targetDir, resultFile, result, force) {
  const resolvedPath = resolve(targetDir, resultFile);
  ensureWritable(resolvedPath, force);
  writeFile(resolvedPath, JSON.stringify(result, null, 2));
  return resolvedPath;
}

function formatResult(result, asJson) {
  if (asJson) {
    return JSON.stringify(result, null, 2);
  }

  if (result.mode === "detect") {
    return [
      "FCM project layout detected.",
      `Framework: ${result.detection.framework}`,
      `Recommended module: ${result.detection.recommended.srcDir}/${result.detection.recommended.moduleName}`,
      `Recommended public dir: ${result.detection.recommended.publicDir}`
    ].join("\n");
  }

  return [
    result.dryRun ? "FCM scaffold plan generated." : "FCM scaffold created successfully.",
    `Client module: ${result.createdFiles.clientModule}`,
    `Service worker: ${result.createdFiles.serviceWorker}`,
    `Config source: ${result.resolved.configSource}`,
    `VAPID source: ${result.resolved.vapidKeySource ?? "flag"}`,
    result.installCommand ? `Install command: ${result.installCommand}` : "Install command: skipped",
    "Next steps:",
    `1. Import ${result.importSuggestion.importPath} from your app.`,
    `2. Ensure ${result.createdFiles.serviceWorker} is deployed at ${result.serviceWorkerPath}.`,
    "3. Call requestPermissionAndGetToken() after login or once the user opts in."
  ].join("\n");
}

function printHelp() {
  process.stdout.write(`fcm-web

Usage:
  fcm-web init [options]
  fcm-web detect [options]
  fcm-web [options]

AI shortcuts:
  --ai                             Enables machine-friendly JSON output and defaults --install to true
  --config-json <json>             Pass Firebase config directly as JSON
  --config-env <name>              Read Firebase config JSON from an environment variable
  --vapid-key-env <name>           Read VAPID key from an environment variable
  --dry-run                        Show what would change without writing files
  --result-file <path>             Write JSON result metadata to a file

Init options:
  --config <path>                 Firebase web config JSON file
  --api-key <value>               Firebase apiKey
  --auth-domain <value>           Firebase authDomain
  --project-id <value>            Firebase projectId
  --storage-bucket <value>        Firebase storageBucket
  --messaging-sender-id <value>   Firebase messagingSenderId
  --app-id <value>                Firebase appId
  --measurement-id <value>        Firebase measurementId
  --vapid-key <value>             Public VAPID key for web push
  --target <path>                 Target project root (default: current directory)
  --src-dir <path>                Directory for generated module (auto-detected by default)
  --module-name <name>            Generated client module file (auto-detected by default)
  --public-dir <path>             Public directory for service worker (auto-detected by default)
  --service-worker-name <name>    Service worker file name (default: firebase-messaging-sw.js)
  --firebase-cdn-version <value>  Firebase compat CDN version (default: ${DEFAULT_FIREBASE_CDN_VERSION})
  --default-click-url <path>      Fallback URL for notification clicks (default: /)
  --package-manager <name>        npm | pnpm | yarn | bun | auto
  --install                       Install firebase in the target project
  --force                         Overwrite existing files
  --json                          Print machine-readable JSON output
  -h, --help                      Show this help

AI env defaults:
  ${DEFAULT_AI_CONFIG_ENV}         Firebase config JSON string for --ai mode
  ${DEFAULT_AI_VAPID_ENV}           Public VAPID key for --ai mode
`);
}

function buildImportPath(srcDir, moduleName) {
  const joined = `${srcDir}/${moduleName}`.replace(/\\/g, "/");
  return joined.replace(/\.(ts|tsx|js|jsx|mjs|cjs)$/u, "");
}

function shouldUseJsonOutput(options) {
  return Boolean(options.json || options.ai || process.env.FCM_WEB_OUTPUT === "json");
}

function createAction(type, path, status, extra = {}) {
  return {
    type,
    path,
    status,
    ...extra
  };
}

function runDetect(options) {
  const targetDir = resolve(options.target ?? process.cwd());
  const detection = detectProjectLayout(targetDir);
  const result = {
    ok: true,
    mode: "detect",
    aiMode: Boolean(options.ai),
    targetDir,
    detection
  };

  process.stdout.write(`${formatResult(result, shouldUseJsonOutput(options))}\n`);
}

function runInit(options) {
  const targetDir = resolve(options.target ?? process.cwd());
  const detection = detectProjectLayout(targetDir);
  const { firebaseConfig, configSource } = resolveFirebaseConfig(options, targetDir);
  const { vapidKey, vapidKeySource } = resolveVapidKey(options);

  if (typeof vapidKey !== "string" || vapidKey.trim().length === 0) {
    throw new Error("A public VAPID key is required. Use --vapid-key, --vapid-key-env, or --ai with FCM_WEB_VAPID_KEY.");
  }

  const srcDir = options.srcDir ?? detection.recommended.srcDir;
  const moduleName = options.moduleName ?? detection.recommended.moduleName;
  const publicDir = options.publicDir ?? detection.recommended.publicDir;
  const serviceWorkerName = options.serviceWorkerName ?? "firebase-messaging-sw.js";
  const force = Boolean(options.force);
  const dryRun = Boolean(options.dryRun);
  const jsonOutput = shouldUseJsonOutput(options);
  const install = options.install === true || (options.ai && options.install !== false);
  const serviceWorkerPath = normalizeServiceWorkerPath(serviceWorkerName);

  const clientModulePath = resolve(targetDir, srcDir, moduleName);
  const serviceWorkerFilePath = resolve(targetDir, publicDir, serviceWorkerName);

  ensureWritable(clientModulePath, force);
  ensureWritable(serviceWorkerFilePath, force);

  const clientModuleContent = buildClientModule({
    firebaseConfig,
    vapidKey,
    serviceWorkerPath
  });

  const serviceWorkerContent = buildServiceWorker({
    firebaseConfig,
    firebaseCdnVersion: options.firebaseCdnVersion ?? DEFAULT_FIREBASE_CDN_VERSION,
    defaultClickUrl: options.defaultClickUrl ?? "/"
  });

  if (!dryRun) {
    writeFile(clientModulePath, clientModuleContent);
    writeFile(serviceWorkerFilePath, serviceWorkerContent);
  }

  const packageManager = detectPackageManager(targetDir, options.packageManager ?? "auto");
  const installCommand = install && !dryRun ? installFirebase(targetDir, packageManager, jsonOutput) : null;
  const plannedInstallCommand = install ? getInstallCommand(packageManager) : null;

  const result = {
    ok: true,
    mode: "init",
    aiMode: Boolean(options.ai),
    dryRun,
    targetDir,
    detection,
    packageManager,
    installRequested: install,
    installCommand,
    plannedInstallCommand: plannedInstallCommand
      ? `${plannedInstallCommand.command} ${plannedInstallCommand.args.join(" ")}`
      : null,
    serviceWorkerPath,
    resolved: {
      configSource,
      vapidKeySource,
      srcDir,
      moduleName,
      publicDir
    },
    createdFiles: {
      clientModule: clientModulePath,
      serviceWorker: serviceWorkerFilePath
    },
    importSuggestion: {
      importPath: buildImportPath(srcDir, moduleName),
      exportName: "browserFCM"
    },
    actions: [
      createAction("write", clientModulePath, dryRun ? "planned" : "written"),
      createAction("write", serviceWorkerFilePath, dryRun ? "planned" : "written"),
      ...(plannedInstallCommand
        ? [
            createAction("install", targetDir, dryRun ? "planned" : "completed", {
              command: `${plannedInstallCommand.command} ${plannedInstallCommand.args.join(" ")}`
            })
          ]
        : [])
    ]
  };

  if (options.resultFile) {
    if (dryRun) {
      result.resultFile = resolve(targetDir, options.resultFile);
      result.actions.push(createAction("write-result", result.resultFile, "planned"));
    } else {
      result.resultFile = resolve(targetDir, options.resultFile);
      result.actions.push(createAction("write-result", result.resultFile, "written"));
      writeResultFile(targetDir, options.resultFile, result, force);
    }
  }

  process.stdout.write(`${formatResult(result, jsonOutput)}\n`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printHelp();
    return;
  }

  const command = args._[0] ?? "init";

  if (command === "help") {
    printHelp();
    return;
  }

  if (command === "detect") {
    runDetect(args);
    return;
  }

  if (command === "init") {
    runInit(args);
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

try {
  main();
} catch (error) {
  const jsonOutput = process.argv.includes("--json") || process.argv.includes("--ai");

  if (jsonOutput) {
    process.stderr.write(
      `${JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }, null, 2)}\n`
    );
  } else {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  }

  process.exitCode = 1;
}
