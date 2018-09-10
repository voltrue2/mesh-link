'use strict';
const dgram = require('dgram');
const assert = require('assert');
const { spawn } = require('child_process');
const NODE_PATH = __dirname + '/server';
const ONE = 'one';
const TWO = 'two';
const THREE = 'three';
const ADDR = '127.0.0.1';
const PORT_CLIENT = 7200;
const PORT_ONE = 7100;
const PORT_TWO = 7101;
const PORT_THREE = 7102;
const plist = [];

describe('mesh-link', () => {

    it('Can start node "one"', (done) => {
        startNode(ONE, PORT_ONE);
        setTimeout(done, 1000);
    });

    it('Can start node "two"', (done) => {
        startNode(TWO, PORT_TWO);
        setTimeout(done, 1000);
    });

    it('Can wait 2000 seconds', (done) => {
        setTimeout(done, 2000);
    });

    it('Node "one" can send a message to node "two" and receive a response back', (done) => {
        createClient('hello2two', PORT_ONE, (buf, next) => {
            var data = JSON.parse(buf);
            eq(data.message, 'hello world', next);
        }, done);
    });

    it('Node "one" can send an unreliable message to node "two" and receive a response back', (done) => {
        createClient('Uhello2two', PORT_ONE, (buf, next) => {
            var data = JSON.parse(buf);
            eq(data.message, 'hello world', next);
        }, done);
    });

    it('Can start node "three"', (done) => {
        startNode(THREE, PORT_THREE);
        setTimeout(done, 1000);
    });

    it('Can wait 2000 seconds', (done) => {
        setTimeout(done, 2000);
    });

    it('Node "three" can send a message to all nodes and receive a response back', (done) => {
        setTimeout(() => {
            stopAllNodes();
            setTimeout(() => {
                throw new Error('Time Out...');
            }, 100 * plist.length);
        }, 2000);
        var count = 0;
        var msg = '';
        createClient('foo2all', PORT_THREE, (buf, next) => {
            count += 1;
            var data = JSON.parse(buf);
            msg += '/' + data.message;
            if (count === 4) {
                eq(msg, '/foo bar/foo bar/foo bar/foo bar', next);
            }
        }, done);
    });

    it('Node "three" can send an unreliable message to all nodes and receive a response back', (done) => {
        setTimeout(() => {
            stopAllNodes();
            setTimeout(() => {
                throw new Error('Time Out...');
            }, 100 * plist.length);
        }, 2000);
        var count = 0;
        var msg = '';
        createClient('Ufoo2all', PORT_THREE, (buf, next) => {
            count += 1;
            var data = JSON.parse(buf);
            msg += '/' + data.message;
            if (count === 4) {
                eq(msg, '/foo bar/foo bar/foo bar/foo bar', next);
            }
        }, done);
    });

    it('Can stop all nodes', (done) => {
        stopAllNodes();
        setTimeout(done, 100 * plist.length);
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

function createClient(cmd, port, test, done) {
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
        test(buf, () => {
            client.close();
            console.log('Client stopped');
            done();
        });
    });
    client.bind({
        port: PORT_CLIENT,
        address: ADDR,
        exclusive: true
    });
    return client;
}

function startNode(name, port) {
    var path = process.execPath;
    var cmd = [ NODE_PATH, name, port ];
    var params = { detached: true, stdio: [ 0, 'pipe', 'pipe' ] };
    var p = spawn(path, cmd, );
    p.stdout.on('data', (data) => {
        console.log(data.toString());
    });
    p.stderr.on('data', (error) => {
        console.error('error:', error.toString());
    });
    p.on('close', () => {
        console.log('node stopped', name, port);
    });
    plist.push(p);
}

function stopAllNodes() {
    for (var i = 0, len = plist.length; i < len; i++) {
        stopNode(plist[i]);
    }
}

function stopNode(p) {
    p.kill('SIGTERM');
}

