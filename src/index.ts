#!/usr/bin/env node
import { Logger } from "./logger.ts";
import * as Bridge from "./bridge.ts";
import Server from "./server.ts";
import type { BridgeMessage } from "./types.ts";

const log = new Logger().log;
log("arRPC v3.5.0");

try {
	Bridge.init();
} catch (e) {
	log("Bridge failed to start", e);
}

const server = new Server("./detectable.json");

server.on("activity", (data: BridgeMessage) => Bridge.send(data));

await server.start();