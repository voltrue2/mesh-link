'use strict';

const logger = require('./logger');
const announce = require('./announce');
const delivery = require('./delivery');
const backup = require('./backup');

const conf = {
    relayLimit: 1,
    relayDelay: 0
};

module.exports = {
    start: start,
    stop: stop,
    info: delivery.info,
    onUpdate: announce.onUpdate,
    onUpdated: announce.onUpdated,
    setValue: announce.setValue,
    getNodeValue: announce.getNodeValue,
    getNodeEndPoints: announce.getNodeEndPoints,
    getNodes: announce.getNodes,
    nodeExists: announce.nodeExists,
    handler: handler,
    send: send,
    usend: usend,
    getBackupNodes: getBackupNodes
};

function start(_conf, cb) {
    if (!_conf) {
        _conf = {};
    }
    if (_conf.relayLimit) {
        conf.relayLimit = _conf.relayLimit;
    }
    if (_conf.relayDelay) {
        conf.relayDelay = _conf.relayDelay;
    }
    if (_conf.logger) {
        logger.setup(_conf.logger);
    }
    // continue relaying a message to next mesh nodes
    delivery.onHandle(_relay);
    // when a reliable message to a mesh node times out, continue on to the next
    delivery.onTimeout(_relay);
    // decide how many backup nodes this mesh node would have
    backup.setup(conf);
    var _info;
    if (!cb) {
        var promise = delivery.start(_conf);
        return promise.then(() => {
            _info = delivery.info();
            logger.setInfo(_info);
            return announce.start(_info, _conf);
        });
    }
    delivery.start(_conf, () => {
        _info = delivery.info();
        logger.setInfo(_info);
        announce.start(_info, _conf, cb);
    });
}

function stop(cb) {
    if (!cb) {
        return new Promise(_stop);
    }
    if (delivery && delivery.stop) {
        logger.info('<broker>Stopping announce');
        announce.stop(() => {
            logger.info('<broker>Stopping delivery');
            delivery.stop(cb);
        });
    } else {
        cb();
    }
}

function _stop(resolve) {
    if (delivery && delivery.stop) {
        logger.info('<borker>Stopping announce');
        announce.stop(() => {
            logger.info('<broker>Stopping delivery');
            delivery.stop(resolve);
        });
    } else {
        resolve();
    }
}

function send(handlerId, nodes, data, cb) {
    if (!Array.isArray(nodes)) {
        nodes = [ nodes ];
    }
    _send(handlerId, nodes, data, true, cb);
}

function usend(handlerId, nodes, data, cb) {
    if (!Array.isArray(nodes)) {
        nodes = [ nodes ];
    }
    _send(handlerId, nodes, data, false, cb);
}

function _send(handlerId, nodes, data, reliable, cb) {
    var branched = _branchNodes(nodes);
    var branches = branched.branches;
    var foundLocalNode = branched.foundLocalNode;
    var wrappedData = { data: data, handlerId: handlerId, nodes: [] };
    if (foundLocalNode) {
        delivery.localSend(handlerId, wrappedData, cb);
        // we do not need cb because we can respond locally
        cb = null;
    }
    for (var i = 0, len = branches.length; i < len; i++) {
        if (branches[i] === 0) {
            logger.error('<broker>No node to send the message given:', handlerId, data);
            if (typeof cb === 'function') {
                cb(new Error('No node to send the message given: ' + handlerId));
            }
            return;
        }
        var branch = branches[i];
        var node = branch.shift();
        if (!node) {
            continue;
        }
        wrappedData.nodes = branch;
        logger.sys(
            '<broker>Sending message to:', node.address, node.port,
            'handler ID:', handlerId, 'data:', data,
            'require response:', (cb ? true : false),
            'reliable:', reliable
        );
        if (reliable) {
            delivery.send(node.address, node.port, handlerId, wrappedData, cb);
        } else {
            delivery.usend(node.address, node.port, handlerId, wrappedData, cb);
        }
    }
}

function _branchNodes(_nodes) {
    // copy _nodes to avoid contaminating the origial nodes object...
    var nodes = _nodes.concat([]);
    var limit = conf.relayLimit;
    if (nodes.length <= limit) {
        limit = nodes.length;
    }
    var foundLocalNode = false;
    var branches = [];
    var path = 0;
    while (nodes.length) {
        if (!branches[path]) {
            branches[path] = [];
        }
        if (path === limit) {
            path = 0;
        }
        // make sure we include live node ONLY
        var node = _getNode(nodes);
        if (node) {
            // if we find local node, separater it from the reset
            if (announce.isLocalNode(node.address, node.port)) {
                foundLocalNode = true;
                continue;
            }
            // remote node
            branches[path].push({
                address: node.address,
                port: node.port
            });
            path += 1;
        }
    }
    return { branches: branches, foundLocalNode: foundLocalNode };
}

function _relay(wrappedData) {
    if (!wrappedData.nodes.length) {
        return wrappedData.data;
    }
    try {
        logger.sys(
            '<broker>Relay message of handler ID:', wrappedData.handlerId,
            'nodes', wrappedData.nodes,
            'relay delay', conf.relayDelay, 'ms'
        );
        if (conf.relayDelay) {
            setTimeout(() => {
                send(wrappedData.handlerId, wrappedData.nodes, wrappedData.data);
            }, conf.relayDelay);
        } else {
            send(wrappedData.handlerId, wrappedData.nodes, wrappedData.data);
        }
    } catch (error) {
        logger.error(
            '<broker>Failed to relay a message of handler ID:', wrappedData.handlerId,
            'nodes:', wrappedData.nodes,
            'error:', error
        );
    }
    return wrappedData.data;
}

function _getNode(nodes) {
    var node = nodes.shift();
    if (!node) {
        return null;
    }
    if (!announce.nodeExists(node.address, node.port)) {
        // node we found is no longer available: skip this node find next node
        return _getNode(nodes);
    }
    // this node is available
    return node;
}

function handler(handlerId, _handler) {
    delivery.handler(handlerId, _handler);
}

function getBackupNodes() {
    return backup.get(delivery.info(), announce.getNodeEndPoints());
}

