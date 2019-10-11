const _ = require('underscore');
const objectql = require("@steedos/objectql");
const steedosSchema = objectql.getSteedosSchema();
const Fiber = require('fibers');

exports.getByAdminSpaceIds = async function getByAdminSpaceIds(spaceIds, companyId, isCompanyAdmin) {
    let filters = _makeInFilters('space', spaceIds);
    if (isCompanyAdmin && companyId) {
        filters = `(${filters}) and (company_id eq '${companyId}')`;
    }
    let userIds = [];
    let spaceUsers = [];

    spaceUsers = await steedosSchema.getObject('space_users').find({
        filters: filters,
        fields: ['name', 'email', 'space', 'organization', 'organizations', 'user', 'user_accepted', 'company_id']
    })
    userIds = _.pluck(spaceUsers, 'user');
    let users = await new Promise(function (resolve, reject) {
        Fiber(function () {
            try {
                let result = Creator.getCollection('users').find({
                    _id: {
                        $in: userIds
                    }
                }, {
                    fields: {
                        'photo': 1,
                        'google_id': 1,
                        'imo_uid': 1,
                        'company': 1,
                        'name': 1,
                        'locale': 1,
                        'steedos_id': 1,
                        'primary_email_verified': 1,
                        'is_paid_user': 1,
                        'mobile': 1,
                        'email': 1,
                        'created': 1,
                        'modified': 1,
                        'created_by': 1,
                        'modified_by': 1,
                        'email_notification': 1,
                        'qq_open_id': 1
                    }
                }).fetch();
                resolve(result);
            } catch (error) {
                reject(error)
            }
        }).run()
    })

    let forms = await steedosSchema.getObject('forms').find({
        filters: filters,
        fields: ['name', 'state', 'is_deleted', 'is_valid', 'space', 'description', 'help_text', 'created', 'created_by', 'error_message', 'current', 'enable_workflow', 'enable_view_others', 'app', 'category', 'is_subform', 'instance_style', 'company_id']
    })
    let flows = await steedosSchema.getObject('flows').find({
        filters: filters,
        fields: ['name', 'name_formula', 'code_formula', 'space', 'description', 'is_valid', 'form', 'flowtype', 'state', 'is_deleted', 'created', 'created_by', 'help_text', 'current_no', 'current', 'perms', 'error_message', 'app', 'distribute_optional_users', 'company_id']
    })
    let roles = await steedosSchema.getObject('flow_roles').find({
        filters: filters
    });
    let organizations = await steedosSchema.getObject('organizations').find({
        filters: filters
    });
    let positions = await steedosSchema.getObject('flow_positions').find({
        filters: filters
    });
    let categories = await steedosSchema.getObject('categories').find({
        filters: _makeInFilters('space', spaceIds)
    });

    return {
        SpaceUsers: spaceUsers,
        Users: users,
        Forms: forms,
        Flows: flows,
        Organizations: organizations,
        Positions: positions,
        Roles: roles,
        Categories: categories
    }
}


exports.checkSpaceUserBeforeUpdate = async function checkSpaceUserBeforeUpdate(spaceId, userId) {
    if (await steedosSchema.getObject('spaces').count({
            filters: `(_id eq '${spaceId}')`
        }) === 0) {
        throw new Error('该工作区不存在或已经被删除')
    }

    if (await steedosSchema.getObject('space_users').count({
            filters: `(space eq '${spaceId}') and (user eq '${userId}')`
        }) === 0) {
        throw new Error('该用户不存在于该工作区中')
    }
};

