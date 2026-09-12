#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const pkg = require("../package.json");
const { discoverInstall } = require("./src/runtime/discover");
const lifecycle = require("./src/runtime/lifecycle");
const { runMenu, dashboardUrl, runTrayHost, startTrayHost } = require("./src/runtime/runMenu");
const { checkForUpdate } = require("./src/runtime/update");
const { withProgress } = require("./src/cli/utils/display");

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args[0] === "xai" && args[1] === "video") {
    const { run } = require("./src/cli/commands/xaiVideo");
    run(args.slice(2))
      .then((code) => process.exit(code))
      .catch((error) => {
        process.stderr.write(`Error: ${error?.message || error}\n`);
        process.exit(1);
      });
  } else {
    main(args).catch((error) => {
      reportFatalError(error);
      process.exitCode = 1;
    });
  }
}

function reportFatalError(error) {
  const message = String(error?.message || error || "Unknown error").replace(/[\r\n]+/g, " ").slice(0, 1000);
  process.stderr.write(`Error: ${message}\n`);

  const logPath = process.env.SWAYROUTER_AUTOSTART_LOG;
  if (!logPath) return;
  try {
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.appendFileSync(logPath, `${new Date().toISOString()} Startup failed: ${message}\n`);
  } catch {}
}

function usage() {
  console.log(`
Usage: swayrouter [command] [options]

Start and manage an already prepared Sway Router runtime.

Commands:
  start                    Start the router attached to this terminal
  status                   Show status and dashboard URL
  restart                  Restart the router
  stop                     Stop the router
  menu                     Open the menu without starting the router
  xai video ...            Generate a video through the running router

Start options:
  -b, --background         Start detached and keep a system tray when supported
  -t, --tray               Start detached with a persistent system tray host
  -f, --foreground         Keep the router attached to this terminal
  -l, --log                Show native server logs
  --skip-update            Skip the registry version check

Runtime options:
  -p, --port PORT          Override the native port
  -H, --host HOST          Override the native host
  --dir PATH               Use a specific installation directory
  -h, --help               Show this help
  -v, --version            Show version

Examples:
  swayrouter                   Start in the background and open the control menu
  swayrouter start             Start the router attached to this terminal
  swayrouter start -b          Start in the background with the system tray
  swayrouter status            Check whether it is running
  swayrouter stop              Stop it safely
`);
}

function parseArgs(argv) {
  const options = {
    command: null,
    port: null,
    host: null,
    dir: null,
    noBrowser: false,
    showLog: false,
    skipUpdate: false,
    foreground: false,
    background: false,
    tray: false,
    open: false,
    status: false,
    stop: false,
    help: false,
    version: false,
  };
  const commands = new Set(["start", "status", "restart", "stop", "menu"]);

  for (let index = 0; index < argv.length; index += 1) {
    const rawArg = argv[index];
    const equalsIndex = rawArg.startsWith("--") ? rawArg.indexOf("=") : -1;
    const arg = equalsIndex > -1 ? rawArg.slice(0, equalsIndex) : rawArg;
    const inlineValue = equalsIndex > -1 ? rawArg.slice(equalsIndex + 1) : undefined;

    if (!options.command && !arg.startsWith("-")) {
      if (commands.has(arg)) {
        options.command = arg;
        continue;
      }
      if (arg === "xai") {
        throw new Error("xai video must be invoked as `swayrouter xai video ...`");
      }
      throw new Error(`unknown command: ${arg}`);
    }
    if (options.command && !arg.startsWith("-")) {
      throw new Error(`unexpected argument: ${arg}`);
    }

    const next = () => {
      if (inlineValue !== undefined) return inlineValue;
      if (index + 1 >= argv.length) throw new Error(`${arg} requires a value`);
      index += 1;
      return argv[index];
    };

    switch (arg) {
      case "--port":
      case "-p": {
        const value = Number.parseInt(next(), 10);
        if (!Number.isInteger(value) || value < 1 || value > 65535) {
          throw new Error("port must be an integer between 1 and 65535");
        }
        options.port = value;
        break;
      }
      case "--host":
      case "-H":
        options.host = next();
        break;
      case "--dir":
        options.dir = next();
        break;
      case "--no-browser":
      case "-n":
        options.noBrowser = true;
        break;
      case "--log":
      case "-l":
        options.showLog = true;
        break;
      case "--foreground":
      case "-f":
        options.foreground = true;
        break;
      case "--background":
      case "-b":
        options.background = true;
        break;
      case "--tray":
      case "-t":
        options.background = true;
        options.tray = true;
        break;
      case "--status":
        options.status = true;
        break;
      case "--stop":
        options.stop = true;
        break;
      case "--skip-update":
        options.skipUpdate = true;
        break;
      case "--help":
      case "-h":
        options.help = true;
        break;
      case "--version":
      case "-v":
        options.version = true;
        break;
      default:
        throw new Error(`unknown option: ${arg}`);
    }
  }

  if (options.command === "status") options.status = true;
  if (options.command === "stop") options.stop = true;
  if (options.command === "open") options.open = true;
  return options;
}

function commandFor(options) {
  if (options.status) return "status";
  if (options.stop) return "stop";
  return options.command || "start";
}

function isDefaultMenuInvocation(options) {
  return options.command === null
    && !options.foreground
    && !options.background
    && !options.tray
    && !options.status
    && !options.stop;
}

function assertStartMode(options) {
  if (options.foreground && options.background) {
    throw new Error("choose either --foreground or --background, not both");
  }
}

