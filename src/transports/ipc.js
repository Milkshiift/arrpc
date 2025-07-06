import {Logger} from '../logger.js';
const log = new Logger("ipc", "yellow").log;

import { join } from 'path';
import { platform, env } from 'process';
import { unlinkSync } from 'fs';

import { createServer, createConnection } from 'net';

const SOCKET_PATH = platform === 'win32' ? '\\\\?\\pipe\\discord-ipc'
  : join(env.XDG_RUNTIME_DIR || env.TMPDIR || env.TMP || env.TEMP || '/tmp', 'discord-ipc');

// enums for various constants
const Types = { // types of packets
  HANDSHAKE: 0,
  FRAME: 1,
  CLOSE: 2,
  PING: 3,
  PONG: 4
};

const CloseCodes = { // codes for closures
  CLOSE_NORMAL: 1000,
  CLOSE_UNSUPPORTED: 1003,
  CLOSE_ABNORMAL: 1006
};

const ErrorCodes = { // codes for errors
  INVALID_CLIENTID: 4000,
  INVALID_ORIGIN: 4001,
  RATELIMITED: 4002,
  TOKEN_REVOKED: 4003,
  INVALID_VERSION: 4004,
  INVALID_ENCODING: 4005
};

let uniqueId = 0;

const encode = (type, data) => {
  data = JSON.stringify(data);
  const dataSize = Buffer.byteLength(data);

  const buf = Buffer.alloc(dataSize + 8);
  buf.writeInt32LE(type, 0); // type
  buf.writeInt32LE(dataSize, 4); // data size
  buf.write(data, 8, dataSize); // data

  return buf;
};

const read = socket => {
  let resp = socket.read(8);
  if (!resp) return;

  resp = Buffer.from(resp);
  const type = resp.readInt32LE(0);
  const dataSize = resp.readInt32LE(4);

  if (type < 0 || type >= Object.keys(Types).length) throw new Error('invalid type');

  let data = socket.read(dataSize);
  if (!data) throw new Error('failed reading data');

  data = JSON.parse(Buffer.from(data).toString());

  switch (type) {
    case Types.PING:
      socket.emit('ping', data);
      socket.write(encode(Types.PONG, data));
      break;

    case Types.PONG:
      socket.emit('pong', data);
      break;

    case Types.HANDSHAKE:
      if (socket._handshook) throw new Error('already handshook');

      socket._handshook = true;
      socket.emit('handshake', data);
      break;

    case Types.FRAME:
      if (!socket._handshook) throw new Error('need to handshake first');

      socket.emit('request', data);
      break;

    case Types.CLOSE:
      socket.end();
      socket.destroy();
      break;
  }

  read(socket);
};

const getAvailableSocket = async () => {
  for (let i = 0; i < 10; i++) {
    const path = SOCKET_PATH + '-' + i;
    const socket = createConnection(path);

    const connected = await new Promise((resolve) => {
      socket.on('connect', () => {
        socket.end();
        resolve(true);
      });

      socket.on('error', (err) => {
        if (err.code === 'ECONNREFUSED' || err.code === 'ENOENT') {
          if (platform !== 'win32') {
            try {
              unlinkSync(path);
            } catch (e) {
              // ignore
            }
          }
          resolve(false);
        } else {
          resolve(true);
        }
      });
    });

    if (!connected) {
      return path;
    }
  }
  throw new Error('ran out of tries to find socket');
};

export default class IPCServer {
  constructor(handers) { return new Promise(async res => {
    this.handlers = handers;

    this.onConnection = this.onConnection.bind(this);
    this.onMessage = this.onMessage.bind(this);

    const server = createServer(this.onConnection);
    server.on('error', e => {
      log('server error', e);
    });

    const socketPath = await getAvailableSocket();
    server.listen(socketPath, () => {
      log('listening at', socketPath);
      this.server = server;

      res(this);
    });
  }); }

  onConnection(socket) {
    log('new connection!');

    socket.pause();
    socket.on('readable', () => {
      try {
        read(socket);
      } catch (e) {
        log('error whilst reading', e);

        socket.end(encode(Types.CLOSE, {
          code: CloseCodes.CLOSE_UNSUPPORTED,
          message: e.message
        }));
        socket.destroy();
      }
    });

    socket.once('handshake', params => {
      if (process.env.ARRPC_DEBUG) log('handshake:', params);

      const ver = parseInt(params.v ?? 1);
      const clientId = params.client_id ?? '';
      // encoding is always json for ipc

      socket.close = (code = CloseCodes.CLOSE_NORMAL, message = '') => {
        socket.end(encode(Types.CLOSE, {
          code,
          message
        }));
        socket.destroy();
      };

      if (ver !== 1) {
        log('unsupported version requested', ver);

        socket.close(ErrorCodes.INVALID_VERSION);
        return;
      }

      if (clientId === '') {
        log('client id required');

        socket.close(ErrorCodes.INVALID_CLIENTID);
        return;
      }

      socket.on('error', e => {
        log('socket error', e);
      });

      socket.on('close', e => {
        log('socket closed', e);
        this.handlers.close(socket);
      });

      socket.on('request', this.onMessage.bind(this, socket));

      socket._send = socket.send;
      socket.send = msg => {
        if (process.env.ARRPC_DEBUG) log('sending', msg);
        socket.write(encode(Types.FRAME, msg));
      };

      socket.clientId = clientId;

      this.handlers.connection(socket);
    })
  }

  onMessage(socket, msg) {
    if (process.env.ARRPC_DEBUG) log('message', msg);
    this.handlers.message(socket, msg);
  }
}
