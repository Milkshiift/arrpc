import { Logger } from "../logger.ts";
import { getDetectableDB } from "./downloader.ts";
const log = new Logger("process", "red").log;

const DEBUG = process.argv.some((arg) => arg === "--debug");

let getProcesses: () => Promise<[number, string, string[], string | undefined][]>;

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
		throw new Error("Unsupported platform");
}

interface ProcessServerHandlers {
	message: (socket: { socketId: string }, msg: unknown) => void;
}

interface DetectableGame {
	e?: {
		n: string[];
		a?: string;
	};
	i?: string;
	n?: string;
	[key: string]: unknown;
}

interface DetectedGame {
	id: string;
	name: string;
	pid: number;
}

export default class ProcessServer {
	handlers: ProcessServerHandlers;
	timestamps: Record<string, number>;
	names: Record<string, string>;
	pids: Record<string, number>;
	detectablePath: string;
	DetectableDB: DetectableGame[] = [];
	detectionMap: Map<string, DetectableGame[]> = new Map();
	_generatePossiblePaths: {
		(path: string): string[];
		cache?: Map<string, string[]>;
	};

	constructor(handlers: ProcessServerHandlers, detectablePath: string) {
		if (!getProcesses) {
			throw new Error("Failed to load process scanner");
		}

		this.handlers = handlers;
		this.timestamps = {};
		this.names = {};
		this.pids = {};
		this.detectablePath = detectablePath;

		this._generatePossiblePaths = this.generatePossiblePathsImpl.bind(this);
		this._generatePossiblePaths.cache = new Map();

		void this.init();
	}

	async init(): Promise<void> {
		this.DetectableDB = await getDetectableDB(this.detectablePath);
		this.detectionMap = new Map();
		for (const element of this.DetectableDB) {
			if (element.e?.n) {
				for (const name of element.e.n) {
					const key = name[0] === ">" ? name.substring(1) : name;
					if (!this.detectionMap.has(key)) {
						this.detectionMap.set(key, []);
					}
					this.detectionMap.get(key)?.push(element);
				}
			}
		}
		
		this._generatePossiblePaths.cache = new Map();

		this.scan = this.scan.bind(this);
		await this.scan();
		setInterval(this.scan, 5000);

		log("started");
	}

	generatePossiblePathsImpl(path: string): string[] {
		if (!this._generatePossiblePaths.cache)
			this._generatePossiblePaths.cache = new Map();
		if (this._generatePossiblePaths.cache.has(path))
			return this._generatePossiblePaths.cache.get(path)!;

		const normalizedPath = path.toLowerCase();

		const splitPath = normalizedPath.replaceAll("\\", "/").split("/");
		if (/^[a-z]:$/.test(splitPath[0]!) || splitPath[0] === "") {
			splitPath.shift();
		}

		const variations: string[] = [];
		const modifiers = ["64", ".x64", "x64", "_64"];

		for (let i = 0; i < splitPath.length || i === 1; i++) {
			const basePath = splitPath.slice(-i).join("/");
			if (!basePath) continue;

			variations.push(basePath);

			for (const mod of modifiers) {
				if (basePath.includes(mod)) {
					variations.push(basePath.replace(mod, ""));
				}
			}
		}

		this._generatePossiblePaths.cache.set(path, variations);

		if (this._generatePossiblePaths.cache.size > 1000) {
			const iterator = this._generatePossiblePaths.cache.keys();
			const firstKey = iterator.next().value;
			if (firstKey) this._generatePossiblePaths.cache.delete(firstKey);
		}

		return variations;
	}

	_matchExecutable(
		executables: DetectableGame["e"],
		possiblePaths: string[],
		args: string[] | undefined,
		cwdPath: string | undefined,
	): boolean {
		if (!executables) return false;
		const argsMatch = !executables.a || args?.includes(executables.a);
		if (!argsMatch) return false;

		return executables.n.some((name) => {
			if (name[0] === ">") {
				return name.substring(1) === possiblePaths[0];
			}
			return possiblePaths.some(
				(path) =>
					name === path ||
					(cwdPath && `${cwdPath}/${path}`.includes(`/${name}`)),
			);
		});
	}

	async scan(): Promise<void> {
		const startTime = DEBUG ? performance.now() : undefined;
		let processCount = 0;

		try {
			const processes = await getProcesses();
			processCount = processes.length;
			const detectedGames = new Set<DetectedGame>();

			for (const [pid, path, args, _cwdPath = ""] of processes) {
				if (!path) continue;
				const possiblePaths = this._generatePossiblePaths(path);

				const potentialMatches = new Set<DetectableGame>();
				for (const possiblePath of possiblePaths) {
					if (this.detectionMap.has(possiblePath)) {
						this.detectionMap
							.get(possiblePath)
							?.forEach((element) => void potentialMatches.add(element));
					}
				}

				for (const element of potentialMatches) {
					try {
						const { e, i, n } = element;
						if (this._matchExecutable(e, possiblePaths, args, _cwdPath) && i && n) {
							detectedGames.add({ id: i, name: n, pid });
						}
					} catch (error) {
						log(
							"Error during processing:",
							error,
							"\nCaused by:",
							JSON.stringify(element),
						);
					}
				}
			}

			this.handleScanResults(Array.from(detectedGames));

			if (DEBUG && startTime !== undefined)
				log(
					`Scan completed in ${(performance.now() - startTime).toFixed(2)}ms, checked ${processCount} processes`,
				);
		} catch (error: any) {
			log("Worker error:", error.message);
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
				{
					socketId: id,
				},
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

		this._cleanupLostGames(activeIds);
	}

	_cleanupLostGames(activeIds: Set<string>): void {
		for (const id in this.timestamps) {
			if (!activeIds.has(id)) {
				log("lost game!", this.names[id]);
				delete this.timestamps[id];
				delete this.names[id];
				delete this.pids[id];

				this.handlers.message(
					{
						socketId: id,
					},
					{
						cmd: "SET_ACTIVITY",
						args: {
							activity: null,
							pid: this.pids[id],
						},
					},
				);
			}
		}
	}
}