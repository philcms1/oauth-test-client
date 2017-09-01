var express = require("express");
var bodyParser = require('body-parser');
var request = require("request");
var url = require("url");
var qs = require("qs");
var querystring = require('querystring');
var cons = require('consolidate');
var randomstring = require("randomstring");
var jose = require('jsrsasign');
var base64url = require('base64url');
var fs = require('fs');
var __ = require('underscore');
__.string = require('underscore.string');


var app = express();

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

app.engine('html', cons.underscore);
app.set('view engine', 'html');
app.set('views', 'files/client');

// client information
var client = {};

// authorization server information
var authServer = {
    authorizationEndpoint: process.env.AUTH_ENDPOINT || 'https://localhost:8443/oauth2/authorize',
    tokenEndpoint: process.env.TOKEN_ENDPOINT || 'https://localhost:8443/oauth2/token',
    // revocationEndpoint: 'http://localhost:9001/revoke',
    registrationEndpoint: process.env.REG_ENDPOINT || 'https://localhost:8443/oauth2/register'
    // userInfoEndpoint: 'http://localhost:9001/userinfo'
};

var protectedResource = process.env.PR_ENDPOINT || 'https://localhost:8443/api/questions';

var state = null;

var access_token = null;
var refresh_token = null;
var scope = null;
var id_token = null;
var userInfo = null;

app.get('/', function (req, res) {
	res.render('index', {access_token: access_token, refresh_token: refresh_token, scope: scope, client: client});
});

app.get('/authorize', function(req, res){
    var template = {
        client_name: 'OAuth Dynamic Test Client',
        client_uri: 'http://localhost:9000/',
        redirect_uris: ['http://localhost:9000/callback'],
        grant_types: ['client_credentials'],
        // response_types: ['code'],
        token_endpoint_auth_method: 'client_secret_basic',
        scope: 'foo bar'
    };

    var headers = {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
    };


	if (!client.client_id) {
        console.log('Registering client...');
        request({
            method: 'POST',
            url: authServer.registrationEndpoint,
            agentOptions: {
                ca: fs.readFileSync('nginx.cert')
            },
            body: JSON.stringify(template)
        }, function(err, resp, body) {

            if (resp.statusCode === 201) {
                // var body = JSON.parse(regRes.getBody());
                var parsedBody = JSON.parse(body);
                console.log("Got registered client", parsedBody);
                if (parsedBody.client_id) {
                    client = parsedBody;
                    // console.log(client);
                }
            } else {
                // var body = JSON.parse(regRes.getBody());
                console.log("Got error registering client", body);
            }

            if (!client.client_id) {
                res.render('error', {error: 'Unable to register client.'});
                return;
            }
            access_token = null;
            refresh_token = null;
            scope = null;
            state = randomstring.generate();

            var authorizeUrl = buildUrl(authServer.authorizationEndpoint, {
                response_type: 'code',
                scope: client.scope,
                client_id: client.client_id,
                redirect_uri: client.redirect_uris[0],
                state: state
            });

            console.log("redirect", authorizeUrl);
            res.redirect(authorizeUrl);

        });


	}	


});

app.get("/callback", function(req, res){

	if (req.query.error) {
		// it's an error response, act accordingly
		res.render('error', {error: req.query.error});
		return;
	}
	
	var resState = req.query.state;
	if (resState == state) {
		console.log('State value matches: expected %s got %s', state, resState);
	} else {
		console.log('State DOES NOT MATCH: expected %s got %s', state, resState);
		res.render('error', {error: 'State value did not match'});
		return;
	}

	var code = req.query.code;

	var form_data = qs.stringify({
				grant_type: 'client_credentials',
				// code: code,
				redirect_uri: client.redirect_uris[0]
			});
	var headers = {
		'Content-Type': 'application/x-www-form-urlencoded',
		'Authorization': 'Basic ' + encodeClientCredentials(client.client_id, client.client_secret)
	};

	/*var tokRes = request('POST', authServer.tokenEndpoint,
		{	
			body: form_data,
			headers: headers
		}
	);*/
    console.log('Requesting access token for code %s',code);
	request({
		method: 'POST',
		url: authServer.tokenEndpoint,
        agentOptions: {
            ca: fs.readFileSync('nginx.cert')
        },
		headers: headers,
		form_data: form_data
	}, function(err, resp, body) {
        if (resp.statusCode >= 200 && resp.statusCode < 300) {
            var parsedBody = JSON.parse(body);

            access_token = parsedBody.access_token;
            console.log('Got access token: %s', access_token);
            if (parsedBody.refresh_token) {
                refresh_token = parsedBody.refresh_token;
                console.log('Got refresh token: %s', refresh_token);
            }

            scope = parsedBody.scope;
            console.log('Got scope: %s', scope);

            res.render('index', {access_token: access_token, refresh_token: refresh_token, scope: scope, client: client});

        } else {
            res.render('error', {error: 'Unable to fetch access token, server response: ' + resp.statusCode})
        }
	});

	// console.log('Requesting access token for code %s',code);

});

app.get('/fetch_resource', function(req, res) {

	if (!access_token) {
		res.render('error', {error: 'Missing access token.'});
		return;
	}
	
	console.log('Making request with access token %s', access_token);
	
	var headers = {
		'Authorization': 'Bearer ' + access_token,
		'Content-Type': 'application/x-www-form-urlencoded'
	};
	
	var resource = request('POST', protectedResource,
		{headers: headers}
	);

	request({
		method: 'POST',
		url: protectedResource
	}, function(err, resp, body) {
        if (resp.statusCode >= 200 && resp.statusCode < 300) {
            var parsedBody = JSON.parse(body);
            res.render('data', {resource: parsedBody});
            return;
        } else {
            access_token = null;
            if (refresh_token) {
                // try to refresh and start again
                refreshAccessToken(req, res);
                return;
            } else {
                res.render('error', {error: 'Server returned response code: ' + resp.statusCode});
                return;
            }
        }
	});
	

	
});

app.use('/', express.static('files/client'));

var buildUrl = function(base, options, hash) {
	var newUrl = url.parse(base, true);
	delete newUrl.search;
	if (!newUrl.query) {
		newUrl.query = {};
	}
	__.each(options, function(value, key, list) {
		newUrl.query[key] = value;
	});
	if (hash) {
		newUrl.hash = hash;
	}
	
	return url.format(newUrl);
};

var encodeClientCredentials = function(clientId, clientSecret) {
	return new Buffer(querystring.escape(clientId) + ':' + querystring.escape(clientSecret)).toString('base64');
};

var server = app.listen(9000, 'localhost', function () {
  var host = server.address().address;
  var port = server.address().port;
  console.log('OAuth Client is listening at http://%s:%s', host, port);
});
 
