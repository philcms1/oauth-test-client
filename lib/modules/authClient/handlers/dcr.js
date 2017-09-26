const Joi = require('joi');

const ProviderServices = require('../services/provider');
const Models = require('../persistence/mongodb/models');

const basicDcrSchema = {
    req_id: Joi.string().token().max(15).required(),
    client_name: Joi.string().token().min(10).max(50),
    client_uri: Joi.string().uri().optional().allow(''),
    response_type: Joi.string().valid('code', 'token').required(),
    token_endpoint_auth_method: Joi.string().valid('none', 'client_secret_basic', 'client_secret_post', 'client_secret_jwt', 'private_key_jwt')
};

const grantTypesSchema = { grant_types: Joi.array().items(Joi.string().valid('authorization_code', 'implicit', 'client_credentials', 'refresh_token')) };

module.exports.getDcr = function(request, reply) {
    return reply.view('dcr', {
        req_id: request.pre.req_id,
        user: request.auth.credentials
    })
};

module.exports.postDcr = function(request, reply) {
    request.log(['test-dcr'], `Payload for registration: ${JSON.stringify(request.payload)}.`);

    ProviderServices.registerClient(request.server.app.active_provider.registration_endpoint, request.payload)
        .then(response => {
            request.log(['test-dcr'], `Successfully registered client, and received from AS: ${JSON.stringify(response.data)}.`);
            Models
                .saveClient(response.data)
                .then((client) => {
                    request.log(['test-addclient'], `Successfully created client ${client.client_id}.`);
                    return reply.redirect('/client/clients');
                }, (err) => {
                    request.log(['test-addclient-error'], `Error creating client: ${err}.`);
                    return reply.view('error', {
                        error_message: err.message,
                        user: request.auth.credentials,
                        client: request.server.app.active_client.hasOwnProperty('client_id') ? request.server.app.active_client : undefined,
                        provider: request.server.app.active_provider.hasOwnProperty('provider_name') ? request.server.app.active_provider : undefined
                    });
                });
        })
        .catch(err => {
            request.log(['test-dcr-error'], `Error registering client with OAuth server: ${err}.`);
            return reply.view('error', {
                error_message: err.message,
                user: request.auth.credentials
            });
        });
};

module.exports.validateDcrPayload = (val, options, next) => {
    console.log(`Custom validating payload: ${JSON.stringify(val)}`);
    const form_errors = {};
    const customErrorMessages = {
        req_id: 'should be a valid email address',
        client_name: 'should be 10 tp 50 characters long, and only contain a-z, A-Z, 0-9, and underscore _',
        client_uri: 'should be a URI',
        redirect_uris: 'should be a comma separated list of maximum 5 URIs',
        grant_types: 'should be one of the following values: Authorization Code, Client Credentials, or Refresh Token',
        token_endpoint_auth_method: 'should be one of the following values: client_secret_basic, client_secret_post, client_secret_jwt, or private_key_jwt',
        response_type: 'Can only be "code" with a grant type of "Authorization Code and "token" with "implicit", or either with "Client Credentials"',
        scope: 'should be space-separated list of maximum 10 strings of alphanumerical characters'
    };


    const basicResult = Joi.validate(val, basicDcrSchema, {
        abortEarly: false,
        stripUnknown: true
    });

    if (basicResult.error) {
        basicResult.error.details.forEach(detail => {
            form_errors[detail.path] = customErrorMessages[detail.path];
        });
    }

    if (!val.client_uri || typeof val.client_uri === 'string' && val.client_uri.length === 0) {
        delete val.client_uri;
    }

    // Validate redirect_uris
    const redirect_uris_array = [];
    val.redirect_uris.split(',').forEach(s => redirect_uris_array.push(s.trim()));
    if (redirect_uris_array.length > 5) {
        form_errors.redirect_uris = customErrorMessages.redirect_uris;
    } else {
        try {
            redirect_uris_array.forEach(uri => Joi.assert(uri, Joi.string().uri()));
            val.redirect_uris = redirect_uris_array;
        } catch(err) {
            form_errors.redirect_uris = customErrorMessages.redirect_uris;
        }
    }

    // Validate grant_types
    const grant_types_array = Array.isArray(val.grant_types) ? val.grant_types : [val.grant_types];
    try {
        Joi.assert({ grant_types: grant_types_array }, grantTypesSchema);
        val.grant_types = grant_types_array;
    } catch(err) {
        form_errors.grant_types = customErrorMessages.grant_types;
    }

    // Validate scope
    if (typeof val.scope === 'string' && val.scope.length > 0) {
        const array_scopes = [];
        val.scope.split(' ').forEach(s => array_scopes.push(s.trim()));
        if (array_scopes.length > 10) {
            form_errors.scope = customErrorMessages.scope;
        } else {
            try {
                array_scopes.forEach(s => Joi.assert(s, Joi.string().alphanum().min(1).max(50)));
            } catch(err) {
                form_errors.scope = customErrorMessages.scope;
            }
        }
    } else {
        delete val.scope;
    }

    // Validate response types
    if ((grant_types_array.indexOf('authorization_code') > -1 && val.response_type !== 'code')
        || grant_types_array.indexOf('implicit') > -1 && val.response_type !== 'token') {
        form_errors.response_type = customErrorMessages.response_type;
    }


    if (Object.keys(form_errors).length === 0 && form_errors.constructor === Object) {
        console.log('form_errors is empty');
        next();
    } else {
        console.log('form_errors not empty');
        console.log(form_errors);

        next(form_errors, val);
    }
};

module.exports.failActionPostDcrValidation = function(request, reply, source, error) {
    reply.view('dcr', {
        errors: error.data,
        values: request.payload,
        req_id: request.payload.req_id,
        user: request.auth.credentials
    }).code(400);
};
