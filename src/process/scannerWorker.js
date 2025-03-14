import {parentPort} from 'worker_threads';
import {getProcessesLinux} from "./native/linux.js";
import {getProcessesWindows} from "./native/win32.js";

const getProcesses = process.platform === 'linux' ? getProcessesLinux : getProcessesWindows;
let DetectableDB;

function _generatePossiblePaths(path) {
  const normalizedPath = path.toLowerCase();

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

  return variations.filter(Boolean);
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
    const processes = await getProcesses();
    const detectedGames = new Set();

    for (const [pid, path, args, _cwdPath = ''] of processes) {
      const possiblePaths = _generatePossiblePaths(path);

      for (const element of DetectableDB) {
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

parentPort.on('message', async (message) => {
  switch (message.type) {
    case 'init':
      DetectableDB = message.detectable;
      parentPort.postMessage({ type: 'initialized' });
      break;
    case 'scan':
      await scan();
      break;
  }
}); 