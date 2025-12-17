import { Logger } from "./logger.ts";
import { WebSocketServer, type WebSocket } from "ws";

const log = new Logger("bridge", "cyan").log;

interface Message {
	socketId: string;
	activity: unknown | null;
	[key: string]: unknown;
}

const lastMsg = new Map<string, Message>();
let wss: WebSocketServer | null = null;

export const send = (msg: Message): void => {
	// If activity is null, the application has stopped/disconnected.
	// Remove from cache to prevent leaks and reconnecting clients seeing dead status.
	if (msg.activity === null) {
		lastMsg.delete(msg.socketId);
	} else {
		lastMsg.set(msg.socketId, msg);
	}

	if (wss) {
		const payload = JSON.stringify(msg);
		wss.clients.forEach((x: WebSocket) => {
			if (x.readyState === 1) x.send(payload);
		});
	}
};

export const init = (): void => {
	let port = 1337;
	if (process.env["ARRPC_BRIDGE_PORT"]) {
		const parsed = parseInt(process.env["ARRPC_BRIDGE_PORT"], 10);
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

		for (const [_, msg] of lastMsg) {
			if (msg.activity != null) socket.send(JSON.stringify(msg));
		}

		socket.on("close", () => {
			log("web disconnected");
		});
	});

	wss.on("listening", () => log("listening on", port));
};