import { createConnection, type Socket } from "node:net";
import { join } from "node:path";
import { platform, env } from "node:process";

const Types = {
	HANDSHAKE: 0,
	FRAME: 1,
	CLOSE: 2,
	PING: 3,
	PONG: 4,
} as const;

const encode = (type: number, data: unknown): Buffer => {
	const stringData = JSON.stringify(data);
	const dataSize = Buffer.byteLength(stringData);
	const buf = Buffer.alloc(dataSize + 8);
	buf.writeInt32LE(type, 0);
	buf.writeInt32LE(dataSize, 4);
	buf.write(stringData, 8, dataSize);
	return buf;
};

const decode = (socket: Socket, callback: (type: number, data: any) => void) => {
	let header: Buffer | null = null;

	socket.on("readable", () => {
		try {
			while (true) {
				if (!header) {
					if (socket.readableLength < 8) return;
					header = socket.read(8);
				}
                
                if (!header) return;

				const type = header.readInt32LE(0);
				const dataSize = header.readInt32LE(4);

				if (socket.readableLength < dataSize) {
					return;
				}

				const bodyBuffer = socket.read(dataSize);
				if (!bodyBuffer) {
					return;
				}
                
                header = null;

				const data = JSON.parse(bodyBuffer.toString("utf8"));
				callback(type, data);
			}
		} catch (e) {
			console.error("Error decoding message:", e);
		}
	});
};

const getSocketPath = () => {
	if (platform === "win32") {
		return "\\\\?\\pipe\\discord-ipc-0";
	}
	const prefix = env.XDG_RUNTIME_DIR || env.TMPDIR || env.TMP || env.TEMP || "/tmp";
	return join(prefix, "discord-ipc-0");
};

async function main() {
	const socketPath = getSocketPath();
	console.log("Connecting to", socketPath);

	const socket = createConnection(socketPath);

	socket.on("connect", () => {
		console.log("Connected to IPC server!");

		const handshake = {
			v: 1,
			client_id: "123456789012345678"
		};
		socket.write(encode(Types.HANDSHAKE, handshake));
		console.log("Sent Handshake");
	});

	decode(socket, (type, data) => {
		console.log("Received:", type, data);

		if (type === Types.PING) {
			socket.write(encode(Types.PONG, data));
		}
        
        if (data.evt === "READY") {
             console.log("Received READY event, setting activity...");
             const activityPayload = {
                cmd: "SET_ACTIVITY",
                args: {
                    pid: process.pid,
                    activity: {
                        details: "Running Test Client",
                        state: "Emulating Game",
                        timestamps: {
                            start: Date.now()
                        },
                        assets: {
                            large_image: "test_image",
                            large_text: "Test Image"
                        }
                    }
                },
                nonce: "test-nonce-" + Date.now()
            };
            socket.write(encode(Types.FRAME, activityPayload));
        }
	});

	socket.on("error", (err) => {
		console.error("Socket error:", err);
        process.exit(1);
	});

	socket.on("close", () => {
		console.log("Socket closed");
        process.exit(0);
	});

    setInterval(() => {
    }, 1000);
}

main().catch(console.error);