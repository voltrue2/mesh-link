'use strict';
const dgram = require('dgram');
const assert = require('assert');
const { spawn } = require('child_process');
const NODE_PATH = __dirname + '/server';
const ONE = 'one';
const TWO = 'two';
const THREE = 'three';
const ADDR = '127.0.0.1';
const PORT_CLIENT = 4200;
const PORT_ONE = 4100;
const PORT_TWO = 4101;
const PORT_THREE = 7102;
const plist = [];
// we assume the last one is always the timeout value
const TIMEOUT = parseInt(process.argv[process.argv.length - 1]) - 1000;

var timer;

describe('mesh-link', () => {

    it('Can get back up candidate mesh nodes', () => {
        var me = { address: '127.0.0.1', port: 1234 };
        var backup = require('../lib/backup');
        backup.setup({ backups: { TypeTest: 3 } }, me);
        var nodes = [
            { address: '198.21.1.64', port: 5678 },
            { address: '255.255.255.255', port: 9012 },
            { address: '127.0.0.1', port: 3456 },
            { address: '192.44.1.56', port: 7890 },
            { address: '0.0.0.0', port: 1234 },
            { address: '192.44.1.55', port: 5678 },
            { address: '198.21.1.65', port: 9012 },
            { address: '192.44.1.53', prt: 3456 },
            { address: '198.21.1.61', port: 7890 }
        ];
        for (var k = 0, ken = nodes.length; k < ken; k++) {
            nodes[k].sortKey = backup.addrToNum(nodes[k].address);
        }
        backup.update({ TypeTest: nodes });
        var res = backup.get('TypeTest', me);

        console.log(me);
        console.log(res);

        for (var i = 0, len = res.length; i < len; i++) {
            assert.notEqual(me.address + me.port, res[i].address + res[i].port);
        }
        assert.equal(res[0].address + res[0].port, nodes[2].address + nodes[2].port);
        assert.equal(res[1].address + res[1].port, nodes[4].address + nodes[4].port);
        assert.equal(res[2].address + res[2].port, nodes[8].address + nodes[8].port);
    });

    it('Can start node "one"', (done) => {
        startTimer();
        startNode(ONE, PORT_ONE);
        setTimeout(bindDone(done), 1000);
    });

    it('Can start node "two"', (done) => {
        startTimer();
        startNode(TWO, PORT_TWO);
        setTimeout(bindDone(done), 1000);
    });

    it('Can wait 2000 seconds', (done) => {
        startTimer();
        setTimeout(bindDone(done), 2000);
    });

    it('Node "one" can send a message to node "two" and receive a response back', (done) => {
        startTimer();
        runClient('hello2two', PORT_ONE, (buf, next) => {
            try {
                var data = JSON.parse(buf);
            } catch (error) {
                console.error('Invalid JSON....', buf.toString());
                throw error;
            }
            eq(data.message, 'hello world', next);
        }, bindDone(done));
    });

    it('Node "one" can send an unreliable message to node "two" and receive a response back', (done) => {
        startTimer();
        runClient('Uhello2two', PORT_ONE, (buf, next) => {
            var data = JSON.parse(buf);
            eq(data.message, 'hello world', next);
        }, bindDone(done));
    });

    it('Can start node "three"', (done) => {
        startTimer();
        startNode(THREE, PORT_THREE);
        setTimeout(bindDone(done), 1000);
    });

    it('Can wait 2000 seconds', (done) => {
        startTimer();
        setTimeout(bindDone(done), 2000);
    });

    it('Node "two" can create a shared object and see that local and remote are completely in sync', (done) => {
        startTimer();
        runClient('createSO', PORT_TWO, (buf, next) => {
            var list = JSON.parse(buf);
            var two = list[0];
            var one = list[1];
            eq(two, one, next);
        }, bindDone(done));
    });

    it('Node "two" can create and update shared object locally and from another node and see that it is in sync', (done) => {
        startTimer();
        runClient('updateSO', PORT_TWO, (buf, next) => {
            var list = JSON.parse(buf);
            var ctwo = list[0];
            var cone = list[1];
            var cthree = list[2];
            var mtwo = JSON.stringify(list[3]);
            var mone = JSON.stringify(list[4]);
            var mthree = JSON.stringify(list[5]);
            eq(ctwo, cone, () => {
                eq(cone, cthree, () => {
                    eq(mtwo, mone, () => {
                        eq(mone, mthree, next);
                    });
                });
            });
        }, bindDone(done));
    });

    it('Can wait for 5 seconds', (done) => {
        startTimer();
        setTimeout(bindDone(done), 5000);
    });

    it('All nodes have no more shared objects b/c they have expired', (done) => {
        startTimer();
        runClient('noSO', PORT_TWO, (buf, next) => {
            var list = JSON.parse(buf);
            var two = list[0];
            var one = list[1];
            var three = list[2];
            eq(two, 0, () => {
                eq(two, one, () => {
                    eq(one, three, next);
                });
            });
        }, bindDone(done));
    });

    it('Node "three" can send a message to all nodes and receive a response back', (done) => {
        startTimer();
        var timeout = setTimeout(() => {
            stopAllNodes();
            setTimeout(() => {
                throw new Error('Time Out...');
            }, 100 * plist.length);
        }, 2000);
        var count = 0;
        var msg = '';
        runClient('foo2all', PORT_THREE, (buf, next) => {
            count += 1;
            var data = JSON.parse(buf);
            msg += '/' + data.message;
            if (count === 4) {
                eq(msg, '/foo bar/foo bar/foo bar/foo bar', next);
            }
            clearTimeout(timeout);
        }, bindDone(done));
    });

    it('Node "three" can send an unreliable message to all nodes and receive a response back', (done) => {
        startTimer();
        var timeout = setTimeout(() => {
            stopAllNodes();
            setTimeout(() => {
                throw new Error('Time Out...');
            }, 100 * plist.length);
        }, 2000);
        var count = 0;
        var msg = '';
        runClient('Ufoo2all', PORT_THREE, (buf, next) => {
            count += 1;
            var data = JSON.parse(buf);
            msg += '/' + data.message;
            if (count === 4) {
                eq(msg, '/foo bar/foo bar/foo bar/foo bar', next);
            }
            clearTimeout(timeout);
        }, bindDone(done));
    });

    it('Node "three" can send a relay message to all nodes including a defect node, but all nodes receives the message', (done) => {
        startTimer();
        var timeout = setTimeout(() => {
            stopAllNodes();
            setTimeout(() => {
                throw new Error('Time Out...');
            }, 1000 * plist.length);
        }, 5000);
        runClient('relayWithOneDefectNode', PORT_THREE, (buf, next) => {
            var msg = buf.toString();
            var expected = JSON.stringify([ 'GOOD', 'GOOD', 'GOOD' ]);
            eq(msg, expected, next);
            clearTimeout(timeout);
        }, bindDone(done));
    });

    it('Node "two" can send a message to node "three", but response times out', (done) => {
        startTimer();
        runClient('responseTimeout', PORT_TWO, (buf, next) => {
            eq(buf.toString(), 'Reliable message response timed out - handler ID: 3 - destination: 127.0.0.1 4002', next);
        }, bindDone(done));
    });

    it('Node "one" can save data on its backup nodes', (done) => {
        startTimer();
        runClient('saveOnBackupNodes', PORT_TWO, (buf, next) => {
            var msg = buf.toString();
            eq(msg, 'I have a dream', next);
        }, bindDone(done));
    });

    it('Node "one" can pause announcement to remove itself from the available mesh node list', (done) => {
        startTimer();
        runClient('pauseAnnouncementOfOne', PORT_ONE, (buf, next) => {
            var res = JSON.parse(buf);
            eq(res.message, 'AnnouncementPaused', next);
        }, bindDone(done));
    });

    it('One of the backups of node "one" can return the saved data', (done) => {
        startTimer();
        runClient('getThingFromBackup', PORT_TWO, (buf, next) => {
            var res = JSON.parse(buf);
            eq(res.thing.message, 'I have a dream', next);
        }, bindDone(done));
    });

    it('Can stop all nodes', (done) => {
        stopAllNodes();
        setTimeout(done, 100 * plist.length);
    });

    it('Can run performance test on backup', () => {
        var me = { address: '127.0.0.1', port: 1234 };
        var backup = require('../lib/backup');
        backup.setup({ backups: { TypeTest: 3 } }, me);
        var nodes = [ me ];
        var total = 300;
        for (var i = 0; i < total; i++) {
            var node = { sortKey: backup.addrToNum(i + '.0.0.0'), address: i + '.0.0.0', port: i +1000 };
            nodes.push(node);
        }
        backup.update({ TypeTest: nodes });
        var start = Date.now();
        var res;
        var loop = 100000;
        for (var j = 0; j < loop; j++) {
            res = backup.get('TypeTest', me);
        }
        var time = Date.now() - start;
        console.log('Calculating backups over', total, 'mesh nodes', loop, 'times took', time + 'ms');
        for (var i = 0, len = res.length; i < len; i++) {
            assert.notEqual(me.address, res[i].address);
        }
        assert.equal(res[0].address, nodes[129].address);
        assert.equal(res[1].address, nodes[128].address);
        assert.equal(res[2].address, nodes[130].address);
    });

});

