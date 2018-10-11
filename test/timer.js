'use strict';

const mlink = require('../index');

mlink.start({
    logger: console
});

setTimeout(stop, 2000);

function stop() {
    mlink.stop()
        .then(() => {
            console.log('done!');
            process.exit(0);
        });
}

