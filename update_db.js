import { createWriteStream } from 'fs';
import { get } from 'https';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import {compressJson, readCompressedJson} from "./src/process/compression.js";
import * as base122 from "./src/base122.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const compressedPath = join(__dirname, 'src', 'process', 'detectable.js');

const current = await readCompressedJson(compressedPath);

let jsonData = '';

get('https://discord.com/api/v9/applications/detectable', res => {
  res.on('data', chunk => {
    jsonData += chunk;
  });

  res.on('end', () => {
    const updated = JSON.parse(jsonData);
    const compressed = compressJson(updated, compressedPath);
    const base = base122.encode(compressed);
    const compressedFile = createWriteStream(compressedPath);
    compressedFile.write("export const data =\""+base+"\";");
    compressedFile.end();

    compressedFile.on('finish', () => {
      compressedFile.close();

      const originalSize = Buffer.from(JSON.stringify(updated)).length;
      const baseSize = Buffer.from(base).length;
      const finalSize = compressed.length;

      console.log('Updated detectable DB');
      console.log(`${current.length} -> ${updated.length} games (+${updated.length - current.length})`);
      console.log('Compression stats:');
      console.log(`Original JSON: ${originalSize} bytes`);
      console.log(`Compressed Brotli: ${finalSize} bytes (${((originalSize - finalSize) / originalSize * 100).toFixed(2)}% smaller)`);
      console.log(`Final Base122: ${baseSize} bytes`);
    });
  });
});