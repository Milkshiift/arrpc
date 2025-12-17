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

interface GameData {
	executables?: {
		name?: string;
		os?: string;
		arguments?: string;
		[key: string]: unknown;
	}[];
	[key: string]: unknown;
}

interface TransformedGame {
	e?: {
		n: string[];
		a?: string;
	};
	[key: string]: unknown;
}

export function transformObject(all: GameData[]): TransformedGame[] {
	return all.reduce((acc: TransformedGame[], game) => {
		const newGame: TransformedGame = {};
		for (const key in game) {
			if (FILTERED_KEYS.has(key)) continue;
			const newKey = KEY_MAP[key] || key;
			newGame[newKey] = game[key];
		}

		if (newGame.e && Array.isArray(game.executables)) {
			if (game.executables.length === 0) return acc;

			const execs: { n: string[]; a?: string } = {
				n: game.executables
					.filter((item) => item.os !== "darwin")
					.map((item) => item.name)
					.filter((name): name is string => !!name),
			};

			const arg = game.executables[0]?.arguments;
			if (arg) execs.a = arg;
			newGame.e = execs;
		}

		acc.push(newGame);
		return acc;
	}, []);
}

export async function getDetectableDB(path: string): Promise<TransformedGame[]> {
	let fileDate = "";
	try {
		fileDate = (await stat(path)).mtime.toUTCString();
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

		if (!res.ok) throw new Error(`Fetch failed: ${res.statusText}`);

		const jsonData = (await res.json()) as GameData[];
		const transformed = transformObject(jsonData);
		await writeFile(path, JSON.stringify(transformed));

		log("Updated detectable DB");
		return transformed;
	} catch (e: any) {
		log("Failed to update detectable DB, trying local.", e.message);
		try {
			const data = await readFile(path, "utf8");
			return JSON.parse(data);
		} catch {
			return [];
		}
	}
}