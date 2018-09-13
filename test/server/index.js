'use strict';

const dgram = require('dgram');
const mlink = require('../../');

const NAME = process.argv[2];
const PORT = process.argv[3];
const ADDR = '127.0.0.1';

const server = dgram.createSocket('udp4');

var ready = false;

mlink.onLogging((level, args) => {
    console.log.apply(console, args);
});

server.on('listening', onListening);
server.on('error', onError);
server.on('message', onMessage);
server.bind({
    port: PORT,
    address: ADDR,
    exclusive: true
});

function onListening() {
    mlink.setValue('name', NAME);
    // hello2two
    mlink.handler(1, (data, cb) => {
        var res = { message: data.message + ' world' };
        cb(res);
    });
    // foo2all
    mlink.handler(2, (data, cb) => {
        var res = { message: data.message + ' bar' };
        cb(res);
        var buf = Buffer.from(JSON.stringify(res));
        server.send(buf, 0, buf.length, data.port, data.addr);
    });
    // responseTimeout
    mlink.handler(3, () => {
        // do nothing intentionally...
    });
    // set up mesh-link
    var conf = {
        nic: 'eth0',
        address: '127.0.0.1',
        port: 4000,
        prefix: '__test__',
        relayLimit: 1,
        logger: { enable: true }
    };
    mlink.start(conf)
        .then(() => {
            // ready
            console.log('server "' + NAME + '" at port', PORT, 'ready');
            ready = true;
        })
        .catch((error) => {
            // failed...
            process.exit(1);
        });
}

function onError(error) {
    console.error(NAME, PORT, 'failed to start:', error);
    process.exit(1);
}

function onMessage(buf, remote) {
    var cmd = buf.toString();
    switch (cmd) {
        case 'hello2two':
            var node = getNodeByName('two');
            if (node) {
                mlink.send(1, [ node ], { message: 'hello', from: NAME }, (error, res) => {
                    if (error) {
                        var err = Buffer.from(error.message);
                        server.send(err, 0, err.length, remote.port, remote.address);
                        return;
                    }
                    var buf2 = Buffer.from(JSON.stringify(res));
                    server.send(buf2, 0, buf2.length, remote.port, remote.address);
                });
            } else {
                var err2 = Buffer.from('node "two" not found');
                server.send(err2, 0, err2.length, remote.port, remote.address);
            }
        break;
        case 'foo2all':
            var nodes = mlink.getNodeEndPoints();
            if (!nodes.length) {
                var err2 = Buffer.from('nodes not found');
                server.send(err2, 0, err2.length, remote.port, remote.address);
                return;
            }
            mlink.send(2, nodes, { message: 'foo', addr: remote.address, port: remote.port }, (error, res) => {
                if (error) {
                    var err = Buffer.from(error.message);
                    server.send(err, 0, err.length, remote.port, remote.address);
                    return;
                }
                var buf2 = Buffer.from(JSON.stringify(res));
                server.send(buf2, 0, buf2.length, remote.port, remote.address);
            });
        break;
        case 'Uhello2two':
            var node = getNodeByName('two');
            if (node) {
                mlink.send(1, [ node ], { message: 'hello', from: NAME }, (error, res) => {
                    if (error) {
                        var err = Buffer.from(error.message);
                        server.send(err, 0, err.length, remote.port, remote.address);
                        return;
                    }
                    var buf2 = Buffer.from(JSON.stringify(res));
                    server.send(buf2, 0, buf2.length, remote.port, remote.address);
                });
            } else {
                var err2 = Buffer.from('node "two" not found');
                server.send(err2, 0, err2.length, remote.port, remote.address);
            }
        break;
        case 'Ufoo2all':
            var nodes = mlink.getNodeEndPoints();
            if (!nodes.length) {
                var err2 = Buffer.from('nodes not found');
                server.send(err2, 0, err2.length, remote.port, remote.address);
                return;
            }
            mlink.send(2, nodes, { message: 'foo', addr: remote.address, port: remote.port }, (error, res) => {
                if (error) {
                    var err = Buffer.from(error.message);
                    server.send(err, 0, err.length, remote.port, remote.address);
                    return;
                }
                var buf2 = Buffer.from(JSON.stringify(res));
                server.send(buf2, 0, buf2.length, remote.port, remote.address);
            });
        case 'responseTimeout':
            var node3 = getNodeByName('three');
            if (node3) {
                mlink.send(3, [ node3 ], { message: 'hello', from: NAME }, (error, res) => {
                    if (error) {
                        var err = Buffer.from(error.message);
                        server.send(err, 0, err.length, remote.port, remote.address);
                        return;
                    }
                    var buf2 = Buffer.from(JSON.stringify(res));
                    server.send(buf2, 0, buf2.length, remote.port, remote.address);
                });
            } else {
                var err3 = Buffer.from('node "three" not found');
                server.send(err3, 0, err3.length, remote.port, remote.address);
            }
        break;
    }
}

function getNodeByName(name) {
    var nodes = mlink.getNodeEndPoints();
    for (var i = 0, len = nodes.length; i < len; i++) {
        var value = mlink.getNodeValue(nodes[i].address, nodes[i].port, 'name');
        if (value === name) {
            return nodes[i];
        }
    }
    return null;
}

