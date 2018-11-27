'use strict';
const broker = require('./lib/broker');
const so = require('./lib/so');
const logger = require('./lib/logger');
module.exports = {
    start: broker.start,
    stop: broker.stop,
    info: broker.info,
    onUpdate: broker.onUpdate,
    onUpdated: broker.onUpdated,
    setValue: broker.setValue,
    getNodeValue: broker.getNodeValue,
    getNodeEndPoints: broker.getNodeEndPoints,
    getBackupNodes: broker.getBackupNodes,
    handler: broker.handler,
    send: broker.send,
    usend: broker.usend,
    sharedObject: so,
    onLogging: logger.onLogging,
    // used ONLY for tests
    _pauseAnnouncement: broker._pauseAnnouncement
};
