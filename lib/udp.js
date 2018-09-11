'use strict';

const os = require('os');
const networkInterfaces = os.networkInterfaces() || {};
const dgram = require('dgram');
const logger = require('./logger');

const LOCALHOST = '127.0.0.1';
const E_PORT_IN_USE = 'EADDRINUSE';
const PING = Buffer.from('ping');
const PONG = Buffer.from('PONG\n');

const conf = {
    nic: 'eth0',
    addr: LOCALHOST,
    port: 8100
};

class UdpEngine {

    constructor(addr, port) {
        this._addr = addr || conf.addr;
        this._port = port || conf.port;
        this._server = null;
        this._onMessageListeners = [];
    }

    static setNetworkInterfaceName(nic) {
        conf.nic = nic;
        conf.addr = networkInterfaces[conf.nic] || LOCALHOST;
        logger.info(
            'Target network interface is set to:', nic,
            'interface:', (networkInterfaces[conf.nic] || null),
            'address:', conf.addr
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
        logger.info('Mesh network node is ready at', that._addr, that._port);
        bind.resolve();
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
        var listeners = bind.that._onMessageListeners;
        for (var i = 0, len = listeners.length; i < len; i++) {
            listeners[i](buf, remote);
        }
    }

}

module.exports = UdpEngine;

