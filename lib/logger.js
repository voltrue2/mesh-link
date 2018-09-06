'use strict';

var enabled = false;
var _info = '';

module.exports = {
    setup: setup,
    setInfo: setInfo,
    verbose: verbose,
    sys: sys,
    debug: debug,
    info: info,
    warn: warn,
    fatal: fatal
};

function setup(_enabled) {
    enabled = _enabled;
}

function setInfo(__info) {
    _info =  '[' + __info.address + '/' + __info.port + ']';
}

function verbose() {
    _log('verbose', arguments);
}

function sys() {
    _log('sys', arguments);
}

function debug() {
    _log('debug', arguments);
}

function info() {
    _log('info', arguments);
}

function warn() {
    _log('warn', arguments);
}

function error() {
    _log('error', arguments);
}

function fatal() {
    _log('fatal', arguments);
}

function _log(name, _args) {
    if (!enabled) {
        return;
    }
    var label = 'mesh-link{' + name + '}' + _info + ' -';
    var args = [ label ];
    for (var i = 0, len = _args.length; i < len; i++) {
        args.push(_args[i]);
    }
    if (warn === 'warn' || name === 'error' || name === 'fatal') {
        console.error.apply(console, args);
    } else {
        console.log.apply(console, args);
    }
}

