'use strict';

const dgram = require('dgram');
const mlink = require('../../');

const NAME = process.argv[2];
const PORT = process.argv[3];
const ADDR = '127.0.0.1';
const SO_TTL = 5000;
const BAD_PORT = 9999;

const server = dgram.createSocket('udp4');

var ready = false;
var remember;
var thingToSave;
var cachedNodes = {};

process.on('SIGINT', () => {
    mlink.stop(() => {
        process.exit(0);
    });
});

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
    // createSO
    mlink.handler(4, (data, cb) => {
        var mid = data.mid;
        mlink.sharedObject.get(mid)
            .then((so) => {
                cb({ count: so.get('count'), map: so.get('map') });
            })
            .catch(cb);
    });
    // upateSO
    mlink.handler(5, (data, cb) => {
        var mid = data.mid;
        mlink.sharedObject.get(mid, (error, so) => {
            if (error) {
                return cb(error);
            }
            so.multi([
                so.inc('count', 1),
                so.inc('count', -1),
                so.inc('count', 1),
                so.inc('count', 1),
                so.add('map', 'three', 3),
                so.inc('count', -1),
                so.inc('count', 1),
                so.inc('count', -1),
                so.del('map', 'two'),
                so.inc('count', 1),
                so.inc('count', -1)
            ])
            .then(() => {
                cb({
                    count: so.get('count'),
                    map: so.get('map')
                });
            })
            .catch((error) => {
                cb(error);
            });
        });
    });
    // noSO
    mlink.handler(6, (nothing, cb) => {
        cb({ num: mlink.sharedObject.getNumOfSharedObjects() });
    });
    // set up mesh-link
    var conf = {
        redis: {
            multi: {
                master: { host: '127.0.0.1', port: 6379 },
                slave: { host: 'localhost', port: 6379 }
            }
            /*
            host: '127.0.0.1',
            port: 6379
            */
        },
        backups: {
            TypeTest: 3,
        },
        useHash: false,
        useSharedObject: true,
        cleanInterval: 1000,
        nic: 'eth0',
        strict: false,
        address: '127.0.0.1',
        port: 4000,
        prefix: '__test__',
        relayLimit: 1,
        timeout: 10000,
        logger: { enable: true }
    };
    // relayWithOneDefectNode
    mlink.handler(7, (data) => {
        remember = data;
    });
    // relayWithOneDefectNode
    mlink.handler(8, (nothing, cb) => {
        cb(remember);
    });
    // saveOnBackupNodes
    mlink.handler(9, (_thingToSave, cb) => {
        thingToSave = _thingToSave;
        var backups = mlink.getBackupNodes();
        console.log('----> Save on backups also:', thingToSave, backups, PORT);
        mlink.send(10, backups, thingToSave);
        cb();
    });
    // saveOnBackupNodes
    mlink.handler(10, (_thingToSave) => {
        thingToSave = _thingToSave;
        console.log('----> Backup save:', thingToSave, mlink.info(), PORT);
    });
    // getThingFromBackup
    mlink.handler(11, (nothing, cb) => {
        console.log('----> Get from backup', thingToSave, mlink.info(), PORT);
        cb({ thing: thingToSave, info: mlink.info() });
    });
    // getSender
    mlink.handler(12, function (nothing, cb) {
        console.log(JSON.stringify(this));
        cb(this.sender);
    });
    mlink.onNewNodes((nodes) => {
        console.log('New mesh nodes detected:', nodes);
    });
    mlink.setType('TypeTest');
    mlink.start(conf)
        .then(() => {
            // ready
            console.log('server "' + NAME + '" at port', PORT, 'ready');
            ready = true;
        })
        .catch((error) => {
            // failed...
            console.error(error);
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
        break;
        case 'responseTimeout':
            var node3 = getNodeByName('three');
            if (node3) {
                mlink.send(3, [ node3 ], { message: 'hello', from: NAME }, (error, res) => {
                    if (error) {
                        var err = Buffer.from(error.message);
                        server.send(err, 0, err.length, remote.port, remote.address);
                        return;
                    }
                    var buf3 = Buffer.from(JSON.stringify(res));
                    server.send(buf3, 0, buf3.length, remote.port, remote.address);
                });
            } else {
                var err3 = Buffer.from('node "three" not found');
                server.send(err3, 0, err3.length, remote.port, remote.address);
            }
        break;
        case 'createSO':
            var node = getNodeByName('one');
            if (node) {
                var first = mlink.sharedObject.create({
                    count: { value: 0, max: 3, min: 0 },
                    name: { value: 'first' },
                    map: { value: {} }
                }, SO_TTL, node);
                first.inc('count', 1, (error) => {
                        if (error) {
                            var buf5 = Buffer.from(JSON.stringify([ first.get('count'), res.count ]));
                            server.send(buf5, 0, buf5.length, remote.port, remote.address);
                        }
                    mlink.send(4, [ node ], { mid: first.mid }, (error, res) => {
                        if (error) {
                            var err = Buffer.from(error.message);
                            server.send(err, 0, err.length, remote.port, remote.address);
                            return;
                        }
                        var buf3 = Buffer.from(JSON.stringify([ first.get('count'), res.count ]));
                        server.send(buf3, 0, buf3.length, remote.port, remote.address);
                    });
                });
            } else {
                var err4 = Buffer.from('node "one" not found');
                server.send(err4, 0, err4.length, remote.port, remote.address);
            }
        break;
        case 'updateSO':
            var node = getNodeByName('one');
            if (node) {
                var second = mlink.sharedObject.create({
                    count: { value: 0, max: 20, min: 0 },
                    name: { value: 'first' },
                    map: { value: {} }
                }, SO_TTL, node);
                second.add('map', 'one', 1);
                second.add('map', 'two', 2);
                second.inc('count', 1);
                second.inc('count', 1);
                second.inc('count', -1);
                second.inc('count', 1);
                second.inc('count', 1);
                second.inc('count', -1);
                second.inc('count', -1);
                second.inc('count', 1);
                second.inc('count', -1);
                setTimeout(() => {
                    second.inc('count', 1);
                    second.inc('count', -1);
                    second.inc('count', 1);
                    second.inc('count', -1);
                    second.inc('count', -1);
                    second.inc('count', 1);
                    second.del('map', 'one');
                    second.inc('count', -1);
                    second.inc('count', -1);
                    second.inc('count', -1);
                    second.inc('count', 1);
                    second.add('map', 'four', 4)
                        .then(() => {
                            var node2 = getNodeByName('three');
                            mlink.send(5, [ node2 ], { mid: second.mid }, (error, res) => {
                                if (error) {
                                    var err = Buffer.from(error.message + '\n' + error.stack);
                                    server.send(err, 0, err.length, remote.port, remote.address);
                                    return;
                                }
                                setTimeout(() => {
                                    mlink.send(4, [ node ], { mid: second.mid }, (error, res2) => {
                                        var buf4 = Buffer.from(JSON.stringify([
                                            second.get('count'), res.count, res2.count,
                                            second.get('map'), res.map, res2.map
                                        ]));
                                        server.send(buf4, 0, buf4.length, remote.port, remote.address);
                                    });
                                }, 100);
                            });
                        })
                        .catch((error) => {
                            var err = Buffer.from(error.message + '\n' + error.stack);
                            server.send(err, 0, err.length, remote.port, remote.address);
                        });
                }, 10);
            } else {
                var err4 = Buffer.from('node "one" not found');
                server.send(err4, 0, err4.length, remote.port, remote.address);
            }
        break;
        case 'noSO':
            setTimeout(() => {
                var node = getNodeByName('one');
                mlink.send(6, [ node ], {}, (error, res) => {
                    if (error) {
                        var err = Buffer.from(error.message);
                        server.send(err, 0, err.length, remote.port, remote.address);
                        return;
                    }
                    node = getNodeByName('two');
                    mlink.send(6, node, {}, (error, res2) => {
                        if (error) {
                            var err = Buffer.from(error.message);
                            server.send(err, 0, err.length, remote.port, remote.address);
                            return;
                        }
                        node = getNodeByName('three');
                        mlink.send(6, node, {}, (error, res3) => {
                            if (error) {
                                var err = Buffer.from(error.message);
                                server.send(err, 0, err.length, remote.port, remote.address);
                                return;
                            }
                            var buf = Buffer.from(JSON.stringify([ res.num, res2.num, res3.num ]));
                            server.send(buf, 0, buf.length, remote.port, remote.address);
                        }); 
                    });
                });
            }, SO_TTL);
        break;
        case 'relayWithOneDefectNode':
            var nodes = [
                { address: ADDR, port: BAD_PORT },
                getNodeByName('one'),
                getNodeByName('two'),
                getNodeByName('three')
            ];
            mlink.send(7, nodes, { message: 'GOOD' });
            setTimeout(() => {
                var messages = [];
                mlink.send(8, nodes[1], {}, (error, res) => {
                    if (error) {
                        var err = Buffer.from(error.message);
                        server.send(err, 0, err.length, remote.port, remote.address);
                        return;
                    }
                    messages.push(res.message);
                    mlink.send(8, nodes[2], {}, (error, res) => {
                        if (error) {
                            var err = Buffer.from(error.message);
                            server.send(err, 0, err.length, remote.port, remote.address);
                            return;
                        }
                        messages.push(res.message);
                        mlink.send(8, nodes[3], {}, (error, res) => {
                            if (error) {
                                var err = Buffer.from(error.message);
                                server.send(err, 0, err.length, remote.port, remote.address);
                                return;
                            }
                            messages.push(res.message);
                            var buf = Buffer.from(JSON.stringify(messages));
                            server.send(buf, 0, buf.length, remote.port, remote.address);
                        });
                    });
                });
            }, 3000);
        break;
        case 'saveOnBackupNodes':
            var node = getNodeByName('one');
            var messageToSave = 'I have a dream';
            mlink.send(9, [ node ], { message: messageToSave });
            setTimeout(() => {
                var buf = Buffer.from(messageToSave);
                server.send(buf, 0, buf.length, remote.port, remote.address);
            }, 3000);
        break;
        case 'pauseAnnouncementOfOne':
            mlink._pauseAnnouncement();
            setTimeout(() => {
                var buf = Buffer.from(JSON.stringify({
                    message: 'AnnouncementPaused',
                }));
                server.send(buf, 0, buf.length, remote.port, remote.address);
            }, 3000);
        break;
        case 'getThingFromBackup':
            var node = getNodeByName('one');
            mlink.send(11, mlink.prepareNodes(mlink.getType(), node), {}, (error, res) => {
                if (error) {
                    var err = Buffer.from(error.message);
                    server.send(err, 0, err.length, remote.port, remote.address);
                    return;
                }
                var buf = Buffer.from(JSON.stringify(res));
                server.send(buf, 0, buf.length, remote.port, remote.address);
            });
        break;
        case 'getSender':
            var node = getNodeByName('one');
            mlink.send(12, [node], {}, (error, res) => {
                if (error) {
                    console.error('getSender receive error', error.message);
                    var err = Buffer.from(error.message);
                    server.send(err, 0, err.length, remote.port, remote.address);
                    return;
                }
                var buf = Buffer.from(JSON.stringify(res));
                server.send(buf, 0, buf.length, remote.port, remote.address);
            });
            break;
    }
}

function getNodeByName(name) {
    // we intentionally use cache here so that we can run tests on mesh nodes
    // that are no longer available and such...
    if (cachedNodes[name]) {
        return cachedNodes[name];
    }
    var nodes = mlink.getNodeEndPoints();
    for (var i = 0, len = nodes.length; i < len; i++) {
        var value = mlink.getNodeValue(nodes[i].address, nodes[i].port, 'name');
        if (value === name) {
            cachedNodes[name] = nodes[i];
            return nodes[i];
        }
    }
    return null;
}

