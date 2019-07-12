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
    onNewNodes: broker.onNewNodes,
    setType: broker.setType,
    setValue: broker.setValue,
    nodeExists: broker.nodeExists,
    getType: broker.getType,
    getNodesByType: broker.getNodesByType,
    getNodeValue: broker.getNodeValue,
    getNodeEndPoints: broker.getNodeEndPoints,
    getBackupNodes: broker.getBackupNodes,
    getNodes: broker.getNodes,
    handler: broker.handler,
    prepareNodes: broker.prepareNodes,
    send: broker.send,
    usend: broker.usend,
    sharedObject: so,
    onLogging: logger.onLogging,
    // used ONLY for tests
    _pauseAnnouncement: broker._pauseAnnouncement
};
