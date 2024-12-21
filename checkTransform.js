import {get} from "https";
import {createWriteStream} from "fs";
import {dirname, join} from "path";
import {fileURLToPath} from "url";
import {transformObject} from "./src/process/compression.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

let jsonData = '';

get('https://discord.com/api/v9/applications/detectable', res => {
    res.on('data', chunk => {
        jsonData += chunk;
    });

    res.on('end', () => {
        const updated = transformObject(JSON.parse(jsonData));
        const file = createWriteStream(join(__dirname, "transformed.json"));
        file.write(JSON.stringify(updated, null, 2));
        file.end();

        file.on('finish', () => {
            file.close();
        });
    });
});