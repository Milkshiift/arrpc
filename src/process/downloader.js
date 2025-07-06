import {readFile, writeFile, stat} from 'fs/promises';
import {Logger} from "../logger.js";
const log = new Logger("downloader", "green").log;

const KEY_MAP = {
    executables: 'e',
    arguments: 'a',
    name: 'n',
    id: 'i',
};

const FILTERED_KEYS = ['hook', 'overlay', 'overlay_compatibility_hook', 'aliases', 'is_launcher', 'os'];

export function transformObject(all) {
    const KEY_MAP = {
        executables: 'e',
        arguments: 'a',
        name: 'n',
        id: 'i',
    };
    const FILTERED_KEYS = ['hook', 'overlay', 'overlay_compatibility_hook', 'aliases', 'is_launcher', 'os'];

    return all.reduce((acc, game) => {
        const newGame = {};
        for (const key in game) {
            if (FILTERED_KEYS.includes(key)) continue;
            const newKey = KEY_MAP[key] || key;
            newGame[newKey] = game[key];
        }

        if (newGame.e) {
            if (newGame.e.length === 0) return acc;
            const execs = {
                n: newGame.e.filter(item => item.os !== 'darwin').map(item => item.name)
            };
            const arg = newGame.e[0]?.arguments;
            if (arg) execs.a = arg;
            newGame.e = execs;
        }

        acc.push(newGame);
        return acc;
    }, []);
}

export async function getDetectableDB(path) {
    let fileDate;
    try { fileDate = (await stat(path)).mtime.toUTCString() } catch { fileDate = "" }
    const res = await fetch('https://discord.com/api/v10/applications/detectable', {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.3',
            'If-Modified-Since': fileDate
        }
    });

    if (res.status === 304) {
        log("Detectable DB is up to date");
        const data = await readFile(path, 'utf8');
        return JSON.parse(data);
    }

    const jsonData = await res.json();
    const transformed = transformObject(jsonData);
    await writeFile(path, JSON.stringify(transformed));

    log('Updated detectable DB');

    return transformed;
}