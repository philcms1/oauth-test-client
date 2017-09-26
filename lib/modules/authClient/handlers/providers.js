const Models = require('../persistence/mongodb/models');

module.exports.getProviders = function(request, reply) {
    Models
        .findProviders()
        .then((providers) => {
            request.log(['test-providers'], `Retrieved ${providers.length} providers for display.`);
            return reply.view('providers', {
                providers: providers,
                user: request.auth.credentials
            });
        }, (err) => {
            request.log(['test-providers-error'], `Error retrieving providers: ${err}.`);
            return reply.view('error', {
                error_message: err.message,
                user: request.auth.credentials
            });
        });
};

module.exports.getAddProvider = function(request, reply) {
    return reply.view('addprovider', {
        req_id: request.pre.req_id,
        user: request.auth.credentials
    })
};

module.exports.postProvider = function(request, reply) {
    Models
        .saveProvider(request.payload)
        .then((provider) => {
            request.log(['test-addprovider'], `Successfully created provider ${provider.name}.`);
            return reply.redirect('/client/providers');
        }, (err) => {
            request.log(['test-addprovider-error'], `Error creating provider: ${err}.`);
            return reply.view('error', {
                error_message: err.message,
                user: request.auth.credentials
            });
        });
};

module.exports.failActionPostProviderValidation = function (request, reply, source, error) {
    const errors = {};
    const details = error.data.details;
    const customErrorMessages = {
        provider_name: 'should be 3 tp 30 characters long, and only include letters and numbers and "-_"',
        authorization_endpoint: 'should be a valid URI',
        token_endpoint: 'should be a valid URI',
        revocation_endpoint: 'should be a valid URI',
        registration_endpoint: 'should be a valid URI',
        userinfo_endpoint: 'should be a valid URI'
    };
    details.forEach((detail) => {
        if (!errors.hasOwnProperty(detail.path)) {
            errors[detail.path] = customErrorMessages[detail.path];
        }
    });

    reply.view('addprovider', {
        errors: errors,
        values: request.payload,
        req_id: request.payload.req_id,
        user: request.auth.credentials
    }).code(400);
};