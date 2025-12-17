import { EventEmitter } from "node:events";
import IPCServer, { type IPCSocket } from "./transports/ipc.ts";
import WSServer, { type RPCWebSocket } from "./transports/websocket.ts";
import ProcessServer from "./process/index.ts";
import type { Activity } from "./types.ts";

let socketIdCounter = 0;

interface ServerSocket {
	socketId: string;
	lastPid?: number;
	clientId?: string;
	send: (msg: unknown) => void;
	close?: () => void;
	transportType: "ipc" | "websocket";
}

type TransportSocket = IPCSocket | RPCWebSocket;

interface RPCMessage {
	cmd: string;
	args: {
		activity?: Activity;
		pid?: number;
		code?: string;
		type?: string;
		[key: string]: unknown;
	};
	nonce: string | null;
}

export default class RPCServer extends EventEmitter {
	detectablePath: string;
	ipc: IPCServer;
	ws: WSServer;
	processServer?: ProcessServer;

	private socketMap = new WeakMap<TransportSocket, ServerSocket>();

	constructor(detectablePath: string) {
		super();
		this.detectablePath = detectablePath;

		const onConnection = this.onConnection.bind(this);
		const onMessage = this.onMessage.bind(this);
		const onClose = this.onClose.bind(this);

		this.ipc = new IPCServer({
			connection: (socket) => onConnection(socket, "ipc"),
			message: (socket, msg) => onMessage(socket, msg as RPCMessage),
			close: (socket) => onClose(socket),
		});

		this.ws = new WSServer({
			connection: (socket) => onConnection(socket, "websocket"),
			message: (socket, msg) => onMessage(socket, msg as RPCMessage),
			close: (socket) => onClose(socket),
		});
	}

	async start(): Promise<void> {
		await this.ipc.start();
		await this.ws.start();

		const noScan =
			process.argv.includes("--no-process-scanning") ||
			process.env.ARRPC_NO_PROCESS_SCANNING;

		if (this.detectablePath && !noScan) {
			this.processServer = new ProcessServer(
				{
					message: (socket, msg) => {
						const payload = msg as RPCMessage;
						this.emit("message", { socket: socket, ...payload });

						if (payload.cmd === "SET_ACTIVITY") {
							const { activity, pid } = payload.args;

							const normalizedActivity = activity
								? {
										type: 0,
										flags: 0,
										...activity,
									}
								: activity;

							this.emit("activity", {
								activity: normalizedActivity,
								pid,
								socketId: socket.socketId,
							});
						}
					},
				},
				this.detectablePath,
			);
		}
	}

	private getOrCreateServerSocket(
		socket: TransportSocket,
		type: "ipc" | "websocket",
	): ServerSocket {
		const existing = this.socketMap.get(socket);
		if (existing) return existing;

		const serverSocket: ServerSocket = {
			socketId: `socket-${socketIdCounter++}`,
			clientId: socket.clientId,
			transportType: type,
			send: (msg) => {
				if (type === "ipc") (socket as IPCSocket).send(msg);
				else (socket as RPCWebSocket).sendPayload(msg);
			},
			close: () => {
				if (type === "ipc") (socket as IPCSocket).close();
				else (socket as RPCWebSocket).close();
			},
		};

		this.socketMap.set(socket, serverSocket);
		return serverSocket;
	}

	onConnection(rawSocket: TransportSocket, type: "ipc" | "websocket"): void {
		const socket = this.getOrCreateServerSocket(rawSocket, type);

		socket.send({
			cmd: "DISPATCH",
			data: {
				v: 1,
				config: {
					cdn_host: "cdn.discordapp.com",
					api_endpoint: "//discord.com/api",
					environment: "production",
				},
				user: {
					id: "1045800378228281345",
					username: "arrpc",
					discriminator: "0",
					global_name: "arRPC",
					avatar: "cfefa4d9839fb4bdf030f91c2a13e95c",
					avatar_decoration_data: null,
					bot: false,
					flags: 0,
					premium_type: 0,
				},
			},
			evt: "READY",
			nonce: null,
		});

		this.emit("connection", socket);
	}

