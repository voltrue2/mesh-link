'use strict';

const Redis = require('ioredis');
const so = require('./so');
const compressor = require('./compressor');
const dcopy = require('./dcopy');
const logger = require('./logger');
const backup = require('./backup');

const DELIMITER = '`';
const PREFIX = '@mlink' + DELIMITER;
const SCAN_COUNT = 1000;
const MATCH = 'MATCH';
const COUNT = 'COUNT';

const values = { type: 0, data: {} };

var UPDATE_INTERVAL = 1000;
var TTL = _getTTL();
var PX = PREFIX;
var PATTERN;
var info;
var client;
var cache = {};
var cacheByType = {};
var nodeEndPoints = [];
var _onUpdateCallbacks = [];
var _onUpdatedCallbacks = [];
var _onNewNodeCallbacks = [];
var _stopUpdate = false;

module.exports = {
    start: start,
    setValue: setValue,
    setType: setType,
    getType: getType,
    getNodeValue: getNodeValue,
    getNodeEndPoints: getNodeEndPoints,
    getNodes: getNodes,
    getNodesByType: getNodesByType,
    getBackupNodes: getBackupNodes,
    nodeExists: nodeExists,
    isLocalNode: isLocalNode,
    onUpdate: onUpdate,
    onUpdated: onUpdated,
    onNewNodes: onNewNodes,
    stop: stop,
    // this is used in tests ONLY
    _pause: _pause
};

// this is used ONLY in tests
function _pause() {
   _stopUpdate = true;
}

// _info comes from delivery
function start(_info, conf, cb) {
    if (conf && conf.prefix) {
        PX += conf.prefix + DELIMITER;
    } else {
        PX += DELIMITER;
    }
    if (conf && conf.updateInterval && conf.updateInterval >= UPDATE_INTERVAL) {
        UPDATE_INTERVAL = conf.updateInterval;
        TTL = _getTTL();
    }
    PATTERN = PX + '*';
    info = _info;
    // set up shared object
    so.setup(conf, info);
    // setup backup
    backup.setup(conf, info);
    // Promise or callback
    if (!cb) {
        return new Promise(_start.bind(null, conf.redis));
    }
    _start(cb, cb);
}

function setType(type) {
    values.type = type;
}

function setValue(name, value) {
    values.data[name] = value;
}

function getType() {
    return values.type;
}

function getNodeValue(addr, port, name) {
    var key = _createCacheKey(addr, port);
    if (cache[key]) {
        if (cache[key].data[name]) {
            return dcopy(cache[key].data[name]);
        }
    }
    return null;
}

function _createNodeEndPoints() {
    var keys = Object.keys(cache);
    var res = [];
    for (var i = 0, len = keys.length; i < len; i++) {
        res.push(_parseCacheKey(keys[i]));
    }
    nodeEndPoints = res;
}

function getBackupNodes(type, node) {
    return backup.get(type, node);
}

function getNodeEndPoints() {
    return nodeEndPoints.concat([]);
}

function getNodes() {
    return dcopy(cache);
}

function getNodesByType(type) {
    if (cacheByType[type]) {
        return dcopy(cacheByType[type]);
    }
    return [];
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

function onNewNodes(callback) {
    _onNewNodeCallbacks.push(callback);
}

function _start(conf, resolve, reject) {
    if (!conf) {
        conf = {};
    }
    if (!conf || (!conf.cluster && !conf.sentinel)) {
        logger.info('<announce>Connecting to Redis:', conf);
        // https://www.npmjs.com/package/ioredis#connect-to-redis
        client = new Redis(conf);
    } else if (conf.sentinel) {
        logger.info('<announce>Connecting to Redis Sentinel:', conf.sentinel);
        // https://www.npmjs.com/package/ioredis#sentinel
        client = new Redis(conf.sentinel);
    } else if (conf.cluster) {
        logger.info('<announce>Connecting to Redis Cluster:', conf.cluster);
        https://www.npmjs.com/package/ioredis#cluster
        client = new Redis.Cluster(conf.cluster);
    } else {
        return reject('<announce>Unknown mode for Redis ' + conf.mode);
    }
    client.on('ready', _onStart.bind(null, { resolve: resolve }));
    client.on('error', _onError.bind(null, { reject: reject }));
}

function _onStart(bind) {
    logger.info('<announce>Connected to Redis');
    _update();
    bind.resolve();
}

function _onError(bind, error) {
    logger.error('<announce>Failed to connec to Redis', error);
    bind.reject(error);
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
    client.setex(announceKey, TTL, '', _scanAnnounceKeys);
}

function _scanAnnounceKeys(error) {
    if (error) {
        logger.error('<announce>Failed to announce:', error);
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
    if (keys.length === 0) {
        // we found no keys at all: keep the cache
        _setupUpdate();
        return;
    }
    // temporary cache to replace the cache after parse
    var newNodes = [];
    var tmp = {};
    var tmpByType = {};
    var i;
    var len;
    try {
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
            tmp[key] = values;
            if (!tmpByType[values.type]) {
                tmpByType[values.type] = [];
            }
            tmpByType[values.type].push(values.node);
            if (!cache[key] && !values._self) {
                newNodes.push(values);
            }
        }
        // new nodes
        if (newNodes.length) {
            for (i = 0, len = _onNewNodeCallbacks.length; i < len; i++) {
                _onNewNodeCallbacks[i](newNodes);
            }
        }
        // update cache
        cache = tmp;
        cacheByType = tmpByType;
        _createNodeEndPoints();
        backup.update(cacheByType);
        // deep copy to avoid contaminating the original cache data
        var copiedCache = dcopy(cache);
        var copiedCacheByType = dcopy(cacheByType);
        for (i = 0, len = _onUpdatedCallbacks.length; i < len; i++) {
            _onUpdatedCallbacks[i](copiedCache, copiedCacheByType);
        }
    } catch (error) {
        logger.error('<announce>Invalid Redis keys - ignore the keys and skip updating cache:', error);
    }
    // schedule next update
    _setupUpdate();
}

function _parseAnnounceKey(key) {
    var list = key.split(DELIMITER);
    return {
        node: {
            address: list[2],
            port: parseInt(list[3])
        },
        type: list[4],
        data: compressor.unpack(list[5]),
        so: parseInt(list[6]),
        _self: false
    };
}

function _parseCacheKey(key) {
    var split = key.split(DELIMITER);
    return {
        sortKey: backup.addrToNum(split[0]),
        address: split[0],
        port: parseInt(split[1])
    };
}

function _createCacheKey(addr, port) {
    return addr + DELIMITER + port;
}

function _createAnnounceKey() {
    return _createCacheKey(PX + info.address, info.port) +
        DELIMITER + values.type +
        DELIMITER + _createAnnounceValue();

}

function _createAnnounceValue() {
    var cdata = compressor.pack(values.data);
    return cdata + DELIMITER + so.getNumOfSharedObjects();
}

function _getTTL() {
    var ratio = 1.5;
    if (UPDATE_INTERVAL < 2000) {
        ratio = 2;
    }
    return Math.floor( (UPDATE_INTERVAL * ratio) / 1000 );
}

