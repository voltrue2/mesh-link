'use strict';

const uuid = require('../uuid');

// if a buffer is greater than this it will split
const MAX_SIZE = 1300;

var splitSize = MAX_SIZE;

class Msg {

    constructor() {
        this._list = [];
        this._filled = 0;
    }

    static id(buf) {
        return buf.slice(0, 16).toString('hex');
    }

    static setSplitSize(_splitSize) {
        if (_splitSize <= 0) {
            return;
        }
        splitSize = _splitSize;
    }

    static split(buf) {
        var id = uuid().toString('hex');
        // if buf is too big, split it into smaller chunks
        if (buf.length > splitSize) {
            var list = [];
            var consumed = 0;
            while (consumed < buf.length) {
                var chunck = buf.slice(consumed, consumed + splitSize);
                var msg = this._createMessage(id, chunck, list.length, buf.length);
                list.push(msg);
                consumed += chunck.length;
            }
            return list;
        }
        // there's no need to split the buf
        return [ this._createMessage(id, buf, 0, buf.length) ];
    }

    static _createMessage(id, chunck, index, length) {
        var idbuf = Buffer.from(id, 'hex');
        var lenbuf = Buffer.alloc(4);
        lenbuf.writeUInt32BE(length, 0);
        var indexbuf = Buffer.alloc(2);
        indexbuf.writeUInt16BE(index, 0);
        return Buffer.concat([ idbuf, lenbuf, indexbuf, chunck ]);
    }

    add(buf) {
        var parsed = this._parse(buf);
        this._init(parsed.length);
        if (!this._list[parsed.index]) {
            this._list[parsed.index] = parsed.chunck;
            this._filled += parsed.chunck.length;
        }
        if (this._filled === parsed.length) {
            // we have all chuncks!
            return Buffer.concat(this._list);
        }
        return null;
    }

    _init(len) {
        if (this._list.length === 0) {
            this._list.length = len > splitSize ? Math.round(len / splitSize) : 1;
        }
    }

    _parse(buf) {
        // we do NOT parse id at offset 0
        var len = buf.readUInt32BE(16);
        var index = buf.readUInt16BE(20);
        var chunck = buf.slice(22);
        return { length: len, index: index, chunck: chunck };
    }

}

module.exports = Msg;

