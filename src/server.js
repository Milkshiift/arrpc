import { EventEmitter } from "node:events";

import IPCServer from "./transports/ipc.js";
import WSServer from "./transports/websocket.js";
import ProcessServer from "./process/index.js";

let socketId = 0;

export default class RPCServer extends EventEmitter {
	constructor(detectablePath) {
		super();
		this.detectablePath = detectablePath;

		this.onConnection = this.onConnection.bind(this);
		this.onMessage = this.onMessage.bind(this);
		this.onClose = this.onClose.bind(this);

		const handlers = {
			connection: this.onConnection,
			message: this.onMessage,
			close: this.onClose,
		};

		this.ipc = new IPCServer(handlers);
		this.ws = new WSServer(handlers);
	}

	async start() {
		// Start Transports
		await this.ipc.start();
		await this.ws.start();

		// Start Process Scanner
		const noScan =
			process.argv.includes("--no-process-scanning") ||
			process.env.ARRPC_NO_PROCESS_SCANNING;
		if (this.detectablePath && !noScan) {
			this.processServer = new ProcessServer(
				{
					message: this.onMessage.bind(this),
				},
				this.detectablePath,
			);
		}
	}

	onConnection(socket) {
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

		socket.socketId = socketId++;
		this.emit("connection", socket);
	}

	onClose(socket) {
		this.emit("activity", {
			activity: null,
			pid: socket.lastPid,
			socketId: socket.socketId.toString(),
		});

		this.emit("close", socket);
	}

	async onMessage(socket, { cmd, args, nonce }) {
		this.emit("message", { socket, cmd, args, nonce });

		const commandHandlers = {
			CONNECTIONS_CALLBACK: () => {
				socket.send?.({ cmd, data: { code: 1000 }, evt: "ERROR", nonce });
			},
			SET_ACTIVITY: () => {
				const { activity, pid } = args;
				const sId = socket.socketId.toString();

				if (!activity) {
					socket.send?.({ cmd, data: null, evt: null, nonce });
					return this.emit("activity", { activity: null, pid, socketId: sId });
				}

				const { buttons, timestamps, instance } = activity;
				socket.lastPid = pid ?? socket.lastPid;

				const metadata = {};
				const extra = {};
				if (buttons) {
					metadata.button_urls = buttons.map((x) => x.url);
					extra.buttons = buttons.map((x) => x.label);
				}

				if (timestamps) {
					for (const x in timestamps) {
						// Fix timestamp length if necessary (ms vs s)
						if (String(Date.now()).length - String(timestamps[x]).length > 2) {
							timestamps[x] = Math.floor(1000 * timestamps[x]);
						}
					}
				}

				this.emit("activity", {
					activity: {
						application_id: socket.clientId,
						type: 0,
						metadata,
						flags: instance ? 1 : 0,
						...activity,
						...extra,
					},
					pid,
					socketId: sId,
				});

				socket.send?.({
					cmd,
					data: {
						...activity,
						...extra,
						name: "",
						application_id: socket.clientId,
						type: 0,
						metadata,
					},
					evt: null,
					nonce,
				});
			},
			GUILD_TEMPLATE_BROWSER: () =>
				this.handleInvite(socket, args, nonce, false),
			INVITE_BROWSER: () => this.handleInvite(socket, args, nonce, true),
			DEEP_LINK: () => {
				const deep_callback = (success) => {
					socket.send({
						cmd,
						data: success ? null : { code: 1001 },
						evt: success ? null : "ERROR",
						nonce,
					});
				};
				if (args.type === "SHOP" || args.type === "FEATURES") {
					deep_callback(false);
				} else {
					this.emit("link", args, deep_callback);
				}
			},
		};

		commandHandlers[cmd]?.();
	}

	handleInvite(socket, args, nonce, isInvite) {
		const { code } = args;
		const callback = (isValid = true) => {
			socket.send({
				cmd: isInvite ? "INVITE_BROWSER" : "GUILD_TEMPLATE_BROWSER",
				data: isValid
					? { code }
					: {
							code: isInvite ? 4011 : 4017,
							message: `Invalid ${isInvite ? "invite" : "guild template"} id: ${code}`,
						},
				evt: isValid ? null : "ERROR",
				nonce,
			});
		};
		this.emit(isInvite ? "invite" : "guild-template", code, callback);
	}
}
