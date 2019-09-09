'use strict';

const Redis = require('ioredis');
const so = require('./so');
const compressor = require('./compressor');
const dcopy = require('./dcopy');
const logger = require('./logger');

const DELIMITER = '`';
const PREFIX = '@mlink' + DELIMITER;
const SCAN_COUNT = 1000;
const MATCH = 'MATCH';
const COUNT = 'COUNT';

const values = { type: 0, data: {}, bkOriginNodes: [] };

var UPDATE_INTERVAL = 1000;
var TTL = _getTTL();
var PX = PREFIX;
var PATTERN;
var info;
var master;
var slave;
var bkNums = {};
var backups = {};
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
    bkNums = conf.backups || {};
    // Promise or callback
    if (!cb) {
        return new Promise(_start.bind(null, conf.redis));
    }
    _start(cb, cb);
}

function getBackupNodes(type, node) {
    if (!type) {
        type = values.type;
    }
    if (!node) {
        node = info;
    }
    var key = _createCacheKey(node.address, node.port);
    if (!backups[key]) {
        return [];
    }
    var res = [];
    var list = Object.keys(backups[key]);
    for (var i = 0, len = list.length; i < len; i++) {
        var split = list[i].split(DELIMITER);
        var addr = split[0];
        var port = parseInt(split[1]);
        res.push({ address: addr, port: port });
    }
    return res;
}

function packBackupNodes(bkNodesList) {
    var res = [];
    for (var i = 0, len = bkNodesList.length; i < len; i++) {
        var node = bkNodesList[i];
        res.push(node.address + '-' + node.port);
    }
    return res.join('/');
}

function unpackBackupNodes(bkNodesStr) {
    var res = [];
    var list = bkNodesStr.split('/');
    for (var i = 0, len = list.length; i < len; i++) {
        var node = list[i].split('-');
        res.push({ address: node[0], port: parseInt(node[1]) });
    }
    return res;
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
    var announceKey = _createAnnounceKey();
    master.del(announceKey);
    setTimeout(() => {
      _stopUpdate = true;
      master.quit();
      if (master !== slave) {
          slave.quit();
      }
      if (Promise && !cb) {
          return new Promise(_onStop);
      }
      _onStop(cb);
    }, 100);
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
    // with lazyConnect, connect() must be called manually
    // we do this b/c we want slave to create a new connection every time we update...
    if (!conf.options) {
      conf.options = {};
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
        conf.options.lazyConnect = true;
        master = new Redis(conf.multi.master.host, conf.multi.master.port, conf.options);
        slave = new Redis(conf.multi.slave.host, conf.multi.slave.port, conf.options);
        // master must be connected anyways
        master.connect((error) => {
            if (error) {
                return reject(error);
            }
            logger.info('<announce>Connected to Redis');
            _update();
            resolve();
        });
        return;
    } else {
        return reject('<announce>Unknown mode for Redis ' + conf.mode);
    }
    // non multi configurations
    master.on('ready', _onStart.bind(null, { resolve: resolve }));
    master.on('error', _onError.bind(null, { reject: reject }));
}

function _onStart(bind) {
    logger.info('<announce>Connected to Redis');
    if (started) {
        return;
    }
    started = true;
    _update();
    // we want to make sure we have the node data
    setTimeout(() => {
        bind.resolve();
    }, 1000);
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
    if (master === slave) {
      // NOT in multi mode and we keep the same connection
      executeScan();
      return;
    }
    // in multi mode and we create a new connection for slave
    slave.connect((error) => {
        if (error) {
            logger.error('<announce>Failed to connect:', error);
            if (master !== slave) {
                slave.disconnect();
            }
            // abort scan...
            _setupUpdate();
            return;
        }
        executeScan();
    });
}

