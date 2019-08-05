const express = require('express');
const steedosAuth = require('@steedos/auth');
const objectql = require("@steedos/objectql");
const _ = require('underscore');
const bodyParser = require('body-parser');
const designerManager = require('./designerManager');

const router = express.Router();

const steedosSchema = objectql.getSteedosSchema();

const jsonParser = bodyParser.json({ type: 'text/plain' });
router.use(jsonParser);

router.use('/am', function auth(req, res, next) {
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
router.get('/am/designer/startup', async function (req, res) {
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
        let updatedFlows = [];
        _.each(data['Flows'], async function (flowCome) {
            let spaceId = flowCome["space"];
            let formId = flowCome["form"];
            let flowId = flowCome["id"];
            let now = new Date();

            await designerManager.checkBeforeFlow(spaceId, formId);

            let flow = await designerManager.getFlow(flowId);
            await designerManager.getSpaceUser(userId, spaceId);
            await designerManager.isSpaceAdmin(spaceId, userId);

            if (flowCome['state'] !== 'enabled' || flowCome['state'] !== 'disabled') {
                throw new Error('流程状态值无效');
            }

            // 某步骤被删除后，删除同流程的“指定历史步骤”属性中被引用的步骤id（仅限于流程的最新版)
            let clientStepIds = []
            _.each(flowCome['current']['steps'], function (step) {
                clientStepIds.push(step['id']);
            })

            _.each(flowCome['current']['steps'], function (step) {
                if (step['approver_step']) {
                    if (!clientStepIds.includes(step['approver_step'])) {
                        step['approver_step'] = '';
                    }
                }
            })

            // 流程升级
            // 由于前台后台posx posy timeout_hours字段类型不一致会导致流程升级 所以在这里统一转为后台Float类型 便于比较
            _.each(flowCome['current']['steps'], function (st) {
                st['posx'] = parseFloat(st['posx']);
                st['posy'] = parseFloat(st['posy']);
                if (st['timeout_hours']) {
                    st['timeout_hours'] = parseFloat(st['timeout_hours']);
                }
            })

            // 由于前台传的是id而非_id，故比较时将id转为_id
            _.each(flowCome['current']['steps'], function (step) {
                step['_id'] = step['id'];
                delete step['id'];
                if (step['lines']) {
                    _.each(step['lines'], function (line) {
                        line['_id'] = line['id'];
                        delete line['id'];
                    })
                }
            })
            let stepsStr = JSON.stringify(flow['current']['steps']);
            let flowComeStepsStr = JSON.stringify(flowCome['current']['steps']);
            let pass = false;
            let updateObj = { $set: {} };
            let flowCollection = Creator.getCollection('flows');

            let insCount = Creator.getCollection('instances').find({ space: spaceId, flow: flowId, flow_version: flow.current._id }).count();
            if (insCount > 0) {
                pass = true;
            }

            if (pass === true && flow.current.start_date && stepsStr === flowComeStepsStr) {
                updateObj.$push = { 'historys': flow.current };
                let current = {
                    '_id': flowCollection._makeNewID(),
                    'modified': now,
                    'modified_by': userId,
                    'created': now,
                    'created_by': userId,
                    'steps': flowCome['current']['steps'],
                    'form_version': flow.current.form_version,
                    '_rev': flow.current._rev,
                    'flow': flowId,
                };
                if (flow.state === 'enabled') {
                    current['start_date'] = now;
                }

                updateObj.$set.current = current;

            } else {
                updateObj.$set = {
                    'current.modified': now,
                    'current.modified_by': userId,
                    'current.steps': flowCome["current"]["steps"]
                }
            }

            updateObj.$set.name = flowCome['name'];
            updateObj.$set.name_formula = '';
            updateObj.$set.code_formula = '';
            updateObj.$set.is_valid = flowCome['is_valid'];
            updateObj.$set.flowtype = flowCome['flowtype'];
            updateObj.$set.help_text = flowCome['help_text'];
            updateObj.$set.decription = flowCome['descriptions'];
            updateObj.$set.error_message = flowCome['error_message'];
            updateObj.$set.modified = now;
            updateObj.$set.modified_by = userId;

            if (flowCome['perms']) {
                flowCome['_id'] = flowCome['id'];
                delete flowCome['id'];
                updateObj.$set.perms = flowCome['perms'];
            }

            // flow对象上添加categoryId
            let form = await steedosSchema.getObject('forms').findOne(flow.form, { fields: ['category'] });
            updateObj.$set.category = form['category'];

            flowCollection.update(flowId, updateObj);

            updatedFlows.push(flowCollection.findOne(flowId));
        })
        res.send({ "ChangeSet": { "updates": { "Flows": updatedFlows } } });
    } catch (error) {
        res.status(500).send(error.message)
    }
})

router.put('/am/flows/state', async function (req, res) {
    try {
        let userId = req.user.userId;
        let data = req.body;
        let formCollection = Creator.getCollection('forms');
        let flowCollection = Creator.getCollection('flows');
        let updatedForms = [];
        let updatedFlows = [];
        _.each(data['Flows'], async function (flowCome) {
            let spaceId = flowCome["space"];
            let formId = flowCome["form"];
            let flowId = flowCome["id"];
            let now = new Date();
            let flowUpdateObj = { $set: {} };
            let formUpdateObj = { $set: {} };

            await designerManager.checkBeforeFlow(spaceId, formId);

            let flow = await designerManager.getFlow(flowId);
            let form = await designerManager.getForm(formId);
            await designerManager.getSpaceUser(userId, spaceId);
            await designerManager.isSpaceAdmin(spaceId, userId);

            let state = flowCome['state'];
            if (state !== 'enabled' || state !== 'disabled') {
                throw new Error('流程状态值无效');
            }

            // 启用流程
            if (state === 'enabled') {
                // 流程启用前，校验其“指定历史步骤”属性中被引用的步骤是否存在且能被找到（仅限于流程的最新版）
                let checkStepIds = [];
                _.each(flow.current.steps, function (step) {
                    checkStepIds.push(step._id);
                })

                _.each(flow.current.steps, function (step) {
                    if (step.deal_type === 'specifyStepUser' || step.deal_type === 'specifyStepRole') {
                        if (!step.approver_step || !checkStepIds.includes(step.approver_step)) {
                            throw new Error('流程中的指定步骤不存在');
                        }
                    }
                })

                // 如果 流程对应表单 是停用的 则启用
                if (form.state === 'disabled') {
                    let formUpdateObj = {
                        $set: {
                            'state': 'enabled',
                            'current.start_date': now,
                            'current.modified': now,
                            'current.modified_by': userId
                        }
                    }
                    formCollection.update(formId, formUpdateObj);
                }

                if (!flow.is_valid) {
                    throw new Error('流程不合法');
                }
                if (!['new', 'modify', 'delete'].includes(flow.flowtype)) {
                    throw new Error('FlowType值必须是new、modify、delete其中之一');
                }
                if (!flow.current.steps) {
                    throw new Error('流程的步骤不能为空');
                }

                flowUpdateObj.$set['state'] = 'enabled';
                flowUpdateObj.$set['current.modified'] = now;
                flowUpdateObj.$set['current.start_date'] = now;
                flowUpdateObj.$set['current.modified_by'] = userId;

                // 校验步骤中的字段控制设定对象在表单中都存在
                let formCurrentFields = form.current.fields;
                let formCurrentFieldsCode = [];
                _.each(formCurrentFields, function (field) {
                    formCurrentFieldsCode.push(field.code);
                })
                let currentSteps = [];
                _.each(flow.current.steps, function (step) {
                    let fieldsModifiable = [];
                    _.each(step.fields_modifiable, function (fieldCode) {
                        if (formCurrentFieldsCode.includes(fieldCode)) {
                            fieldsModifiable.push(fieldCode);
                        }
                    })
                    step.fields_modifiable = fieldsModifiable;
                    currentSteps.push(step);
                })
                flowUpdateObj.$set['current.steps'] = currentSteps;
            } else { // 禁用流程
                flowUpdateObj.$set['state'] = 'disabled';
                flowUpdateObj.$set['current.modified'] = now;
                flowUpdateObj.$set['current.finish_date'] = flow.current.modified;
                flowUpdateObj.$set['current.modified_by'] = userId;
            }
            flowUpdateObj.$set['modified'] = now;
            flowUpdateObj.$set['modified_by'] = userId;

            flowCollection.update(flowId, flowUpdateObj);
            updatedFlows.push(flowCollection.findOne(flowId));

            // 判断表单所有流程是否已经全部停用 如果已全部停用 则修改表单状态为停用
            if (state === 'disabled') {
                let isAllDisabled = true;
                flowCollection.find({ space: spaceId, form: formId }, { fields: { state: 1 } }).forEach(function (flow) {
                    if (flow.state === 'enabled') {
                        isAllDisabled = false;
                    }
                })
                if (isAllDisabled === true) {
                    formUpdateObj.$set['state'] = 'disabled';
                    formUpdateObj.$set['current.finish_date'] = now;
                    formUpdateObj.$set['current.modified'] = userId;
                    formCollection.update(formId, formUpdateObj);
                    updatedForms.push(formCollection.findOne(formId));
                }
            }

        })
        res.send({ "ChangeSet": { "updates": { "Forms": updatedForms, "Flows": updatedFlows } } });
    } catch (error) {
        res.status(500).send(error.message)
    }
})

exports.designerRouter = router;
