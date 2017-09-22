const meta = require('./package');
const Path = require('path');
const Joi = require('joi');
const Boom = require('boom');
const Handlebars = require('handlebars');
const Wreck = require('wreck');
const qs = require('qs');
const querystring = require('querystring');
const Randomstring = require('randomstring');
const _ = require('lodash');

const Models = require('./persistence/mongodb/models');
const FormUtils = require('./utils/form-util');
const DcrHandler = require('./handlers/dcr');

const userPwd = process.env.SECRET_PASSWORD || 'asdfg123';

const wreck = Wreck.defaults({
    json: true,
    baseUrl: 'https://localhost:8443/oauth2',
    rejectUnauthorized: false
});

let active_client = {};
let active_provider = {};



let form_errors = {};

const encodeClientCredentials = (clientId, clientSecret) => {
    return new Buffer(querystring.escape(clientId) + ':' + querystring.escape(clientSecret)).toString('base64');
};

exports.register = (server, options, next) => {

    server.app.active_client = {};
    server.app.active_provider = {};

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
                client: server.app.active_client.hasOwnProperty('client_id') ? server.app.active_client : undefined,
                provider: server.app.active_provider.hasOwnProperty('provider_name') ? server.app.active_provider : undefined
            })
        }
    });

    /*******************************************************************************************************/
    /*                                   Dynamic Client Registration                                       */
    /*******************************************************************************************************/
    server.route({
        method: 'GET',
        path: '/dcr',
        handler: DcrHandler.getDcr,
        config: {
            pre: [{
                assign: 'req_id',
                method: FormUtils.setRequestKey
            }]
        }
    });

    server.route({
        method: 'POST',
        path: '/dcr',
        handler: DcrHandler.postDcr,
        config: {
            pre: [{
                assign: 'req_data',
                method: FormUtils.checkRequestKey
            }],
            validate: {
                payload: DcrHandler.validateDcrPayload,
                failAction: function(request, reply, source, error) {
                    reply.view('dcr', {
                        errors: error.data,
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
            return reply.view('addprovider', {
                req_id: request.pre.req_id,
                user: request.auth.credentials
            })
        },
        config: {
            pre: [{
                assign: 'req_id',
                method: (request, reply) => {
                    FormUtils.setRequestKey(request, reply);
                }
            }]
        }
    });

    server.route({
        method: 'POST',
        path: '/addprovider',
        handler: (request, reply) => {
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
        },
        config: {
            pre: [{
                assign: 'req_data',
                method: (request, reply) => {
                    FormUtils.checkRequestKey(request, reply);
                }
            }],
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
                    server.app.active_provider = {
                        provider_name: provider.provider_name,
                        authorization_endpoint: provider.authorization_endpoint,
                        token_endpoint: provider.token_endpoint,
                        revocation_endpoint: provider.revocation_endpoint,
                        registration_endpoint: provider.registration_endpoint,
                        userinfo_endpoint: provider.userinfo_endpoint

                    };
                    request.log(['client-set-provider'], `Setting active provider: ${JSON.stringify(server.app.active_provider)}.`);
                    return reply.view('home', {
                        user: request.auth.credentials,
                        client: active_client.hasOwnProperty('client_id') ? active_client : undefined,
                        provider: server.app.active_provider
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

            return reply.view('login', {
                req_id: request.pre.req_id,
                next: nextUrl,
                user: request.auth.credentials
            })
        },
        config: {
            pre: [{
                assign: 'req_id',
                method: (request, reply) => {
                    FormUtils.setRequestKey(request, reply);
                }
            }],
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
        },
        config: {
            pre: [{
                assign: 'req_data',
                method: (request, reply) => {
                    FormUtils.checkRequestKey(request, reply);
                }
            }],
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