function eq(expected, actual, cb) {
    try {
        console.log(expected, '==', actual);
        assert.equal(expected, actual);
        cb();
    } catch (error) {
        console.error(error);
        stopAllNodes();
        setTimeout(() => {
            process.exit(1);
        }, 100 * plist.length);
    }
}

function runClient(cmd, port, test, done) {
    var client = dgram.createSocket('udp4');
    client.on('listening', () => {
        console.log('Client is ready - sending a command:', cmd, port);
        var buf = Buffer.from(cmd);
        client.send(buf, 0, buf.length, port, ADDR);
    });
    client.on('error', (error) => {
        throw error;
    });
    client.on('message', (buf) => {
        try {
            test(buf, () => {
                try {
                    client.close();
                } catch (err) {
                    // oh well...
                }
                console.log('Client stopped');
                done();
            });
        } catch (error) {
            client.close();
            console.log('Client stopped with an error:', error);
            stopAllNodes();
            setTimeout(() => {
                process.exit(1);
            }, 100 * plist.length);
        }
    });
    client.bind({
        port: PORT_CLIENT,
        address: ADDR,
        exclusive: true
    });
    return client;
}

function startTimer() {
    timer = setTimeout(() => {
        stopAllNodes();
        setTimeout(() => {
            throw new Error('Test timed out');
        }, 100 * plist.length);
    }, TIMEOUT);
}

function stopTimer() {
    clearTimeout(timer);
}

function bindDone(done) {
    return function _done(error) {
        stopTimer();
        done(error);
    };
}

function startNode(name, port) {
    var path = process.execPath;
    var cmd = [ NODE_PATH, name, port ];
    var params = { detached: true, stdio: [ 0, 'pipe', 'pipe' ] };
    var p = spawn(path, cmd, params);
    p.stdout.on('data', (data) => {
        process.stdout.write('> ' + data.toString());
    });
    p.stderr.on('data', (error) => {
        process.stderr.write('error: ' + error.toString());
    });
    p.on('close', (code) => {
        console.log('$ node stopped', name, port, 'code:', code);
    });
    plist.push(p);
}

function stopAllNodes() {
    console.log('stop all nodes...');
    for (var i = 0, len = plist.length; i < len; i++) {
        stopNode(plist[i]);
    }
}

function stopNode(p) {
    p.kill('SIGTERM');
}

