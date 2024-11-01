import { Packr } from 'msgpackr';
import * as zlib from 'node:zlib';
import { data } from './detectable.js';
import base122 from '../base122.js';

const keyMap = new Map([
    ['executables', 'e'],
    ['is_launcher', 'l'],
    ['name', 'n'],
    ['os', 'o'],
    ['id', 'i'],
    ['hook', 'h'],
]);

const valueMap = new Map([
    ['win32', 1],
    ['darwin', 2],
]);

function transformObject(obj, map, reverse = false) {
    if (!obj || typeof obj !== 'object') return obj;

    const transformKey = key => (reverse ? [...map.entries()].find(([_, v]) => v === key)?.[0] : map.get(key) || key);
    const transformValue = value => (reverse ? [...valueMap.entries()].find(([_, v]) => v === value)?.[0] : valueMap.get(value) || value);

    if (Array.isArray(obj)) return obj.map(item => transformObject(item, map, reverse));

    return Object.keys(obj).reduce((acc, key) => {
        const value = obj[key];
        const newKey = transformKey(key);
        const newValue = transformObject(value, map, reverse);

        acc[newKey] = transformValue(newValue);
        return acc;
    }, {});
}

// Configure Packr for maximum compression
const encoder = new Packr({
    structuredClone: false,
    useRecords: true,
    variableMapSize: false,
    useFloat32: 2,
});

export const readCompressedJson = async () => {
    try {
        const decoded = base122.decode(data);
        const decompressed = encoder.unpack(zlib.brotliDecompressSync(decoded));
        return transformObject(decompressed, keyMap, true);
    } catch (error) {
        console.error("Failed to read compressed JSON", error);
        return {};
    }
};

// ~85% compression ratio generally
export const compressJson = (obj) => {
    try {
        const compressed = encoder.pack(transformObject(obj, keyMap));
        return zlib.brotliCompressSync(compressed, {
            params: {
                [zlib.constants.BROTLI_PARAM_QUALITY]: 11,
            },
        });
    } catch (error) {
        console.error("Failed to write compressed JSON", error);
        return {};
    }
}