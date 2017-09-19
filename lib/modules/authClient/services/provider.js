const Wreck = require('wreck');

const wreck = Wreck.defaults({
    baseUrl: 'https://localhost:8443/oauth2',
    rejectUnauthorized: false
});

module.exports.registerClient = function(data) {
    return wreck.request('POST', '/register', { payload: data });
};