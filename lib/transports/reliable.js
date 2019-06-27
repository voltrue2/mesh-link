'use strict';

const uuid = require('../uuid');
const logger = require('../logger');
const EventEmitter = require('events').EventEmitter;

const SHUTDOWN_POLLING_INTERVAL = 1000;
const MAX_SHUTDOWN_POLLING = 30;
const USEND_FLAG = 0x00;
const SEND_FLAG = 0x01;
const ACK_FLAG = 0x02;
const _info = { addr: null, port: 0 };
var CLEAN_INTERVAL = 10000;
var TTL = 2999;
var TIMEOUT = 3000;
var RETRY_TIMEOUT = 200;

/**
* @event start   Emitted when UdpEngine is ready
* @event error   Emitted when UdpEngine fails to start
* @event msg     Emitted when Reliable receives a message from another reliable
* @event timeout Emitted when a reliable message is timed out
* @event umsg    Emitted when Reliable receives an unreliable message sent by usend() from another node
* @event ack     Emitted when ack is received
*/
class Reliable extends EventEmitter {

    constructor(udpEngine) {
        super();
        this._shutdownPollingCounter = 0;
        this._udp = udpEngine;
        this._retries = {};
        this._emitted = {};
        this._udp.receive(this._onReceive.bind(null, { that: this }));
        var that = this;
        setTimeout(() => {
            that._cleaner();
        }, CLEAN_INTERVAL);
    }

    static get CLEAN_INTERVAL() {
        return CLEAN_INTERVAL;
    }

    static get TTL() {
        return TTL;
    }

    static set CLEAN_INTERVAL(val) {
        CLEAN_INTERVAL = val;
        TTL = val - 1;
    }

    static set TIMEOUT(val) {
        TIMEOUT = val;
    }

    static set RETRY_TIMEOUT(val) {
        RETRY_TIMEOUT = val;
    }

    start() {
        var that = this;
        this._udp.start()
            .then(() => {
                var info = that._udp.info();
                _info.addr = info.address;
                _info.port = info.port;
                that.emit('start');
            })
            .catch((error) => {
                that.emit('error', error);
            });
    }

    stop() {
        this._startShutdown();
    }

    info() {
        return { address: _info.addr, port: _info.port };
    }

    send(addr, port, buf) {
        var id = uuid().toString('hex');
        var msg = this._createSendMessage(id, buf);
        this._udp.send(addr, port, msg);
        this._setupRetry(id, addr, port, msg);
        return id;
    }

    usend(addr, port, buf) {
        var msg = this._createUsendMessage(buf);
        this._udp.send(addr, port, msg);
    }

    _onReceive(bind, msg, sender) {
        var that = bind.that;
        var parsed = that._parseMessage(msg);
        // dismiss retry from the map
        that._dismissRetry(parsed.id);
        // decide what to do based on the received message
        switch (parsed.flag) {
            // unreliable message
            case USEND_FLAG:
                // emit on receive event
                that.emit('umsg', parsed.buf, sender);
            break;
            // reliable message
            case SEND_FLAG:
                // emit on receive event
                if (!that._emitted[parsed.id]) {
                    that.emit('msg', parsed.buf, sender);
                    that._emitted[parsed.id] = Date.now();
                }
                // send ack back to sender
                that._sendAck(sender, parsed);
            break;
            // ack of reliable message
            case ACK_FLAG:
                // sender received ack from receiver
                that._handleAck(parsed);
                // parsed.buf.toString('hex') = msgId
                that.emit('ack', parsed.buf.toString('hex'));
            break;
            default:
                // unknown message....
            break;
        }
    }

    _sendAck(sender, parsedMsg) {
        var id = uuid().toString('hex');
        var ack = this._createAck(id, parsedMsg.id);
        this._udp.send(sender.address, sender.port, ack);
    }

    _handleAck(parsed) {
        // dismiss retry of the message
        var msgId = parsed.buf.toString('hex');
        this._dismissRetry(msgId);
    }

    _dismissRetry(id) {
        if (this._retries[id]) {
            clearTimeout(this._retries[id].timeout);
            delete this._retries[id];
        }
    }

    _setupRetry(id, addr, port, msg) {
        var bind = { that: this, id: id };
        this._retries[id] = {
            addr: addr,
            port: port,
            msg: msg,
            counter: 0,
            timeout: setTimeout(this._retry.bind(null, bind), RETRY_TIMEOUT)
        };
    }

