const Randomstring = require('randomstring');

module.exports.setRequestKey = (request, reply) => {
    const reqCacheClient = request.server.root.app.caching_catbox_memory;
    const req_id = Randomstring.generate(12);
    const key = { id: req_id, segment: 'requests' };
    reqCacheClient.set(key, request.query, 120000, (err) => {
        if (err) {
            request.log(['test-pre-error'], `Error saving request to cache with key ${req_id}.`);
            throw err;
        }
        request.log(['test-pre'], `Successfully persisted request to cache with key ${req_id}.`);
        reply(req_id);
    });
};

module.exports.checkRequestKey = (request, reply) => {
    const reqCacheClient = request.server.root.app.caching_catbox_memory;
    const { req_id } = request.payload;
    request.log(['test-pre'], `Validating POST request with key ${req_id}.`);
    const key = { id: req_id, segment: 'requests' };

    reqCacheClient.get(key, (err, cached) => {
        if (err) {
            request.log(['test-pre-error'], `Error retrieving request data from Catbox with key ${req_id}.`);
            throw err;
        }
        if (cached) {
            const req_data = cached.item;
            request.log(['test-dcr'], `Successfully retrieved item from cache with key ${req_id}: ${JSON.stringify(req_data)}.`);

            reqCacheClient.drop(key, (err) => {
                if (err) {
                    request.log(['test-pre-error'], `Error dropping item from cache with key ${req_id}: ${err}.`);
                    throw err;
                }
                request.log(['test-pre'], `Successfully dropped item from cache with key ${req_id}.`);
                delete request.payload.req_id;
                reply(req_data);
            });
        } else {
            request.log(['test-pre-error'], `No matching request for key ${req_id}.`);
            reply.view('error', {
                error_message: 'An error occurred. Please try again later.',
                user: request.auth.credentials
            });
        }
    });
};

