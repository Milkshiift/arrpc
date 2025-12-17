import { Logger } from "../logger.ts";
import { getDetectableDB, type DetectableGame, type DetectableExecutable } from "./downloader.ts";
import type { ProcessEntry } from "../types.ts";

const log = new Logger("process", "red").log;

const DEBUG = process.argv.includes("--debug");

type ProcessScanner = () => Promise<ProcessEntry[]>;
let getProcesses: ProcessScanner;

try {
	switch (process.platform) {
		case "win32":
			getProcesses = (await import("./native/win32.ts")).getProcesses;
			break;
		case "darwin":
			getProcesses = (await import("./native/darwin.ts")).getProcesses;
			break;
		case "linux":
			getProcesses = (await import("./native/linux.ts")).getProcesses;
			break;
		default:
			throw new Error(`Unsupported platform: ${process.platform}`);
	}
} catch (e) {
	log("Failed to import native process scanner:", e);
	process.exit(1);
}

export interface ProcessServerHandlers {
	message: (socket: { socketId: string }, msg: unknown) => void;
}

interface DetectedGame {
	id: string;
	name: string;
	pid: number;
}

export default class ProcessServer {
	handlers: ProcessServerHandlers;
	timestamps: Record<string, number> = {};
	names: Record<string, string> = {};
	pids: Record<string, number> = {};
	detectablePath: string;
	DetectableDB: DetectableGame[] = [];

	detectionMap: Map<string, DetectableGame[]> = new Map();

	private isScanning = false;

	private pathCache: Map<string, string[]> = new Map();

	constructor(handlers: ProcessServerHandlers, detectablePath: string) {
		this.handlers = handlers;
		this.detectablePath = detectablePath;
		void this.init();
	}

	async init(): Promise<void> {
		this.DetectableDB = await getDetectableDB(this.detectablePath);
		this.detectionMap.clear();

		for (const game of this.DetectableDB) {
			if (game.e && Array.isArray(game.e)) {
				for (const exec of game.e) {
					const key = exec.n;
					const list = this.detectionMap.get(key) ?? [];
					list.push(game);
					this.detectionMap.set(key, list);
				}
			}
		}

		this.pathCache.clear();

		await this.scan();
		setInterval(() => void this.scan(), 5000);

		log("started");
	}

	generatePossiblePaths(path: string): string[] {
		const cached = this.pathCache.get(path);
		if (cached) return cached;

		const normalizedPath = path.toLowerCase();
		const splitPath = normalizedPath.replaceAll("\\", "/").split("/");

		const variations: string[] = [];
		const modifiers = ["64", ".x64", "x64", "_64"];

		for (let i = 0; i < splitPath.length; i++) {
			const basePath = splitPath.slice(-i - 1).join("/");
			if (!basePath) continue;

			variations.push(basePath);

			for (const mod of modifiers) {
				if (basePath.includes(mod)) {
					variations.push(basePath.replaceAll(mod, ""));
				}
			}
		}

		this.pathCache.set(path, variations);

		// Simple LRU-like eviction
		if (this.pathCache.size > 1000) {
			const firstKey = this.pathCache.keys().next().value;
			if (firstKey) this.pathCache.delete(firstKey);
		}

		return variations;
	}

	private matchExecutable(
		executables: DetectableExecutable[],
		possiblePaths: string[],
		args: string[] | undefined,
		cwdPath: string | undefined,
	): boolean {
		if (!executables || !Array.isArray(executables)) return false;

		return executables.some((exec) => {
			const argsMatch = !exec.a || args?.includes(exec.a);
			if (!argsMatch) return false;

			const name = exec.n;
			const isStrict = exec.s === 1;

			if (isStrict) {
				return name === possiblePaths[0];
			}

			// Loose match: check variations or partial path matches
			return possiblePaths.some(
				(path) =>
					name === path ||
					(cwdPath && `${cwdPath}/${path}`.includes(`/${name}`)),
			);
		});
	}

	async scan(): Promise<void> {
		if (this.isScanning) return;
		this.isScanning = true;

		const startTime = DEBUG ? performance.now() : 0;
		let processCount = 0;

		try {
			const processes = await getProcesses();
			processCount = processes.length;
			const detectedGames = new Set<DetectedGame>();

			for (const [pid, path, args, _cwdPath] of processes) {
				if (!path) continue;
				const possiblePaths = this.generatePossiblePaths(path);
				const cwdPath = _cwdPath || "";

				const potentialMatches = new Set<DetectableGame>();

				// Find all games that *might* be associated with this executable name
				for (const possiblePath of possiblePaths) {
					const matches = this.detectionMap.get(possiblePath);
					if (matches) {
						for (const match of matches) potentialMatches.add(match);
					}
				}

				// Verify the specific matching rules (arguments, strictness)
				for (const game of potentialMatches) {
					try {
						if (game.e && this.matchExecutable(game.e, possiblePaths, args, cwdPath) && game.i && game.n) {
							detectedGames.add({ id: game.i, name: game.n, pid });
							break;
						}
					} catch (error) {
						log("Error during matching:", error);
					}
				}
			}

			this.handleScanResults(Array.from(detectedGames));

			if (DEBUG) {
				log(`Scan completed in ${(performance.now() - startTime).toFixed(2)}ms, checked ${processCount} processes`);
			}
		} catch (error: unknown) {
			log("Worker error:", error instanceof Error ? error.message : error);
		} finally {
			this.isScanning = false;
		}
	}

	handleScanResults(games: DetectedGame[]): void {
		const activeIds = new Set<string>();

		for (const { id, name, pid } of games) {
			this.names[id] = name;
			this.pids[id] = pid;
			activeIds.add(id);

			if (!this.timestamps[id]) {
				log("detected game!", name);
				this.timestamps[id] = Date.now();
			}

			this.handlers.message(
				{ socketId: id },
				{
					cmd: "SET_ACTIVITY",
					args: {
						activity: {
							application_id: id,
							name,
							timestamps: {
								start: this.timestamps[id],
							},
						},
						pid,
					},
				},
			);
		}

		this.cleanupLostGames(activeIds);
	}

	private cleanupLostGames(activeIds: Set<string>): void {
		for (const id in this.timestamps) {
			if (!activeIds.has(id)) {
				log("lost game!", this.names[id]);

				const closingPid = this.pids[id];

				delete this.timestamps[id];
				delete this.names[id];
				delete this.pids[id];

				this.handlers.message(
					{ socketId: id },
					{
						cmd: "SET_ACTIVITY",
						args: {
							activity: null,
							pid: closingPid,
						},
					},
				);
			}
		}
	}
}