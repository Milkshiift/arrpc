import { readdir, readFile, readlink } from "fs/promises";

export const getProcesses = async () => {
  try {
    const pidEntries = await readdir("/proc", { withFileTypes: true });

    const processTasks = pidEntries
        .filter(dirent =>
            dirent.isDirectory() &&
            /^\d+$/.test(dirent.name)
        )
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