const server = require('@steedos/meteor-bundle-runner');
const express = require('express');
const steedos = require('@steedos/core');
const app = express();
const init = require('./index').init
server.Fiber(function () {
    try {
        server.Profile.run("Server startup", function () {
            server.loadServerBundles();
            steedos.init();
            init({app})
            WebApp.connectHandlers.use(app);
            server.callStartupHooks();
            server.runMain();
        })
    } catch (error) {
       console.error(error.stack)
    }
}).run()