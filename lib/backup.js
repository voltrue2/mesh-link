'use strict';

var localhost = '127.0.0.1';
var backupMap = {};
var info;
var backups = {};
var cacheByType = {};

module.exports = {
    setup: setup,
    update: update,
    get: get
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
    // do we need to update backup cache?
    if (Object.keys(backups).length > 0) {
        return;
    }
    _updateBackup();
}

function _updateBackup() {
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
            if (!ep) {
                continue;
            }
            _createCache(endpoints, backupNum, ep.address, ep.port, tmp);
        }
    }
    backups = tmp;
}

function get(type, node, count) {
    if (!node) {
        // we assume it wants its own backups
        node = info;
    }
    if (!count) {
        count = 0;
    }
    if (node && node.address && node.port) {
        // we will hit the cache unless we look for backups of a dead mesh node
        var key = node.address + node.port;
        if (backups[key] && backups[key].length > 0) {
            return backups[key];
        }
        if (count < 5) {
            _updateBackup();
            count += 1;
            return get(type, node, count);
        }
    }
    return [];
}

function _createCache(list, backupNum, addr, port, tmp) {
    var key = addr + port;
    var backupList = _getBackups(list, backupNum, addr, port);
    tmp[key] = backupList;
}

function _getBackups(list, backupNum, addr, port) {
    var res = [];
    var seen = {};
    var nodes = list.concat();
    while (res.length < backupNum) {
        var len = nodes.length;
        var index = rand(0, len - 1);
        var selected = nodes.splice(index, 1);
        if (!selected.length) {
            break;
        }
        var node = selected[0];
        if (addr === localhost) {
            if (node.port === port) {
                continue;
            }
        } else {
            if (node.address === addr) {
                continue;
            }
        }
        if (seen[node.address + node.port]) {
            continue;
        }
        res.push(node);
        seen[nodes.address + node.port] = true;
        if (res.length === len) {
            break;
        }
        if (nodes.length === 0) {
            break;
        }
    }
    return res;
}

function rand(min, max) {
    var offset = max - min;
    var r = Math.floor(Math.random() * (offset + 1));
    return r + min;
}

