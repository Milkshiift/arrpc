import { exec } from "node:child_process";
import type { ProcessEntry } from "../../types.ts";

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

					const processes: ProcessEntry[] = data
						.map((proc: any) => {
							const pid = proc.ProcessId;
							if (!pid) return null;

							const path = proc.ExecutablePath || proc.Name;
							if (!path) return null;

							const cmdLine = proc.CommandLine || "";
							let args: string[] = [];

							if (cmdLine) {
								args = cmdLine.split(" ");
							}

							return [pid, path, args, undefined] as ProcessEntry;
						})
						.filter((p: any) => p !== null);

					resolve(processes);
				} catch (e) {
					resolve([]);
				}
			},
		);
	});
};
