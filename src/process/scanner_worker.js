import { parentPort } from 'worker_threads';
import { readCompressedJson } from './compression.js';
import * as Natives from './native/index.js';

const Native = Natives[process.platform];
let DetectableDB;

class LRUCache {
  constructor(maxSize = 1000) {
    this.maxSize = Math.max(maxSize, 0);
    this.cache = new Map();
  }

  set(key, value) {
    if (this.maxSize === 0) return;

    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxSize) {
      this.cache.delete(this.cache.keys().next().value);
    }
    this.cache.set(key, value);
  }

  has(key) {
    return this.cache.has(key);
  }

  get(key) {
    if (this.cache.has(key)) {
      const value = this.cache.get(key);
      this.cache.delete(key);
      this.cache.set(key, value);
      return value;
    }
    return undefined;
  }
}

const processCache = new LRUCache(1000);
const pathVariationsCache = new LRUCache(1000);

async function initialize() {
  DetectableDB = await readCompressedJson();
}

function _generatePossiblePaths(path) {
  const normalizedPath = path.toLowerCase();
  if (pathVariationsCache.has(normalizedPath)) {
    return pathVariationsCache.get(normalizedPath);
  }

  const splitPath = normalizedPath.replaceAll('\\', '/').split('/');
  if ((/^[a-z]:$/.test(splitPath[0]) || splitPath[0] === "")) {
    splitPath.shift();
  }

  const variations = [];
  const modifiers = ['64', '.x64', 'x64', '_64'];
  
  const maxLength = splitPath.length + 1;
  variations.length = maxLength * (modifiers.length + 1);
  let idx = 0;

  for (let i = 0; i < splitPath.length || i === 1; i++) {
    const basePath = splitPath.slice(-i).join('/');
    variations[idx++] = basePath;
    
    for (const mod of modifiers) {
      if (basePath.includes(mod)) {
        variations[idx++] = basePath.replace(mod, '');
      }
    }
  }

  const result = variations.filter(Boolean);
  pathVariationsCache.set(normalizedPath, result);
  return result;
}

function _matchExecutable(executables, possiblePaths, args, cwdPath) {
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

async function scan() {
  try {
    const processes = await Native.getProcesses();
    const detectedGames = new Set();

    const BATCH_SIZE = 50;
    for (let i = 0; i < processes.length; i += BATCH_SIZE) {
      const batch = processes.slice(i, i + BATCH_SIZE);
      
      for (const [pid, path, args, cwdPath = ''] of batch) {
        const cacheKey = `${pid}:${path}`;
        if (processCache.has(cacheKey)) continue;
        
        processCache.set(cacheKey, true);
        const possiblePaths = _generatePossiblePaths(path);

        for (const { e, i: gameId, n } of DetectableDB) {
          if (_matchExecutable(e, possiblePaths, args, cwdPath)) {
            detectedGames.add({ id: gameId, name: n, pid });
          }
        }
      }
    }

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