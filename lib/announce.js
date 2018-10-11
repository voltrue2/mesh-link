'use strict';

const redis = require('redis');
const so = require('./so');

const PREFIX = '@mlink/';
/*
const SCAN_COUNT = 1000;
const MATCH = 'MATCH';
const COUNT = 'COUNT';
*/

const values = { data: {}, so: 0 };

var UPDATE_INTERVAL = 1000;
var TTL = _getTTL();
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
    } else {
        PX += '/';
    }
    if (conf && conf.updateInterval) {
        UPDATE_INTERVAL = conf.updateInterval;
        TTL = _getTTL();
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

function stop(cb) {
    client.quit();
    if (Promise && !cb) {
        return new Promise(_onStop);
    }
    _onStop(cb);
}

function _onStop(resolve) {
    setTimeout(resolve, (TTL * 2) * 1000);
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
    var announceKey = _createAnnounceKey();
    var announceValue = _createAnnounceValue();
    // announce myself with a TTL
    var multi = client.multi();
    multi.set(announceKey, announceValue);
    multi.expire(announceKey, TTL);
    multi.exec(_scanAnnounceKeys);
}

function _scanAnnounceKeys(error) {
    if (error) {
        // abort scan...
        _setupUpdate();
        return;
    }
    /*
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
    */
    // according to the documentation scan is better than keys but it seems keys is faster...
    // https://redis.io/commands/keys
    client.keys(PATTERN, (error, keys) => {
        if (error) {
            // error... we abort the scan...
            _setupUpdate();
            return;
        }
        _readAnnounceValues(keys);
    });
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
        if (list.length === 0) {
            // if we get nothing from redis, keep the cache as is
            _setupUpdate();
            return;
        }
        try {
            // initialize cache
            cache = {};
            // populate cache
            var i;
            var len;
            for (i = 0, len = list.length; i < len; i++) {
                if (!list[i]) {
                    continue;
                }
                var parsed = _parseAnnounceKey(keys[i]);
                var item = JSON.parse(list[i]);
                var key = _createCacheKey(parsed.address, parsed.port);
                if (parsed.address === info.address && parsed.port === info.port) {
                    item._self = true;
                } else {
                    item._self = false;
                }
                item.node = parsed;
                cache[key] = item;
            }
        } catch (error) {
            // well error...
        }
        _setupUpdate();
        var res = JSON.parse(JSON.stringify(cache));
        for (i = 0, len = _onUpdatedCallbacks.length; i < len; i++) {
            _onUpdatedCallbacks[i](res);
        }
    });
}

function _parseAnnounceKey(key) {
    var list = key.split('/');
    return {
        address: list[2],
        port: list[3]
    };
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
    values.so = so.getNumOfSharedObjects();
    return JSON.stringify(values);
}

function _getTTL() {
    return Math.floor( (UPDATE_INTERVAL * 2) / 1000 );
}

