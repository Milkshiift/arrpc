import * as fs from "fs";

const FILE_OPERATION_TIMEOUT_MS = 100;
const YIELD_AFTER_N_PIDS = 10;

const yieldToEventLoop = () => new Promise(resolve => setImmediate(resolve));

export const getProcessesLinux = async () => {
    try {
        const pidEntries = fs.readdirSync("/proc", { withFileTypes: true });
        const pidsToProcess = pidEntries.filter(dirent => dirent.isDirectory() && /^\d+$/.test(dirent.name));

        const processes = [];
        let processedCount = 0;

        for (const dirent of pidsToProcess) {
            const pid = +dirent.name;
            try {
                let cmdlineContent;
                try {
                    const syncCmdlineRead = () => fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8');
                    cmdlineContent = await Promise.race([
                        new Promise((resolve, reject) => {
                            try { resolve(syncCmdlineRead()); } catch (e) { reject(e); }
                        }),
                        new Promise((_, reject) =>
                            setTimeout(() => reject(new Error(`Timeout reading cmdline for PID ${pid}`)), FILE_OPERATION_TIMEOUT_MS)
                        )
                    ]);
                } catch (err) {
                    continue;
                }

                let statusContent;
                try {
                    statusContent = fs.readFileSync(`/proc/${pid}/status`, 'utf8');
                } catch (statusErr) {
                    continue;
                }

                if (statusContent.includes('State:\tT') || statusContent.includes('State:\tZ')) {
                    continue;
                }

                let cwdPath;
                try {
                    cwdPath = fs.readlinkSync(`/proc/${pid}/cwd`);
                } catch (err) { /* cwd is optional */ }

                const parts = cmdlineContent.split('\0').filter(part => part.trim() !== '');

                if (parts.length > 0) {
                    processes.push([pid, parts[0], parts.slice(1), cwdPath]);
                }
            } catch (err) {}

            processedCount++;
            if (processedCount % YIELD_AFTER_N_PIDS === 0) {
                await yieldToEventLoop();
            }
        }
        return processes;
    } catch (error) {
        console.error('Process discovery error:', error.message);
        return [];
    }
};