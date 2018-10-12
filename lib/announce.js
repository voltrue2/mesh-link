'use strict';

const redis = require('redis');
const so = require('./so');
const compressor = require('./compressor');
const logger = require('./logger');

const DELIMITER = '`';
const PREFIX = '@mlink' + DELIMITER;
/*
const SCAN_COUNT = 1000;
const MATCH = 'MATCH';
const COUNT = 'COUNT';
*/

const values = { data: {} };

var UPDATE_INTERVAL = 1000;
var TTL = _getTTL();
var PX = PREFIX;
var PATTERN;
var info;
var client;
var cache = {};
var _onUpdateCallbacks = [];
var _onUpdatedCallbacks = [];
var _stopUpdate = false;

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
        PX += conf.prefix + DELIMITER;
    } else {
        PX += DELIMITER;
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
    logger.info('<announce>Stop');
    _stopUpdate = true;
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
    if (_stopUpdate) {
        logger.info('<announce>Update stopped');
        return;
    }
    try {
        for (var i = 0, len = _onUpdateCallbacks.length; i < len; i++) {
            _onUpdateCallbacks[i]();    
        }
    } catch (e) {
        // we make sure _update() does not die with an exception...
    }
    var announceKey = _createAnnounceKey();
    // announce myself with a TTL
    var multi = client.multi();
    multi.set(announceKey, '');
    multi.expire(announceKey, TTL);
    multi.exec(_scanAnnounceKeys);
}

function _scanAnnounceKeys(error) {
    if (error) {
        logger.error('<announce>Failed to announce:', error);
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
            logger.error('<announce>Failed to scan:', error);
            // error... we abort the scan...
            _setupUpdate();
            return;
        }
        _readAnnounceValues(keys);
    });
}

function _readAnnounceValues(keys) {
    if (keys.length === 0) {
        // we found no keys at all: keep the cache
        _setupUpdate();
        return;
    }
    // initialize cache
    cache = {};
    // populate cache
    var i;
    var len;
    for (i = 0, len = keys.length; i < len; i++) {
        if (!keys[i]) {
            continue;
        }
        var values = _parseAnnounceKey(keys[i]);
        var key = _createCacheKey(values.node.address, values.node.port);
        // default _self is false
        if (values.node.address === info.address && values.node.port === info.port) {
            values._self = true;
        }
        cache[key] = values;
    }
    // schedule next update
    _setupUpdate();
    // deep copy to avoid contaminating the original cache data
    var res = JSON.parse(JSON.stringify(cache));
    for (i = 0, len = _onUpdatedCallbacks.length; i < len; i++) {
        _onUpdatedCallbacks[i](res);
    }
}

function _parseAnnounceKey(key) {
    var list = key.split(DELIMITER);
    return {
        node: {
            address: list[2],
            port: list[3]
        },
        data: compressor.unpack(list[4]),
        so: parseInt(list[5]),
        _self: false
    };
}

function _parseCacheKey(key) {
    var split = key.split(DELIMITER);
    return { address: split[0], port: parseInt(split[1]) };
}

function _createCacheKey(addr, port) {
    return addr + DELIMITER + port;
}

function _createAnnounceKey() {
    return _createCacheKey(PX + info.address, info.port) +
        DELIMITER + _createAnnounceValue();

}

function _createAnnounceValue() {
    var cdata = compressor.pack(values.data);
    return cdata + DELIMITER + so.getNumOfSharedObjects();
}

function _getTTL() {
    return Math.floor( (UPDATE_INTERVAL * 2) / 1000 );
}

