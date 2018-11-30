'use strict';

/**
* Shared Object is an object that is stored on one mesh node
* Whenevever there is a mutation, all watchers will receive updates
*/
const uuid = require('../uuid');
const EventEmitter = require('events').EventEmitter;

// 5 minutes
const TTL = 300000;
const TYPE_MAP = 'map';

class SharedObject extends EventEmitter {

    // data cannot be nested
    constructor(addr, port, data, _ttl) {
        super();
        // mid (managed ID) is created and used by manager
        this.mid = null;
        this.id = null;
        this._TTL = (_ttl || TTL);
        this.ttl = Date.now() + this._TTL;
        this._stored = { address: addr || null, port: port || 0 };
        this._props = {};
        this._watchers = [];
        this._watcherMap = {};
        this._callbacks = {};
        if (data) {
            this.id = uuid().toString('hex');
            var now = Date.now();
            for (var name in data) {
                var prop = this._createProperty(data[name], now);
                if (prop === null) {
                    continue;
                }
                this._props[name] = prop;
            }
        }
    }

    static parse(stringifiedOs) {
        var data = JSON.parse(stringifiedOs);
        var so = new SharedObject();
        so.mid = data.mid;
        so.id = data.id;
        so.ttl = data.ttl;
        so._TTL = data._TTL;
        so._stored.address = data._stored.address;
        so._stored.port = data._stored.port;
        so._props = data._props;
        so._watchers = data._watchers;
        for (var i = 0, len = data._watchers.length; i < len; i++) {
            var key = data._watchers[i].address + data._watchers[i].port;
            so._watcherMap[key] = true;
        }
        return so;
    }

    static stringify(so) {
        return JSON.stringify({
            mid: so.mid,
            id: so.id,
            ttl: so.ttl,
            _TTL: so._TTL,
            _stored: so._stored,
            _props: so._props,
            _watchers: so._watchers,
            _watcherMap: so._watcherMap
        });
    }

    remove() {
        // emit remove event so you can do some cleaning of the object reference(s)
        this.emit('remove');
    }

    getNode() {
        return {
            address: this._stored.address,
            port: this._stored.port
        };
    }

    getWatchers() {
        return this._watchers.concat([]);
    }

    addWatcher(addr, port) {
        var key = addr + port;
        if (this._watcherMap[key]) {
            return false;
        }
        this._watcherMap[key] = true;
        this._watchers.push({
            address: addr,
            port: port
        });
        // internal event
        this.emit('watcherAdd', this, addr, port);
        return true;
    }

    get(name) {
        if (this._props[name]) {
            return this._props[name].value;
        }
        return null;
    }

    multi(updates) {
        if (!Promise) {
            throw new Error('PromiseNotAvailable');
        }
        return Promise.all(updates);
    }

    inc(name, offset, cb) {
        var bind = {
            that: this,
            name: name,
            offset: offset
        };
        if (Promise && !cb) {
            new Promise(this._inc.bind(null, bind));
        }
        return this._inc(bind, cb, cb);
    }

    // private
    _inc(bind, resolve, reject) {
        var that = bind.that;
        var name = bind.name;
        var offset = bind.offset;
        if (!that._isMutationAllowed(name, offset)) {
            reject(new Error('IncRejected'));
            return false;
        }
        var delta = that._props[name].value + offset;
        if (delta > that._props[name].max) {
            delta = that._props[name].max;
        } else if (delta < that._props[name].min) {
            delta = that._props[name].min;
        }
        var cid = that._setCallback(resolve, reject);
        that._set(name, delta, cid);
        return true;
    }

    add(name, key, value, cb) {
        var bind = {
            that: this,
            name: name,
            key: key,
            value: value
        };
        if (Promise && !cb) {
            return new Promise(this._add.bind(null, bind));
        }
        return this._add(bind, cb, cb);
    }

