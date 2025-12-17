import { Logger } from "../logger.js";
const log = new Logger("ipc", "yellow").log;

import { join } from "node:path";
import { platform, env } from "node:process";
import { unlinkSync } from "node:fs";
import { createServer, createConnection } from "node:net";

const SOCKET_PATH =
	platform === "win32"
		? "\\\\?\\pipe\\discord-ipc"
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
};

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

const encode = (type, data) => {
	data = JSON.stringify(data);
	const dataSize = Buffer.byteLength(data);
	const buf = Buffer.alloc(dataSize + 8);
	buf.writeInt32LE(type, 0);
	buf.writeInt32LE(dataSize, 4);
	buf.write(data, 8, dataSize);
	return buf;
};

const processSocketReadable = (socket) => {
	while (true) {
		const _headerParams = { read: false, type: -1, size: 0 };

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

		if (type < 0 || type >= Object.keys(Types).length) {
			log("Invalid IPC packet type", type);
			socket.destroy();
			return;
		}

		let data;
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
				if (socket._handshook) {
					log("Client tried to double handshake");
					socket.close(CloseCodes.CLOSE_ABNORMAL);
					return;
				}
				socket._handshook = true;
				socket.emit("handshake", data);
				break;
			case Types.FRAME:
				if (!socket._handshook) {
					log("Client sent frame before handshake");
					socket.close(CloseCodes.CLOSE_ABNORMAL);
					return;
				}
				socket.emit("request", data);
				break;
			case Types.CLOSE:
				socket.end();
				socket.destroy();
				return;
		}
	}
};

const getAvailableSocket = async () => {
	for (let i = 0; i < 10; i++) {
		const path = `${SOCKET_PATH}-${i}`;
		const socket = createConnection(path);

		const connected = await new Promise((resolve) => {
			socket.on("connect", () => {
				socket.end();
				resolve(true);
			});
			socket.on("error", (err) => {
				if (err.code === "ECONNREFUSED" || err.code === "ENOENT") {
					if (platform !== "win32") {
						try {
							unlinkSync(path);
						} catch (_e) {}
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

export default class IPCServer {
	constructor(handlers) {
		this.handlers = handlers;
		this.server = null;
		this.onConnection = this.onConnection.bind(this);
		this.onMessage = this.onMessage.bind(this);
	}

	async start() {
		const socketPath = await getAvailableSocket();

		this.server = createServer(this.onConnection);
		this.server.on("error", (e) => log("server error", e));

		return new Promise((resolve) => {
			this.server.listen(socketPath, () => {
				log("listening at", socketPath);
				resolve();
			});
		});
	}

	onConnection(socket) {
		log("new connection!");

		socket.on("readable", () => {
			try {
				processSocketReadable(socket);
			} catch (e) {
				log("error whilst reading", e);
				socket.end(
					encode(Types.CLOSE, {
						code: CloseCodes.CLOSE_UNSUPPORTED,
						message: e.message,
					}),
				);
				socket.destroy();
			}
		});

		socket.once("handshake", (params) => {
			if (process.env.ARRPC_DEBUG) log("handshake:", params);

			const ver = parseInt(params.v ?? 1, 10);
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
			socket.on("close", (e) => {
				log("socket closed", e);
				this.handlers.close(socket);
			});

			socket.on("request", this.onMessage.bind(this, socket));

			socket._send = socket.send;
			socket.send = (msg) => {
				if (process.env.ARRPC_DEBUG) log("sending", msg);
				if (socket.writable) socket.write(encode(Types.FRAME, msg));
			};

			socket.clientId = clientId;
			this.handlers.connection(socket);
		});
	}

	onMessage(socket, msg) {
		if (process.env.ARRPC_DEBUG) log("message", msg);
		this.handlers.message(socket, msg);
	}
}
