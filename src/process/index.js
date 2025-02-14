import { Worker } from 'worker_threads';
import { Logger } from '../logger.js';
import * as Natives from './native/index.js';
import {getDetectableDB} from "./downloader.js";
import {workerCode} from "./scannerWorkerString.js";
const log = new Logger("process", "red").log;
const Native = Natives[process.platform];

export default class ProcessServer {
  constructor(handlers, detectablePath) {
    if (!Native) return;

    this.detectablePath = detectablePath;
    this.handlers = handlers;
    this.timestamps = {};
    this.names = {};
    this.pids = {};

    void this.initializeWorker();
  }

  async initializeWorker() {
    // We make the worker from a string so arrpc can be used in bundled environments
    this.worker = new Worker(workerCode, {eval: true});

    this.worker.on('message', (message) => {
      switch (message.type) {
        case 'initialized':
          this.startScanning();
          break;
        case 'scan_results':
          this.handleScanResults(message.games);
          break;
        case 'error':
          log('Scan error:', message.error);
          break;
      }
    });

    this.worker.on('error', (error) => {
      log('Worker error:', error);
    });

    this.worker.postMessage({
      type: 'init',
      detectable: await getDetectableDB(this.detectablePath)
    });
  }

  startScanning() {
    this.worker.postMessage({ type: 'scan' });

    this.intervalId = setInterval(() => {
      this.worker.postMessage({ type: 'scan' });
    }, 5000);

    log('started');
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
      }
    }
  }

  destroy() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
    }
    if (this.worker) {
      void this.worker.terminate();
    }
  }
}