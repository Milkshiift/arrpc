import { Logger } from "../logger.ts";
import { join } from "node:path";
import { env, platform } from "node:process";
import { unlinkSync } from "node:fs";
import { createConnection, createServer, type Server, type Socket, } from "node:net";

const log = new Logger("ipc", "yellow").log;

const SOCKET_PATH =
	platform === "win32"
		? "\\\\.\\pipe\\discord-ipc"
		: join(
				env.XDG_RUNTIME_DIR || env.TMPDIR || env.TMP || env.TEMP || "/tmp",
				"discord-ipc",
			);

const Types = {
	HANDSHAKE: 0,
	FRAME: 1,
	CLOSE: 2,
	PING: 3,
	PONG: 4,
} as const;

type PacketType = (typeof Types)[keyof typeof Types];

const CloseCodes = {
	CLOSE_NORMAL: 1000,
	CLOSE_UNSUPPORTED: 1003,
	CLOSE_ABNORMAL: 1006,
};

const ErrorCodes = {
	INVALID_CLIENTID: 4000,
	INVALID_ORIGIN: 4001,
	RATELIMITED: 4002,
	TOKEN_REVOKED: 4003,
	INVALID_VERSION: 4004,
	INVALID_ENCODING: 4005,
};

export interface IPCSocket extends Socket {
	clientId?: string;
	send: (msg: unknown) => void;
	close: (code?: number, message?: string) => void;
}

const encode = (type: number, data: unknown): Buffer => {
	const stringData = JSON.stringify(data);
	const dataSize = Buffer.byteLength(stringData);
	const buf = Buffer.alloc(dataSize + 8);
	buf.writeInt32LE(type, 0);
	buf.writeInt32LE(dataSize, 4);
	buf.write(stringData, 8, dataSize);
	return buf;
};

const processSocketReadable = (socket: Socket): void => {
	while (true) {
		if (socket.readableLength < 8) return;

		const header = socket.read(8);
		if (!header) return;

		const type = header.readInt32LE(0);
		const dataSize = header.readInt32LE(4);

		if (socket.readableLength < dataSize) {
			socket.unshift(header);
			return;
		}

		const bodyBuffer = socket.read(dataSize);
		if (!bodyBuffer) {
			socket.unshift(header);
			return;
		}

		const isValidType = Object.values(Types).includes(type as PacketType);
		if (!isValidType) {
			log("Invalid IPC packet type", type);
			socket.destroy();
			return;
		}

		let data: object;
		try {
			data = JSON.parse(bodyBuffer.toString("utf8"));
		} catch (e) {
			log("Failed to parse IPC JSON", e);
			continue;
		}

		switch (type) {
			case Types.PING:
				socket.emit("ping", data);
				socket.write(encode(Types.PONG, data));
				break;
			case Types.PONG:
				socket.emit("pong", data);
				break;
			case Types.HANDSHAKE:
				socket.emit("handshake", data);
				break;
			case Types.FRAME:
				socket.emit("request", data);
				break;
			case Types.CLOSE:
				socket.end();
				socket.destroy();
				return;
		}
	}
};

const getAvailableSocket = async (): Promise<string> => {
	for (let i = 0; i < 10; i++) {
		const path = `${SOCKET_PATH}-${i}`;
		const connected = await new Promise<boolean>((resolve) => {
			const socket = createConnection(path);
			socket.on("connect", () => {
				socket.end();
				resolve(true);
			});
			socket.on("error", (err: Error & { code?: string }) => {
				if (err.code === "ECONNREFUSED" || err.code === "ENOENT") {
					if (platform !== "win32") {
						try {
							unlinkSync(path);
						} catch {}
					}
					resolve(false);
				} else {
					resolve(true);
				}
			});
		});

		if (!connected) return path;
	}
	throw new Error("ran out of tries to find socket");
};

export interface IPCServerHandlers {
	connection: (socket: IPCSocket) => void;
	message: (socket: IPCSocket, msg: unknown) => void;
	close: (socket: IPCSocket) => void;
}

export default class IPCServer {
	handlers: IPCServerHandlers;
	server: Server | null = null;

	constructor(handlers: IPCServerHandlers) {
		this.handlers = handlers;
		this.onConnection = this.onConnection.bind(this);
		this.onMessage = this.onMessage.bind(this);
	}

	async start(): Promise<void> {
		const socketPath = await getAvailableSocket();

		this.server = createServer(this.onConnection);

		return new Promise((resolve, reject) => {
			const onStartupError = (e: Error) => {
				log("server failed to start", e);
				reject(e);
			};

			this.server?.on("error", onStartupError);

			this.server?.listen(socketPath, () => {
				log("listening at", socketPath);

				this.server?.off("error", onStartupError);

				this.server?.on("error", (e) => log("server error", e));

				resolve();
			});
		});
	}

	onConnection(rawSocket: Socket): void {
		log("new connection!");
		const socket = rawSocket as IPCSocket;

		socket.on("readable", () => {
			try {
				processSocketReadable(socket);
			} catch (e: unknown) {
				const message = e instanceof Error ? e.message : String(e);
				log("error whilst reading", message);
				socket.end(
					encode(Types.CLOSE, {
						code: CloseCodes.CLOSE_UNSUPPORTED,
						message,
					}),
				);
				socket.destroy();
			}
		});

		let handshook = false;

		socket.once("handshake", (params: { v?: string; client_id?: string }) => {
			if (handshook) return;
			handshook = true;

			if (process.env.ARRPC_DEBUG) log("handshake:", params);

			const ver = parseInt(params.v ?? "1", 10);
			const clientId = params.client_id ?? "";

			socket.close = (code = CloseCodes.CLOSE_NORMAL, message = "") => {
				socket.end(encode(Types.CLOSE, { code, message }));
				socket.destroy();
			};

			if (ver !== 1) {
				log("unsupported version requested", ver);
				socket.close(ErrorCodes.INVALID_VERSION);
				return;
			}

			if (clientId === "") {
				log("client id required");
				socket.close(ErrorCodes.INVALID_CLIENTID);
				return;
			}

			socket.on("error", (e) => log("socket error", e));
			socket.on("close", (hadError) => {
				log("socket closed", hadError);
				this.handlers.close(socket);
			});

			socket.on("request", (data) => this.onMessage(socket, data));

			socket.send = (msg: unknown) => {
				if (process.env.ARRPC_DEBUG) log("sending", msg);
				if (socket.writable) socket.write(encode(Types.FRAME, msg));
			};

			socket.clientId = clientId;
			this.handlers.connection(socket);
		});
	}

	onMessage(socket: IPCSocket, msg: unknown): void {
		if (process.env.ARRPC_DEBUG) log("message", msg);
		this.handlers.message(socket, msg);
	}
}
