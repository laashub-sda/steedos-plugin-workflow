const express = require('express');
const steedosAuth = require('@steedos/auth');
const objectql = require("@steedos/objectql");
const _ = require('underscore');
const designerManager = require('./designerManager');

let router = express.Router();

let steedosSchema = objectql.getSteedosSchema();

router.use('/', function auth(req, res, next) {
    let methodOverride = req.query['methodOverride'];
    if (methodOverride) {
        req.method = methodOverride;
    }

    steedosAuth.auth(req, res).then(function (result) {
        if (result) {
            req.user = result;
            next();
        } else {
            res.status(401).send({ status: 'error', message: 'You must be logged in to do this.' });
        }
    })
})

// startup
router.post('/am/designer/startup', async function (req, res) {
    try {
        let userId = req.user.userId;
        let queryParams = req.query;
        let companyId = queryParams["companyId"];
        let isCompanyAdmin = false;
        let spaceIds = [];
        let spaces = [];
        let spaceObj = steedosSchema.getObject('spaces');
        let orgObj = steedosSchema.getObject('organizations');
        if (companyId) {
            let org = await orgObj.findOne(companyId, { fields: ['space'] });
            if (await spaceObj.count({ filters: `(space eq '${org.space}') and (admins eq '${userId}')` }) == 0) {
                spaceIds = [org.space];
                spaces = [await spaceObj.findOne(org.space)];
                isCompanyAdmin = true;
            }
        }

        if (!isCompanyAdmin) {
            spaces = await spaceObj.find({ filters: `(admins eq '${userId}')` });
            spaceIds = _.pluck(spaces, '_id');
        }

        let changeSet = await designerManager.getByAdminSpaceIds(spaceIds, companyId, isCompanyAdmin)
        // changeSet['Clouds'] = clouds
        // changeSet['Modules'] = modules
        changeSet['Spaces'] = spaces
        changeSet['sync_token'] = new Date().getTime() / 1000

        res.send(changeSet)
    } catch (error) {
        res.status(500).send(error.message)
    }
})


// 表单
router.put('/am/forms', async function (req, res) {
    try {
        let userId = req.user.userId;
        let data = req.body;
        let updatedForms = [];
        let updatedFlows = [];
        _.each(data['Forms'], async function (form) {
            // 执行者的身份校验
            await designerManager.checkSpaceUserBeforeUpdate(form['space'], userId)
            // 更新表单
            await designerManager.updateForm(form["id"], form, updatedForms, updatedFlows, userId)
        })

        res.send({ "ChangeSet": { "updates": { "Forms": updatedForms, "Flows": updatedFlows } } });
    } catch (error) {
        res.status(500).send(error.message)
    }
})

// 流程
router.put('/am/flows', async function (req, res) {
    try {
        let userId = req.user.userId;
        let data = req.body;
        _.each(data['Flows'], async function(flowCome){
            let spaceId = flowCome["space"];
            let formId = flowCome["form"];
            let flowId = flowCome["id"];

            await designerManager.checkBeforeFlow(spaceId, formId);

            let flow = await getFlow(flowId);
            let spaceUser = await getSpaceUser(userId, spaceId);

            




        })
    } catch (error) {
        res.status(500).send(error.message)
    }
})

router.put('/am/flows/state', async function (req, res) {
    try {
        
    } catch (error) {
        res.status(500).send(error.message)
    }
})

export let designerRouter = router;
