'use strict';

const os = require('os');
const networkInterfaces = os.networkInterfaces() || {};
const dgram = require('dgram');
const logger = require('./logger');

const LOCALHOST = '127.0.0.1';
const E_PORT_IN_USE = 'EADDRINUSE';
const PING = Buffer.from('ping');
const PONG = Buffer.from('PONG\n');
const DELIMITER = Buffer.from('feedme');
const DLEN = 6;

const conf = {
    nic: 'eth0',
    addr: LOCALHOST,
    port: 8100,
    sendInterval: 0
};

class UdpEngine {

    constructor(addr, port, _nicName, sendInterval, strict) {
        if (strict === undefined) {
            strict = true;
        }
        var nicName = _nicName || conf.nic;
        var nic = networkInterfaces[nicName] || [ { address: null } ];
        this._addr = addr || (nic[0].address || conf.addr);
        this._port = port || conf.port;
        this._server = null;
        this._queue = {};
        this._onMessageListeners = [];
        if (_nicName && !networkInterfaces[_nicName]) {
            // we specified a net work interface but could not find it...
            logger.error(
                'Configuration specified a nic of "' + _nicName +
                '", but could not find it (strict:' + (strict || false) + ')'
            );
            if (strict) {
                throw new Error('Network interface "' + _nicName + '" not found');
            }
        }
        if (sendInterval > 0) {
            conf.sendInterval = sendInterval;
        }
        logger.sys('Available network interfaces:', networkInterfaces);
        logger.sys('Is', nicName, 'available?', nic);
        logger.info(
            'Target network interface is set to:', nicName,
            '- interface:', nic[0].address,
            '- address:', this._addr
        );
    }

    start() {
        var bind = { that: this };
        return new Promise(this._start.bind(null, bind));
    }

    stop() {
        if (this._server) {
            this._server.close();
            this._server = null;
        }
    }

    info() {
        return { address: this._addr, port: this._port };
    }

    send(addr, port, buf) {
        if (!this._server) {
            return;
        }
        if (conf.sendInterval > 0) {
            var key = addr + '/' + port;
            if (!this._queue[key]) {
                this._queue[key] = Buffer.alloc(0);
            }
            this._queue[key] = Buffer.concat([ this._queue[key], buf, DELIMITER ]);
            return;
        }
        this._server.send(buf, 0, buf.length, port, addr);
    }

    receive(listener) {
        this._onMessageListeners.push(listener);
    }

    _start(bind, resolve, reject) {
        var that = bind.that;
        var bind2 = { that: that, resolve: resolve, reject: reject };
        that._server = dgram.createSocket('udp4');
        that._server.on('listening', that._onListening.bind(null, bind2));
        that._server.on('error', that._onError.bind(null, bind2));
        that._server.on('message', that._onMessage.bind(null, { that: that }));
        that._server.bind({
            port: that._port,
            address: that._addr,
            exclusive: true
        });
    }

    _onListening(bind) {
        var that = bind.that;
        var info = that._server.address();
        that._addr = info.address;
        that._port = info.port;
        if (conf.sendInterval > 0) {
            logger.info('Mesh network message is in batch send mode at', conf.sendInterval, 'milliseconds');
            that._sender();
        }
        logger.info('Mesh network node is ready at', that._addr, that._port);
        bind.resolve();
    }

    _sender() {
        var that = this;
        setTimeout(() => {
            if (!that._server) {
                return;
            }
            try {
                for (var key in that._queue) {
                    var split = key.split('/');
                    var addr = split[0];
                    var port = parseInt(split[1]);
                    var buf = that._queue[key];
                    that._server.send(buf, 0, buf.length, port, addr);
                }
                that._queue = {};
            } catch (err) {
                logger.error(err);
            }
            that._sender();
        }, conf.sendInterval);
    }

    _onError(bind, error) {
        if (error.code === E_PORT_IN_USE) {
            bind.that._port += 1;
            bind.that.stop();
            bind.that._start(bind, bind.resolve, bind.reject);
            return;
        }
        logger.error('Mesh network node failed to start at', bind.that._addr, bind.that._port);
        bind.reject(error);
    }

    _onMessage(bind, buf, remote) {
        if (PING.equals(buf)) {
            // ping pong for communication test
            bind.that.send(remote.address, remote.port, PONG);
            return;
        }
        var bufs = [];
        if (conf.sendInterval > 0) {
            var index = buf.indexOf(DELIMITER);
            while (index > -1) {
                var sliced = buf.slice(0, index);
                if (sliced.length > 0) {
                    bufs.push(sliced);
                }
                buf = buf.slice(index + DLEN);
                index = buf.indexOf(DELIMITER);
            }
        } else {
            bufs.push(buf);
        }
        var listeners = bind.that._onMessageListeners;
        for (var j = 0, jen = bufs.length; j < jen; j++) {
            for (var i = 0, len = listeners.length; i < len; i++) {
                listeners[i](bufs[j], remote);
            }
        }
    }

}

module.exports = UdpEngine;

