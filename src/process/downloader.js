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
    const transformKey = (key) => {
        if (FILTERED_KEYS.includes(key)) return null;
        return KEY_MAP[key] || key;
    };

    for (const key in all) {
        const game = all[key];
        for (const key in game) {
            const newKey = transformKey(key);
            if (newKey !== null) game[newKey] = game[key];
            delete game[key];

            const prop = game[newKey];
            if (Array.isArray(prop)) {
                const execs = {
                    n: prop.filter(item => item.os !== 'darwin').map(item => item.name)
                };
                const arg = prop[0].arguments;
                if (arg) execs.a = arg;
                game[newKey] = execs;
            }
        }
    }

    return all;
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

    return jsonData;
}