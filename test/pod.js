'use strict';

const mlink = require('../index');

mlink.start();

setTimeout(stayAlive, 10000);

function stayAlive() {
    setTimeout(stayAlive, 10000);
}

