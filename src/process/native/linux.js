import * as fs from "node:fs";

const YIELD_AFTER_MS = 10;

const yieldToEventLoop = () => new Promise((resolve) => setImmediate(resolve));

export const getProcesses = async () => {
	try {
		const pidEntries = await fs.promises.readdir("/proc", {
			withFileTypes: true,
		});

		const processes = [];
		let lastYield = performance.now();

		for (const dirent of pidEntries) {
			if (!dirent.isDirectory()) continue;

			const code = dirent.name.charCodeAt(0);
			if (code < 48 || code > 57) continue;

			const pid = +dirent.name;

			try {
				const cmdline = fs.readFileSync(`/proc/${pid}/cmdline`, "utf8");
				if (!cmdline) continue;

				// Check status to avoid Zombies (Z) or Stopped (T) processes
				const status = fs.readFileSync(`/proc/${pid}/status`, "utf8");
				if (status.includes("State:\tT") || status.includes("State:\tZ")) {
					continue;
				}

				let cwdPath;
				try {
					cwdPath = fs.readlinkSync(`/proc/${pid}/cwd`);
				} catch {}

				const nullIndex = cmdline.indexOf("\0");
				if (nullIndex === -1) continue;

				const command = cmdline.substring(0, nullIndex);
				const argsRaw = cmdline.substring(nullIndex + 1);

				const args = argsRaw.split("\0").filter((x) => x);

				processes.push([pid, command, args, cwdPath]);
			} catch (_e) {}

			if (performance.now() - lastYield > YIELD_AFTER_MS) {
				await yieldToEventLoop();
				lastYield = performance.now();
			}
		}
		return processes;
	} catch (error) {
		console.error("Process discovery error:", error.message);
		return [];
	}
};