function resolveInstallation(options) {
  const installation = discoverInstall({
    dir: options.dir,
    cliDirectory: path.resolve(__dirname, ".."),
  });
  if (!installation) return null;
  if (options.port && installation.mode === "docker" && options.port !== 14045) {
    throw new Error("Docker Compose uses the fixed port 14045; --port overrides are supported only for native mode");
  }
  if (options.host && installation.mode === "docker") {
    throw new Error("--host is supported only for native mode; Docker Compose listens on 127.0.0.1:14045");
  }
  if (options.port) installation.port = options.port;
  if (options.host) installation.host = options.host;
  return installation;
}

async function startForeground(installation, options) {
  const result = await withProgress("Starting Sway Router", (progress) => {
    progress.update(35, "Starting Sway Router");
    return lifecycle.start(installation, {
      background: false,
      showLog: options.showLog,
      port: options.port,
      host: options.host,
    });
  }, { doneMessage: "Sway Router started" });
  const url = dashboardUrl(installation, result.port);
  console.log(`Sway Router is running at ${url}`);
  console.log("Press Ctrl+C to stop the router gracefully.");
  await new Promise((resolve) => {
    const stop = () => {
      try { lifecycle.stop(installation); } catch {}
      resolve();
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
}

async function startBackground(installation, options) {
  const result = await withProgress("Starting Sway Router", (progress) => {
    progress.update(35, "Starting Sway Router");
    return lifecycle.start(installation, {
      background: true,
      showLog: options.showLog,
      port: options.port,
      host: options.host,
    });
  }, { doneMessage: "Sway Router started" });
  const url = dashboardUrl(installation, result.port);
  const tray = startTrayHost(installation, result.port);
  console.log(`Sway Router is running in the background at ${url}${tray ? " with the tray enabled" : ""}`);
}

async function startRuntime(installation, options) {
  assertStartMode(options);
  if (options.tray) {
    await runTrayHost(installation, options);
    return;
  }
  if (options.background) {
    await startBackground(installation, options);
    return;
  }
  await startForeground(installation, options);
}

async function startDefaultMenu(installation, options, updateInfo) {
  const current = lifecycle.status(installation);
  let port = Number(options.port || installation.port || 14045);

  if (current.running) {
    console.log(`Sway Router is already running at ${dashboardUrl(installation, port)}`);
  } else {
    const result = await withProgress("Starting Sway Router", (progress) => {
      progress.update(35, "Starting Sway Router");
      return lifecycle.start(installation, {
        background: true,
        showLog: options.showLog,
        port: options.port,
        host: options.host,
      });
    }, { doneMessage: "Sway Router started" });
    port = result.port;
    console.log(`Sway Router is running in the background at ${dashboardUrl(installation, port)}`);
  }

  await runMenu(installation, { ...options, port, updateInfo });
}

function showRuntimeStatus(installation, status, port) {
  console.log("Sway Router");
  console.log(`  Status: ${status.running ? "running" : "stopped"}`);
  console.log(`  Current Version: v${pkg.version}`);
  console.log(`  Mode: ${installation.mode}`);
  console.log(`  Dashboard: ${dashboardUrl(installation, port)}`);
  if (status.pid) console.log(`  PID: ${status.pid}`);
}

async function main(argv) {
  const options = parseArgs(argv);
  if (options.help) {
    usage();
    return;
  }
  if (options.version) {
    console.log(pkg.version);
    return;
  }

  const command = commandFor(options);
  const installation = resolveInstallation(options);
  if (!installation) {
    if (command === "status") {
      console.log("Sway Router is not prepared.");
      console.log("Prepare the Sway Router runtime and installation metadata first.");
      return;
    }
    if (command === "stop") {
      console.log("Sway Router was not prepared; nothing to stop.");
      return;
    }
    throw new Error("Sway Router is not prepared. Prepare the runtime and installation metadata first.");
  }

  const status = lifecycle.status(installation);
  if (command === "status") {
    showRuntimeStatus(installation, status, options.port);
    return;
  }
  if (command === "stop") {
    const result = await withProgress("Stopping Sway Router", () => lifecycle.stop(installation), {
      doneMessage: "Sway Router stopped",
    });
    console.log(result.stopped ? "Sway Router stopped." : "Sway Router was not running.");
    return;
  }

  const updateInfo = !options.skipUpdate && (command === "start" || command === "restart" || command === "menu")
    ? await checkForUpdate()
    : null;
  if (updateInfo?.updateAvailable && !updateInfo.updateSupported) {
    console.log(`Sway Router v${updateInfo.latestVersion} is available, but this installation cannot self-update.`);
  }
  if (updateInfo?.updateAvailable && updateInfo.updateSupported && command !== "menu" && !isDefaultMenuInvocation(options)) {
    console.log(`Sway Router v${updateInfo.latestVersion} is available. Run \'swayrouter\' to update from the menu.`);
  }
  if (command === "restart") {
    if (status.running) {
      await withProgress("Stopping Sway Router", () => lifecycle.stop(installation), {
        doneMessage: "Sway Router stopped",
      });
    }
    await startRuntime(installation, options);
    return;
  }
  if (command === "menu") {
    await runMenu(installation, { ...options, updateInfo });
    return;
  }
  if (isDefaultMenuInvocation(options)) {
    await startDefaultMenu(installation, options, updateInfo);
    return;
  }
  await startRuntime(installation, options);
}

module.exports = {
  commandFor,
  isDefaultMenuInvocation,
  main,
  parseArgs,
  resolveInstallation,
  usage,
};
