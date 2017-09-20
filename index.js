const Glue = require('glue');

const Manifest = {
    server: {},
    connections: [{
        port: process.env.PORT || 9000,
        labels: ["client"]
    }],
    registrations: [
        {
            plugin: {
                register: "good",
                options: {
                    reporters: {
                        console: [
                            {
                                module: "good-squeeze",
                                name: "Squeeze",
                                args: [{
                                    log: "*",
                                    request: "*",
                                    response: ["oauth2-*", "ui-*"]
                                }]
                            },
                            {
                                module: "good-console"
                            },
                            "stdout"
                        ]
                    }
                }
            }
        },
        {
            plugin: "vision"
        },
        {
            plugin: "inert"
        },
        {
            plugin: "lout"
        },
        {
            plugin: "tv"
        },
        {
            plugin: "hapi-auth-cookie"
        },
        {
            plugin: {
                register: "./lib/modules/caching/index",
                options: {}
            }
        },
        {
            plugin: "./lib/modules/authClient/index",
            options: {
                select: ["client"],
                routes: {
                    prefix: "/client"
                }
            }
        }
    ]
};

const options = { relativeTo: __dirname };

Glue.compose(Manifest, options, (err, server) => {
    if (err) {
        throw err;
    }

    server.start((error) => {
        if (error) {
            throw error;
        }
        console.log(`Server started...`);
    });
});
