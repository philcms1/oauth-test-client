const Mongoose = require('mongoose');
const ObjectID = require('mongodb').ObjectID;

const clientSchema = Mongoose.Schema({
        client_name: {type: String, unique: true},
        client_id: {type: String, unique: true, required: true},
        client_secret: {type: String, required: true},
        response_type: {type: String},
        token_endpoint_auth_method: {type: String, required: true},
        grant_types: [{type: String, required: true}],
        redirect_uris: [{type: String, required: true}],
        scope: {type: String},
        active: {type: Boolean}
    },
    {
        timestamps: {
            createdAt: 'created_at',
            updatedAt: 'updated_at'
        }
    }
);

const providerSchema = Mongoose.Schema({
        provider_name: {type: String, unique: true, required: true},
        authorization_endpoint: {type: String, required: true},
        token_endpoint: {type: String, required: true},
        revocation_endpoint: {type: String, required: true},
        registration_endpoint: {type: String, required: true},
        userinfo_endpoint: {type: String, required: true},
        active: {type: Boolean}
    },
    {
        timestamps: {
            createdAt: 'created_at',
            updatedAt: 'updated_at'
        }
    }
);

const codeSchema = Mongoose.Schema({
        code: {type: String, required: true},
        client_id: {type: String, required: true},
        redirect_uri: {type: String, required: true},
        state: {type: String, required: true},
        scope: {type: String},
        ttl: Date
    },
    {
        timestamps: {
            createdAt: 'created_at',
            updatedAt: 'updated_at'
        }
    }
);

const tokenSchema = Mongoose.Schema({
        access_token: {type: String, required: true},
        refresh_token: {type: String, required: true},
        client_id: {type: String, required: true},
        token_type: {type: String, required: true},
        state: {type: String, required: true},
        scope: {type: String},
        ttl: Date
    },
    {
        timestamps: {
            createdAt: 'created_at',
            updatedAt: 'updated_at'
        }
    }
);

const userSchema = Mongoose.Schema({
        email: {type: String, required: true},
        password: {type: String, required: true},
        active: {type: Boolean},
        role: {type: String},
    },
    {
        timestamps: {
            createdAt: 'created_at',
            updatedAt: 'updated_at'
        }
    }
);

const Client = Mongoose.model('Client', clientSchema);
const Provider = Mongoose.model('Provider', providerSchema);
const Code = Mongoose.model('Code', codeSchema);
const Token = Mongoose.model('Token', tokenSchema);
const User = Mongoose.model('User', userSchema);

/*************************************************/
/*                    Clients                    */
/*************************************************/
module.exports.findClientById = function(client_id) {
    return Client.findOne({client_id: client_id});
};

module.exports.findClients = function() {
    return Client.find();
};

module.exports.deleteClient = function(client_id) {
    return Client.findOneAndRemove({client_id: client_id})
};

module.exports.saveClient = function(client_data) {
    client_data.user_id = ObjectID(client_data.user_id);
    const newClient = new Client(client_data);
    return newClient.save();
};

/*************************************************/
/*                    Clients                    */
/*************************************************/
module.exports.findProviders = function() {
    return Provider.find();
};

module.exports.saveProvider = function(provider_data) {
    const newProvider = new Provider(provider_data);
    return newProvider.save();
};

/*************************************************/
/*                     Codes                     */
/*************************************************/
module.exports.deleteCode = function(_id) {
    return Code.findOneAndRemove({_id: ObjectID(_id)})
};

module.exports.findCodeByValue = function(code) {
    return Code.findOne({code: code})
};

module.exports.saveCode = function(code_data) {
    const newCode = new Code(code_data);
    return newCode.save();
};

/*************************************************/
/*                     Users                     */
/*************************************************/
module.exports.findUsers = function() {
    return User.find();
};

module.exports.findUserByEmail = function(email) {
    return User.findOne({email: email});
};

module.exports.saveUser = function(user_data) {
    const newUser = new User(user_data);
    return newUser.save();
};

/*************************************************/
/*                     Tokens                    */
/*************************************************/
module.exports.findTokenByRefresh = function(refresh_token) {
    return Token.findOne({refresh_token: refresh_token});
};

module.exports.deleteTokenByClientId = function(client_id) {
    return Token.findOneAndRemove({client_id: client_id});
};

module.exports.deleteToken = function(_id) {
    return Token.findOneAndRemove({_id: ObjectID(_id)});
};

module.exports.saveToken = function(token_data) {
    const newToken = new Token(token_data);
    return newToken.save();
};