    // private
    _add(bind, resolve, reject) {
        var that = bind.that;
        var name = bind.name;
        var key = bind.key;
        var value = bind.value;
        if (!that._props[name] || that._props[name].type !== TYPE_MAP) {
            reject(new Error('AddRejected'));
            return false;
        }
        var max = that._props[name].max;
        if (max && Object.keys(that._props[name].value).length >= max) {
            reject(new Error('AddReachedMax'));
            return false;
        }
        var cid = that._setCallback(resolve, reject);
        that._props[name].value[key] = value;
        that._set(name, that._props[name].value, cid);
        return true;
    }

    del(name, key, cb) {
        var bind = {
            that: this,
            name: name,
            key: key
        };
        if (Promise && !cb) {
            return new Promise(this._del.bind(null, bind));
        }
        return this._del(bind, cb, cb);
    }

    // private
    _del(bind, resolve, reject) {
        var that = bind.that;
        var name = bind.name;
        var key = bind.key;
        if (!that._props[name] || that._props[name].type !== TYPE_MAP) {
            reject(new Error('DeleteRejected'));
            return false;
        }
        if (that._props[name].value[key] === undefined) {
            reject(new Error('DeleteNotNecessary'));
            return false;
        }
        var cid = that._setCallback(resolve, reject);
        delete that._props[name].value[key];
        that._set(name, that._props[name].value, cid);
        return true;
    }

    set(name, value, cb) {
        var bind = {
            that: this,
            name: name,
            value: value
        };
        if (Promise && !cb) {
            return new Promise(this._set.bind(null, bind));
        }
        return this._set(bind, cb, cb);
    }

    // private
    _set(bind, resolve, reject) {
        var that = bind.that;
        var name = bind.name;
        var value = bind.value;
        if (!that._isMutationAllowed(name, value)) {
            reject(new Error('SetRejected'));
            return false;
        }
        var cid = that._setCallback(resolve, reject);
        that._set(name, value, cid);
        return true;
    }

    // used by manager ONLY
    _sync(name, value, updateTime) {
        if (updateTime < this._props[name].lastUpdateTime) {
            return false;
        }
        var now = Date.now();
        this._props[name].value = value;
        this._props[name].lastUpdateTime = updateTime;
        this.ttl = now + this._TTL;
        // external event
        this.emit('update', this, name, value, updateTime);
        return true;
    }

    // used by manager ONLY
    _callback(cid, error) {
        if (this._callbacks[cid]) {
            if (error) {
                this._callbacks[cid].reject(error);
            } else {
                this._callbacks[cid].resolve();
            }
            delete this._callbacks[cid];
        }
    }

    // private
    _setCallback(resolve, reject) {
        if (resolve && reject) {
            var cid = uuid().toString('hex');
            this._callbacks[cid] = {
                resolve: resolve,
                reject: reject
            };
            return cid;
        }
        return null;
    }

    // private
    _set(name, value, cid) {
        var now = Date.now();
        this._props[name].value = value;
        this._props[name].lastUpdateTime = now;
        var val = this._props[name].value;
        var lastUpdateTime = this._props[name].lastUpdateTime;
        this.ttl = now + this._TTL;
        // internal event
        this.emit('change', this, name, val, lastUpdateTime, cid);
        // external event
        this.emit('update', this, name, val, lastUpdateTime, cid);
    }

    // private
    _createProperty(prop, now) {
        if (prop.value === null || prop.value === undefined) {
            return null;
        }
        var res = {
            type: null,
            value: null,
            min: null,
            max: null,
            lastUpdateTime: null
        };
        res.type = typeof prop.value;
        res.value = prop.value;
        res.min = prop.min || 0;
        res.max = prop.max || 0;
        res.lastUpdateTime = now;
        // array is not allowed...
        if (res.type === 'object') {
            res.type = 'map';
            res.value = {};
        }
        return res;
    }

    // private
    _isMutationAllowed(propName, value) {
        if (this._props[propName] === undefined) {
            return false;
        } else if (typeof value !== this._props[propName].type) {
            return false;
        }
        return true;
    }

}

module.exports = SharedObject;

