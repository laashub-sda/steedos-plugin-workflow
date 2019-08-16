const server = require('@steedos/meteor-bundle-runner');
const express = require('express');
const designerRouter = require('./lib/designerRouter').designerRouter;
const path = require('path');
const steedos = require('@steedos/core');

server.Fiber(function () {
    server.Profile.run("Server startup", function () {
        server.loadServerBundles();
        steedos.init();
        try {
            let app = express();
            app
            .use('/', designerRouter)
            .use('/applications', express.static(path.join(__dirname, 'public')));
            console.log('public path: ', path.join(__dirname, 'public'));
            WebApp.connectHandlers.use(app);
        } catch (error) {
            console.log(error)
        }
        server.callStartupHooks();
        server.runMain();
    });
}).run();