'use strict';

const mlink = require('../index');

mlink.start({
    updateInterval: 2000
});

setTimeout(stayAlive, 1000);

function stayAlive() {
    console.log(mlink.getNodeEndPoints().length);
    setTimeout(stayAlive, 1000);
}

