import {parentPort} from 'worker_threads';
import {readdir, readFile, readlink} from "fs/promises";
import {exec} from "child_process";

export const getProcessesLinux = async () => {
  try {
    const pidEntries = await readdir("/proc", { withFileTypes: true });
    const processTasks = pidEntries.filter(dirent => dirent.isDirectory() && /^\d+$/.test(dirent.name))
        .map(async (dirent) => {
          const pid = +dirent.name;
          try {
            // Use a timeout to prevent hanging on unreadable files
            const cmdlineContent = await Promise.race([
              readFile(`/proc/${pid}/cmdline`, 'utf8'),
              new Promise((_, reject) =>
                  setTimeout(() => reject(new Error('Timeout')), 100)
              )
            ]);

            // ignore suspended processes
            try {
              const status = await readFile(`/proc/${pid}/status`, 'utf8');
              if (status.includes('State:\tT')) return null;
            } catch (err) {}

            let cwdPath;
            try {
              cwdPath = await readlink(`/proc/${pid}/cwd`);
            } catch (err) {}

            const parts = cmdlineContent.split('\0').filter(part => part.trim() !== '');

            return parts.length ? [pid, parts[0], parts.slice(1), cwdPath] : null;
          } catch {
            return null;
          }
        });
    const processes = await Promise.all(processTasks);
    return processes.filter(Boolean);
  } catch (error) {
    console.error('Process discovery error:', error);
    return [];
  }
};

export const getProcessesWindows = () => new Promise(res => exec(`wmic process get ProcessID,ExecutablePath /format:csv`, (e, out) => {
  res(out.toString().split('\r\n').slice(2).map(x => {
    const parsed = x.trim().split(',').slice(1).reverse();
    return [ parseInt(parsed[0]) || parsed[0], parsed[1] ];
  }).filter(x => x[1]));
}));

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

      for (const { e, i, n } of DetectableDB) {
        if (_matchExecutable(e, possiblePaths, args, _cwdPath)) {
          detectedGames.add({ id: i, name: n, pid });
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