// 更新表单，包括子表
exports.updateForm = async function updateForm(formId, form, forms, flows, currentUserId) {
    await new Promise(function (resolve, reject) {
        Fiber(function () {
            try {
                let formCollection = Creator.getCollection('forms');
                let flowCollection = Creator.getCollection('flows');
                let ff = formCollection.findOne(formId);
                let spaceId = ff.space;
                let now = new Date();
                let current = {};
                let formUpdateObj = {};


                let pass = false;
                // 根据APP 判断表单当前版本是否走过申请单 或者 records
                if (ff.app === 'workflow') {
                    let insCount = Creator.getCollection('instances').find({
                        space: spaceId,
                        form: formId,
                        'form_version': form['current']['id']
                    }).count();
                    if (insCount > 0) {
                        pass = true;
                    }
                } else if (ff.app === 'creator') {
                    let recordsCount = Creator.getCollection('records').find({
                        space: spaceId,
                        form: formId,
                        'form_version': form['current']['id']
                    }).count();
                    if (recordsCount > 0) {
                        pass = true;
                    }
                }

                if (pass === true && ff["current"]["start_date"]) { // 升级表单
                    formUpdateObj.$push = {
                        'historys': ff["current"]
                    };
                    current._id = formCollection._makeNewID();
                    current._rev = ff["current"]["_rev"] + 1;
                    current.created = now;
                    current.created_by = currentUserId;
                    if (ff.state === 'enabled') {
                        current.start_date = now;
                    }
                    // 更新流程版本
                    flowCollection.find({
                        form: formId
                    }).forEach(function (flow) {
                        let up = false;
                        if (Creator.getCollection('instances').find({
                                space: spaceId,
                                flow: flow._id,
                                flow_version: flow.current._id
                            }).count()) {
                            up = true;
                        }
                        let flowUpdateObj = {
                            $set: {}
                        };
                        if (up === true && flow.current.start_date) { // 升级流程

                            flowUpdateObj.$push = {
                                'historys': flow.current
                            };
                            let flowCurrent = {
                                '_id': flowCollection._makeNewID(),
                                'created': now,
                                'created_by': currentUserId,
                                'steps': flow.current.steps,
                                '_rev': flow.current._rev + 1,
                                'flow': flow._id,
                                'form_version': current._id,
                                'modified': now,
                                'modified_by': currentUserId
                            };
                            if (flow.state === "enabled") {
                                flowCurrent.start_date = now;
                            }
                            flowUpdateObj.$set['current'] = flowCurrent;
                        } else {
                            flowUpdateObj.$set = {
                                'current.form_version': current._id,
                                'current.modified': now,
                                'current.modified_by': currentUserId
                            }
                        }
                        flowUpdateObj.$set['modified'] = now;
                        flowUpdateObj.$set['modified_by'] = currentUserId;
                        flowCollection.update(flow._id, flowUpdateObj);
                        flows.push(flowCollection.findOne(flow._id));
                    })
                } else {
                    current = ff.current;
                }

                current.modified = now;
                current.modified_by = currentUserId;
                current.form = form["id"];
                current.fields = _formatFieldsID(form["current"]["fields"]);
                current.form_script = form["current"]["form_script"];
                current.name_forumla = form["current"]["name_forumla"];

                formUpdateObj.$set = {
                    'current': current,
                    'name': form["name"],
                    'modified': now,
                    'modified_by': currentUserId,
                    'is_valid': form["is_valid"],
                    'description': form["description"],
                    'help_text': form["help_text"],
                    'error_message': form["error_message"],
                    'category': form["category"],
                    'instance_style': form["instance_style"]
                }

                formCollection.update(formId, formUpdateObj);
                forms.push(formCollection.findOne(formId));
                resolve();
            } catch (error) {
                reject(error)
            }
        }).run()
    })

}


exports.checkBeforeFlow = async function checkBeforeFlow(spaceId, formId) {
    if (await steedosSchema.getObject('spaces').count({
            filters: `(_id eq '${spaceId}')`
        }) === 0) {
        throw new Error('工作区不存在或已经被删除')
    }

    if (await steedosSchema.getObject('forms').count({
            filters: `(_id eq '${formId}')`
        }) === 0) {
        throw new Error('表单不存在')
    }
}

exports.getFlow = async function getFlow(flowId) {
    let flow = await steedosSchema.getObject('flows').findOne(flowId);
    if (!flow) {
        throw new Error('流程不存在')
    }
    return flow;
}

exports.getForm = async function getForm(formId) {
    let form = await steedosSchema.getObject('forms').findOne(formId);
    if (!form) {
        throw new Error('表单不存在')
    }
    return form;
}

exports.getSpaceUser = async function getSpaceUser(userId, spaceId) {
    let spaceUser = (await steedosSchema.getObject('space_users').find({
        filters: `(space eq '${spaceId}') and (user eq '${userId}')`
    }))[0];
    if (!spaceUser) {
        throw new Error('用户不属于当前工作区')
    }
    if (!spaceUser.user_accepted) {
        throw new Error('用户在当前工作区是停用状态')
    }
    return spaceUser;
}

exports.isSpaceAdmin = async function isSpaceAdmin(spaceId, userId) {
    let space = await steedosSchema.getObject('spaces').findOne(spaceId);
    if (!space) {
        throw new Error('未找到工作区');
    }

    if (!space.admins.includes(userId)) {
        throw new Error('用户不是工作区管理员');
    }
}

