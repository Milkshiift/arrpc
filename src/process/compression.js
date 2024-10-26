import {Packr} from 'msgpackr';
import * as zlib from "node:zlib";
import {data} from "./detectable.js";
import base122 from "../base122.js";

const keyMap = {
    'executables': 'e',
    'is_launcher': 'l',
    'name': 'n',
    'os': 'o',
    'id': 'i',
    'hook': 'h'
};

const valueMap = {
    'win32': 1,
    'darwin': 2,
};

function compressObject(obj) {
    if (!obj || typeof obj !== 'object') return obj;

    if (Array.isArray(obj)) return obj.map(item => compressObject(item));

    return Object.keys(obj).reduce((acc, key) => {
        const value = obj[key];
        const newKey = keyMap[key] || key;
        let newValue;

        if (Array.isArray(value)) {
            newValue = value.map(v => compressObject(v));
        } else if (typeof value === 'object' && value !== null) {
            newValue = compressObject(value);
        } else {
            newValue = valueMap[value] || value;
        }

        acc[newKey] = newValue;
        return acc;
    }, {});
}

function decompressObject(obj) {
    if (!obj || typeof obj !== 'object') return obj;

    if (Array.isArray(obj)) return obj.map(item => decompressObject(item));

    return Object.keys(obj).reduce((acc, key) => {
        const value = obj[key];
        const newKey = Object.keys(keyMap).find(k => keyMap[k] === key) || key;
        let newValue;

        if (Array.isArray(value)) {
            newValue = value.map(v => decompressObject(v));
        } else if (typeof value === 'object' && value !== null) {
            newValue = decompressObject(value);
        } else {
            newValue = Object.keys(valueMap).find(v => valueMap[v] === value) || value;
        }

        acc[newKey] = newValue;
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
        return decompressObject(decompressed);
    } catch (error) {
        console.log("Failed to read compressed JSON", error);
        return {};
    }
};

// ~85% compression ratio generally
export const compressJson = (obj) => {
    try {
        const compressed = encoder.pack(compressObject(obj));
        return zlib.brotliCompressSync(compressed, {
            params: {
                [zlib.constants.BROTLI_PARAM_QUALITY]: 11
            }
        });
    } catch (error) {
        console.log("Failed to write compressed JSON", error);
        return {};
    }
}