import { readFile, writeFile, stat } from "node:fs/promises";
import { Logger } from "../logger.ts";

const log = new Logger("downloader", "green").log;

const KEY_MAP: Record<string, string> = {
	executables: "e",
	arguments: "a",
	name: "n",
	id: "i",
};

const FILTERED_KEYS = new Set([
	"hook",
	"overlay",
	"overlay_compatibility_hook",
	"aliases",
	"is_launcher",
	"os",
]);

interface RawGameData {
	executables?: {
		name?: string;
		os?: string;
		arguments?: string;
		[key: string]: unknown;
	}[];
	[key: string]: unknown;
}

export interface DetectableGame {
	e?: {
		n: string[];
		a?: string;
	};
	i?: string;
	n?: string;
	[key: string]: unknown;
}

export function transformObject(all: RawGameData[]): DetectableGame[] {
	const results: DetectableGame[] = [];

	for (const game of all) {
		const newGame: DetectableGame = {};

		for (const key in game) {
			if (FILTERED_KEYS.has(key)) continue;
			const newKey = KEY_MAP[key] || key;
			newGame[newKey] = game[key];
		}

		if (Array.isArray(game.executables) && game.executables.length > 0) {
			const names = game.executables
				.filter((item) => item.os !== "darwin" && item.name)
				.map((item) => item.name as string);

			if (names.length > 0) {
				const execs: { n: string[]; a?: string } = { n: names };
				const arg = game.executables[0]?.arguments;
				if (arg) execs.a = arg;
				newGame.e = execs;
			}
		} else if (game.executables && game.executables.length === 0) {
			continue;
		}

		results.push(newGame);
	}
	return results;
}

export async function getDetectableDB(path: string): Promise<DetectableGame[]> {
	let fileDate = "";
	try {
		const stats = await stat(path);
		fileDate = stats.mtime.toUTCString();
	} catch {}

	try {
		const res = await fetch(
			"https://discord.com/api/v10/applications/detectable",
			{
				headers: {
					"User-Agent":
						"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.3",
					"If-Modified-Since": fileDate,
				},
			},
		);

		if (res.status === 304) {
			log("Detectable DB is up to date");
			const data = await readFile(path, "utf8");
			return JSON.parse(data);
		}

		if (!res.ok) throw new Error(`Fetch failed: ${res.statusText} (${res.status})`);

		const jsonData = (await res.json()) as RawGameData[];
		const transformed = transformObject(jsonData);

		await writeFile(path, JSON.stringify(transformed));
		log("Updated detectable DB");

		return transformed;
	} catch (e: unknown) {
		const msg = e instanceof Error ? e.message : String(e);
		log("Failed to update detectable DB, trying local.", msg);
		try {
			const data = await readFile(path, "utf8");
			return JSON.parse(data);
		} catch {
			return [];
		}
	}
}