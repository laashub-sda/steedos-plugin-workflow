let designerRouter = require('./lib/designerRouter').designerRouter;
export function init({ app }) {
    app.use(designerRouter)
    .use('/applications', express.static(path.join(__dirname, 'public')));
}