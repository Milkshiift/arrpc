import { Packr } from 'msgpackr';
import * as zlib from 'node:zlib';
import { data } from './detectable.js';
import base122 from '../base122.js';

const KEY_MAP = new Map([
    ['executables', 'e'],
    ['name', 'n'],
    ['os', 'o'],
    ['id', 'i'],
]);

const OS_MAP = new Map([
    ['win32', 1],
    ['darwin', 2],
]);

/**
 * Recursively transform an object by:
 * 1. Mapping keys based on the provided key map
 * 2. Filtering out specific keys
 * 3. Handling nested objects and arrays
 */
function transformObject(obj, reverse = false) {
    // Handle non-object types
    if (!obj || typeof obj !== 'object') return obj;

    // Create key and value transformation functions
    const transformKey = key => {
        // Skip 'hook' and 'is_launcher' keys entirely
        if (key === 'hook' || key === 'is_launcher') return null;

        return reverse
            ? [...KEY_MAP.entries()].find(([_, v]) => v === key)?.[0]
            : KEY_MAP.get(key) || key;
    };

    const transformValue = value => {
        return reverse
            ? [...OS_MAP.entries()].find(([_, v]) => v === value)?.[0]
            : OS_MAP.get(value) || value;
    };

    // Handle arrays by transforming each item
    if (Array.isArray(obj)) {
        return obj
            .map(item => transformObject(item, reverse))
            // For executables, filter out those with is_launcher: true
            .filter(item =>
                !reverse ||
                !item.is_launcher
            );
    }

    // Transform object keys and values
    return Object.keys(obj).reduce((acc, key) => {
        const newKey = transformKey(key);

        // Skip null keys (hook, is_launcher)
        if (newKey === null) return acc;

        const value = obj[key];
        const newValue = transformObject(value, reverse);

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
        return transformObject(decompressed, true);
    } catch (error) {
        console.error("Failed to read compressed JSON", error);
        return {};
    }
};

// ~85% compression ratio generally
export const compressJson = (obj) => {
    try {
        const compressed = encoder.pack(transformObject(obj));
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