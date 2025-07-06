import { Logger } from '../logger.js';
import {getDetectableDB} from "./downloader.js";
const log = new Logger("process", "red").log;

const DEBUG = process.argv.some((arg) => arg === "--debug");

let getProcesses;
switch (process.platform) {
    case "win32":
        getProcesses = (await import("./native/win32.js")).getProcesses;
        break;
    case "darwin":
        getProcesses = (await import("./native/darwin.js")).getProcesses;
        break;
    case "linux":
        getProcesses = (await import("./native/linux.js")).getProcesses;
        break;
    default:
        throw new Error("Unsupported platform");
}

export default class ProcessServer {
  constructor(handlers, detectablePath) {
    if (!getProcesses) return;

    this.handlers = handlers;
    this.timestamps = {};
    this.names = {};
    this.pids = {};
    this.detectablePath = detectablePath;

    void this.init();
  }

  async init() {
    this.DetectableDB = await getDetectableDB(this.detectablePath);
    this._generatePossiblePaths.cache = new Map();

    this.scan = this.scan.bind(this);
    await this.scan();
    setInterval(this.scan, 5000);

    log('started');
  }

  _generatePossiblePaths(path) {
    if (!this._generatePossiblePaths.cache) this._generatePossiblePaths.cache = new Map();
    if (this._generatePossiblePaths.cache.has(path)) return this._generatePossiblePaths.cache.get(path);

    const normalizedPath = path.toLowerCase();

    const splitPath = normalizedPath.replaceAll('\\', '/').split('/');
    if ((/^[a-z]:$/.test(splitPath[0]) || splitPath[0] === "")) {
      splitPath.shift();
    }

    const variations = [];
    const modifiers = ['64', '.x64', 'x64', '_64'];

    for (let i = 0; i < splitPath.length || i === 1; i++) {
      const basePath = splitPath.slice(-i).join('/');
      if (!basePath) continue;

      variations.push(basePath);

      for (const mod of modifiers) {
        if (basePath.includes(mod)) {
          variations.push(basePath.replace(mod, ''));
        }
      }
    }

    this._generatePossiblePaths.cache.set(path, variations);

    if (this._generatePossiblePaths.cache.size > 1000) {
      const iterator = this._generatePossiblePaths.cache.keys();
      this._generatePossiblePaths.cache.delete(iterator.next().value);
    }

    return variations;
  }

  _matchExecutable(executables, possiblePaths, args, cwdPath) {
    if (!executables) return false;
    const argsMatch = !executables.a || (args && args.includes(executables.a));
    if (!argsMatch) return false;

    return executables.n.some(name => {
      if (name[0] === '>') {
        return name.substring(1) === possiblePaths[0];
      }
      return possiblePaths.some(path =>
          name === path || (cwdPath && `${cwdPath}/${path}`.includes(`/${name}`))
      );
    });
  }

  async scan() {
    const startTime = DEBUG ? performance.now() : undefined;
    let processCount = 0;

    try {
      const processes = await getProcesses();
      processCount = processes.length;
      const detectedGames = new Set();

      const detectionMap = new Map();
      for (const element of this.DetectableDB) {
        if (element.e && element.e.n) {
          for (const name of element.e.n) {
            const key = name[0] === '>' ? name.substring(1) : name;
            if (!detectionMap.has(key)) {
              detectionMap.set(key, []);
            }
            detectionMap.get(key).push(element);
          }
        }
      }

      for (const [pid, path, args, _cwdPath = ''] of processes) {
        if (!path) continue; // Skip processes with no path

        const possiblePaths = this._generatePossiblePaths(path);

        const potentialMatches = new Set();
        for (const possiblePath of possiblePaths) {
          if (detectionMap.has(possiblePath)) {
            detectionMap.get(possiblePath).forEach(element => potentialMatches.add(element));
          }
        }

        for (const element of potentialMatches) {
          try {
            const { e, i, n } = element;
            if (this._matchExecutable(e, possiblePaths, args, _cwdPath)) {
              detectedGames.add({ id: i, name: n, pid });
            }
          } catch (error) {
            log('Error during processing:', error, '\nCaused by:', JSON.stringify(element));
          }
        }
      }

      this.handleScanResults(Array.from(detectedGames));

      if (DEBUG) log(`Scan completed in ${(performance.now() - startTime).toFixed(2)}ms, checked ${processCount} processes`);
    } catch (error) {
      log('Worker error:', error.message);
    }
  }

  handleScanResults(games) {
    const activeIds = new Set();

    for (const { id, name, pid } of games) {
      this.names[id] = name;
      this.pids[id] = pid;
      activeIds.add(id);

      if (!this.timestamps[id]) {
        log('detected game!', name);
        this.timestamps[id] = Date.now();
      }

      this.handlers.message({
        socketId: id
      }, {
        cmd: 'SET_ACTIVITY',
        args: {
          activity: {
            application_id: id,
            name,
            timestamps: {
              start: this.timestamps[id]
            }
          },
          pid
        }
      });
    }

    this._cleanupLostGames(activeIds);
  }

  _cleanupLostGames(activeIds) {
    for (const id in this.timestamps) {
      if (!activeIds.has(id)) {
        log('lost game!', this.names[id]);
        delete this.timestamps[id];
        delete this.names[id];
        delete this.pids[id];

        this.handlers.message({
          socketId: id
        }, {
          cmd: 'SET_ACTIVITY',
          args: {
            activity: null,
            pid: this.pids[id]
          }
        });
      }
    }
  }
}