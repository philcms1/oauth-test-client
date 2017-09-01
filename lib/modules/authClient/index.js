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