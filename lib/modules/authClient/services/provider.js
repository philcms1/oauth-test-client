const Wreck = require('wreck');
const Axios = require('axios');
const https = require('https');

const axios = Axios.create({
    httpsAgent: new https.Agent({
        rejectUnauthorized: false
    })
});

const wreck = Wreck.defaults({
    json: true,
    rejectUnauthorized: false
});

module.exports.registerClient = function(url, data) {
    return axios.post(url, data);
};