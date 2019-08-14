'use strict';

const packer = require('./packer');
const logger = require('./logger');
const uuid = require('./uuid');
const UdpEngine = require('./udp');
const Reliable = require('./transports/reliable');
const Msg = require('./transports/msg');

const EMPTY_UUID = Buffer.alloc(16);
const SEND_TYPE = 10;
const RESP_TYPE = 20;

const msgMap = {};
const handlers = {};
const sends = {};
const responses = {};

// same as CLEAN_INTERVAL of Reliable
var CLEAN_INTERVAL;
// same as TTL of Reliable
var TTL;
var reliable;
var _onStopCallback;
var _onHandleCallback;
var _onTimeoutCallback;

module.exports = {
    start: start,
    stop: stop,
    info: info,
    setSplitSize: setSplitSize,
    handler: handler,
    onHandle: onHandle,
    onTimeout: onTimeout,
    send: send,
    usend: usend,
    localSend: localSend
};

function start(conf, cb) {
    if (!conf) {
        conf = {};
    }
    if (conf.timeout) {
        Reliable.TIMEOUT = conf.timeout;
    }
    if (conf.cleanInterval) {
        Reliable.CLEAN_INTERVAL = conf.cleanInterval;
    }
    if (conf.retryTimeout) {
        Reliable.RETRY_TIMEOUT = conf.retryTimeout;
    }
    if (conf.logger) {
        logger.setup(conf.logger);
    }
    CLEAN_INTERVAL = Reliable.CLEAN_INTERVAL;
    TTL = Reliable.TTL;
    reliable = new Reliable(new UdpEngine(conf.address, conf.port, conf.nic, conf.strict));
    _setupCleaner();
    if (!cb) {
        return new Promise(_start);
    }
    _start(cb, cb);
}

function _start(resolve, reject) {
    reliable.on('start', resolve);
    reliable.on('error', reject);
    reliable.on('msg', _onMsg);
    reliable.on('timeout', _onTimeout);
    reliable.on('umsg', _onUmsg);
    reliable.on('ack', _onAck);
    reliable.on('stop', _onStop);
    reliable.start();
}

function stop(cb) {
    _onStopCallback = cb;
    if (reliable && reliable.stop) {
        reliable.stop();
    }
}

function _onStop() {
    _onStopCallback();
}

function info() {
    return reliable.info();
}

function setSplitSize(splitSize) {
    Msg.setSplitSize(splitSize);
}

function handler(handlerId, _handler) {
    if (isNaN(handlerId) || handlerId > 0xffff) {
        throw new Error('Invalid handler ID ' + handlerId);
    }
    if (handlers[handlerId]) {
        throw new Error('Duplicate handler ID ' + handlerId);
    }
    handlers[handlerId] = _handler;
}

function onHandle(_callback) {
    _onHandleCallback = _callback;
}

function onTimeout(_callback) {
    _onTimeoutCallback = _callback;
}

function localSend(handlerId, wrappedData, responseCallback) {
    if (!handlers[handlerId]) {
        logger.error('<delivery>Handler missing for handler ID:', handlerId);
        return;
    }
    var timeout = setTimeout(() => {
        if (typeof responseCallback !== 'function') {
            return;
        }
        responseCallback(new Error('Local command response timed out - handler ID:' + handlerId));
    }, CLEAN_INTERVAL);
    _onHandleCallback(wrappedData);
    const receiver = _createReceiver(true, reliable.info());
    handlers[handlerId].call(receiver, wrappedData.data, (res) => {
        clearTimeout(timeout);
        if (res instanceof Error) {
            responseCallback(res);
        } else {
            responseCallback(null, res);
        }
    });
}

function send(addr, port, handlerId, data, responseCallback) {
    if (isNaN(handlerId) || handlerId > 0xffff) {
        logger.error('<delivery>Invalid handler ID:', handlerId);
        return;
    }
    var now = Date.now();
    var id = EMPTY_UUID.toString('hex');
    if (responseCallback) {
        id = uuid().toString('hex');
        responses[id] = {
            handlerId: handlerId,
            callback: responseCallback,
            remoteAddr: addr,
            remotePort: port,
            time: now
        };
    }
    var chunks = Msg.split(_createPacket(id, handlerId, data));
    var chunk = chunks.shift();
    // send the first chunk
    var msgId = _sendChunk(chunk, addr, port);
    // we send rest of the chuncks as we receive acks for each send
    sends[msgId] = { addr: addr, port: port, chunks: chunks, time: now };
    logger.sys('<delivery>Send a message - message ID:', msgId, 'message chunks:', chunks.length);
}

function _sendChunk(chunk, addr, port) {
    return reliable.send(addr, port, chunk);
}

