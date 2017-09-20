const reqCacheClient = server.root.app.caching_catbox_memory;

/*
module.exports.getDcr = (request, reply) => {
    const req_id = Randomstring.generate(12);
    const key = { id: req_id, segment: 'requests' };
    reqCacheClient.set(key, request.query, 120000, (err) => {
        if (err) {
            request.log(['test-dcr-error'], `Error saving dcr request to cache with key ${req_id} -- defaulting to memory: ${err}.`);
        }
        request.log(['test-dcr'], `Successfully persisted dcr data to cache with key ${req_id}.`);
        reply.view('dcr', {
            req_id: req_id,
            user: request.auth.credentials

        })
    });
};*/
