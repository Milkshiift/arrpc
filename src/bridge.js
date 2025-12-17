import { Logger } from "./logger.js";
import { WebSocketServer } from "ws";

const log = new Logger("bridge", "cyan").log;

const lastMsg = new Map();
let wss = null;

export const send = (msg) => {
	// If activity is null, the application has stopped/disconnected.
	// Remove from cache to prevent leaks and reconnecting clients seeing dead status.
	if (msg.activity === null) {
		lastMsg.delete(msg.socketId);
	} else {
		lastMsg.set(msg.socketId, msg);
	}

	if (wss) {
		const payload = JSON.stringify(msg);
		wss.clients.forEach((x) => {
			if (x.readyState === 1) x.send(payload);
		});
	}
};

export const init = () => {
	let port = 1337;
	if (process.env.ARRPC_BRIDGE_PORT) {
		const parsed = parseInt(process.env.ARRPC_BRIDGE_PORT, 10);
		if (!Number.isNaN(parsed)) port = parsed;
	}

	wss = new WebSocketServer({ port });

	wss.on("error", (error) => {
		if (error.code === "EADDRINUSE") {
			throw new Error(
				`arRPC tried to use bridge port ${port}, but it is already in use.`,
			);
		} else {
			throw error;
		}
	});

	wss.on("connection", (socket) => {
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
