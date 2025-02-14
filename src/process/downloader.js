import {readFile, writeFile, stat} from 'fs/promises';
import { transformObject } from "./compression.js";
import {Logger} from "../logger.js";
const log = new Logger("downloader", "green").log;

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