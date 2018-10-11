'use strict';

const redis = require('redis');
const so = require('./so');

const PREFIX = '@mlink/';
const UPDATE_INTERVAL = 1000;
const TTL = Math.floor( (UPDATE_INTERVAL * 2) / 1000); // this is in seconds
const SCAN_COUNT = 1000;
const MATCH = 'MATCH';
const COUNT = 'COUNT';

const values = { data: {}, so: 0 };

var PX = PREFIX;
var PATTERN;
var info;
var client;
var cache = {};
var _onUpdateCallbacks = [];
var _onUpdatedCallbacks = [];

module.exports = {
    start: start,
    setValue: setValue,
    getNodeValue: getNodeValue,
    getNodeEndPoints: getNodeEndPoints,
    getNodes: getNodes,
    nodeExists: nodeExists,
    isLocalNode: isLocalNode,
    onUpdate: onUpdate,
    onUpdated: onUpdated,
    stop: stop
};

// _info comes from delivery
function start(_info, conf, cb) {
    if (conf && conf.prefix) {
        PX += conf.prefix + '/';
    }
    PATTERN = PX + '*';
    info = _info;
    // set up shared object
    so.setup(conf);
    // Promise or callback
    if (!cb) {
        return new Promise(_start.bind(null, conf.redis));
    }
    _start(cb, cb);
}

function setValue(name, value) {
    values.data[name] = value;
} 

function getNodeValue(addr, port, name) {
    var key = _createCacheKey(addr, port);
    if (cache[key]) {
        if (cache[key].data[name]) {
            return JSON.parse(JSON.stringify(cache[key].data[name]));
        }
    }
    return null;
}

function getNodeEndPoints() {
    var keys = Object.keys(cache);
    var res = [];
    for (var i = 0, len = keys.length; i < len; i++) {
        res.push({
            address: cache[keys[i]].node.address,
            port: cache[keys[i]].node.port
        });
    }
    return res;
}

function getNodes() {
    return JSON.parse(JSON.stringify(cache));
}

function nodeExists(addr, port) {
    var key = _createCacheKey(addr, port);
    if (cache[key]) {
        return true;
    }
    return false;
}

function isLocalNode(addr, port) {
    var key = _createCacheKey(addr, port);
    if (cache[key] && cache[key]._self) {
        return true;
    }
    return false;
}

function stop() {
    client.quit();
}

function onUpdate(callback) {
    _onUpdateCallbacks.push(callback);
}

function onUpdated(callback) {
    _onUpdatedCallbacks.push(callback);
}

function _start(conf, resolve, reject) {
    // connect to redis: docs https://github.com/NodeRedis/node_redis#rediscreateclient
    client = redis.createClient(conf);
    client.on('ready', _onStart.bind(null, { resolve: resolve }));
    client.on('error', reject);
}

function _onStart(bind) {
    _update();
    bind.resolve();
}

function _setupUpdate() {
    setTimeout(_update, UPDATE_INTERVAL);
}

function _update() {
    try {
        for (var i = 0, len = _onUpdateCallbacks.length; i < len; i++) {
            _onUpdateCallbacks[i]();    
        }
    } catch (e) {
        // we make sure _update() does not die with an exception...
    }
    // announceKey includes values
    var announceKey = _createAnnounceKey();
    // announce myself with a TTL
    var multi = client.multi();
    multi.set(announceKey, '1');
    multi.expire(announceKey, TTL);
    multi.exec(_scanAnnounceKeys);
}

function _scanAnnounceKeys(error) {
    if (error) {
        // abort scan...
        _setupUpdate();
        return;
    }
    // scan all announce keys
    var cursor = 0;
    var keys = [];
    // start scanning announce keys
    __scanner();
    function __scanner() {
        client.scan(cursor, MATCH, PATTERN, COUNT, SCAN_COUNT, (error, res) => {
            if (error) {
                // error... we abort the scan...
                _setupUpdate();
                return;
            }
            cursor = parseInt(res[0]);
            keys = keys.concat(res[1]);
            if (cursor !== 0) {
                return __scanner();
            }
            _readAnnounceValues(keys);
        });
    }
}

function _readAnnounceValues(keys) {
    /*
    var multi = client.multi();
    for (var i = 0, len = keys.length; i < len; i++) {
        multi.get(keys[i]);
    }
    multi.exec((error, list) => {
        if (error) {
            _setupUpdate();
            return;
        }
        // initialize cache
        cache = {};
        // populate cache
        var i;
        var len;
        for (i = 0, len = list.length; i < len; i++) {
            if (!list[i]) {
                continue;
            }
            var item = JSON.parse(list[i]);
            var addr = item.node.address;
            var port = item.node.port;
            var key = _createCacheKey(addr, port);
            if (addr === info.address && port === info.port) {
                item._self = true;
            } else {
                item._self = false;
            }
            cache[key] = item;
        }
        _setupUpdate();
        var res = JSON.parse(JSON.stringify(cache));
        for (i = 0, len = _onUpdatedCallbacks.length; i < len; i++) {
            _onUpdatedCallbacks[i](res);
        }
    });
    */
    // initialize cache
    cache = {};
    // populate cache
    for (var i = 0, len = keys.length; i < len; i++) {
        var parsed = _parseAnnounceKey(keys[i]);
        var time = parsed.time;
        var addr = parsed.address;
        var port = parsed.port;
        var values = parsed.values;
        var self = false;
        var key = _createCacheKey(addr, port);
        if (addr === info.address && port === info.port) {
            self = true;
        }
        if (cache[key] && cache[key].time > time) {
            // duplicate and old: ignore
            continue;
        }
        cache[key] = {
            node: { address: addr, port: port },
            data: values.data,
            so: values.so,
            _self: self
        };
    }
    _setupUpdate();
    var res = JSON.parse(JSON.stringify(cache));
    for (i = 0, len = _onUpdatedCallbacks.length; i < len; i++) {
        _onUpdatedCallbacks[i](res);
    }
}

function _parseAnnounceKey(key) {
    var list = key.split('/');
    // index 0 is the prefix
    // index 1 is the custom prefix
    return {
        address: list[2],
        port: list[3], // we keep port as a string
        time: parseInt(list[4]),
        values: JSON.parse(Buffer.from(list[5], 'base64'))
    };
}

function _createCacheKey(addr, port) {
    return addr + '/' + port;
}

function _createAnnounceKey() {
    var keyHead =_createCacheKey(PX + info.address, info.port);
    var time = Math.floor(Date.now() / 1000);
    var keyTail = _createAnnounceValue();
    return keyHead + '/' + time + '/' + keyTail;
}

function _createAnnounceValue() {
    values.so = so.getNumOfSharedObjects();
    return Buffer.from(JSON.stringify(values)).toString('base64');
}

