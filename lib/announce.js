'use strict';

const redis = require('redis');

const PREFIX = '@mlink/';
const UPDATE_INTERVAL = 1000;
const SCAN_COUNT = 1000;
const PATTERN = PREFIX + '*';
const MATCH = 'MATCH';
const COUNT = 'COUNT';

const cache = {};
const values = { node: { address: null, port: 0 }, data: {} };

var PX = PREFIX;
var info;
var client;
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
    info = _info;
    values.node.address = info.address;
    values.node.port = info.port;
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
        res.push(_parseCacheKey(keys[i]));
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
    _setupUpdate();
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
    var announceKey = _createAnnounceKey();
    var announceValue = _createAnnounceValue();
    // TTL is 10 seconds
    var ttl = UPDATE_INTERVAL / 100; 
    // announce myself with a TTL
    var multi = client.multi();
    multi.set(announceKey, announceValue);
    multi.expire(announceKey, ttl);
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
    var multi = client.multi();
    for (var i = 0, len = keys.length; i < len; i++) {
        multi.get(keys[i]);
    }
    multi.exec((error, list) => {
        if (error) {
            _setupUpdate();
            return;
        }
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
}

function _parseCacheKey(key) {
    var split = key.split('/');
    return { address: split[0], port: parseInt(split[1]) };
}

function _createCacheKey(addr, port) {
    return addr + '/' + port;
}

function _createAnnounceKey() {
    return _createCacheKey(PX + info.address, info.port);

}

function _createAnnounceValue() {
    return JSON.stringify(values);
}

