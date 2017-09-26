const Randomstring = require('randomstring');
const qs = require('qs');
const querystring = require('querystring');

const Models = require('../persistence/mongodb/models');
const ProviderServices = require('../services/provider');

module.exports.getTokens = function(request, reply) {
    Models
        .findTokensByClientId(request.server.app.active_client.client_id)
        .then((tokens) => {
            request.log(['test-tokens'], `Retrieved ${tokens.length} tokens for display.`);
            return reply.view('tokens', {
                tokens: tokens,
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

module.exports.postToken = function(request, reply) {
    const { grant_type } = request.payload;

    if (request.server.app.active_client.grant_types.indexOf(grant_type) === -1) {
        const invalid_grant_type = `Requested grant type ${grant_type} is not valid.`;
        request.log(['client-token-error'], invalid_grant_type);
        return reply.view('error', {
            error_message: invalid_grant_type,
            user: request.auth.credentials
        });
    }

    request.server.app.selected_grant_type = grant_type;
    request.log(['client-token'], `Obtaining token for grant type ${grant_type}.`);

    request.server.app.runtime_state = Randomstring.generate(25);

    const client_data = {
        client_id: request.server.app.active_client.client_id,
        redirect_uri: request.server.app.active_client.redirect_uris[0],
        state: request.server.app.runtime_state
    };
    if (request.server.app.active_client.scope) {
        client_data.scope = request.server.app.active_client.scope;
    }

    switch(grant_type) {
        case 'authorization_code':
            client_data.response_type = 'code';
            request.log(['client-token'], `Client ${JSON.stringify(client_data)}.`);

            const query_parameters = Object.keys(client_data).map(function(k) {
                return encodeURIComponent(k) + "=" + encodeURIComponent(client_data[k]);
            }).join('&');

            const redirect_authorization_url = `${request.server.app.active_provider.authorization_endpoint}?${query_parameters}`;
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
};

module.exports.tokenCallback = function(request, reply) {
    const { state, code, error } = request.query;
    if (error) {
        request.log(['client-callback-error'], error.message);
        return reply.view('error', {
            error_message: error.message,
            user: request.auth.credentials
        });
    }

    if (state && request.server.app.runtime_state && request.server.app.runtime_state !== state) {
        request.log(['client-callback-error'], `Invalid state. Expected ${request.server.app.runtime_state}, got ${state}.`);
        return reply.view('error', {
            error_message: `Invalid state received from Oauth provider.`,
            user: request.auth.credentials
        });
    }

    switch(request.server.app.selected_grant_type) {
        case 'authorization_code':
            request.log(['client-callback'], `Requesting access token for authorization code ${code}.`);

            const token_data = {
                grant_type: request.server.app.selected_grant_type,
                code: code,
                redirect_uri: request.server.app.active_client.redirect_uris[0]
            };

            const form_data = qs.stringify(token_data);
            const headers = {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Authorization': 'Basic ' + encodeClientCredentials(request.server.app.active_client.client_id, request.server.app.active_client.client_secret)
            };

            // ProviderServices.getToken(request.server.app.active_provider.token_endpoint, )
            /*wreck.post(
                request.server.app.active_provider.token_endpoint,
                {
                    payload: form_data,
                    headers: headers
                },
                (err, res, payload) => {
                    if (err) {
                        request.log(['test-callback-error'], `Error getting token from provider: ${err}.`);
                        return reply.view('error', {
                            error_message: err.message,
                            user: request.auth.credentials
                        });

                    }
                    request.log(['test-callback'], `Successfully got token from provider: ${JSON.stringify(payload)}.`);
                    request.server.app.active_token = payload;
                    request.server.app.active_token.client_id = request.server.app.active_client.client_id;

                    Models.saveToken(request.server.app.active_token)
                        .then(token => {
                            request.log(['test-callback-error'], `Successfully persisted token.`);
                            return reply.view('home', {
                                user: request.auth.credentials,
                                client: request.server.app.active_client.hasOwnProperty('client_id') ? request.server.app.active_client : undefined,
                                provider: request.server.app.active_provider.hasOwnProperty('provider_name') ? request.server.app.active_provider : undefined,
                                token: request.server.app.active_token
                            });
                        }, err => {
                            request.log(['test-callback-error'], `Error saving token: ${err}.`);
                            return reply.view('error', {
                                error_message: `Error persisting token to database.`,
                                user: request.auth.credentials
                            });
                        });
                });*/
            break;
    }
};

const encodeClientCredentials = (clientId, clientSecret) => {
    return new Buffer(querystring.escape(clientId) + ':' + querystring.escape(clientSecret)).toString('base64');
};