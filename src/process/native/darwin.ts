// From https://github.com/Legcord/arrpc

import { exec } from "node:child_process";
import type { ProcessEntry } from "../../types.ts";

export const getProcesses = async (): Promise<ProcessEntry[]> => {
	return new Promise((resolve) => {
		exec("ps -awwx -o pid=,comm=", (error, stdout, stderr) => {
			if (error || stderr) {
				resolve([]);
				return;
			}
			const lines = stdout.trim().split("\n");
			const processes = lines
				.map((line) => {
					const trimmed = line.trim();
					const splitIndex = trimmed.indexOf(" ");
					if (splitIndex === -1) return null;

					const pidStr = trimmed.substring(0, splitIndex);
					const comm = trimmed.substring(splitIndex + 1).trim();
					const pid = parseInt(pidStr, 10);

					if (Number.isNaN(pid) || !comm) return null;

					return [pid, comm, [], undefined] as [
						number,
						string,
						string[],
						undefined,
					];
				})
				.filter((p): p is [number, string, string[], undefined] => Boolean(p));
			resolve(processes);
		});
	});
};
