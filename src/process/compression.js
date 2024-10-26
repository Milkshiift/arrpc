/*
  Some insane compression magic (95% compression!)
*/

import {readFile} from 'fs/promises';
import {dirname, join} from 'path';
import {fileURLToPath} from 'url';
import {Packr} from 'msgpackr';
import * as zlib from "node:zlib";

const __dirname = dirname(fileURLToPath(import.meta.url));

const path = join(__dirname, 'detectable.json');
const compressedPath = path + '.mpk.br';

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

        if (typeof value === 'string') {
            // Dynamic substring mapping
            newValue = dictionaryEncode(value);
        } else if (Array.isArray(value)) {
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

        if (typeof value === 'string') {
            newValue = dictionaryDecode(value);
        } else if (Array.isArray(value)) {
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

// Dynamic substring encoding
const substringDict = {};
function dictionaryEncode(str) {
    const keys = Object.keys(substringDict);
    const match = keys.find(sub => str.includes(sub));

    if (match) return str.replace(new RegExp(match, 'g'), substringDict[match]);

    if (str.length > 5) { // Only map long substrings to shorten storage
        const token = `_@${keys.length}`;
        substringDict[str] = token;
        return token;
    }
    return str;
}

function dictionaryDecode(str) {
    const entries = Object.entries(substringDict);
    const match = entries.find(([key, token]) => str.includes(token));
    return match ? str.replace(new RegExp(match[1], 'g'), match[0]) : str;
}

// Configure Packr for maximum compression
const encoder = new Packr({
    structuredClone: false,
    useRecords: true,
    variableMapSize: false,
    useFloat32: 2,
});

export const readCompressedJson = async (filepath = compressedPath) => {
    try {
        const compressed = await readFile(filepath);
        const decompressed = encoder.unpack(zlib.brotliDecompressSync(compressed));
        return decompressObject(decompressed);
    } catch (error) {
        console.log("Failed to read compressed JSON", error);
        return {};
    }
};

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