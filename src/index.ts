#!/usr/bin/env node

import { Logger } from "./logger.ts";
const log = new Logger().log;

log("arRPC v3.5.0");

import * as Bridge from "./bridge.ts";
import Server from "./server.ts";

try {
	Bridge.init();
} catch (e) {
	log("Bridge failed to start", e);
}

const server = new Server("./detectable.json");

server.on("activity", (data: any) => Bridge.send(data));

await server.start();