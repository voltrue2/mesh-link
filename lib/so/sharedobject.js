'use strict';

/**
* Shared Object is a object that is stored on one mesh node
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

    inc(name, offset) {
        if (!this._isMutationAllowed(name, offset)) {
            return false;
        }
        var delta = this._props[name].value + offset;
        if (delta > this._props[name].max) {
            delta = this._props[name].max;
        } else if (delta < this._props[name].min) {
            delta = this._props[name].min;
        }
        this._set(name, delta);
        return true;
    }   

    add(name, key, value) {
        if (!this._props[name] || this._props[name].type !== TYPE_MAP) {
            return false;
        }
        this._props[name].value[key] = value;
        this._set(name, this._props[name].value);
        return true;
    }

    del(name, key) {
        if (!this._props[name] || this._props[name].type !== TYPE_MAP) {
            return false;
        }
        if (this._props[name].value[key] === undefined) {
            return false;
        }
        delete this._props[name].value[key];
        this._set(name, this._props[name].value);
        return true;
    }

    set(name, value) {
        if (!this._isMutationAllowed(name, value)) {
            return false;
        }
        this._set(name, value);
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

    // private
    _set(name, value) {
        var now = Date.now();
        this._props[name].value = value;
        this._props[name].lastUpdateTime = now;
        var val = this._props[name].value;
        var lastUpdateTime = this._props[name].lastUpdateTime;
        this.ttl = now + this._TTL;
        // internal event
        this.emit('change', this, name, val, lastUpdateTime);
        // external event
        this.emit('update', this, name, val, lastUpdateTime);
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

