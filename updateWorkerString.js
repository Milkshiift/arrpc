import {readFile, writeFile} from "node:fs/promises";

let workerCode = await readFile("./src/process/scannerWorker.js", "utf8");
workerCode = workerCode.replace(/\\/g, '\\\\');
workerCode = workerCode.replace(/\$\{/g, '\\${');
workerCode = workerCode.replace(/`/g, '\\`');
const newContent = `export const workerCode = \`${workerCode}\`;`;
await writeFile("./src/process/scannerWorkerString.js", newContent, 'utf8');