import { Logger } from "../logger.ts";
import { type DetectableGame, getDetectableDB, } from "./downloader.ts";
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
	timestamp: number;
}

export default class ProcessServer {
	handlers: ProcessServerHandlers;
	timestamps: Record<string, number> = {};
	names: Record<string, string> = {};
	pids: Record<string, number> = {};
	detectablePath: string;

	detectionMap: Map<string, DetectableGame[]> = new Map();

	private isScanning = false;
	private lastScanTime = 0;
	private readonly SCAN_INTERVAL = 5000;
	private readonly MIN_SCAN_INTERVAL = 1000;

	constructor(handlers: ProcessServerHandlers, detectablePath: string) {
		this.handlers = handlers;
		this.detectablePath = detectablePath;
		void this.init();
	}

	async init(): Promise<void> {
		const db = await getDetectableDB(this.detectablePath);
		this.detectionMap.clear();

		// Pre-process the DB into a Map for O(1) lookups
		for (const game of db) {
			if (game.e && Array.isArray(game.e)) {
				for (const exec of game.e) {
					// Index by the executable name
					const name = exec.n.toLowerCase();

					// Also index by filename if the entry contains a path (e.g. "bin/game")
					const key = name.split("/").pop() ?? name;

					const list = this.detectionMap.get(key) ?? [];
					list.push(game);
					this.detectionMap.set(key, list);
				}
			}
		}

		log(`indexed ${db.length} games`);

		await this.scan();

		setInterval(() => {
			const now = Date.now();
			if (now - this.lastScanTime >= this.MIN_SCAN_INTERVAL) {
				void this.scan();
			}
		}, this.SCAN_INTERVAL);

		log("started");
	}

	private isValidProcess(pid: number, path: string): boolean {
		if (pid === 1) return false;
		if (path.length < 1) return false;

		// Internal *nix stuff
		if (path.startsWith("/proc")) return false;
		if (path.startsWith("/usr/lib/")) return false;
		if (path.includes("systemd")) return false;

		// System processes / Wine
		if (path.startsWith("c:/windows")) return false;

		// CEF / Electron noise
		if (path.includes("webhelper")) return false;

		if (path.endsWith("/bin/dolphin")) return false; // KDE file manager

		return true;
	}

	private stripBitness(name: string): string {
		return name
			.replace(/\.x64/g, "")
			.replace(/_64/g, "")
			.replace(/x64/g, "")
			.replace(/64/g, "");
	}

	async scan(): Promise<void> {
		if (this.isScanning) return;
		this.isScanning = true;
		this.lastScanTime = Date.now();

		const startTime = DEBUG ? performance.now() : 0;
		const detectedGames = new Map<string, DetectedGame>();

		try {
			const processes = await getProcesses();

			for (const [pid, _path, args, _cwdPath] of processes) {
				const rawPath = _path.toLowerCase().replaceAll("\\", "/");
				const cwdPath = (_cwdPath || "").toLowerCase().replaceAll("\\", "/");

				if (!this.isValidProcess(pid, rawPath)) continue;

				// 1. Get the filename (e.g. "c:/games/game.exe" -> "game.exe")
				const filename = rawPath.split("/").pop();
				if (!filename) continue;

				// 2. Generate candidates for lookup
				const candidates = new Set<string>();

				// a. Exact filename: "game.exe"
				candidates.add(filename);

				// b. No extension: "game"
				const noExt = filename.replace(".exe", "");
				candidates.add(noExt);

				// c. Strip bitness: "game_64.exe" -> "game.exe"
				const noBitness = this.stripBitness(filename);
				candidates.add(noBitness);
				candidates.add(this.stripBitness(noExt)); // "game_64" -> "game"

				// 3. Check candidates against the map
				for (const candidate of candidates) {
					const matches = this.detectionMap.get(candidate);
					if (!matches) continue;

					for (const game of matches) {
						if (this.checkGameMatch(game, candidate, filename, rawPath, cwdPath, args)) {
							// Found a match
							detectedGames.set(game.i, {
								id: game.i,
								name: game.n,
								pid,
								timestamp: this.timestamps[game.i] || Date.now()
							});
						}
					}
				}
			}

			this.handleScanResults(Array.from(detectedGames.values()));

			if (DEBUG) {
				const timeTaken = (performance.now() - startTime).toFixed(2);
				log(`scanned ${processes.length} processes in ${timeTaken}ms`);
			}
		} catch (error) {
			log("Scan error:", error);
		} finally {
			this.isScanning = false;
		}
	}

	// Logic to verify if a candidate game actually matches the process based on path inclusion, arguments, or strict matching.
	private checkGameMatch(
		game: DetectableGame,
		candidateKey: string, // The key we used to find the game (e.g. "game")
		filename: string,     // The actual filename (e.g. "game_x64.exe")
		fullPath: string,     // Full path to executable
		cwdPath: string,      // Current working directory of process
		args: string[]        // Process arguments
	): boolean {
		if (!game.e) return false;

		return game.e.some((exec) => {
			// Names are already normalized (lowercased) in the downloader step.
			const dbExecName = exec.n;

			// --- Filter 1: Arguments ---
			// If DB requires args, and process args don't contain them, fail.
			if (exec.a) {
				const joinedArgs = args.join(" ").toLowerCase();
				if (!joinedArgs.includes(exec.a.toLowerCase())) return false;
			}

			// --- Filter 2: Strict Matching ('>' in DB, 's:1' in transformed) ---
			if (exec.s === 1) {
				// Strict means the filename must match exactly what's in the DB.
				return dbExecName === filename;
			}

			// --- Filter 3: Loose Matching ---

			// a. Exact filename match
			if (dbExecName === filename) return true;

			// b. Exe-less match
			if (dbExecName === filename.replace(".exe", "")) return true;

			// c. DB name + .exe match
			if (dbExecName === `${filename}.exe`) return true;

			// d. Path inclusion
			// This handles cases where the DB entry is "bin/game" but we detected "game".
			const combinedPath = `${cwdPath}/${fullPath}`;
			if (combinedPath.includes(`/${dbExecName}`)) return true;

			// e. Bitness stripped match
			if (dbExecName === candidateKey) return true;

			return false;
		});
	}

	handleScanResults(games: DetectedGame[]): void {
		const activeIds = new Set<string>();

		for (const { id, name, pid, timestamp } of games) {
			this.names[id] = name;
			this.pids[id] = pid;
			activeIds.add(id);

			if (!this.timestamps[id]) {
				log("detected game!", name);
				this.timestamps[id] = timestamp;
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
		const currentIds = Object.keys(this.timestamps);

		for (const id of currentIds) {
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