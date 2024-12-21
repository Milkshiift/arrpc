import { readCompressedJson } from "./compression.js";

const rgb = (r, g, b) => (msg) => `\x1b[38;2;${r};${g};${b}m${msg}\x1b[0m`;
const logColor = {
  arRPC: rgb(88, 101, 242)('arRPC'),
  process: rgb(237, 66, 69)('process')
};
const log = (...args) => console.log(`[${logColor.arRPC} > ${logColor.process}]`, ...args);

// Preload and cache database to avoid repeated reads
const DetectableDB = await readCompressedJson();

import * as Natives from './native/index.js';
const Native = Natives[process.platform];

export default class ProcessServer {
  constructor(handlers) {
    if (!Native) return;

    this.handlers = handlers;
    this.timestamps = {};
    this.names = {};
    this.pids = {};

    // Process Cache
    this.processCache = new Map();

    // Use arrow function to preserve 'this' context
    this.scan = () => this._scan();

    // Immediately start scanning and set up interval
    this.scan();
    this.intervalId = setInterval(this.scan, 5000);

    log('started');
  }

  // Destructor-like method to clean up resources
  destroy() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
    }
  }

  async _scan() {
    //const startTime = performance.now();

    try {
      const processes = await Native.getProcesses();
      const activeIds = new Set();

      // Filter processes using cache
      const processesToScan = processes.filter(([pid, path]) => {
        const cacheKey = `${pid}:${path}`;
        if (this.processCache.has(cacheKey)) {
          return false; // Skip cached processes
        } else {
          this.processCache.set(cacheKey, true); // Cache for next scan
          return true; // Scan uncached processes
        }
      });

      for (const [pid, path, args, _cwdPath = ''] of processesToScan) {
        const possiblePaths = this._generatePossiblePaths(path);

        for (const { e, i, n } of DetectableDB) {
          if (this._matchExecutable(e, possiblePaths, args, _cwdPath)) {
            this._handleDetectedGame(i, n, pid, activeIds);
          }
        }
      }

      this._cleanupLostGames(activeIds);
      this._pruneCache(processes);
      //this._logScanPerformance(startTime);
    } catch (error) {
      log('Scan error:', error);
    }
  }

  // Remove stale entries from the cache
  _pruneCache(currentProcesses) {
    const currentProcessKeys = new Set(currentProcesses.map(([pid, path]) => `${pid}:${path}`));
    for (const key of this.processCache.keys()) {
      if (!currentProcessKeys.has(key)) {
        this.processCache.delete(key);
      }
    }
  }

  _generatePossiblePaths(path) {
    const splitPath = path.toLowerCase().replaceAll('\\', '/').split('/');
    if ((/^[a-z]:$/.test(splitPath[0]) || splitPath[0] === "")) {
      splitPath.shift(); // drop the first index if it's a drive letter or empty
    }

    const toCompare = [];
    for (let i = 0; i < splitPath.length || i === 1; i++) {
      toCompare.push(splitPath.slice(-i).join('/'));
    }

    // Generate additional path variations to reduce false negatives
    const variations = [...toCompare];
    for (const p of toCompare) {
      const modifiers = ['64', '.x64', 'x64', '_64'];
      modifiers.forEach(mod => {
        variations.push(p.replace(mod, ''));
      });
    }

    return variations;
  }

  _matchExecutable(executables, possiblePaths, args, cwdPath) {
    if (!executables) return false;
    return executables.n.some(name => {
      const pathMatches = name[0] === '>' ? name.substring(1) === possiblePaths[0] : possiblePaths.some(path => name === path || `${cwdPath}/${path}`.includes(`/${name}`));
      const argsMatch = !executables.a || (args && args.join(" ").includes(executables.a));
      return pathMatches && argsMatch;
    });
  }

  _handleDetectedGame(id, name, pid, activeIds) {
    this.names[id] = name;
    this.pids[id] = pid;
    activeIds.add(id);

    if (!this.timestamps[id]) {
      log('detected game!', name);
      this.timestamps[id] = Date.now();
    }

    // Send activity consistently
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

  _cleanupLostGames(activeIds) {
    for (const id in this.timestamps) {
      if (!activeIds.has(id)) {
        log('lost game!', this.names[id]);

        this.handlers.message({
          socketId: id
        }, {
          cmd: 'SET_ACTIVITY',
          args: {
            activity: null,
            pid: this.pids[id]
          }
        });

        delete this.timestamps[id];
        delete this.names[id];
        delete this.pids[id];
      }
    }
  }

  _logScanPerformance(startTime) {
    const duration = (performance.now() - startTime).toFixed(2);
    log(`finished scan in ${duration}ms`);
  }
}