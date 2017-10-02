
const Joi = require('joi');

const Models = require('../persistence/mongodb/models');

const basicClientSchema = {
    req_id: Joi.string().token().max(15).required(),
    client_id: Joi.string().regex(/^[a-zA-Z0-9-]{8,150}$/).required(),
    client_secret: Joi.string().regex(/^[a-zA-Z0-9-]{8,150}$/).required(),
    client_description: Joi.string().allow(''),
    response_type: Joi.string().valid('code', 'token').required(),
    token_endpoint_auth_method: Joi.string().valid('none', 'client_secret_basic', 'client_secret_post', 'client_secret_jwt', 'private_key_jwt')
};

const grantTypesSchema = { grant_types: Joi.array().items(Joi.string().valid('authorization_code', 'implicit', 'client_credentials', 'refresh_token')) };

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

module.exports.getAddClient = function(request, reply) {
    return reply.view('addclient', {
        req_id: request.pre.req_id,
        user: request.auth.credentials
    })
};

module.exports.postClient = function(request, reply) {
    request.log(['client-addclient'], `Persisting client data ${JSON.stringify(request.payload)}.`);
    Models
        .saveClient(request.payload)
        .then((client) => {
            request.log(['client-addclient'], `Successfully created client ${client.client_id}.`);
            return reply.redirect('/client/clients');
        }, (err) => {
            request.log(['client-addclient-error'], `Error creating client: ${err}.`);
            return reply.view('error', {
                error_message: err.message,
                user: request.auth.credentials,
                client: request.server.app.active_client.hasOwnProperty('client_id') ? request.server.app.active_client : undefined,
                provider: request.server.app.active_provider.hasOwnProperty('provider_name') ? request.server.app.active_provider : undefined
            });
        });
};

module.exports.validateClientPayload = (val, options, next) => {
    console.log(`Custom validating payload: ${JSON.stringify(val)}`);
    const form_errors = {};
    const customErrorMessages = {
        req_id: 'should be a valid email address',
        client_id: 'should be 8 to 30 characters long, and only include letters and numbers and "-_"',
        client_secret: 'should be 8 t0 30 characters long, and only include letters and numbers and "-_"',
        redirect_uris: 'should be a comma separated list of maximum 5 URIs',
        grant_types: 'should be one of the following values: Authorization Code, Client Credentials, or Refresh Token',
        token_endpoint_auth_method: 'should be one of the following values: client_secret_basic, client_secret_post, client_secret_jwt, or private_key_jwt',
        response_type: 'Can only be "code" with a grant type of "Authorization Code and "token" with "implicit", or either with "Client Credentials"',
        scope: 'should be space-separated list of maximum 10 strings of alphanumerical characters'
    };


    const basicResult = Joi.validate(val, basicClientSchema, {
        abortEarly: false,
        stripUnknown: true
    });

    if (basicResult.error) {
        basicResult.error.details.forEach(detail => {
            form_errors[detail.path] = customErrorMessages[detail.path];
        });
    }

    if (!val.client_description || typeof val.client_description === 'string' && val.client_description.length === 0) {
        delete val.client_description;
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

module.exports.failActionPostclientValidation = function(request, reply, source, error) {
    reply.view('addclient', {
        errors: error.data,
        values: request.payload,
        req_id: request.payload.req_id,
        user: request.auth.credentials
    }).code(400);
};