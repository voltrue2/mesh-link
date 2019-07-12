'use strict';

/**
* Shared Object Manager
* Manages shared object creation, propergation, updates and synchronizations
* A shared object will keep all watchers(mesh node) updated whenever it mutates
*/

const SharedObject = require('./sharedobject');

const managedso = {};

const CREATE = 65001;
const PUSH = 65002;
const SYNC = 65003;
const WATCHER_ADD = 65004;
const RM = 65005;
const RM_SYNC = 65006;
const GET = 65007;
// clean every 10 minutes default
const CLEAN_INTERVAL = 600000;
// max number of managed shated objects cleaned at a time
const MAX_CLEAN = 100;

var cleanInterval;

module.exports = {
    setup: setup,
    create: create,
    remove: remove,
    get: get,
    getNumOfSharedObjects: getNumOfSharedObjects
};

var logger;
var broker;

function setup(conf) {
    if (!conf || !conf.useSharedObject) {
        return;
    }
    cleanInterval = conf.cleanInterval || CLEAN_INTERVAL;
    logger = require('../logger');
    broker = require('../broker');
    broker.handler(CREATE, _remoteCreate);
    broker.handler(PUSH, _remoteUpdate);
    broker.handler(SYNC, _syncSharedObject);
    broker.handler(WATCHER_ADD, _remoteAddWatcher);
    broker.handler(RM, _remoteRemove);
    broker.handler(RM_SYNC, _syncRemove);
    broker.handler(GET, _remoteGet);
    _setupCleaner();
}

/** @description returns a number of managed shared objects on a single mesh node
* @return {number}
*/
function getNumOfSharedObjects() {
    return Object.keys(managedso).length;
}

/** @description creates a shared object and stores it on a specified mesh node
* @param {object} objectData - A shared object data to be stored
* @param {number} ttl - Optional TTL for the shated object
* @param {object} node - A mesh node to store the shared object: { address, port }
* @param {function} cb - A callback if Promise is not used
* @return {SharedObject}
*/
function create(objectData, ttl, node) {
    var info = broker.info();
    var so = new SharedObject(node.address, node.port, objectData, ttl);
    so.mid = _createManagedId(so.id, node.address, node.port);
    // register remote update functions
    so.on('change', _pushChangeToRemote);
    so.on('watcherAdd', _pushWatcherToRemote);
    // add myself as a watcher node:
    // we do this AFTER so.on('watcherAdd', _pushWatcherAddToRemote);
    // b/c we are creating a new shared ojbect with the original watcher
    so.addWatcher(info.address, info.port);
    // keep it in memory locally
    managedso[so.id] = so;
    var message = {
        so: SharedObject.stringify(so)
    };
    // store shared object on a remte node
    broker.send(CREATE, [ node ], message);
    // return immideately
    return so;
}

/** @description remove a shared object from all mesh nodes
* @param {SharedObject} - so A shared object to remove
* @return {undefined}
*/
function remove(so) {
    // emit remove event to make sure you can clean the shared object references...
    managedso[so.id].remove();
    // remove locally
    delete managedso[so.id];
    // remove remotely and sync
    var parsed = _parseManagedId(so.mid);
    var node = parsed.node;
    var message = { id: so.id };
    broker.send(RM, [ node ], message);
}

/** @description fetches a shared object by mid
* @param {string} - mid An ID of the shared object
* @param {callback} - cb A callback: If you are using Promise, you do not need this
* @returns {Promise}
*/
function get(mid, cb) {
    var parsed = _parseManagedId(mid);
    var bind = { parsed: parsed };
    if (Promise && !cb) {
        return new Promise(_get.bind(null, bind));
    }
    var bind2 = { cb: cb };
    _get(bind, _onGet.bind(null, bind2), _onGetError.bind(null, bind2));
}

function _get(bind, resolve, reject) {
    var parsed = bind.parsed;
    if (managedso[parsed.id]) {
        return resolve(managedso[parsed.id]);
    }
    var message = {
        id: parsed.id
    };
    broker.send(GET, [ parsed.node ], message, (error, res) => {
        if (error) {
            return reject(error);
        }
        // re-construct shared object locally
        var info = broker.info();
        var so = SharedObject.parse(res.data);
        // register a remote update functions
        so.on('change', _pushChangeToRemote);
        so.on('watcherAdd', _pushWatcherToRemote);
        // add myself as a watcher node:
        // we do this AFTER so.on('watcherAdd', _pushWatcherAddToRemote);
        // b/c we are creating a new shared ojbect with the original watcher
        so.addWatcher(info.address, info.port);
        managedso[parsed.id] = so;
        resolve(so);
    });
}

function _onGet(bind, so) {
    bind.cb(null, so);
}

function _onGetError(bind, error) {
    bind.cb(error);
}

function _pushChangeToRemote(so, name, value, updateTime, cid) {
    var node = so.getNode();
    var message = {
        id: so.id,
        name: name,
        value: value,
        updateTime: updateTime,
        node: node
    };
    broker.send(PUSH, [ node ], message, _onPushChangeToRemote.bind(null, { so: so, cid: cid }));
}

