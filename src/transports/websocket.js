import { Logger } from "../logger.js";
const log = new Logger("websocket", "magentaBright").log;

import { WebSocketServer } from "ws";
import { createServer } from "node:http";
import { parse } from "node:querystring";

const portRange = [6463, 6472]; // ports available/possible: 6463-6472

export default class WSServer {
	constructor(handlers) {
		this.handlers = handlers;
		this.http = null;
		this.wss = null;
		this.onConnection = this.onConnection.bind(this);
		this.onMessage = this.onMessage.bind(this);
	}

	async start() {
		let port = portRange[0];

		while (port <= portRange[1]) {
			if (process.env.ARRPC_DEBUG) log("trying port", port);

			try {
				await new Promise((resolve, reject) => {
					const http = createServer();

					const wss = new WebSocketServer({ server: http });
					wss.on("connection", this.onConnection);

					http.on("error", (e) => {
						wss.removeAllListeners();
						reject(e);
					});

					http.listen(port, "127.0.0.1", () => {
						log("listening on", port);
						this.http = http;
						this.wss = wss;
						resolve();
					});
				});
				return;
			} catch (e) {
				if (e.code === "EADDRINUSE") {
					port++;
				} else {
					throw e;
				}
			}
		}

		throw new Error("No available ports in range 6463-6472");
	}

	onConnection(socket, req) {
		const params = parse(req.url.split("?")[1]);
		const ver = parseInt(params.v ?? 1, 10);
		const encoding = params.encoding ?? "json";
		const clientId = params.client_id ?? "";
		const origin = req.headers.origin ?? "";

		if (process.env.ARRPC_DEBUG) log(`new connection! origin:`, origin);

		if (encoding !== "json") {
			log("unsupported encoding requested", encoding);
			socket.close();
			return;
		}

		if (ver !== 1) {
			log("unsupported version requested", ver);
			socket.close();
			return;
		}

		socket.clientId = clientId;
		socket.encoding = encoding;

		socket.on("error", (e) => log("socket error", e));
		socket.on("close", (e, r) => {
			log("socket closed", e, r);
			this.handlers.close(socket);
		});

		socket.on("message", (msg) => {
			try {
				this.onMessage(socket, JSON.parse(msg));
			} catch (e) {
				log("malformed message", e);
			}
		});

		socket._send = socket.send;
		socket.send = (msg) => {
			if (process.env.ARRPC_DEBUG) log("sending", msg);
			if (socket.readyState === 1) socket._send(JSON.stringify(msg));
		};

		this.handlers.connection(socket);
	}

	onMessage(socket, msg) {
		if (process.env.ARRPC_DEBUG) log("message", msg);
		this.handlers.message(socket, msg);
	}
}
