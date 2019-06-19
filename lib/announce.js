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
const SORT_KEY_SEED = Math.round(Date.now() / 1000) + rand(0, 0xff);

const values = { type: 0, data: {}, sortKeySeed: SORT_KEY_SEED };

var UPDATE_INTERVAL = 1000;
var TTL = _getTTL();
var PX = PREFIX;
var PATTERN;
var info;
var master;
var slave;
var onStartCounter = 0;
var cache = {};
var cacheByType = {};
var nodeEndPoints = [];
var _onUpdateCallbacks = [];
var _onUpdatedCallbacks = [];
var _onNewNodeCallbacks = [];
var _stopUpdate = false;
var started = false;

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
    master.quit();
    if (master !== slave) {
        slave.quit();
    }
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
    if (!conf || (!conf.cluster && !conf.sentinel && !conf.multi)) {
        logger.info('<announce>Connecting to Redis:', conf);
        // https://www.npmjs.com/package/ioredis#connect-to-redis
        master = new Redis(conf);
        slave = master;
    } else if (conf.sentinel) {
        logger.info('<announce>Connecting to Redis Sentinel:', conf.sentinel);
        // https://www.npmjs.com/package/ioredis#sentinel
        master = new Redis(conf.sentinel);
        slave = master;
    } else if (conf.cluster) {
        logger.info('<announce>Connecting to Redis Cluster:', conf.cluster);
        https://www.npmjs.com/package/ioredis#cluster
        master = new Redis.Cluster(conf.cluster);
        slave = master;
    } else if (conf.multi) {
        logger.info('<announce>Connecting to multiple Redis:', conf.multi);
        master = new Redis(conf.multi.master);
        slave = new Redis(conf.multi.slave);
    } else {
        return reject('<announce>Unknown mode for Redis ' + conf.mode);
    }
    master.on('ready', _onStart.bind(null, { resolve: resolve }));
    master.on('error', _onError.bind(null, { reject: reject }));
    if (master !== slave) {
        slave.on('ready', _onStart.bind(null, { resolve: resolve }));
        slave.on('error', _onError.bind(null, { reject: reject }));
    }
}

function _onStart(bind) {
    if (master === slave) {
        onStartCounter = 2;
    } else {
        onStartCounter += 1;
    }
    if (onStartCounter === 2) {
        logger.info('<announce>Connected to Redis');
        if (started) {
            return;
        }
        started = true;
        _update();
        bind.resolve();
    }
}

function _onError(bind, error) {
    logger.error('<announce>Failed to connec to Redis', error);
    if (started) {
        return;
    }
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
    master.setex(announceKey, TTL, '', _scanAnnounceKeys);
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
        slave.scan(cursor, MATCH, PATTERN, COUNT, SCAN_COUNT, (error, res) => {
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
    var tmpEndPoints = [];
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
            // create endpoint
            tmpEndPoints.push({
                address: values.node.address,
                port: values.node.port,
                sortKey: backup.addrToNum(values.node.address) + values.sortKeySeed
            });
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
        nodeEndPoints = tmpEndPoints;
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
        sortKeySeed: parseInt(list[5]),
        data: compressor.unpack(list[6]),
        so: parseInt(list[7]),
        _self: false
    };
}

function _createCacheKey(addr, port) {
    return addr + DELIMITER + port;
}

function _createAnnounceKey() {
    return _createCacheKey(PX + info.address, info.port) +
        DELIMITER + values.type +
        DELIMITER + values.sortKeySeed +
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

function rand(min, max) {
    var offset = max - min;
    var rand   = Math.floor(Math.random() * (offset + 1));
    return rand + min;
}

