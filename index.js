let designerRouter = require('./src/designerRouter').designerRouter;
export function init({ app }) {
    app.use(designerRouter);
}