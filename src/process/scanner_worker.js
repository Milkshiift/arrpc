import { parentPort } from 'worker_threads';
import { readCompressedJson } from './compression.js';
import * as Natives from './native/index.js';

const Native = Natives[process.platform];
let DetectableDB;
let processCache = new Map();

async function initialize() {
  DetectableDB = await readCompressedJson();
}

function _generatePossiblePaths(path) {
  const splitPath = path.toLowerCase().replaceAll('\\', '/').split('/');
  if ((/^[a-z]:$/.test(splitPath[0]) || splitPath[0] === "")) {
    splitPath.shift();
  }

  const toCompare = [];
  for (let i = 0; i < splitPath.length || i === 1; i++) {
    toCompare.push(splitPath.slice(-i).join('/'));
  }

  const variations = [...toCompare];
  for (const p of toCompare) {
    const modifiers = ['64', '.x64', 'x64', '_64'];
    modifiers.forEach(mod => {
      variations.push(p.replace(mod, ''));
    });
  }

  return variations;
}

function _matchExecutable(executables, possiblePaths, args, cwdPath) {
  if (!executables) return false;
  return executables.n.some(name => {
    const pathMatches = name[0] === '>' ? name.substring(1) === possiblePaths[0] : possiblePaths.some(path => name === path || `${cwdPath}/${path}`.includes(`/${name}`));
    const argsMatch = !executables.a || (args && args.join(" ").includes(executables.a));
    return pathMatches && argsMatch;
  });
}

function _pruneCache(currentProcesses) {
  const currentPaths = new Set(currentProcesses.map(([_, path]) => path));

  for (const key of processCache.keys()) {
    const path = key.split(':')[1];
    if (!currentPaths.has(path)) {
      processCache.delete(key);
    }
  }
}

async function scan() {
  try {
    const processes = await Native.getProcesses();
    const detectedGames = new Set();

    // Filter processes using cache
    const processesToScan = processes.filter(([pid, path]) => {
      const cacheKey = `${pid}:${path}`;
      if (processCache.has(cacheKey)) {
        return false;
      } else {
        processCache.set(cacheKey, true);
        return true;
      }
    });

    for (const [pid, path, args, _cwdPath = ''] of processesToScan) {
      const possiblePaths = _generatePossiblePaths(path);

      for (const { e, i, n } of DetectableDB) {
        if (_matchExecutable(e, possiblePaths, args, _cwdPath)) {
          detectedGames.add({ id: i, name: n, pid });
        }
      }
    }

    _pruneCache(processes);

    // Send results back to main thread
    parentPort.postMessage({
      type: 'scan_results',
      games: Array.from(detectedGames)
    });
  } catch (error) {
    parentPort.postMessage({
      type: 'error',
      error: error.message
    });
  }
}

// Handle messages from main thread
parentPort.on('message', async (message) => {
  switch (message.type) {
    case 'init':
      await initialize();
      parentPort.postMessage({ type: 'initialized' });
      break;
    case 'scan':
      await scan();
      break;
  }
}); 