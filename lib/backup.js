'use strict';

var backupMap = {};
var info;
var backups = {};
var cacheByType = {};

module.exports = {
    setup: setup,
    update: update,
    get: get,
    addrToNum: addrToNum
};

/**
* conf.backups {
    <node type>: <backup number>
}
*/
function setup(conf, _info) {
    if (conf && conf.backups) {
        backupMap = conf.backups;
    }
    info = _info;
}

function update(_cacheByType) {
    if (!backupMap) {
        return;
    }
    // update cache map
    cacheByType = _cacheByType;
    // create backup cache
    var types = Object.keys(cacheByType);
    var tmp = {};
    for (var i = 0, len = types.length; i < len; i++) {
        var type = types[i];
        var backupNum = backupMap[type];
        if (!backupNum || backupNum <= 0) {
            continue;
        }
        var endpoints = cacheByType[type];
        for (var j = 0, jen = endpoints.length; j < jen; j++) {
            var ep = endpoints[j];
            _createCache(endpoints, backupNum, ep.address, ep.port, tmp);
        }
    }
    backups = tmp;
}

function get(type, node) {
    if (!node) {
        // we assume it wants its own backups
        node = info;
    }
    if (node && node.address && node.port) {
        // we will hit the cache unless we look for backups of a dead mesh node
        var key = node.address + node.port;
        if (backups[key]) {
            return backups[key];
        }
        // this means that we need to calculate backups of the mesh node that is no longer available
        var list = type ? cacheByType[type] : [];
        var backupNum = backupMap[type] || 0;
        return _getBackups(list, backupNum, node.address, node.port);
    }
    return [];
}

function _createCache(list, backupNum, addr, port, tmp) {
    var key = addr + port;
    var backupList = _getBackups(list, backupNum, addr, port);
    tmp[key] = backupList;
}

function _getBackups(list, backupNum, addr, port) {
    if (!list || !list.length) {
        return [];
    }
    var bind = { addrNum: addrToNum(addr) };
    var copy = list.concat([]);
    copy.sort(_sortByClosesAddress.bind(null, bind));
    return _filter(copy, backupNum, addr, port);
}

function _filter(list, backupNum, addr, port) {
    var counter = 0;
    var res = [];
    // exclude the same address from the results: we assume the same address means same server
    for (var i = 0, len = list.length; i < len; i++) {
        var _addr = list[i].address;
        var _port = list[i].port;
        if (addr !== _addr || port !== _port) {
            res.push(list[i]);
            counter += 1;
        }
        if (counter === backupNum) {
            break;
        }
    }
    return res;
}

function _sortByClosesAddress(bind, a, b) {
    var adiff = a.sortKey - bind.addrNum;
    var bdiff = b.sortKey - bind.addrNum;
    var adelta = adiff < 0 ? -1 * adiff : adiff;
    var bdelta = bdiff < 0 ? -1 * bdiff : bdiff;
    return adelta - bdelta;
}

function addrToNum(addr) {
    var splits = addr.split('.');
    return parseInt(splits[0]) + parseInt(splits[1]) + parseInt(splits[2]) + parseInt(splits[3]);
}

