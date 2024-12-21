import * as zlib from 'node:zlib';
import {data} from './detectable.js';
import base122 from '../base122.js';

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

export const readCompressedJson = async () => {
    try {
        const decoded = base122.decode(data);
        return JSON.parse(zlib.brotliDecompressSync(decoded).toString());
    } catch (error) {
        console.error("Failed to read compressed JSON", error);
        return {};
    }
};

// ~74% compression ratio generally
export const compressJson = (obj) => {
    try {
        const compressed = transformObject(obj);
        return zlib.brotliCompressSync(JSON.stringify(compressed), {
            params: {
                [zlib.constants.BROTLI_PARAM_QUALITY]: 11,
            },
        });
    } catch (error) {
        console.error("Failed to write compressed JSON", error);
        return undefined;
    }
}