'use strict';

var DEFAULT_BACKUP_NUM = 3;

var backupNum = DEFAULT_BACKUP_NUM;
var backups = [];

module.exports = {
    setup: setup,
    get: get
};

function setup(conf) {
    if (conf && conf.backups) {
        backupNum = conf.backups;
    }
}

function get(info, nodeEndPoints) {
    var copy = nodeEndPoints.concat([]);
    copy.sort(_sortByClosesAddress.bind(null, info));
    // the first element must be myself: exclude it!
    backups = copy.splice(1, backupNum);
    return backups.concat([]);
}

function _sortByClosesAddress(info, _a, _b) {
    var i = _addr2num(info.address);
    var a = _addr2num(_a.address);
    var b = _addr2num(_b.address);
    var adelta = (a - i) < 0 ? -1 * (a - i) : (a - i);
    var bdelta = (b - i) < 0 ? -1 * (b - i) : (b - i);
    return adelta - bdelta;
}

function _addr2num(addr) {
    var splits = addr.split('.');
    return parseInt(splits[0]) + parseInt(splits[1]) + parseInt(splits[2]) + parseInt(splits[3]);
}

