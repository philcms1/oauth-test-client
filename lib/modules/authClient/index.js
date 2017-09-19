const meta = require('./package');
const Path = require('path');
const Joi = require('joi');
const Boom = require('boom');
const Mongoose = require('mongoose');
const Handlebars = require('handlebars');
const Wreck = require('wreck');
const qs = require('qs');
const querystring = require('querystring');
const Randomstring = require('randomstring');
const Catbox = require('catbox');
const CatboxMemory = require('catbox-memory');
const _ = require('lodash');

const Models = require('./persistence/mongodb/models');

Mongoose.Promise = require('bluebird');
Mongoose.set('debug', "true");
const mongoConnectionUri = process.env.MONGO_URI || 'mongodb://localhost/Test';
Mongoose.connect(mongoConnectionUri, {useMongoClient: true});

// TODO: parameterize this
const apiBaseUrl = 'http://localhost:9005/oauth2';

/**************************************/
//            CATBOX CACHING
/**************************************/
const cacheOptions = {
    expiresIn: 120000,
    segment: 'requests'
};
const reqCacheClient = new Catbox.Client(CatboxMemory, cacheOptions);
/**************************************/

const userPwd = process.env.SECRET_PASSWORD || 'asdfg123';

const wreck = Wreck.defaults({
    json: true,
    baseUrl: 'https://localhost:8443/oauth2',
    rejectUnauthorized: false
});

let active_client = {};
let active_provider = {};

const basicDcrSchema = {
    req_id: Joi.string().token().max(15).required(),
    client_name: Joi.string().token().min(10).max(50),
    client_uri: Joi.string().uri().optional().allow(''),
    response_type: Joi.string().valid('code', 'token').required(),
    token_endpoint_auth_method: Joi.string().valid('none', 'client_secret_basic', 'client_secret_post', 'client_secret_jwt', 'private_key_jwt')
};
const grantTypesSchema = { grant_types: Joi.array().items(Joi.string().valid('authorization_code', 'implicit', 'client_credentials', 'refresh_token')) };
let form_errors = {};

const encodeClientCredentials = (clientId, clientSecret) => {
    return new Buffer(querystring.escape(clientId) + ':' + querystring.escape(clientSecret)).toString('base64');
};

