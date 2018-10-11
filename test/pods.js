'use strict';

const spawn = require('child_process').spawn;
const pod = __dirname + '/pod.js';
const howmany = parseInt(process.argv[2] || 1);

for (var i = 0; i < howmany; i++) {
    spawn(process.execPath, [ pod ]);
    console.log('starting a pod', (i + 1));
}

setTimeout(stayAlive, 10000);

function stayAlive() {
    setTimeout(stayAlive, 10000);
}

