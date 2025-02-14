import {readFile, writeFile} from "node:fs/promises";

const bundleResult = await Bun.build({
    minify: true,
    sourcemap: "none",
    format: "esm",
    target: "node",
    entrypoints: ["./src/process/scannerWorker.js"],
    outdir: "build",
    packages: "bundle",
});
if (bundleResult.logs.length) console.log(bundleResult.logs);

let workerCode = await readFile("./build/scannerWorker.js", "utf8");
workerCode = workerCode.replace(/\\/g, '\\\\');
workerCode = workerCode.replace(/\$\{/g, '\\${');
workerCode = workerCode.replace(/`/g, '\\`');
const newContent = `export const workerCode = \`${workerCode}\`;`;
await writeFile("./src/process/scannerWorkerString.js", newContent, 'utf8');