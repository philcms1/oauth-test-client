const userPwd = process.env.SECRET_PASSWORD || 'asdfg123';

module.exports.getLogin = function(request, reply) {
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
};

module.exports.postLogin = function(request, reply) {
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
};

module.exports.logout = function(request, reply) {
    request.cookieAuth.clear();
    return reply.redirect('/client/login');
};