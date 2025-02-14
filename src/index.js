#!/usr/bin/env node

import {Logger} from './logger.js';
const log = new Logger().log;

log('arRPC v3.5.0');

import * as Bridge from './bridge.js';
import Server from './server.js';

const server = await new Server("./detectable.json");

server.on('activity', data => Bridge.send(data));
