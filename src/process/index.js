import { readCompressedJson } from "./compression.js";

// Optimize color logging to reduce function call overhead
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
    const startTime = performance.now();

    try {
      const processes = await Native.getProcesses();
      const activeIds = new Set();

      for (const [pid, _path, args] of processes) {
        const path = _path.toLowerCase().replaceAll('\\', '/');
        const possiblePaths = this._generatePossiblePaths(path);

        for (const { executables, id, name } of DetectableDB) {
          if (this._matchExecutable(executables, possiblePaths, args)) {
            this._handleDetectedGame(id, name, pid, activeIds);
          }
        }
      }

      this._cleanupLostGames(activeIds);

      this._logScanPerformance(startTime);
    } catch (error) {
      log('Scan error:', error);
    }
  }

  _generatePossiblePaths(path) {
    const splitPath = path.split('/');
    const toCompare = [];

    // Generate base path variations
    for (let i = 1; i < splitPath.length; i++) {
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

  _matchExecutable(executables, possiblePaths, args) {
    return executables?.some(x => {
      // Skip launcher executables
      if (x.is_launcher) return false;

      // Advanced path matching
      const pathMatches = x.name[0] === '>'
          ? x.name.substring(1) === possiblePaths[0]
          : possiblePaths.some(path => x.name === path);

      // Optional argument matching
      const argsMatch = !x.arguments ||
          (args && args.join(" ").includes(x.arguments));

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

    // More efficient stdout writing
    process.stdout.write(`\r${' '.repeat(100)}\r[${logColor.arRPC} > ${logColor.process}] scanned (took ${duration}ms)`);
  }
}