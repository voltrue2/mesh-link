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

module.exports = {
    start: start,
    stop: stop,
    info: info,
    handler: handler,
    onHandle: onHandle,
    send: send,
    localSend: localSend
};

function start(conf, cb) {
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
    reliable = new Reliable(new UdpEngine(conf.address, conf.port));
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
    reliable.on('ack', _onAck);
    reliable.on('stop', _onStop);
    reliable.start();
}

function stop(cb) {
    _onStopCallback = cb;
    reliable.stop();
}

function _onStop() {
    _onStopCallback();
}

function info() {
    return reliable.info();
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

function localSend(handlerId, wrappedData, responseCallback) {
    if (!handlers[handlerId]) {
        logger.error('<delivery>Handler missing for handler ID:', handlerId);
        return;
    }
    _onHandleCallback(wrappedData);
    handlers[handlerId](wrappedData.data, (res) => {
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
            callback: responseCallback,
            time: now
        };    
    }
    var chunks = Msg.split(_createPacket(id, handlerId, data));
    var chunk = chunks.shift();
    // send the first chunk
    var msgId = _sendChunk(chunk, addr, port);
    // we send rest of the chuncks as we receive acks for each send
    sends[msgId] = { addr: addr, port: port, chunks: chunks, time: now };
    logger.sys('Send a message - message ID:', msgId, 'message chunks:', chunks.length);
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
                resp = _response.bind(null, { ridbuf: ridbuf, sender: sender });
            }
            if (!handlers[handlerId]) {
                // handler missing...
                return; 
            }
            var wrappedData = packer.unpack(payload);
            var data = _onHandleCallback(wrappedData);
            logger.sys('<delivery>Message received - handler ID:', handlerId, 'data:', data);
            handlers[handlerId](data, resp);
        break;
        case RESP_TYPE:
            // received a response;
            if (responses[rid]) {
                var callback = responses[rid].callback;
                delete responses[rid];
                var responseData = packer.unpack(payload);
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
        logger.verbose('Send a message chunk to:', addr, port, 'msg ID:', msgId);
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
    var sender = bind.sender;
    _sendResponse(sender.address, sender.port, ridbuf, responseData);
}

function _sendResponse(addr, port, ridbuf, responseData) {
    var buf = _createResponse(ridbuf, responseData);
    var chunks = Msg.split(buf);
    _sendResponseChunks(chunks, addr, port);
}

function _createResponse(ridbuf, responseData) {
    var typebuf = Buffer.alloc(1);
    typebuf.writeUInt8(RESP_TYPE, 0);
    var emptybuf = Buffer.alloc(2);
    var packed = packer.pack(responseData);
    return Buffer.concat([ typebuf, ridbuf, emptybuf, packed ]);  
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
            delete responses[rid];
        }   
    }
    _setupCleaner();
}

function _doNothing() {}