	onClose(rawSocket: TransportSocket): void {
		const socket = this.socketMap.get(rawSocket);
		if (!socket) return;

		this.emit("activity", {
			activity: null,
			pid: socket.lastPid,
			socketId: socket.socketId,
		});

		this.emit("close", socket);
		this.socketMap.delete(rawSocket);
	}

	async onMessage(
		rawSocket: TransportSocket | ServerSocket,
		message: RPCMessage,
	): Promise<void> {
		let socket: ServerSocket | undefined;

		if ("transportType" in rawSocket) {
			socket = rawSocket as ServerSocket;
		} else if ("socketId" in rawSocket) {
			// Virtual socket from ProcessServer
			socket = rawSocket as unknown as ServerSocket;
			if (!socket.send) socket.send = () => {};
		} else {
			socket = this.socketMap.get(rawSocket as TransportSocket);
		}

		if (!socket) {
			return;
		}

		const { cmd, args, nonce } = message;
		this.emit("message", { socket, cmd, args, nonce });

		switch (cmd) {
			case "CONNECTIONS_CALLBACK":
				socket.send({ cmd, data: { code: 1000 }, evt: "ERROR", nonce });
				break;

			case "SET_ACTIVITY": {
				const { activity, pid } = args;
				const sId = socket.socketId;

				if (!activity) {
					socket.send({ cmd, data: null, evt: null, nonce });
					this.emit("activity", {
						activity: null,
						pid,
						socketId: sId,
					});
					return;
				}

				const { buttons, timestamps, instance } = activity;
				if (pid) socket.lastPid = pid;

				const metadata: Record<string, unknown> = {};
				const extra: Record<string, unknown> = {};

				if (buttons && Array.isArray(buttons)) {
					metadata.button_urls = buttons.map((x) => x.url);
					extra.buttons = buttons.map((x) => x.label);
				}

				if (timestamps) {
					for (const x in timestamps) {
						const key = x as keyof typeof timestamps;
						const tsValue = timestamps[key];
						if (tsValue !== undefined && tsValue > 0 && tsValue < 32503680000) {
							timestamps[key] = Math.floor(1000 * tsValue);
						}
					}
				}

				const normalizedActivity = {
					application_id: socket.clientId,
					type: 0,
					metadata,
					flags: instance ? 1 : 0,
					...activity,
					...extra,
				};

				this.emit("activity", {
					activity: normalizedActivity,
					pid,
					socketId: sId,
				});

				socket.send({
					cmd,
					data: {
						...normalizedActivity,
						name: "",
					},
					evt: null,
					nonce,
				});
				break;
			}

			case "GUILD_TEMPLATE_BROWSER":
			case "INVITE_BROWSER": {
				const isInvite = cmd === "INVITE_BROWSER";
				const code = args.code;

				const callback = (isValid = true) => {
					try {
						socket?.send({
							cmd,
							data: isValid
								? { code }
								: {
										code: isInvite ? 4011 : 4017,
										message: `Invalid ${isInvite ? "invite" : "guild template"} id: ${code}`,
									},
							evt: isValid ? null : "ERROR",
							nonce,
						});
					} catch {}
				};
				this.emit(isInvite ? "invite" : "guild-template", code, callback);
				break;
			}

			case "DEEP_LINK":
				if (args.type === "SHOP" || args.type === "FEATURES") {
					socket.send({
						cmd,
						data: { code: 1001 },
						evt: "ERROR",
						nonce,
					});
				} else {
					this.emit("link", args, (success: boolean) => {
						try {
							socket?.send({
								cmd,
								data: success ? null : { code: 1001 },
								evt: success ? null : "ERROR",
								nonce,
							});
						} catch {}
					});
				}
				break;
		}
	}
}