    _retry(bind) {
        var id = bind.id;
        var that = bind.that;
        var map = that._retries;
        if (!map[id]) {
            // no need to retry...
            return;
        }
        var addr = map[id].addr;
        var port = map[id].port;
        map[id].counter += 1;
        if (map[id].counter * RETRY_TIMEOUT >= TIMEOUT) {
            // timeout... give up now...
            var parsed = that._parseMessage(map[id].msg);
            logger.sys('<reliable>Reliable message retry timeout', parsed);
            if (parsed.flag === SEND_FLAG) {
                that.emit('timeout', parsed.buf, addr, port);
            }
            that._dismissRetry(id);
            return;
        }
        // retry
        var msg = map[id].msg;
        logger.sys(
            '<reliable>Reliable message retry:',
            addr, port,
            'message ID:', id,
            'timeout:', map[id].counter * RETRY_TIMEOUT,
            '>=', TIMEOUT
        );
        that._udp.send(addr, port, msg);
        var bind2 = { that: that, id: id };
        var timeout = setTimeout(that._retry.bind(null, bind2), RETRY_TIMEOUT * map[id].counter);
        map[id].timeout = timeout;
    }

    _createSendMessage(id, buf) {
        var flag = Buffer.alloc(1);
        flag.writeUInt8(SEND_FLAG, 0);
        var idbuf = Buffer.from(id, 'hex');
        return Buffer.concat([ flag, idbuf, buf ]);
    }

    _createUsendMessage(buf) {
        var flag = Buffer.alloc(1);
        flag.writeUInt8(USEND_FLAG, 0);
        return Buffer.concat([ flag, buf ]);
    }

    _createAck(id, msgId) {
        var flag = Buffer.alloc(1);
        flag.writeUInt8(ACK_FLAG, 0);
        var idbuf = Buffer.from(id, 'hex');
        var msgIdBuf = Buffer.from(msgId, 'hex');
        return Buffer.concat([ flag, idbuf, msgIdBuf ]);
    }

    _parseMessage(msg) {
        var flag = msg.readUInt8(0);
        var id = null;
        var buf;
        if (flag === USEND_FLAG) {
            buf = msg.slice(1);
        } else {
            id = msg.slice(1, 17).toString('hex');
            buf = msg.slice(17);
        }
        return { flag: flag, id: id, buf: buf };
    }

    _startShutdown() {
        this._pollUnhandledRetries();
    }

    _pollUnhandledRetries() {
        logger.sys(
            '<reliable>Shutdown polling - unhandled retries:',
            Object.keys(this._retries).length,
            '- counter:', this._shutdownPollingCounter
        );
        if (Object.keys(this._retries).length === 0) {
            // no more unhandled retries -> stop UdpEngine
            try {
                this._udp.stop();
            } catch (error) {
                // error...
            }
            logger.info('<reliable>mesh-link stopped');
            this.emit('stop');
            return;
        }
        this._shutdownPollingCounter += 1;
        if (this._shutdownPollingCounter >= MAX_SHUTDOWN_POLLING) {
            logger.info(
                '<reliable>Maximum shutdown polling count reached -',
                'force shutdown - unhandled retries:',
                Object.keys(this._retries).length
            );
            try {
                this._udp.stop();
            } catch (error) {
                // error...
            }
            logger.info('<reliable>mesh-link stopped');
            this.emit('stop');
            return;
        }
        var that = this;
        setTimeout(() => {
            that._pollUnhandledRetries();
        }, SHUTDOWN_POLLING_INTERVAL);
    }

    _cleaner() {
        var now = Date.now();
        try {
            for (var id in this._emitted) {
                if (this._emitted[id] + TTL <= now) {
                    delete this._emitted[id];
                }
            }
            for (var key in this._retries) {
                if (this._retries[key].counter * RETRY_TIMEOUT >= TIMEOUT) {
                    logger.error('<reliable>Reliable message timed out and cleaned:', key);
                    this._dismissRetry(key);
                }
            }
        } catch (error){
            // well error cleaning...
        }
        var that = this;
        setTimeout(() => {
            that._cleaner();
        }, CLEAN_INTERVAL);
    }

}

module.exports = Reliable;

