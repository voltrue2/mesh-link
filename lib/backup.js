'use strict';

var DEFAULT_BACKUP_NUM = 2;

var backupNum = DEFAULT_BACKUP_NUM;
var info;
var backups = [];
var cachedNodeEndPoints;

module.exports = {
    setup: setup,
    update: update,
    get: get,
    addrToNum: addrToNum
};

function setup(conf, _info) {
    if (conf && conf.backups) {
        backupNum = conf.backups;
    }
    info = _info;
}

function update(nodeEndPoints) {
    cachedNodeEndPoints = nodeEndPoints.concat([]);
    var copy = nodeEndPoints.concat([]);
    copy.sort(_sortByClosesAddress.bind(null, info));
    backups = _filter(info.address, info.port, copy);
}

function get(altAddrAndPort) {
    if (altAddrAndPort && altAddrAndPort.address && altAddrAndPort.port) {
        var copy = cachedNodeEndPoints.concat([]);
        var bind = { addrNum: addrToNum(altAddrAndPort.address) };
        copy.sort(_sortByClosesAddress.bind(null, bind));
        return _filter(altAddrAndPort.address, altAddrAndPort.port, copy);
    }
    // this should be ONLY when the node is trying to get its own backups
    return backups;
}

function _filter(addr, port, list) {
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
    var i = bind.addrNum;
    var adelta = (a.sortKey - i) < 0 ? -1 * (a.sortKey - i) : (a.sortKey - i);
    var bdelta = (b.sortKey - i) < 0 ? -1 * (b.sortKey - i) : (b.sortKey - i);
    return adelta - bdelta;
}

function addrToNum(addr) {
    var splits = addr.split('.');
    return parseInt(splits[0]) + parseInt(splits[1]) + parseInt(splits[2]) + parseInt(splits[3]);
}

