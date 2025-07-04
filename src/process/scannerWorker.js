import {parentPort} from 'worker_threads';
import {getProcessesLinux} from "./native/linux.js";
import {getProcessesWindows} from "./native/win32.js";
import {getProcessesDarwin} from "./native/darwin.js";

let getProcesses;
switch (process.platform) {
    case 'linux':
        getProcesses = getProcessesLinux;
        break;
    case 'win32':
        getProcesses = getProcessesWindows;
        break;
  case 'darwin':
        getProcesses = getProcessesDarwin;
        break;
}

let DetectableDB;

function _generatePossiblePaths(path) {
  if (!_generatePossiblePaths.cache) _generatePossiblePaths.cache = new Map();
  if (_generatePossiblePaths.cache.has(path)) return _generatePossiblePaths.cache.get(path);

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

  _generatePossiblePaths.cache.set(path, variations);
  
  if (_generatePossiblePaths.cache.size > 1000) {
    const iterator = _generatePossiblePaths.cache.keys();
    _generatePossiblePaths.cache.delete(iterator.next().value);
  }
  
  return variations;
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
  const startTime = performance.now();
  let processCount = 0;
  
  try {
    const processes = await getProcesses();
    processCount = processes.length;
    const detectedGames = new Set();
    
    const detectionMap = new Map();
    for (const element of DetectableDB) {
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
      
      const possiblePaths = _generatePossiblePaths(path);
      
      const potentialMatches = new Set();
      for (const possiblePath of possiblePaths) {
        if (detectionMap.has(possiblePath)) {
          detectionMap.get(possiblePath).forEach(element => potentialMatches.add(element));
        }
      }
      
      for (const element of potentialMatches) {
        try {
          const { e, i, n } = element;
          if (_matchExecutable(e, possiblePaths, args, _cwdPath)) {
            detectedGames.add({ id: i, name: n, pid });
          }
        } catch (error) {
          parentPort.postMessage({
            type: 'error',
            error: "Error during processing: " + error + "\nCaused by: " + JSON.stringify(element)
          });
        }
      }
    }

    const scanTime = performance.now() - startTime;
    
    parentPort.postMessage({
      type: 'scan_results',
      games: Array.from(detectedGames),
      stats: {
        scanTimeMs: scanTime,
        processCount
      }
    });
  } catch (error) {
    const scanTime = performance.now() - startTime;
    parentPort.postMessage({
      type: 'error',
      error: error.message,
      stats: {
        scanTimeMs: scanTime,
        processCount
      }
    });
  }
}

parentPort.on('message', async (message) => {
  switch (message.type) {
    case 'init':
      DetectableDB = message.detectable;
      _generatePossiblePaths.cache = new Map();
      parentPort.postMessage({ type: 'initialized' });
      break;
    case 'scan':
      await scan();
      break;
    case 'clear_cache':
      if (_generatePossiblePaths.cache) {
        _generatePossiblePaths.cache.clear();
      }
      parentPort.postMessage({ type: 'cache_cleared' });
      break;
  }
}); 