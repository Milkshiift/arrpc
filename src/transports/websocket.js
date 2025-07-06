import {Logger} from '../logger.js';
const log = new Logger("websocket", "magentaBright").log;

import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import { parse } from 'querystring';

const portRange = [ 6463, 6472 ]; // ports available/possible: 6463-6472

export default class WSServer {
  constructor(handlers) {
    this.handlers = handlers;
    this.onConnection = this.onConnection.bind(this);
    this.onMessage = this.onMessage.bind(this);

    return (async () => {
      let port = portRange[0];
      let http, wss;

      while (port <= portRange[1]) {
        if (process.env.ARRPC_DEBUG) log('trying port', port);

        try {
          await new Promise((resolve, reject) => {
            http = createServer();
            http.on('error', reject);

            wss = new WebSocketServer({ server: http });
            wss.on('error', reject);
            wss.on('connection', this.onConnection);

            http.listen(port, '127.0.0.1', () => {
              log('listening on', port);
              this.http = http;
              this.wss = wss;
              resolve();
            });
          });
          break;
        } catch (e) {
          if (e.code === 'EADDRINUSE') {
            log(port, 'in use!');
            port++;
          } else {
            throw e;
          }
        }
      }

      if (port > portRange[1]) {
        throw new Error('No available ports in range');
      }

      return this;
    })();
  }

  onConnection(socket, req) {
    const params = parse(req.url.split('?')[1]);
    const ver = parseInt(params.v ?? 1);
    const encoding = params.encoding ?? 'json'; // json | etf (erlpack)
    const clientId = params.client_id ?? '';

    const origin = req.headers.origin ?? '';

    if (process.env.ARRPC_DEBUG) log(`new connection! origin:`, origin, JSON.parse(JSON.stringify(params)));

    if (origin !== '' && ![ 'https://discord.com', 'https://ptb.discord.com', 'https://canary.discord.com' ].includes(origin)) {
      log('disallowed origin', origin);

      socket.close();
      return;
    }

    if (encoding !== 'json') {
      log('unsupported encoding requested', encoding);

      socket.close();
      return;
    }

    if (ver !== 1) {
      log('unsupported version requested', ver);

      socket.close();
      return;
    }

    /* if (clientId === '') {
      log('client id required');

      socket.close();
      return;
    } */

    socket.clientId = clientId;
    socket.encoding = encoding;

    socket.on('error', e => {
      log('socket error', e);
    });

    socket.on('close', (e, r) => {
      log('socket closed', e, r);
      this.handlers.close(socket);
    });

    socket.on('message', this.onMessage.bind(this, socket));

    socket._send = socket.send;
    socket.send = msg => {
      if (process.env.ARRPC_DEBUG) log('sending', msg);
      socket._send(JSON.stringify(msg));
    };

    this.handlers.connection(socket);
  }

  onMessage(socket, msg) {
    if (process.env.ARRPC_DEBUG) log('message', JSON.parse(msg));
    this.handlers.message(socket, JSON.parse(msg));
  }
}
