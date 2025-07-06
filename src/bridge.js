import {Logger} from './logger.js';
const log = new Logger("bridge", "cyan").log;

import { WebSocketServer } from 'ws';

// basic bridge to pass info onto webapp
let lastMsg = {};
export const send = msg => {
  lastMsg[msg.socketId] = msg;
  wss.clients.forEach(x => x.send(JSON.stringify(msg)));
};

let port = 1337;
if (process.env.ARRPC_BRIDGE_PORT) {
  port = parseInt(process.env.ARRPC_BRIDGE_PORT);
  if (isNaN(port)) {
    throw new Error('invalid port');
  }
}

const wss = new WebSocketServer({ port });

wss.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    throw new Error(`arRPC (rich presence) tried to use port ${port}, but it is already in use. Make sure you are not running another instance of arRPC.\nhttps://github.com/Milkshiift/GoofCord/wiki/FAQ#rich-presence-cant-use-port-1337-because-it-is-occupied`);
  } else {
    throw error;
  }
});

wss.on('connection', socket => {
  log('web connected');

  for (const id in lastMsg) { // catch up newly connected
    if (lastMsg[id].activity != null) send(lastMsg[id]);
  }

  socket.on('close', () => {
    log('web disconnected');
  });
});

wss.on('listening', () => log('listening on', port));