function executeScan() {
    // scan all announce keys
    var cursor = 0;
    var keys = [];
    // start scanning announce keys
    __scanner();
    function __scanner() {
        slave.scan(cursor, MATCH, PATTERN, COUNT, SCAN_COUNT, (error, res) => {
            if (error) {
                // error... we abort the scan...
                if (master !== slave) {
                    slave.disconnect();
                }
                _setupUpdate();
                return;
            }
            cursor = parseInt(res[0]);
            keys = keys.concat(res[1]);
            if (cursor !== 0) {
                return __scanner();
            }
            if (master !== slave) {
                slave.disconnect();
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
            var parsedKey = _parseAnnounceKey(keys[i]);
            if (!parsedKey) {
                continue;
            }
            var key = _createCacheKey(parsedKey.node.address, parsedKey.node.port);
            // default _self is false
            if (parsedKey.node.address === info.address && parsedKey.node.port === info.port) {
                parsedKey._self = true;
            }
            // update cache maps
            tmp[key] = parsedKey;
            if (!tmpByType[parsedKey.type]) {
                tmpByType[parsedKey.type] = [];
            }
            tmpByType[parsedKey.type].push(parsedKey.node);
            if (!cache[key] && !parsedKey._self) {
                newNodes.push(parsedKey);
            }
            // create endpoint
            tmpEndPoints.push({
                address: parsedKey.node.address,
                port: parsedKey.node.port,
                backupNodes: parsedKey.backupNodes
            });
        }
        // new nodes
        if (newNodes.length) {
            for (i = 0, len = _onNewNodeCallbacks.length; i < len; i++) {
                _onNewNodeCallbacks[i](newNodes);
            }
        }
        // update backup cache
        _createBackupNodes(tmp);
        // update cache
        cache = tmp;
        cacheByType = tmpByType;
        nodeEndPoints = tmpEndPoints;
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

function _createBackupNodes(nodes) {
    if (!bkNums[values.type]) {
        return;
    }
    for (var nodeKey in nodes) {
        var node = nodes[nodeKey];
        var origins = node.bkOriginNodes;
        for (var j = 0, jen = origins.length; j < jen; j++) {
            var origin = origins[j];
            var bk = _createCacheKey(node.node.address, node.node.port);
            var key = _createCacheKey(origin.address, origin.port);
            if (!backups[bk]) {
                backups[bk] = {};
            }
            if (backups[bk][key]) {
                continue;
            }
            if (Object.keys(backups[bk]).length === bkNums[values.type]) {
                break;
            }
            backups[bk][key] = true;
        }
    }
}

function _parseAnnounceKey(key) {
    var list = key.split(DELIMITER);
    if (list.length < 8) {
        return null;
    }
    var bkOriginNodes = '';
    if (list[5] !== '') {
        bkOriginNodes = unpackBackupNodes(list[5]);
    }
    return {
        node: {
            address: list[2],
            port: parseInt(list[3])
        },
        type: list[4],
        bkOriginNodes: bkOriginNodes,
        data: compressor.unpack(list[6]),
        so: parseInt(list[7]),
        _self: false
    };
}

function _createCacheKey(addr, port) {
    return addr + DELIMITER + port;
}

function _createAnnounceKey() {
    if (bkNums[values.type]) {
        if (values.bkOriginNodes.length < bkNums[values.type]) {
            addBackupNodes();
        }
    }
    return _createCacheKey(PX + info.address, info.port) +
        DELIMITER + values.type +
        DELIMITER + packBackupNodes(values.bkOriginNodes) +
        DELIMITER + _createAnnounceValue();

}

function addBackupNodes() {
    if (!cacheByType[values.type]) {
        return;
    }
    var seen = [];
    var list = cacheByType[values.type].concat([]);
    while (list.length > 0) {
        var index = rand(0, list.length - 1);
        var node = list.splice(index, 1)[0];
        var key = node.address + node.port;
        if (seen[key]) {
            continue;
        }
        if (node.address !== '127.0.0.1') {
            if (node.address === info.address) {
                continue;
            }
        } else if (node.port === info.port) {
            continue;
        }
        var skip = false;
        for (var i = 0, len = values.bkOriginNodes.length; i < len; i++) {
            var b = values.bkOriginNodes[i];
            if (b.address + b.port === key) {
                skip = true;
                break;
            }
        }
        if (skip) {
            continue;
        }
        seen[key] = true;
        values.bkOriginNodes.push(node);
    }
}

function rand(min, max) {
    var offset = max - min;
    var r = Math.floor(Math.random() * (offset + 1));
    return r + min;
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

