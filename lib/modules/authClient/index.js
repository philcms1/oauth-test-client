const meta = require('./package');
const Path = require('path');
const Joi = require('joi');
const Handlebars = require('handlebars');

const Models = require('./persistence/mongodb/models');
const FormUtils = require('./utils/form-util');
const DcrHandler = require('./handlers/dcr');
const ClientsHandler = require('./handlers/clients');
const ProvidersHandler = require('./handlers/providers');
const TokensHandler = require('./handlers/tokens');
const LoginHandler = require('./handlers/login');

exports.register = (server, options, next) => {

    server.app.active_client = {};
    server.app.active_provider = {};
    server.app.active_token = {};

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
        isCached: false
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
                provider: server.app.active_provider.hasOwnProperty('provider_name') ? server.app.active_provider : undefined,
                token: server.app.active_token.hasOwnProperty('access_token') ? server.app.active_token : undefined
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
                failAction: DcrHandler.failActionPostDcrValidation
            }
        }
    });
    // END ---------------------------------------------------------------------------------------------------

    /*******************************************************************************************************/
    /*                                             Clients                                                 */
    /*******************************************************************************************************/
    server.route({
        method: 'GET',
        path: '/clients',
        handler: ClientsHandler.getClients
    });

    server.route({
        method: 'GET',
        path: '/addclient',
        handler: ClientsHandler.getAddClient,
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
        path: '/addclient',
        handler: ClientsHandler.postClient,
        config: {
            pre: [{
                assign: 'req_data',
                method: (request, reply) => {
                    FormUtils.checkRequestKey(request, reply);
                }
            }],
            validate: {
                payload: ClientsHandler.validateClientPayload,
                failAction: ClientsHandler.failActionPostclientValidation
            }
        }
    });
    // END ---------------------------------------------------------------------------------------------------

    /*******************************************************************************************************/
    /*                                            Providers                                                */
    /*******************************************************************************************************/
    server.route({
        method: 'GET',
        path: '/providers',
        handler: ProvidersHandler.getProviders
    });

    server.route({
        method: 'GET',
        path: '/addprovider',
        handler: ProvidersHandler.getAddProvider,
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
        handler: ProvidersHandler.postProvider,
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
                failAction: ProvidersHandler.failActionPostProviderValidation
            }
        }
    });
    // END ---------------------------------------------------------------------------------------------------

    /*******************************************************************************************************/
    /*                                             Tokens                                                  */
    /*******************************************************************************************************/
    server.route({
        method: 'GET',
        path: '/tokens',
        handler: TokensHandler.getTokens
    });

    server.route({
        method: 'POST',
        path: '/token',
        handler: TokensHandler.postToken
    });

    server.route({
        method: 'GET',
        path: '/callback',
        handler: TokensHandler.tokenCallback,
        config: {
            auth: false
        }
    });
    // END ---------------------------------------------------------------------------------------------------




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
                    server.app.active_client = {
                        client_id: client.client_id,
                        client_secret: client.client_secret,
                        client_name: client.client_name,
                        response_type: client.response_type,
                        token_endpoint_auth_method: client.token_endpoint_auth_method,
                        redirect_uris: client.redirect_uris,
                        grant_types: client.grant_types

                    };
                    request.log(['client-set-client'], `Setting active client: ${JSON.stringify(server.app.active_client)}.`);
                    return reply.view('home', {
                        user: request.auth.credentials,
                        client: server.app.active_client,
                        provider: server.app.active_provider.hasOwnProperty('provider_name') ? server.app.active_provider : undefined
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
                        userinfo_endpoint: provider.userinfo_endpoint,
                        provider_id: provider._id
                    };
                    request.log(['client-set-provider'], `Setting active provider: ${JSON.stringify(server.app.active_provider)}.`);
                    return reply.view('home', {
                        user: request.auth.credentials,
                        client: server.app.active_client.hasOwnProperty('client_id') ? server.app.active_client : undefined,
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
        path: '/set_token',
        handler: (request, reply) => {

            const {token_id} = request.payload;
            request.log(['client-set-token'], `Setting active token with id ${token_id}.`);
            Models
                .findTokenById(token_id)
                .then(token => {
                    if (!token) {
                        const tokenNotFoundError = `Token not found with id: ${token_id}.`;
                        request.log(['client-set-token-error'], tokenNotFoundError);
                        return reply.view('error', {
                            error_message: tokenNotFoundError,
                            user: request.auth.credentials
                        });
                    }
                    server.app.active_token = {
                        access_token: token.access_token,
                        token_type: token.token_type,
                        state: token.state
                    };

                    if (token.refresh_token)
                        server.app.active_token.refresh_token = token.refresh_token;
                    if (token.scope)
                        server.app.active_token.scope = token.scope;

                    request.log(['client-set-token'], `Setting active token: ${JSON.stringify(server.app.active_token)}.`);
                    return reply.view('home', {
                        user: request.auth.credentials,
                        client: server.app.active_client,
                        provider: server.app.active_provider.hasOwnProperty('provider_name') ? server.app.active_provider : undefined,
                        token: server.app.active_token
                    });

                }, (err) => {
                    request.log(['client-set-client-error'], `Error checking if client ${token_id} exists: ${err}.`);
                    return reply.view('error', {
                        error_message: err.message,
                        user: request.auth.credentials
                    });
                });
        }
    });

    /*******************************************************************************************************/
    /*                                             Login                                                   */
    /*******************************************************************************************************/
    server.route({
        method: 'GET',
        path: '/login',
        handler: LoginHandler.getLogin,
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
        handler: LoginHandler.postLogin,
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
        handler: LoginHandler.logout
    });
    // END ---------------------------------------------------------------------------------------------------

    next();
};



exports.register.attributes = {
    pkg: meta,
};