function _onPushChangeToRemote(bind, error) {
    bind.so._callback(bind.cid, error);
}

function _pushWatcherToRemote(so, addr, port) {
    var message = {
        id: so.id,
        address: addr,
        port: port
    };
    broker.send(WATCHER_ADD, [ so.getNode() ], message);
}

// handler ID: CREATE
// this is executed on a remote mesh node
function _remoteCreate(message) {
    // reconstruct the shared object
    var so = SharedObject.parse(message.so);
    // store it in memory
    managedso[so.id] = so;
}

// handler ID: PUSH
// this is executed on a remote mesh node
function _remoteUpdate(message, cb) {
    var id = message.id;
    var name = message.name;
    var value = message.value;
    var updateTime = message.updateTime;
    var nodeFrom = message.node;
    if (managedso[id]) {
        var error = null;
        var ok = managedso[id]._sync(name, value, updateTime);
        if (ok) {
            // sync the change to all watchers
            var watchers = managedso[id].getWatchers();
            // exclude the node that the update came from
            watchers.filter((watcher) => {
                return watcher.address !== nodeFrom.address || watcher.port !== nodeFrom.port;
            });
            broker.send(SYNC, watchers, message);
        } else {
            error = new Error('SyncRejected');
        }
        cb(error);
        return;
    }
    logger.error('Shared object to update not found - ID', id);
    cb(new Error('SharedObjectNotFound'));
}

// handler ID: SYNC
// this is exected on all watcher mesh nodes
function _syncSharedObject(message) {
    var id = message.id;
    var name = message.name;
    var value = message.value;
    var updateTime = message.updateTime;
    if (managedso[id]) {
        managedso[id]._sync(name, value, updateTime);
        return;
    }
    logger.error('Shared object to sync not found - ID', id);
}

// handler ID: WATCHER_ADD
// this is executed on a remote mesh node
function _remoteAddWatcher(message) {
    var id = message.id;
    var addr = message.address;
    var port = message.port;
    if (managedso[id]) {
        managedso[id].addWatcher(addr, port);
        return;
    }
    logger.error('Shared object add a watcher not found - ID', id);
}

// handler ID: RM
// this is executed on a remote mesh node
function _remoteRemove(message) {
    var id = message.id;
    if (managedso[id]) {
        var so = managedso[id];
        // emit remove event to make sure you can clean the shared object references...
        managedso[id].remove();
        delete managedso[id];
        // remove the shared object from all watcher nodes too
        var watchers = so.getWatchers();
        broker.send(RM_SYNC, watchers, message);
    }
}

// handler ID: RM_SYNC
// this is executed on a remote mesh node
function _syncRemove(message) {
    var id = message.id;
    // emit remove event to make sure you can clean the shared object references...
    managedso[id].remove();
    delete managedso[id];
}

// handler ID: GET
// this is executed on a remote mesh node
function _remoteGet(message, cb) {
    var id = message.id;
    if (managedso[id]) {
        return cb({ data: SharedObject.stringify(managedso[id]) });
    }
    cb(new Error('Shared Object of ID' + id + ' not found'));
}

function _createManagedId(id, addr, port) {
    var idbuf = Buffer.from(id, 'hex');
    var nodebuf = Buffer.alloc(6);
    // this is for IPv4 ONLY...
    var addrlist = addr.split('.');
    nodebuf[0] = parseInt(addrlist[0]);
    nodebuf[1] = parseInt(addrlist[1]);
    nodebuf[2] = parseInt(addrlist[2]);
    nodebuf[3] = parseInt(addrlist[3]);
    nodebuf.writeUInt16BE(port, 4);
    return Buffer.concat([ idbuf, nodebuf ]).toString('hex');
}

function _parseManagedId(mid) {
    var buf = Buffer.from(mid, 'hex');
    var node = {
        address: buf[16] + '.' + buf[17] + '.' + buf[18] + '.' + buf[19],
        port: buf.readUInt16BE(20)
    };
    return { id: buf.slice(0, 16).toString('hex'), node: node };
}

function _setupCleaner() {
    setTimeout(_cleaner, cleanInterval);
}

function _cleaner() {
    try {
        var keys = Object.keys(managedso);
        var precision = 0;
        var len = keys.length - 1;
        var min = 0;
        var max = len - MAX_CLEAN >= MAX_CLEAN ? len - MAX_CLEAN : Math.min(MAX_CLEAN, len);
        var offset = max - min;
        var from = parseFloat(Math.min(min + (Math.random() * offset), max).toFixed(precision));
        var to = Math.min(MAX_CLEAN + from, len);
        var now = Date.now();
        for (var i = from; i <= to; i++) {
            if (managedso[keys[i]] && managedso[keys[i]].ttl <= now) {
                // emit remove event to make sure you can clean the shared object references...
                managedso[keys[i]].remove();
                delete managedso[keys[i]];
            }
        }
    } catch (error) {
        // error...
    }
    _setupCleaner();
}


