/*
This basically spawns a long-running powershell script to get all the processes and their arguments.
On a VM, this results in ~30ms per scan.
A native module approach using C++ is around 15ms, and in my opinion is not worth the hassle.
 */

import { type ChildProcess, spawn } from "node:child_process";
import { Logger } from "../../logger.ts";
import type { ProcessEntry } from "../../types.ts";

const log = new Logger("win32-ps", "blueBright").log;

const END_MARKER = "__EOF__";

// ASCII Unit Separator (31).
// Safe for parsing as it is forbidden in Windows filenames and rare in arguments.
const SEP = "\x1f";

const PS_SCRIPT = `
$ErrorActionPreference = "SilentlyContinue";
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8;
$searcher = [System.Management.ManagementObjectSearcher]::new("SELECT ProcessId, ExecutablePath, CommandLine, Name FROM Win32_Process");

# Pre-allocate 64KB to minimize resizing overhead
$sb = [System.Text.StringBuilder]::new(65536);
# Cast to char primitive for faster appending
$sep = [char]31; 

while ($true) {
    $line = [Console]::In.ReadLine();
    if ($line -eq $null) { break; }
    
    if ($line -eq 'scan') {
        $sb.Clear();
        
        foreach ($item in $searcher.Get()) {
            $path = $item["ExecutablePath"];
            if (-not $path) {
                $path = $item["Name"];
            }

            # Assign to $null is faster than [void] casting or Out-Null
            $null = $sb.Append($item["ProcessId"]).Append($sep).Append($path).Append($sep).Append($item["CommandLine"]).AppendLine();
        }
        
        [Console]::Write($sb.ToString());
        [Console]::WriteLine("${END_MARKER}");
    }
}
`;

let psChild: ChildProcess | null = null;
let stdOutBuffer = "";

let activePromise: Promise<ProcessEntry[]> | null = null;
let resolveActive: ((value: ProcessEntry[]) => void) | null = null;
let currentResults: ProcessEntry[] = [];

// Compiled regex for argument splitting
const ARGS_REGEX = /"([^"]*)"|([^\s"]+)/g;

const ensureProcess = () => {
	if (psChild && !psChild.killed) return;

	log("Spawning background PowerShell process...");

	const scriptBuffer = Buffer.from(PS_SCRIPT, "utf16le");
	const encodedScript = scriptBuffer.toString("base64");

	psChild = spawn(
		"powershell",
		["-NoProfile", "-NonInteractive", "-EncodedCommand", encodedScript],
		{
			stdio: ["pipe", "pipe", "ignore"],
			windowsHide: true,
		},
	);

	psChild.stdout?.setEncoding("utf8");

	psChild.stdout?.on("data", (chunk: string) => {
		stdOutBuffer += chunk;

		const lastNewlineIdx = stdOutBuffer.lastIndexOf("\n");
		if (lastNewlineIdx === -1) return;

		const completeData = stdOutBuffer.substring(0, lastNewlineIdx);
		stdOutBuffer = stdOutBuffer.substring(lastNewlineIdx + 1);

		const lines = completeData.split("\n");
		const len = lines.length;

		for (let i = 0; i < len; i++) {
			const rawLine = lines[i];

			if (!rawLine || rawLine.length === 0) continue;

			const line = rawLine.trim();
			if (!line) continue;

			if (line === END_MARKER) {
				if (resolveActive) {
					resolveActive(currentResults);
					resolveActive = null;
					activePromise = null;
					currentResults = [];
				}
				continue;
			}

			if (resolveActive) {
				const p1 = line.indexOf(SEP);
				if (p1 === -1) continue;

				const p2 = line.indexOf(SEP, p1 + 1);

				const pid = parseInt(line.substring(0, p1), 10);

				if (!Number.isNaN(pid)) {
					// Optimized substring extraction (V8 rope)
					const rawPath =
						p2 > -1 ? line.substring(p1 + 1, p2) : line.substring(p1 + 1);
					const cmd = p2 > -1 ? line.substring(p2 + 1) : "";

					const args: string[] = [];
					if (cmd) {
						let argsStr = "";

						// Extract arguments by removing the executable path from the command line
						if (cmd.startsWith(`"${rawPath}"`)) {
							argsStr = cmd.slice(rawPath.length + 2).trim();
						} else if (cmd.startsWith(rawPath)) {
							argsStr = cmd.slice(rawPath.length).trim();
						} else {
							const match = /^("([^"]+)"|([^\s"]+))\s+(.*)$/.exec(cmd);
							if (match) argsStr = match[4] || "";
						}

						if (argsStr) {
							ARGS_REGEX.lastIndex = 0;
							let m: RegExpExecArray | null = ARGS_REGEX.exec(argsStr);
							while (m !== null) {
								args.push(m[1] ?? m[2] ?? "");
								m = ARGS_REGEX.exec(argsStr);
							}
						}
					}

					currentResults.push([
						pid,
						rawPath.replace(/\\/g, "/"),
						args,
						undefined,
					]);
				}
			}
		}
	});

	psChild.on("close", () => {
		psChild = null;
		stdOutBuffer = "";
		if (resolveActive) {
			resolveActive([]);
			resolveActive = null;
			activePromise = null;
		}
	});
};

export const getProcesses = async (): Promise<ProcessEntry[]> => {
	ensureProcess();

	if (!psChild || psChild.killed) return [];
	if (activePromise) return activePromise;

	activePromise = new Promise((resolve) => {
		currentResults = [];
		resolveActive = resolve;
		psChild?.stdin?.write("scan\n");
	});

	return activePromise;
};

const cleanup = () => {
	if (psChild) {
		psChild.kill();
		psChild = null;
	}
};

process.on("exit", cleanup);
process.on("SIGINT", () => { cleanup(); process.exit(); });
process.on("SIGTERM", () => { cleanup(); process.exit(); });
process.on("SIGHUP", () => { cleanup(); process.exit(); });