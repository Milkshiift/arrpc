import { exec } from "node:child_process";
import type { ProcessEntry } from "../../types.ts";

interface RawProcess {
    ProcessId?: number;
    ExecutablePath?: string;
    CommandLine?: string;
    Name?: string;
}

const parseCommandLine = (cmd: string): string[] => {
    const args: string[] = [];
    // "([^"]*)" Matches content inside double quotes (Group 1)
    // ([^\s"]+) OR Matches non-whitespace, non-quote sequences (Group 2)
    const argsRegex = /"([^"]*)"|([^\s"]+)/g;

    const matches = cmd.matchAll(argsRegex);
    for (const match of matches) {
        args.push(match[1] ?? match[2] ?? "");
    }
    return args;
};

export const getProcesses = async (): Promise<ProcessEntry[]> => {
    return new Promise((resolve) => {
        const cmd =
            "Get-CimInstance Win32_Process | Select-Object ProcessId, ExecutablePath, CommandLine, Name | ConvertTo-Json -Compress";

        exec(
            `powershell -NoProfile -Command "${cmd}"`,
            { maxBuffer: 10 * 1024 * 1024 },
            (error, stdout, stderr) => {
                if (error || stderr || !stdout) {
                    resolve([]);
                    return;
                }

                try {
                    let data = JSON.parse(stdout.trim());
                    if (!Array.isArray(data)) {
                        data = [data];
                    }

                    const processes = (data as RawProcess[])
                        .map((proc) => {
                            const pid = proc.ProcessId;
                            if (!pid) return null;

                            const path = proc.ExecutablePath || proc.Name;
                            if (!path) return null;

                            const cmdLine = proc.CommandLine || "";
                            let args: string[] = [];

                            if (cmdLine) {
                                const allParts = parseCommandLine(cmdLine);
                                if (allParts.length > 0) {
                                    allParts.shift();
                                }
                                args = allParts;
                            }

                            return [pid, path, args, undefined] as ProcessEntry;
                        })
                        .filter((p): p is ProcessEntry => p !== null);

                    resolve(processes);
                } catch (_e) {
                    resolve([]);
                }
            },
        );
    });
};