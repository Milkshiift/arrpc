import { Logger } from "./logger.ts";
import { WebSocketServer, type WebSocket } from "ws";
import type { BridgeMessage } from "./types.ts";

const log = new Logger("bridge", "cyan").log;

const lastMsg = new Map<string, BridgeMessage>();
let wss: WebSocketServer | null = null;

export const send = (msg: BridgeMessage): void => {
	// If activity is null, the application has stopped/disconnected.
	if (msg.activity === null) {
		lastMsg.delete(msg.socketId);
	} else {
		lastMsg.set(msg.socketId, msg);
	}

	if (wss) {
		const payload = JSON.stringify(msg);
		for (const client of wss.clients) {
			if (client.readyState === 1) {
				client.send(payload);
			}
		}
	}
};

export const init = (): void => {
	let port = 1337;
	const envPort = process.env.ARRPC_BRIDGE_PORT;
	if (envPort) {
		const parsed = parseInt(envPort, 10);
		if (!Number.isNaN(parsed)) port = parsed;
	}

	wss = new WebSocketServer({ port });

	wss.on("error", (error: Error & { code?: string }) => {
		if (error.code === "EADDRINUSE") {
			throw new Error(
				`arRPC tried to use bridge port ${port}, but it is already in use.`,
			);
		} else {
			throw error;
		}
	});

	wss.on("connection", (socket: WebSocket) => {
		log("web connected");

		for (const msg of lastMsg.values()) {
			if (msg.activity != null) socket.send(JSON.stringify(msg));
		}

		socket.on("close", () => {
			log("web disconnected");
		});
	});

	wss.on("listening", () => log("listening on", port));
};