let designerRouter = require('./lib/designerRouter').designerRouter;
const express = require('express');
const path = require('path');
exports.init = function ({ app }) {
    app.use(designerRouter)
    .use('/applications', express.static(path.join(__dirname, 'public')));
}