exports.makeSteps = function (userId) {
    let flowCollection = Creator.getCollection('flows');
    let user = Creator.getCollection('users').findOne(userId);
    let language = user.locale;
    // 设置当前语言环境
    // R18n.thread_set(R18n.change(language));
    // i18n_obj = R18n.get.t;
    let blank_ayy = [];
    let stepEnd = flowCollection._makeNewID();
    let steps = [];
    let start_step = {};
    start_step._id = flowCollection._makeNewID();
    start_step.approver_orgs = blank_ayy;
    start_step.approver_roles = blank_ayy;
    start_step.approver_users = blank_ayy;
    start_step.fields_modifiable = blank_ayy;
    start_step.name = '开始';
    start_step.step_type = "start";
    start_step.posx = -1;
    start_step.posy = -1;
    let p = {};
    p["__form"] = "editable";
    start_step.permissions = p;
    let lines = [];
    let line = {};
    line._id = flowCollection._makeNewID();
    line.name = "";
    line.to_step = stepEnd;
    line.order = 1;
    line.state = "submitted";
    lines.push(line);
    start_step.lines = lines;
    steps.push(start_step);

    let end_step = {};
    end_step._id = stepEnd;
    end_step.approver_orgs = blank_ayy;
    end_step.approver_roles = blank_ayy;
    end_step.approver_users = blank_ayy;
    end_step.fields_modifiable = blank_ayy;
    end_step.lines = blank_ayy;
    end_step.name = '结束';
    end_step.step_type = "end";
    end_step.posx = -1;
    end_step.posy = -1;
    end_step.permissions = {};
    steps.push(end_step);

    return steps;
}


// TODO 由于流程设计器被简化getChangeSet方法是否有必要？
// export function getChangeSet(userId, syncToken, spaceId, companyId) {
//     let syncTokenTime = new Date(syncToken * 1000);
//     let changeSet = { sync_token: new Date().getTime() / 1000 };
//     changeSet['inserts'] = { 'Spaces': [], 'Users': [], 'SpaceUsers': [], 'Organizations': [], 'Roles': [], 'Positions': [], 'Forms': [], 'Flows': [], 'Categories': [] };
//     changeSet['updates'] = { 'Spaces': [], 'Users': [], 'SpaceUsers': [], 'Organizations': [], 'Roles': [], 'Positions': [], 'Forms': [], 'Flows': [], 'Categories': [] };
//     changeSet['deletes'] = { 'Spaces': [], 'Users': [], 'SpaceUsers': [], 'Organizations': [], 'Roles': [], 'Positions': [], 'Forms': [], 'Flows': [], 'Categories': [] };

//     let user = Creator.getCollection('users').findOne(userId);

//     // 首先，同步用户自己发生了变化的数据
//     if (!user) {
//         return { errors: [{ errorCode: 500, errorMessage: '用户不存在或已删除。' }] };
//     } else {
//         // 新增的User和更新的User
//         let userFields = { photo: 1, company: 1, name: 1, locale: 1, steedos_id: 1, primary_email_verified: 1, is_paid_user: 1, mobile: 1, email: 1, created: 1, modified: 1, created_by: 1, modified_by: 1, email_notification: 1, qq_open_id: 1 };
//         let updatedUsers = Creator.getCollection('users').find({ _id: userId, created: { $lte: syncTokenTime }, modified: { $gt: syncTokenTime } }, { fields: userFields }).fetch();
//         changeSet['updates']['users'] = changeSet['updates']['users'].concat(updatedUsers);
//     }
//     // 获取自从上次同步以来新加入、新注销/被删除/新退出的space
//     let resultSpaceIds = getSpaceIdsForQuery(userId, syncTokenTime)
// TODO

// }

// // 获取自从上次同步以来新加入、新注销/被删除/新退出的工作区id
// function getSpaceIdsForQuery(userId, syncTokenTime){
//     // 获得自从上次同步以来新加入的space

//     let insertedSpaceUsers = Creator.getCollection('space_users').find({user: userId, created: {$gt: syncTokenTime}}, {fields:{space:1}});
//     let spaceInsertedIds = _.pluck(insertedSpaceUsers, 'space');
//     // 获得自从上次同步以来新注销/新退出/被删除的space

// }


function _makeInFilters(fieldName, fieldValueArray) {
    let filters = _.map(fieldValueArray, function (v) {
        return `(${fieldName} eq '${v}')`
    }).join(' or ')
    return filters;
}

function _formatFieldsID(fields) {
    _.each(fields, function (f) {
        if (!f._id && f.id) {
            f._id = f.id;
            delete f.id;
            if (f.type == 'section' || f.type == 'table') {
                _formatFieldsID(f.fields);
            }
        }
    });
    return fields;
}

exports.formatFieldsID = _formatFieldsID;