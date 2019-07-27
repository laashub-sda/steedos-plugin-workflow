const _ = require('underscore');
const objectql = require("@steedos/objectql");
let steedosSchema = objectql.getSteedosSchema();

export async function getByAdminSpaceIds(spaceIds, companyId, isCompanyAdmin) {
    let filters = _makeInFilters('space', spaceIds);
    if (isCompanyAdmin && companyId) {
        filters = `(${filters}) and (company_id eq '${companyId}')`;
    }
    let userIds = [];
    let spaceUsers = [];
    spaceUsers = await steedosSchema.getObject('space_users').find({ filters: filters, fields: ['name', 'email', 'space', 'organization', 'organizations', 'user', 'user_accepted', 'company_id'] })
    userIds = _.pluck(spaceUsers, 'user');
    let usersFilter = _makeInFilters('_id', userIds);
    let users = await steedosSchema.getObject('users').find({ filters: usersFilter, fileds: ['photo', 'google_id', 'imo_uid', 'company', 'name', 'locale', 'steedos_id', 'primary_email_verified', 'is_paid_user', 'mobile', 'email', 'created', 'modified', 'created_by', 'modified_by', 'email_notification', 'qq_open_id'] })
    let forms = await steedosSchema.getObject('forms').find({ filters: filters, fields: ['name', 'state', 'is_deleted', 'is_valid', 'space', 'description', 'help_text', 'created', 'created_by', 'error_message', 'current', 'enable_workflow', 'enable_view_others', 'app', 'category', 'is_subform', 'instance_style', 'company_id'] })
    let flows = await steedosSchema.getObject('flows').find({ filters: filters, fields: ['name', 'name_formula', 'code_formula', 'space', 'description', 'is_valid', 'form', 'flowtype', 'state', 'is_deleted', 'created', 'created_by', 'help_text', 'current_no', 'current', 'perms', 'error_message', 'app', 'distribute_optional_users', 'company_id'] })
    let roles = await steedosSchema.getObject('flow_roles').find({ filters: filters });
    let organizations = await steedosSchema.getObject('organizations').find({ filters: filters });
    let positions = await steedosSchema.getObject('flow_positions').find({ filters: filters });
    let categories = await steedosSchema.getObject('categories').find({ filters: _makeInFilters('space', spaceIds) });

    return { SpaceUsers: spaceUsers, Users: users, Forms: forms, Flows: flows, Organizations: organizations, Positions: positions, Roles: roles, Categories: categories }
}


export async function checkSpaceUserBeforeUpdate(spaceId, userId) {
    if (await steedosSchema.getObject('spaces').count({ filters: `(_id eq '${spaceId}')` }) === 0) {
        throw new Error('该工作区不存在或已经被删除')
    }

    if (await steedosSchema.getObject('space_users').count({ filters: `(space eq '${spaceId}') and (user eq '${userId}')` }) === 0) {
        throw new Error('该用户不存在于该工作区中')
    }
}

// 更新表单，包括子表
export async function updateForm(formId, form, forms, flows, currentUserId) {
    let ff = await steedosSchema.getObject('forms').findOne(formId);
    let spaceId = ff.space;
    let now = new Date();
    let current = {};
    let formUpdateObj = {};

    let formCollection = Creator.getCollection('forms');
    let flowCollection = Creator.getCollection('flow');
    let pass = false;
    // 根据APP 判断表单当前版本是否走过申请单 或者 records
    if (ff.app === 'workflow') {
        let insFilters = `(space eq '${spaceId}') and (form eq '${formId}') and (form_version eq '${form['current']['id']}')`;
        let insCount = await steedosSchema.getObject('instances').count({ filters: insFilters });
        if (insCount > 0) {
            pass = true;
        }
    } else if (ff.app === 'creator') {
        let recordsFilters = `(space eq '${spaceId}') and (form eq '${formId}') and (current/form_version eq '${form['current']['id']}')`;
        let recordsCount = await steedosSchema.getObject('records').count({ filters: recordsFilters });
        if (recordsCount > 0) {
            pass = true;
        }
    }

    if (pass === true && ff["current"]["start_date"]) { // 升级表单
        formUpdateObj.$push = { 'historys': current };
        current._id = formCollection._makeNewID();
        current._rev = ff["current"]["_rev"] + 1;
        current.created = now;
        current.created_by = currentUserId;
        if (ff.state === 'enabled') {
            current.start_date = now;
        }
        // 更新流程版本
        flowCollection.find({ form: formId }).forEach(function (flow) {
            let up = false;
            if (Creator.getCollection('instances').find({ space: spaceId, flow: flow._id, flow_version: flow.current._id }).count()) {
                up = true;
            }
            let flowUpdateObj = { $set: {} };
            if (up === true && flow.current.start_date) { // 升级流程

                flowUpdateObj.$push = { 'historys': flow.current };
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
    current.fields = form["current"]["fields"];
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
}


export async function checkBeforeFlow(spaceId, formId) {
    if (await steedosSchema.getObject('spaces').count({ filters: `(_id eq '${spaceId}')` }) === 0) {
        throw new Error('工作区不存在或已经被删除')
    }

    if (await steedosSchema.getObject('forms').count({ filters: `(_id eq '${formId}')` }) === 0) {
        throw new Error('表单不存在')
    }
}

export async function getFlow(flowId){
    let flow = await steedosSchema.getObject('flows').findOne(flowId); 
    if (!flow){
        throw new Error('流程不存在')
    }
    return flow;
}

export async function getSpaceUser(userId, spaceId){
    let spaceUser = await steedosSchema.getObject('space_users').find({filters: `(space eq '${spaceId}') and (user eq '${userId}')`}); 
    if (!spaceUser){
        throw new Error('用户不属于当前工作区')
    }
    if (!spaceUser.user_accepted){
        throw new Error('用户在当前工作区是停用状态')
    }
    return spaceUser;
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
    let filters = '';
    let maxIdx = fieldValueArray.length - 1;
    _.each(fieldValueArray, function (v, idx) {
        filters += `(${fieldName} eq '${v}')`;
        if (idx < maxIdx) {
            filters += ' or ';
        }
    })
    return filters;
}