'use strict';

var enabled = false;
var _info = '';
var _onLogging;

module.exports = {
    setup: setup,
    setInfo: setInfo,
    verbose: verbose,
    sys: sys,
    debug: debug,
    info: info,
    warn: warn,
    error: error,
    fatal: fatal,
    onLogging: onLogging
};

function setup(_enabled) {
    enabled = _enabled;
}

function setInfo(__info) {
    _info =  '[' + __info.address + '/' + __info.port + ']';
}

function onLogging(func) {
    _onLogging = func;
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
    if (_onLogging) {
        _onLogging(name, args.splice(1));
        return;
    }
    if (warn === 'warn' || name === 'error' || name === 'fatal') {
        /* eslint no-console: "off" */
        console.error.apply(console, args);
    } else {
        /* eslint no-console: "off" */
        console.log.apply(console, args);
    }
}

