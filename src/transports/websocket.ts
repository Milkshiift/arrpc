import { Logger } from "../logger.ts";
import { type WebSocket, WebSocketServer } from "ws";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { parse } from "node:querystring";

const log = new Logger("websocket", "magentaBright").log;
const portRange = [6463, 6472];

interface SystemError extends Error {
	code?: string;
}

export interface RPCWebSocket extends WebSocket {
	clientId?: string;
	encoding?: string;
	sendPayload: (msg: unknown) => void;
}

interface WSHandlers {
	connection: (socket: RPCWebSocket) => void;
	message: (socket: RPCWebSocket, msg: unknown) => void;
	close: (socket: RPCWebSocket) => void;
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
			if (process.env.ARRPC_DEBUG) log("trying port", port);

			try {
				await new Promise<void>((resolve, reject) => {
					const http = createServer();

					const onError = (e: SystemError) => {
						http.removeListener("error", onError);
						reject(e);
					};

					http.on("error", onError);

					http.listen(port, "127.0.0.1", () => {
						http.removeListener("error", onError);

						log("listening on", port);
						this.http = http;

						const wss = new WebSocketServer({ server: http });

						wss.on("connection", (ws, req) =>
							this.onConnection(ws as RPCWebSocket, req),
						);

						wss.on("error", (e) => log("WSS error", e));

						this.wss = wss;
						resolve();
					});
				});
				return;
			} catch (e: unknown) {
				const sysError = e as SystemError;
				if (sysError.code === "EADDRINUSE") {
					port++;
				} else {
					throw e;
				}
			}
		}

		throw new Error("No available ports in range 6463-6472");
	}

	onConnection(socket: RPCWebSocket, req: IncomingMessage): void {
		const params = parse(req.url?.split("?")[1] || "");
		const ver = parseInt((params.v as string) ?? "1", 10);
		const encoding = (params.encoding as string) ?? "json";
		const clientId = (params.client_id as string) ?? "";
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
		socket.on("close", (code, reason) => {
			log("socket closed", code, reason);
			this.handlers.close(socket);
		});

		socket.on("message", (msg) => {
			try {
				this.onMessage(socket, JSON.parse(msg.toString()));
			} catch (e) {
				log("malformed message", e);
			}
		});

		socket.sendPayload = (msg: unknown) => {
			if (process.env.ARRPC_DEBUG) log("sending", msg);
			if (socket.readyState === 1) {
				socket.send(JSON.stringify(msg));
			}
		};

		this.handlers.connection(socket);
	}

	onMessage(socket: RPCWebSocket, msg: unknown): void {
		if (process.env.ARRPC_DEBUG) log("message", msg);
		this.handlers.message(socket, msg);
	}
}
