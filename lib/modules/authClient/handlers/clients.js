
const Models = require('../persistence/mongodb/models');

module.exports.getClients = function(request, reply) {
    Models
        .findClients()
        .then((clients) => {
            request.log(['test-clients'], `Retrieved ${clients.length} clients for display.`);
            return reply.view('clients', {
                clients: clients,
                user: request.auth.credentials
            });
        }, (err) => {
            request.log(['test-clients-error'], `Error retrieving clients: ${err}.`);
            return reply.view('error', {
                error_message: err.message,
                user: request.auth.credentials
            });
        });
};