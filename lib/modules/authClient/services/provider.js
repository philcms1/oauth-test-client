const Axios = require('axios');
const https = require('https');

const axios = Axios.create({
    httpsAgent: new https.Agent({
        rejectUnauthorized: false
    })
});

module.exports.registerClient = (url, data) => axios.post(url, data);

module.exports.getToken = (url, data, config) => axios.post(url, data, config);