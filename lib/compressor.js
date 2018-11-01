'use strict';

/**
* Compress and decompress values of a mesh node
*/

const DELIMITER = ';';
const OBJ_FLAG = '@';

module.exports = {
    pack: pack,
    unpack: unpack
};

function pack(data) {
    var list = [];
    for (var key in data) {
        list.push(key);
        var val = data[key];
        if (typeof val === 'object' && val !== null) {
            list.push(OBJ_FLAG + JSON.stringify(val));
        } else {
            list.push(val);
        }
    }
    return list.join(DELIMITER);
}

function unpack(str) {
    var list = str.split(DELIMITER);
    var data = {};
    var key;
    for (var i = 0, len = list.length; i < len; i++) {
        if (i % 2 === 0) {
            key = list[i];
            continue;
        }
        data[key] = _typecast(list[i]);
    }
    return data;
}

function _typecast(val) {
    if (isNaN(val) === false) {
        return parseFloat(val);
    }
    if (val === 'true') {
        return true;
    }
    if (val === 'false') {
        return false;
    }
    if (val === 'null') {
        return null;
    }
    if (val === 'undefined') {
        return undefined;
    }
    if (val[0] === OBJ_FLAG) {
        return JSON.parse(val.substring(1, val.length));
    }
    return val;
}

