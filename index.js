let designerRouter = require('./lib/designerRouter').designerRouter;
let instanceFilesRouter = require('./lib/instance_files').router;
const express = require('express');
const path = require('path');
exports.init = function ({ app }) {
    app.use(designerRouter)
    .use('/applications', express.static(path.join(__dirname, 'public')));
    app.use('/api/v4', instanceFilesRouter)
}