function _createPacket(id, handlerId, data) {
    var buf = packer.pack(data);
    var typebuf = Buffer.alloc(1);
    typebuf.writeUInt8(SEND_TYPE, 0);
    var idbuf = Buffer.from(id, 'hex');
    var hidbuf = Buffer.alloc(2);
    hidbuf.writeUInt16BE(handlerId, 0);
    return Buffer.concat([ typebuf, idbuf, hidbuf, buf ]);
}

function usend(addr, port, handlerId, data, responseCallback) {
    if (isNaN(handlerId) || handlerId > 0xffff) {
        logger.error('<delivery>Invalid handler ID:', handlerId);
        return;
    }
    var now = Date.now();
    var id = EMPTY_UUID.toString('hex');
    if (responseCallback) {
        id = uuid().toString('hex');
        responses[id] = {
            handlerId: handlerId,
            callback: responseCallback,
            remoteAddr: addr,
            remotePort: port,
            time: now
        };
    }
    var buf = packer.pack({ id: id, handlerId: handlerId, data: data });
    reliable.usend(addr, port, buf);
    logger.sys('<delivery>Send an unreliable message to:', addr, port, data);
}

function _onMsg(buf, sender) {
    var msgId = Msg.id(buf);
    var msg;
    if (!msgMap[msgId]) {
        msg = new Msg();
        msgMap[msgId] = { msg: msg, time: Date.now() };
    } else {
        msg = msgMap[msgId].msg;
    }
    var message = msg.add(buf);
    if (!message) {
        // we do not have the complete message yet...
        return;
    }
    // remove the completed msg
    delete msgMap[msgId];
    // parse message
    var type = message.readUInt8(0);
    var ridbuf = message.slice(1, 17);
    var rid = ridbuf.toString('hex');
    var handlerId = message.readUInt16BE(17);
    var payload = message.slice(19);
    // handle message
    switch (type) {
        case SEND_TYPE:
            // received a message: resp can be doNothing
            // if there's no response callback or sending a message to multiple nodes
            // if sending a message to multiple nodes, the first node that sends a response
            // will be the ONLY node to send a response back to the sender and the rest of
            // the nodes will NOT send responses beacause of how _relay() is implemented in broker
            var resp = _doNothing;
            if (!EMPTY_UUID.equals(ridbuf)) {
                // this buf requires a response
                resp = _response.bind(null, { ridbuf: ridbuf, handlerId: handlerId, sender: sender });
            }
            if (!handlers[handlerId]) {
                // handler missing...
                logger.error('<delivery>Missing handler for handler ID:', handlerId);
                return;
            }
            var wrappedData = packer.unpack(payload);
            var data;
            if (typeof _onHandleCallback === 'function') {
                data = _onHandleCallback(wrappedData);
            } else {
               data = wrappedData;
            }
            logger.sys(
                '<delivery>Message received - handler ID:', handlerId,
                'data:', data, 'response', (resp ? true : false)
            );
            const receiver = _createReceiver(false, sender);
            handlers[handlerId].call(receiver, data, resp);
        break;
        case RESP_TYPE:
            // received a response;
            if (responses[rid]) {
                var callback = responses[rid].callback;
                delete responses[rid];
                var responseData = packer.unpack(payload);
                logger.sys(
                    '<delivery>Response received - handler ID:', handlerId,
                    'data:', responseData
                );
                if (responseData instanceof Error) {
                    callback(responseData);
                } else {
                    callback(null, responseData);
                }
            }
        break;
        default:
            // unknown type...
        break;
    }
}

// this is triggered when a reliable message timed out
function _onTimeout(buf, remoteAddr, remotePort) {
    var msgId = Msg.id(buf);
    var msg;
    if (!msgMap[msgId]) {
        msg = new Msg();
    } else {
        msg = msgMap[msgId].msg;
    }
    var message = msg.add(buf);
    if (!message) {
        // this buf is a message chunk and incomplete
        return;
    }
    // remove the completed msg
    delete msgMap[msgId];
    // parse message
    var type = message.readUInt8(0);
    var ridbuf = message.slice(1, 17);
    var rid = ridbuf.toString('hex');
    var handlerId = message.readUInt16BE(17);
    var payload = message.slice(19);
    // timed out message without response callback will be dropped
    logger.error(
        '<delivery>Reliable message timed out - handler ID:', handlerId,
        (type === SEND_TYPE ? 'send' : 'response'),
        'to', remoteAddr, remotePort
    );
    switch (type) {
        case SEND_TYPE:
            if (typeof _onTimeoutCallback === 'function') {
                var wrappedData = packer.unpack(payload);
                _onTimeoutCallback(wrappedData);
            }
        break;
        case RESP_TYPE:
            if (responses[rid]) {
                var callback = responses[rid].callback;
                delete responses[rid];
                var responseData = packer.unpack(payload);
                logger.error(
                    '<delivery>Response timed out - handler ID:', handlerId,
                    'data:', responseData,
                    'from', remoteAddr, remotePort
                );
                callback(new Error(
                    'Reliable message callback timed out - handler ID:' + handlerId
                ));
            }
        break;
    }
}

