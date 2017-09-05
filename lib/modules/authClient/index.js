const meta = require('./package');
const Path = require('path');
const Joi = require('joi');
const Boom = require('boom');
const Handlebars = require('handlebars');
const Wreck = require('wreck');
const Randomstring = require('randomstring');
const Catbox = require('catbox');
const CatboxMemory = require('catbox-memory');
const _ = require('lodash');

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

const client = {id: 123456};

const wreck = Wreck.defaults({
    baseUrl: 'https://localhost:8443/oauth2',
    rejectUnauthorized: false
});

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
            server.log(['ui-catbox-error'], `Error starting Catbox client: ${err}.`);
        }
        server.log(['ui-catbox'], `Catbox client successfully started.`);
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
                client: client.hasOwnProperty('id') ? client : undefined
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
                    request.log(['ui-dcr-error'], `Error saving dcr request to cache with key ${req_id} -- defaulting to memory: ${err}.`);
                }
                request.log(['ui-dcr'], `Successfully persisted dcr data to cache with key ${req_id}.`);
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
            const req_id = request.payload.req_id;
            request.log(['ui-dcr'], `Validating dcr POST request with key ${req_id}.`);
            const key = { id: req_id, segment: 'requests' };
            let dcrReqData;
            reqCacheClient.get(key, (err, cached) => {
                if (err) {
                    request.log(['ui-dcr-error'], `Error retrieving cdr data from Catbox with key ${req_id}.`);
                    return reply.view('error', {
                        error_message: err.message,
                        user: request.auth.credentials
                    });
                } else if (cached) {
                    dcrReqData = cached.item;
                    request.log(['ui-dcr'], `Successfully retrieved item from cache with key ${req_id}: ${dcrReqData}.`);
                    // const {email, password, rePassword} = request.payload;

                    reqCacheClient.drop(key, (err) => {
                        if (err) {
                            request.log(['ui-dcr-error'], `Error dropping item from cache with key ${req_id}: ${err}.`);
                        }
                        request.log(['ui-dcr'], `Successfully dropped item from cache with key ${req_id}.`);

                        console.log('Ready to process the payload...');


                        request.payload.redirect_uris = [request.payload.redirect_uris];
                        request.payload.grant_types = [request.payload.grant_types];
                        if (request.payload.scope.length === 0) {
                            delete request.payload.scope
                        }
                        if (request.payload.client_uri.length === 0) {
                            delete request.payload.client_uri
                        }
                        delete request.payload.req_id;
                        wreck.post(
                            '/register',
                            {
                                json: true,
                                payload: request.payload
                            },
                            (err, res, payload) => {
                            if (err) {
                                console.log(err);
                            }
                            console.log(res);
                        });

                        reply.view('home', {
                            user: request.auth.credentials,
                            client: client.hasOwnProperty('id') ? client : undefined
                        })

                    });
                }

                if (!dcrReqData) {
                    // No matching req_id, so the form submission is an error or attack
                    const addUserRequestNotFound = `No matching dcr request.`;
                    request.log(['ui-dcr-error'], addUserRequestNotFound);
                    reply.view('error', {
                        error_message: addUserRequestNotFound,
                        user: request.auth.credentials
                    });
                }
            });
        },
        config: {
            validate: {
                payload: {
                    // grant_types: Joi.array().items(Joi.string().valid('authorization_code', 'client_credentials', 'refresh_token')).optional(),
                    grant_types: Joi.any().optional(),
                    response_types: Joi.array().items(Joi.string().valid('code', 'token')).optional(),
                    token_endpoint_auth_method: Joi.string().valid('none', 'client_secret_basic', 'client_secret_post', 'client_secret_jwt', 'private_key_jwt').optional(),
                    scope: Joi.string().optional().allow(''),
                    client_name: Joi.string().min(10).max(50),
                    client_uri: Joi.string().uri().optional().allow(''),
                    logo_uri: Joi.string().uri().optional(),
                    redirect_uris: Joi.string().uri().required(),
                    /*clientName: Joi.string().required(),
                    clientUri: Joi.string().optional(),
                    redirectUris: Joi.string().required(),
                    authorizationCode: Joi.string(),
                    clientCredentials: Joi.string(),
                    tokenEndpointAuthOption: Joi.string().required(),
                    scope: Joi.string().optional(),*/
                    req_id: Joi.string().token().max(15).required()
                },
                options: {
                    abortEarly: false
                },
                failAction: function(request, reply, source, error) {
                    const errors = {};
                    const details = error.data.details;
                    console.log(details);
                    const customErrorMessages = {
                        email: 'should be a valid email address',
                        password: 'should be 3 tp 30 characters long, and only include letters and numbers'
                    };
                    details.forEach((detail) => {
                        if (!errors.hasOwnProperty(detail.path)) {
                            errors[detail.path] = customErrorMessages[detail.path];
                        }
                    });

                    reply.view('dcr', {
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
                    request.log(['ui-login-error'], `Error saving login request to cache with key ${req_id} -- defaulting to memory: ${err}.`);
                    requests[req_id] = request.query;
                }
                request.log(['ui-login'], `Successfully persisted login data to cache with key ${req_id}.`);
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
            request.log(['ui-login'], `Validating login POST request with key ${req_id}.`);
            const key = { id: req_id, segment: 'requests' };
            let loginReqData;
            reqCacheClient.get(key, (err, cached) => {
                if (err) {
                    request.log(['ui-login-error'], `Error retrieving login data from Catbox with key ${req_id}. Falling back to memory.`);
                    loginReqData = requests[req_id];
                } else if (cached) {
                    loginReqData = cached.item;
                    request.log(['ui-login'], `Successfully retrieved item from cache with key ${req_id}: ${JSON.stringify(loginReqData)}.`);
                    reqCacheClient.drop(key, (err) => {
                        if (err) {
                            request.log(['ui-login-error'], `Error dropping item from cache with key ${req_id}: ${err}.`);
                        }
                        request.log(['ui-login'], `Successfully dropped item from cache with key ${req_id}.`);

                        const {username, password, next} = request.payload;
                        if (password === userPwd) {
                            request.log(['ui-login'], `Successfully logged in with ${username}.`);
                            request.cookieAuth.set({username: username});
                            if (next) {
                                return reply.redirect(next);
                            } else {
                                return reply.redirect('/client/home');
                            }
                        } else {
                            request.log(['ui-login-error'], `Error login in.`);
                            return reply.redirect('/client/login');
                        }
                    });
                }

                if (!loginReqData) {
                    // No matching req_id, so the form submission is an error or attack
                    const loginRequestNotFound = `No matching login request.`;
                    request.log(['ui-login-error'], loginRequestNotFound);
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
            request.cookieAuth.clear();
            return reply.redirect('/client/login');
        }
    });

    next();
};



exports.register.attributes = {
    pkg: meta,
};