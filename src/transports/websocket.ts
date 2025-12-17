import { Logger } from "../logger.ts";
const log = new Logger("websocket", "magentaBright").log;

import { WebSocketServer, type WebSocket } from "ws";
import { createServer, type Server, type IncomingMessage } from "node:http";
import { parse } from "node:querystring";

const portRange = [6463, 6472]; // ports available/possible: 6463-6472

interface ExtendedWebSocket extends WebSocket {
	clientId?: string;
	encoding?: string;
	_send?: (msg: string) => void;
}

interface WSHandlers {
	connection: (socket: ExtendedWebSocket) => void;
	message: (socket: ExtendedWebSocket, msg: unknown) => void;
	close: (socket: ExtendedWebSocket) => void;
}

export default class WSServer {
	handlers: WSHandlers;
	http: Server | null;
	wss: WebSocketServer | null;

	constructor(handlers: WSHandlers) {
		this.handlers = handlers;
		this.http = null;
		this.wss = null;
		this.onConnection = this.onConnection.bind(this);
		this.onMessage = this.onMessage.bind(this);
	}

	async start(): Promise<void> {
		let port = portRange[0];

		while (port !== undefined && port <= (portRange[1] ?? 0)) {
			if (process.env["ARRPC_DEBUG"]) log("trying port", port);

			try {
				await new Promise<void>((resolve, reject) => {
					const http = createServer();

					const wss = new WebSocketServer({ server: http });
					wss.on("connection", this.onConnection);

					http.on("error", (e: Error & { code?: string }) => {
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
			} catch (e: any) {
				if (e.code === "EADDRINUSE") {
					port++;
				} else {
					throw e;
				}
			}
		}

		throw new Error("No available ports in range 6463-6472");
	}

	onConnection(socket: ExtendedWebSocket, req: IncomingMessage): void {
		const params = parse(req.url?.split("?")[1] || "");
		const ver = parseInt((params["v"] as string) ?? "1", 10);
		const encoding = (params["encoding"] as string) ?? "json";
		const clientId = (params["client_id"] as string) ?? "";
		const origin = req.headers.origin ?? "";

		if (process.env["ARRPC_DEBUG"]) log(`new connection! origin:`, origin);

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
				this.onMessage(socket, JSON.parse(msg.toString()));
			} catch (e) {
				log("malformed message", e);
			}
		});

		// @ts-ignore - assigning custom property
		socket._send = socket.send;
		socket.send = (msg: unknown) => {
			if (process.env["ARRPC_DEBUG"]) log("sending", msg);
			if (socket.readyState === 1 && socket._send) {
				socket._send(JSON.stringify(msg));
			}
		};

		this.handlers.connection(socket);
	}

	onMessage(socket: ExtendedWebSocket, msg: unknown): void {
		if (process.env["ARRPC_DEBUG"]) log("message", msg);
		this.handlers.message(socket, msg);
	}
}