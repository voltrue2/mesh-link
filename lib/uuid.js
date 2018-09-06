'use strict';

const crypto = require('crypto');

// UUID v4 without -
module.exports = function () {
    var buf = crypto.randomBytes(16);
    // pre 4.4 set bits for version and `clock_seq_hi_and_reserverd`
    buf[6] = (buf[6] & 0x0f) | 0x40;
    buf[8] = (buf[8] & 0x3f) | 0x80;
    return buf;
};

