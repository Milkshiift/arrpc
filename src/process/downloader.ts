import { readFile, writeFile, stat } from "node:fs/promises";
import { Logger } from "../logger.ts";

const log = new Logger("downloader", "green").log;

interface RawExecutable {
	name: string;
	os: string;
	arguments?: string;
	[key: string]: unknown;
}

interface RawGameData {
	id: string;
	name: string;
	executables?: RawExecutable[];
	[key: string]: unknown;
}

export interface DetectableExecutable {
	n: string;
	a?: string;
	s?: 1;
}

export interface DetectableGame {
	i: string;
	n: string;
	e?: DetectableExecutable[];
}

export function transformObject(all: RawGameData[]): DetectableGame[] {
	const results: DetectableGame[] = [];
	const currentPlatform = process.platform;

	for (const game of all) {
		if (!game.id || !game.name) continue;

		const minifiedGame: DetectableGame = {
			i: game.id,
			n: game.name,
		};

		if (Array.isArray(game.executables) && game.executables.length > 0) {
			const processedExecs: DetectableExecutable[] = [];

			for (const exec of game.executables) {
				if (!exec.name) continue;

				if (exec.os) {
					const isNative = exec.os === currentPlatform;
					const isProton = currentPlatform === "linux" && exec.os === "win32";
					if (!isNative && !isProton) continue;
				}

				let name = exec.name;
				let isStrict: 1 | undefined;

				if (name.startsWith(">")) {
					isStrict = 1;
					name = name.slice(1);
				}

				name = name.toLowerCase();

				const minExec: DetectableExecutable = { n: name };

				if (isStrict) minExec.s = 1;
				if (exec.arguments) minExec.a = exec.arguments;

				processedExecs.push(minExec);
			}

			if (processedExecs.length > 0) {
				minifiedGame.e = processedExecs;
				results.push(minifiedGame);
			}
		}
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
		log("Checking for detectable DB updates...");
		const res = await fetch(
			"https://discord.com/api/v10/applications/detectable",
			{
				headers: {
					"If-Modified-Since": fileDate,
				},
			},
		);

		if (res.status === 304) {
			log("Detectable DB is up to date");
			return JSON.parse(await readFile(path, "utf8"));
		}

		if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);

		const jsonData = (await res.json()) as RawGameData[];
		const transformed = transformObject(jsonData);

		await writeFile(path, JSON.stringify(transformed));
		log(`Updated DB: ${transformed.length}.`);

		return transformed;
	} catch (e) {
		log("Update failed, using local.", e);
		try {
			return JSON.parse(await readFile(path, "utf8"));
		} catch {
			return [];
		}
	}
}
