// From https://github.com/Legcord/arrpc

import { exec } from "node:child_process";

export const getProcesses = async (): Promise<
	[number, string, string[], undefined][]
> => {
	return new Promise((resolve) => {
		exec("ps -awwx -o pid=,command=", (error, stdout, stderr) => {
			if (error || stderr) {
				resolve([]);
				return;
			}
			const lines = stdout.trim().split("\n");
			const processes = lines
				.map((line) => {
					const match = line.trim().match(/^(\d+)\s+(.*)$/);
					if (!match || !match[1] || !match[2]) return null;
					const pid = +match[1];
					const fullCmd = match[2];
					const [command, ...args] = fullCmd.split(" ");
					return [pid, command, args, undefined] as [number, string, string[], undefined];
				})
				.filter((p): p is [number, string, string[], undefined] => Boolean(p));
			resolve(processes);
		});
	});
};