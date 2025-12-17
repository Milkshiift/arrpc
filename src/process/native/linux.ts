import * as fs from "node:fs";
import type { ProcessEntry } from "../../types.ts";

const YIELD_AFTER_MS = 10;
const yieldToEventLoop = (): Promise<void> => new Promise((r) => setImmediate(r));

export const getProcesses = async (): Promise<ProcessEntry[]> => {
	try {
		const pidEntries = await fs.promises.readdir("/proc", {
			withFileTypes: true,
		});

		const processes: ProcessEntry[] = [];
		let lastYield = performance.now();

		for (const dirent of pidEntries) {
			if (!dirent.isDirectory()) continue;

			const code = dirent.name.charCodeAt(0);
			if (code < 48 || code > 57) continue;

			const pid = parseInt(dirent.name, 10);
			if (Number.isNaN(pid)) continue;

			try {
				const procPath = `/proc/${pid}`;
				const cmdline = fs.readFileSync(`${procPath}/cmdline`, "utf8");
				if (!cmdline) continue;

				const status = fs.readFileSync(`${procPath}/status`, "utf8");
				if (status.includes("State:\tT") || status.includes("State:\tZ")) {
					continue;
				}

				let cwdPath: string | undefined;
				try {
					cwdPath = fs.readlinkSync(`${procPath}/cwd`);
				} catch {}

				const nullIndex = cmdline.indexOf("\0");
				if (nullIndex === -1) {
					if (cmdline.length > 0) {
						processes.push([pid, cmdline, [], cwdPath]);
					}
					continue;
				}

				const command = cmdline.substring(0, nullIndex);
				const argsRaw = cmdline.substring(nullIndex + 1);
				const args = argsRaw.split("\0").filter((x) => x);

				processes.push([pid, command, args, cwdPath]);
			} catch {}

			if (performance.now() - lastYield > YIELD_AFTER_MS) {
				await yieldToEventLoop();
				lastYield = performance.now();
			}
		}
		return processes;
	} catch (error: unknown) {
		const message = error instanceof Error ? error.message : String(error);
		console.error("Process discovery error:", message);
		return [];
	}
};