exports.register = (server, options, next) => {
    server.auth.strategy('auth-session', 'cookie', 'required', {
        password: 'password-should-be-32-characters',
        cookie: 'hapi-oauth2-ui',
        ttl: 60 * 60 * 1000,
        redirectTo: '/client/login',
        appendNext: true,
        isSecure: false
    });

    server.views({
        engines: { hbs: Handlebars },
        relativeTo: __dirname,
        path: Path.join(__dirname, 'views'),
        layoutPath: Path.join(__dirname, 'views/layout'),
        layout: true,
        isCached: false,
        partialsPath: Path.join(__dirname, 'views/partials'),
    });


    reqCacheClient.start((err) => {
        if (err) {
            server.log(['test-catbox-error'], `Error starting Catbox client: ${err}.`);
        }
        server.log(['test-catbox'], `Catbox client successfully started.`);
    });

    server.route({
        method: 'GET',
        path: '/{param*}',
        handler: {
            directory: {
                path: Path.join(__dirname, 'public')
            }
        },
        config: {
            auth: false
        }
    });

    server.route({
        method: 'GET',
        path: '/home',
        handler: (request, reply) => {
            reply.view('home', {
                user: request.auth.credentials,
                client: active_client.hasOwnProperty('client_id') ? active_client : undefined,
                provider: active_provider.hasOwnProperty('provider_name') ? active_provider : undefined
            })
        }
    });

    server.route({
        method: 'GET',
        path: '/dcr',
        handler: (request, reply) => {
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
        }
    });

    server.route({
        method: 'POST',
        path: '/dcr',
        handler: (request, reply) => {
            active_client = {};
            const req_id = request.payload.req_id;
            request.log(['test-dcr'], `Validating dcr POST request with key ${req_id}.`);
            const key = { id: req_id, segment: 'requests' };
            let dcrReqData;
            reqCacheClient.get(key, (err, cached) => {
                if (err) {
                    request.log(['test-dcr-error'], `Error retrieving dcr data from Catbox with key ${req_id}.`);
                    return reply.view('error', {
                        error_message: err.message,
                        user: request.auth.credentials
                    });
                } else if (cached) {
                    dcrReqData = cached.item;
                    request.log(['test-dcr'], `Successfully retrieved item from cache with key ${req_id}: ${dcrReqData}.`);
                    // const {email, password, rePassword} = request.payload;

                    reqCacheClient.drop(key, (err) => {
                        if (err) {
                            request.log(['test-dcr-error'], `Error dropping item from cache with key ${req_id}: ${err}.`);
                        }
                        request.log(['test-dcr'], `Successfully dropped item from cache with key ${req_id}.`);
                        delete request.payload.req_id;
                        request.log(['test-dcr'], `Payload for registration: ${JSON.stringify(request.payload)}.`);

                        wreck.post(
                            '/register',
                            {
                                payload: request.payload
                            },
                            (err, res, payload) => {
                                if (err) {
                                    request.log(['test-dcr-error'], `Error registering client with OAuth server: ${err}.`);
                                    return reply.view('error', {
                                        error_message: err.message,
                                        user: request.auth.credentials
                                    });

                                }
                                request.log(['test-dcr'], `Successfully registered client, and received from AS: ${JSON.stringify(payload)}.`);
                                Models
                                    .saveClient(payload)
                                    .then((client) => {
                                        request.log(['test-addclient'], `Successfully created client ${client.client_id}.`);
                                        return reply.redirect('/client/clients');
                                    }, (err) => {
                                        request.log(['test-addclient-error'], `Error creating client: ${err}.`);
                                        return reply.view('error', {
                                            error_message: err.message,
                                            user: request.auth.credentials,
                                            client: active_client.hasOwnProperty('client_id') ? active_client : undefined,
                                            provider: active_provider.hasOwnProperty('provider_name') ? active_provider : undefined
                                        });
                                    });
                            });
                    });
                }

                if (!dcrReqData) {
                    // No matching req_id, so the form submission is an error or attack
                    const addUserRequestNotFound = `No matching dcr request.`;
                    request.log(['test-dcr-error'], addUserRequestNotFound);
                    reply.view('error', {
                        error_message: addUserRequestNotFound,
                        user: request.auth.credentials
                    });
                }
            });
        },
        config: {
            validate: {
                payload: (val, options, next) => {
                    console.log(`Custom validating payload: ${JSON.stringify(val)}`);
                    form_errors = {};
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

                    // Optional values:
                    // logo_uri: Joi.string().uri().optional()

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
                        next(null, val);
                    } else {
                        console.log('form_errors not empty');
                        console.log(form_errors);
                        next(form_errors, val);
                    }
                },
                failAction: function(request, reply, source, error) {
                    reply.view('dcr', {
                        errors: form_errors,
                        values: request.payload,
                        req_id: request.payload.req_id,
                        user: request.auth.credentials
                    }).code(400);
                }
            }
        }
    });

    server.route({
        method: 'GET',
        path: '/clients',
        handler: (request, reply) => {
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
        }
    });

    server.route({
        method: 'GET',
        path: '/providers',
        handler: (request, reply) => {
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
        }
    });

    server.route({
        method: 'GET',
        path: '/addprovider',
        handler: (request, reply) => {
            const req_id = Randomstring.generate(12);
            const key = { id: req_id, segment: 'requests' };
            reqCacheClient.set(key, request.query, 120000, (err) => {
                if (err) {
                    request.log(['test-addprovider-error'], `Error saving add provider request to cache with key ${req_id}.`);
                }
                request.log(['test-addprovider'], `Successfully persisted add provider data to cache with key ${req_id}.`);
                reply.view('addprovider', {
                    req_id: req_id,
                    user: request.auth.credentials

                })
            });
        }
    });

    server.route({
        method: 'POST',
        path: '/addprovider',
        handler: (request, reply) => {
            const {req_id} = request.payload;
            request.log(['test-addprovider'], `Validating add provider POST request with key ${req_id}.`);
            const key = { id: req_id, segment: 'requests' };
            let addProviderReqData;
            reqCacheClient.get(key, (err, cached) => {
                if (err) {
                    request.log(['test-addprovider-error'], `Error retrieving add provider data from Catbox with key ${req_id}.`);
                }
                if (cached) {
                    addProviderReqData = cached.item;
                    request.log(['test-addprovider'], `Successfully retrieved item from cache with key ${req_id}: ${addProviderReqData}.`);
                    reqCacheClient.drop(key, (err) => {
                        if (err) {
                            request.log(['test-addprovider-error'], `Error dropping item from cache with key ${req_id}: ${err}.`);
                        }
                        request.log(['test-addprovider'], `Successfully dropped item from cache with key ${req_id}.`);

                        // Parse payload and only use non-empty ones

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
                    });
                } else {
                    const addProviderRequestNotFound = `No matching add provider request.`;
                    request.log(['test-addprovider-error'], addProviderRequestNotFound);
                    reply.view('error', {
                        error_message: addProviderRequestNotFound,
                        user: request.auth.credentials
                    });
                }
            });
        },
        config: {
            validate: {
                payload: {
                    provider_name: Joi.string().regex(/^[a-zA-Z0-9-]{3,30}$/).required(),
                    authorization_endpoint: Joi.string().uri().required(),
                    token_endpoint: Joi.string().uri().required(),
                    revocation_endpoint: Joi.string().uri().optional().allow(''),
                    registration_endpoint: Joi.string().uri().optional().allow(''),
                    userinfo_endpoint: Joi.string().uri().optional().allow(''),
                    req_id: Joi.string().token().max(15).required()
                },
                options: {
                    abortEarly: false
                },
                failAction: function(request, reply, source, error) {
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
                }
            }
        }
    });

    server.route({
        method: 'POST',
        path: '/set_client',
        handler: (request, reply) => {

            const {client_id} = request.payload;
            request.log(['client-set-client'], `Setting active client with id ${client_id}.`);
            Models
                .findClientById(client_id)
                .then((client) => {
                    if (!client) {
                        const clientNotFoundError = `Client not found with id: ${client_id}.`;
                        request.log(['client-set-client-error'], clientNotFoundError);
                        return reply.view('error', {
                            error_message: clientNotFoundError,
                            user: request.auth.credentials
                        });
                    }
                    active_client = {
                        client_id: client.client_id,
                        client_secret: client.client_secret,
                        client_name: client.client_name,
                        response_type: client.response_type,
                        token_endpoint_auth_method: client.token_endpoint_auth_method,
                        redirect_uris: client.redirect_uris,
                        grant_types: client.grant_types

                    };
                    request.log(['client-set-client'], `Setting active client: ${JSON.stringify(active_client)}.`);
                    return reply.view('home', {
                        user: request.auth.credentials,
                        client: active_client,
                        provider: active_provider.hasOwnProperty('provider_name') ? active_provider : undefined
                    });

                }, (err) => {
                    request.log(['client-set-client-error'], `Error checking if client ${client_id} exists: ${err}.`);
                    return reply.view('error', {
                        error_message: err.message,
                        user: request.auth.credentials
                    });
                });
        }
    });

    server.route({
        method: 'POST',
        path: '/set_provider',
        handler: (request, reply) => {

            const {provider_name} = request.payload;
            request.log(['client-set-provider'], `Setting active provider with name ${provider_name}.`);
            Models
                .findProviderByName(provider_name)
                .then((provider) => {
                    if (!provider) {
                        const providerNotFoundError = `Provider not found with name: ${provider_name}.`;
                        request.log(['client-set-provider-error'], providerNotFoundError);
                        return reply.view('error', {
                            error_message: providerNotFoundError,
                            user: request.auth.credentials
                        });
                    }
                    active_provider = {
                        provider_name: provider.provider_name,
                        authorization_endpoint: provider.authorization_endpoint,
                        token_endpoint: provider.token_endpoint,
                        revocation_endpoint: provider.revocation_endpoint,
                        registration_endpoint: provider.registration_endpoint,
                        userinfo_endpoint: provider.userinfo_endpoint

                    };
                    request.log(['client-set-provider'], `Setting active provider: ${JSON.stringify(active_provider)}.`);
                    return reply.view('home', {
                        user: request.auth.credentials,
                        client: active_client.hasOwnProperty('client_id') ? active_client : undefined,
                        provider: active_provider
                    });

                }, (err) => {
                    request.log(['client-setclient-error'], `Error checking if client ${client_id} exists: ${err}.`);
                    return reply.view('error', {
                        error_message: err.message,
                        user: request.auth.credentials
                    });
                });
        }
    });

    server.route({
        method: 'POST',
        path: '/token',
        handler: (request, reply) => {
            const { grant_type } = request.payload;

            if (active_client.grant_types.indexOf(grant_type) === -1) {
                const invalid_grant_type = `Requested grant type ${grant_type} is not valid.`;
                request.log(['client-token-error'], invalid_grant_type);
                return reply.view('error', {
                    error_message: invalid_grant_type,
                    user: request.auth.credentials
                });
            }

            request.log(['client-token'], `Obtaining token for grant type ${grant_type}.`);

            active_client.state = Randomstring.generate(25);

            const client_data = {
                client_id: active_client.client_id,
                redirect_uri: active_client.redirect_uris[0],
                state: active_client.state
            };
            if (active_client.scope) {
                client_data.scope = active_client.scope;
            }

            switch(grant_type) {
                case 'authorization_code':
                    client_data.response_type = 'code';
                    request.log(['client-token'], `Client ${JSON.stringify(client_data)}.`);

                    const query_parameters = Object.keys(client_data).map(function(k) {
                        return encodeURIComponent(k) + "=" + encodeURIComponent(client_data[k]);
                    }).join('&');

                    const redirect_authorization_url = `${active_provider.authorization_endpoint}?${query_parameters}`;
                    request.log(['client-token'], `Redirecting to ${redirect_authorization_url}.`);

                    return reply.redirect(redirect_authorization_url);
                    break;
                case 'implicit':
                    break;
                case 'client_credentials':
                    break;
                case 'refresh_token':
                    break;
            }



            /*const id = request.params.id;
            console.log('Ready to get a token for client ID: ' + id);
            Models
                .findClientById(id)
                .then((client) => {
                    if (!client) {
                        const clientNotFoundError = `Client not found with id: ${id}.`;
                        request.log(['client-token-error'], clientNotFoundError);
                        return reply.view('error', {
                            error_message: clientNotFoundError,
                            user: request.auth.credentials
                        });
                    }
                    active_client = client;
                    // TODO: give choice for grant type
                    // should probably be selected in the table directly
                    const client_grant_type = active_client.grant_types[0];
                    request.log(['client-token'], `Getting token for grant type ${client_grant_type}.`);

                    const client_data = {
                        client_id: active_client.client_id,
                        redirect_uri: active_client.redirect_uris[0],
                        state: Randomstring.generate(25)
                    };
                    if (active_client.scope) {
                        client_data.scope = active_client.scope;
                    }

                    switch(client_grant_type) {
                        case 'authorization_code':
                            client_data.response_type = 'code';
                            console.log(`Client data: ${JSON.stringify(client_data)}`);
                            break;
                        case 'implicit':
                            break;
                        case 'client_credentials':
                            break;
                        case 'refresh_token':
                            break;
                    }

                }, (err) => {
                    request.log(['client-token-error'], `Error checking if client ${id} exists: ${err}.`);
                    return reply.view('error', {
                        error_message: err.message,
                        user: request.auth.credentials
                    });
                });*/
        }
    });

    server.route({
        method: 'GET',
        path: '/callback',
        handler: (request, reply) => {
            const { state, code, error } = request.query;
            if (error) {
                console.log('error');
            }

            if (state && active_client.state && active_client.state !== state) {
                console.log('wrong state');
            }

            switch(active_client.grant_types[0]) {
                case 'authorization_code':
                    console.log(`Received code ${code}`);

                    const token_data = {
                        grant_type: active_client.grant_types[0],
                        code: code,
                        redirect_uri: active_client.redirect_uris[0]
                    };

                    const form_data = qs.stringify(token_data);
                    const headers = {
                        'Content-Type': 'application/x-www-form-urlencoded',
                        'Authorization': 'Basic ' + encodeClientCredentials(active_client.client_id, active_client.client_secret)
                    };

                    console.log('Requesting access token for code %s',code);

                    wreck.post(
                        active_provider.token_endpoint,
                        {
                            payload: form_data,
                            headers: headers
                        },
                        (err, res, payload) => {
                            if (err) {
                                request.log(['test-token-error'], `Error getting token from provider: ${err}.`);
                                return reply.view('error', {
                                    error_message: err.message,
                                    user: request.auth.credentials
                                });

                            }
                            request.log(['test-token'], `Successfully got token, and received from provider: ${JSON.stringify(payload)}.`);
                            return reply.redirect('/client/home');
                        });

                    break;
            }




        },
        config: {
            auth: false
        }
    });

    server.route({
        method: 'GET',
        path: '/login',
        handler: (request, reply) => {
            const nextUrl = request.query.next;

            if (request.auth.isAuthenticated) {
                console.log('****  /login already authenticated.');
                return reply.redirect('/client/home');
            }

            const req_id = Randomstring.generate(12);
            const key = { id: req_id, segment: 'requests' };
            reqCacheClient.set(key, request.query, 120000, (err) => {
                if (err) {
                    request.log(['test-login-error'], `Error saving login request to cache with key ${req_id} -- defaulting to memory: ${err}.`);
                }
                request.log(['test-login'], `Successfully persisted login data to cache with key ${req_id}.`);
                reply.view('login', {
                    req_id: req_id,
                    next: nextUrl,
                    user: request.auth.credentials
                })
            });
        },
        config: {
            auth: {
                strategy:'auth-session',
                mode: 'try'
            },
            plugins: {
                'hapi-auth-cookie': {
                    redirectTo: false
                }
            },
            validate: {
                query: {
                    next: Joi.string()
                }
            }
        }
    });

    server.route({
        method: 'POST',
        path: '/login',
        handler: (request, reply) => {

            if (request.auth.isAuthenticated) {
                console.log('****  /login already authenticated.');
                return reply.redirect('/client/home');
            }

            const req_id = request.payload.req_id;
            request.log(['test-login'], `Validating login POST request with key ${req_id}.`);
            const key = { id: req_id, segment: 'requests' };
            let loginReqData;
            reqCacheClient.get(key, (err, cached) => {
                if (err) {
                    request.log(['test-login-error'], `Error retrieving login data from Catbox with key ${req_id}. Falling back to memory.`);
                    loginReqData = requests[req_id];
                } else if (cached) {
                    loginReqData = cached.item;
                    request.log(['test-login'], `Successfully retrieved item from cache with key ${req_id}: ${JSON.stringify(loginReqData)}.`);
                    reqCacheClient.drop(key, (err) => {
                        if (err) {
                            request.log(['test-login-error'], `Error dropping item from cache with key ${req_id}: ${err}.`);
                        }
                        request.log(['test-login'], `Successfully dropped item from cache with key ${req_id}.`);

                        const {username, password, next} = request.payload;
                        if (password === userPwd) {
                            request.log(['test-login'], `Successfully logged in with ${username}.`);
                            request.cookieAuth.set({username: username});
                            if (next) {
                                return reply.redirect(next);
                            } else {
                                return reply.redirect('/client/home');
                            }
                        } else {
                            request.log(['test-login-error'], `Error login in.`);
                            return reply.redirect('/client/login');
                        }
                    });
                }

                if (!loginReqData) {
                    // No matching req_id, so the form submission is an error or attack
                    const loginRequestNotFound = `No matching login request.`;
                    request.log(['test-login-error'], loginRequestNotFound);
                    return reply.view('error', {
                        error_message: loginRequestNotFound,
                        user: request.auth.credentials
                    });
                }
            });
        },
        config: {
            auth: {
                strategy:'auth-session',
                mode: 'try'
            },
            plugins: {
                'hapi-auth-cookie': {
                    redirectTo: false
                }
            },
            validate: {
                payload: {
                    username: Joi.string().min(8).max(20).required(),
                    password: Joi.string().regex(/^[a-zA-Z0-9]{8,30}$/).required(),
                    req_id: Joi.string().token().max(12).required(),
                    next: Joi.string()
                }
            }
        }
    });

    server.route({
        method: 'GET',
        path: '/logout',
        handler: (request, reply) => {
            active_client = {};
            request.cookieAuth.clear();
            return reply.redirect('/client/login');
        }
    });

    next();
};



exports.register.attributes = {
    pkg: meta,
};