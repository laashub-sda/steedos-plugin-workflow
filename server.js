var server = require('@steedos/meteor-bundle-runner');
var objectql = require("@steedos/objectql");
var express = require('express');
let designerRouter = require('./src/designerRouter').designerRouter;
server.Fiber(function () {
    server.Profile.run("Server startup", function () {
        server.loadServerBundles();
        try {
            let app = express();
            app.use('/', designerRouter);
            WebApp.connectHandlers.use(app);
        } catch (error) {
            console.log(error)
        }
        server.callStartupHooks();
        server.runMain();
    });
}).run();