function _onUmsg(buf, sender) {
    var wrappedData = packer.unpack(buf);
    var ridbuf = Buffer.from(wrappedData.id, 'hex');
    var handlerId = wrappedData.handlerId;
    var data = _onHandleCallback(wrappedData.data);
    if (!handlers[handlerId]) {
        // handler missing...
        logger.error('<delivery>Missing handler for handler ID:', handlerId);
        return;
    }
    // received a message: resp can be doNothing
    // if there's no response callback or sending a message to multiple nodes
    // if sending a message to multiple nodes, the first node that sends a response
    // will be the ONLY node to send a response back to the sender and the rest of
    // the nodes will NOT send responses beacause of how _relay() is implemented in broker
    var resp = _doNothing;
    if (!EMPTY_UUID.equals(ridbuf)) {
        // this buf requires a response
        resp = _response.bind(null, { ridbuf: ridbuf, handlerId: handlerId, sender: sender });
    }
    logger.sys('<delivery>Unreliable message received - handler ID:', handlerId, 'data:', data);
    const receiver = _createReceiver(false, sender);
    handlers[handlerId].call(receiver, data, resp);
}

function _createReceiver(isLocal, sender) {
    const senderInfo = Object.assign({isLocal: isLocal}, sender);
    return {sender: senderInfo};
}

function _onAck(msgId) {
    if (!sends[msgId]) {
        return;
    }
    var addr = sends[msgId].addr;
    var port = sends[msgId].port;
    var chunk = sends[msgId].chunks.shift();
    var newMsgId;
    // update time while we are still sending the remaining chunks
    sends[msgId].time = Date.now();
    // send the remaining chunck and wait for next ack
    if (chunk) {
        logger.verbose('<delivery>Send a message chunk to:', addr, port, 'msg ID:', msgId);
        newMsgId = _sendChunk(chunk, addr, port);
    }
    // if there's no more chuncks, delete
    if (!sends[msgId].chunks.length) {
        delete sends[msgId];
        return;
    }
    if (newMsgId) {
        // every send and ack cycle has a different msgId
        sends[newMsgId] = sends[msgId];
        delete sends[msgId];
    }
}

function _response(bind, responseData) {
    var ridbuf = bind.ridbuf;
    var handlerId = bind.handlerId;
    var sender = bind.sender;
    logger.sys(
        '<delivery>Send response to', sender,
        '- handler ID:', handlerId,
        '- data', responseData
    );
    _sendResponse(sender.address, sender.port, ridbuf, handlerId, responseData);
}

function _sendResponse(addr, port, ridbuf, handlerId, responseData) {
    var buf = _createResponse(ridbuf, handlerId, responseData);
    var chunks = Msg.split(buf);
    _sendResponseChunks(chunks, addr, port);
}

function _createResponse(ridbuf, handlerId, responseData) {
    var typebuf = Buffer.alloc(1);
    typebuf.writeUInt8(RESP_TYPE, 0);
    var hidbuf = Buffer.alloc(2);
    hidbuf.writeUInt16BE(handlerId, 0);
    var packed = packer.pack(responseData);
    return Buffer.concat([ typebuf, ridbuf, hidbuf, packed ]);
}

function _sendResponseChunks(chunks, addr, port) {
    var chunk = chunks.shift();
    reliable.send(addr, port, chunk);
    if (!chunks.length) {
        return;
    }
    process.nextTick(() => {
        _sendResponseChunks(chunks, addr, port);
    });
}

function _setupCleaner() {
    setTimeout(_cleaner, CLEAN_INTERVAL);
}

function _cleaner() {
    var now = Date.now();
    for (var mid in msgMap) {
        if (msgMap[mid].time + TTL <= now) {
            delete msgMap[mid];
        }
    }
    for (var msgId in sends) {
        if (sends[msgId].time + TTL <= now) {
            delete sends[msgId];
        }
    }
    for (var rid in responses) {
        if (responses[rid].time + TTL <= now) {
            var callback = responses[rid].callback;
            var handlerId = responses[rid].handlerId;
            var remoteAddr = responses[rid].remoteAddr;
            var remotePort = responses[rid].remotePort;
            delete responses[rid];
            logger.error(
                '<delivery>Reliable message response timed out - handler ID:',
                handlerId,
                '- destination:',
                remoteAddr, remotePort,
                'cleaned'
            );
            callback(new Error(
                'Reliable message response timed out - handler ID: ' + handlerId +
                ' - destination: ' + remoteAddr + ' ' + remotePort
            ));
        }
    }
    _setupCleaner();
}

function _doNothing() {}

