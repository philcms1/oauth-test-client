const meta = require('./package');
const Catbox = require('catbox');
const CatboxMemory = require('catbox-memory');

exports.register = (server, options, next) => {
    /**************************************/
    //            CATBOX CACHING
    /**************************************/
    const cacheOptions = {
        expiresIn: 120000,
        segment: 'requests'
    };
    const reqCacheClient = new Catbox.Client(CatboxMemory, cacheOptions);

    reqCacheClient.start((err) => {
        if (err) {
            server.log(['caching-catbox-error'], `Error starting Catbox client: ${err}.`);
        }
        server.log(['caching-catbox'], `Catbox client successfully started.`);
        server.app.caching_catbox_memory = reqCacheClient;
    });

    next();
};

exports.register.attributes = {
    pkg: meta,
};
