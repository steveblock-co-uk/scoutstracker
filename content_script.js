// TODO
// - Handle sub-reqiurements, eg Sailing Skills 2.14
// - fix widths
// - borders
// - lock row/column

const OAS_BADGE_GROUPS = {
    verticalskills: "Vertical Skills",
    sailingskills: "Sailing Skills",
    scoutcraftskills: "Scoutcraft Skills",
    campingskills: "Camping Skills",
    trailskills: "Trail Skills",
    winterskills: "Winter Skills",
    paddlingskills: "Paddling Skills",
    aquaticskills: "Aquatic Skills",
    emergencyskills: "Emergency Skills",
};

const OAS_MAX_LEVEL = 3;

const OAS_BADGE_ID_REGEX = /(?<groupId>[a-z]+)(?<level>[1-9])/;
// Presumably the tally ID can differ from the requirement ID?
const TALLY_REGEX = /tally:(?<tallyId>[a-z]+[1-9]\.[\da-z]+)-(?<requiredCount>\d+)/;
const REQUIREMENT_REGEX = /(?<numericPart>\d+)(?<alphaPart>[a-z])?/;

const RED_RGB = [255, 0, 0];
const WHITE_RGB = [255, 255, 255];

function td(x) {
    let td = document.createElement("td");
    td.textContent = x;
    return td;
}

function promisifyRequest(request) {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function getDb() {
    return promisifyRequest(indexedDB.open("ScoutsTracker"));
}

async function getSingletonData(db, tableName) {
    const all = await promisifyRequest(db.transaction(tableName).objectStore(tableName).getAll());
    return all[0].data
}

function getOrCreate(map, key, f) {
    if (!map.has(key)) {
        map.set(key, f());
    }
    return map.get(key);
}

function interpolate(a, b, x) {
    if (a.length !== b.length) {
        throw new Exception();
    }
    return a.map((elem, i) => elem + x * (b[i] - elem));
}

function toRgb(x) {
    return "rgb(" + x.map((e) => Math.round(e)).join(", ") + ")";
}

function parseRequirement(requirement) {
    const result = REQUIREMENT_REGEX.exec(requirement);
    return {
        numericPart: result.groups.numericPart,
        alphaPart: result.groups.alphaPart,
    };
}

async function go() {
    const db = await getDb();
    // These are JS Objects, not Maps.
    const [membersRaw, completedRequirementsRaw, requirementsRaw, talliesRaw] = await Promise.all([
        getSingletonData(db, "db-members"),
        getSingletonData(db, "db-completedrequirements"),
        getSingletonData(db, "db-requirements"),
        getSingletonData(db, "db-tallies"),
    ]);
    console.log(talliesRaw);

    // We use the requirement ID as a unique identifier of the requirement but do not assume anything about its syntax,
    // ie how it relates to the group ID, badge ID or requirement.

    // A map from requirement ID to tally ID and required count.
    const autocompletionRequirements = new Map();
    Object.values(requirementsRaw).forEach((requirement) => {
        const result = TALLY_REGEX.exec(requirement.autocompletion);
        if (result === null) {
            return;
        }
        autocompletionRequirements.set(requirement.requirementid, {
            tallyId: result.groups.tallyId,
            requiredCount: result.groups.requiredCount,
        });
    });
    console.log(autocompletionRequirements);

    // A map from OAS badge group ID to a map from level to a Set of requirement IDs.
    console.log(requirementsRaw);
    const oasRequirementsMapUnsorted = new Map();
    Object.values(requirementsRaw).forEach((requirement) => {
        const result = OAS_BADGE_ID_REGEX.exec(requirement.badgeid);
        if (result === null) {
            return;
        }
        const groupId = result.groups.groupId;
        const level = result.groups.level;
        if (!(groupId in OAS_BADGE_GROUPS) || level >= OAS_MAX_LEVEL) {
            return;
        }
        getOrCreate(
            getOrCreate(oasRequirementsMapUnsorted, groupId, () => new Map()),
            level,
            () => new Set()).add(requirement.requirementid);
    });
    console.log(oasRequirementsMapUnsorted);
    const oasRequirementsMap = new Map();
    Array.from(oasRequirementsMapUnsorted.keys()).toSorted().forEach((groupId) => {
        Array.from(oasRequirementsMapUnsorted.get(groupId).keys()).toSorted().forEach((level) => {
            getOrCreate(oasRequirementsMap, groupId, () => new Map())
                .set(level, new Set(Array.from(oasRequirementsMapUnsorted.get(groupId).get(level)).toSorted((a, b) => {
                    const aParts = parseRequirement(requirementsRaw[a].requirement);
                    const bParts = parseRequirement(requirementsRaw[b].requirement);
                    if (aParts.numericPart === bParts.numericPart) {
                        return aParts.alphaPart.localeCompare(bParts.alphaPart);
                    }
                    return aParts.numericPart - bParts.numericPart;
                })));
        });
    });
    console.log(oasRequirementsMap);

    // A list of members.
    const youthMembers = Object.values(membersRaw)
        .filter((member) => true &&
            member.isnonparticipant === 0 &&
            member.membershiptype === 1 &&
            member.role === 10 &&
            member.status === 1 &&
            true);
    console.log(youthMembers);

    // A map from member ID to a map from OAS group ID to a map from level to a set of IDs of requirements not
    // completed.
    const oasRequirementsNotCompleted = new Map();
    youthMembers.forEach((member) => {
        const completedRequirementIds = new Set(
            Object.keys(completedRequirementsRaw[member.personid] || {}));
        oasRequirementsNotCompleted.set(member.memberid, new Map());
        oasRequirementsMap.forEach((levelToBadge, oasBadgeGroupName) => {
            oasRequirementsNotCompleted.get(member.memberid).set(oasBadgeGroupName, new Map());
            levelToBadge.forEach((requirementIds, level) => {
                const autocompletedRequirementIds = new Set(requirementIds.values().filter((requirementId) => {
                    const autocompletionRequirement = autocompletionRequirements.get(requirementId);
                    if (!autocompletionRequirement) {
                        return false;
                    }
                    const count = talliesRaw[member.personid]?.[autocompletionRequirement.tallyId]?.list
                        .map((tally) => tally.count)
                        .reduce((a, b) => a + b, 0);
                    return count >= autocompletionRequirement.requiredCount;
                }));
                oasRequirementsNotCompleted.get(member.memberid).get(oasBadgeGroupName).set(
                    level, requirementIds.difference(completedRequirementIds).difference(autocompletedRequirementIds));
            });
        });
    });
    console.log(oasRequirementsNotCompleted);

    let table = document.createElement("table");
    table.className = "oas";
    document.body.appendChild(table);

    let badgeGroupNameRow = document.createElement("tr");
    badgeGroupNameRow.appendChild(td(""));  // Name
    //tr1.appendChild(td("isnonparticipant"));  // all 0 for active cubs (almost everyone)
    //tr1.appendChild(td("membershiptype"));  // all 1 for active cubs
    //tr1.appendChild(td("patrolid"));  // positive for all active cubs but not good to rely on
    //tr1.appendChild(td("programid"));  // varies for active cubs
    //tr1.appendChild(td("role")); //all 10 for active cubs. seems to be 1:1 with membershiptype 1
    //tr1.appendChild(td("status"));  // all 1 for active cubs
    //tr1.appendChild(td("exitdate"));  // all -1 for active cubs, but weaker condition than status 1
    oasRequirementsMap.forEach((levelToBadge, oasBadgeGroupName) => {
        const td1 = td(OAS_BADGE_GROUPS[oasBadgeGroupName]);
        td1.colSpan = levelToBadge.values()
            .map((requirementIds) => requirementIds.size)
            .reduce((a, b) => a + b, 0);
        badgeGroupNameRow.appendChild(td1)
    });
    table.appendChild(badgeGroupNameRow);

    let levelRow = document.createElement("tr");
    levelRow.appendChild(td("")); // Name
    oasRequirementsMap.forEach((levelToBadge, oasBadgeGroupName) => {
        levelToBadge.forEach((requirementIds, level) => {
            const tdx = td(level);
            tdx.colSpan = requirementIds.size;
            levelRow.appendChild(tdx);
        });
    });
    table.appendChild(levelRow);

    let requirementRow = document.createElement("tr");
    requirementRow.appendChild(td("")); // Name
    oasRequirementsMap.forEach((levelToBadge, oasBadgeGroupName) => {
        levelToBadge.forEach((requirementIds, level) => {
            requirementIds.forEach((requirementId) => {
                const x = td(requirementsRaw[requirementId].requirement);
                x.title = requirementsRaw[requirementId].description;
                requirementRow.appendChild(x);
            });
        });
    });
    table.appendChild(requirementRow);

    let potentialRow = document.createElement("tr");
    const potentialTd = td("Potential");
    potentialTd.title = "The number of Cubs that have not completed this requirement";
    potentialRow.appendChild(potentialTd);
    oasRequirementsMap.forEach((levelToBadge, oasBadgeGroupName) => {
        levelToBadge.forEach((requirementIds, level) => {
            requirementIds.forEach((requirementId) => {
                const count = youthMembers
                    .filter((member) => oasRequirementsNotCompleted.get(member.memberid).get(oasBadgeGroupName).get(level).has(requirementId))
                    .length;
                const x = td(count > 0 ? count : "");
                x.style.setProperty("background-color", toRgb(interpolate(WHITE_RGB, RED_RGB, count / youthMembers.length)));
                potentialRow.appendChild(x);
            });
        });
    });
    table.appendChild(potentialRow);

    let rewardRow = document.createElement("tr");
    const rewardTd =td("Reward");
    rewardTd.title = "The number of Cubs that will complete this OAS level if they complete this requirement"
    rewardRow.appendChild(rewardTd);
    oasRequirementsMap.forEach((levelToBadge, oasBadgeGroupName) => {
        levelToBadge.forEach((requirementIds, level) => {
            requirementIds.forEach((requirementId) => {
                const count = youthMembers
                    .filter((member) => oasRequirementsNotCompleted.get(member.memberid).get(oasBadgeGroupName).get(level).size === 1)
                    .filter((member) => oasRequirementsNotCompleted.get(member.memberid).get(oasBadgeGroupName).get(level).has(requirementId))
                    .length;
                const x = td(count > 0 ? count : "");
                x.style.setProperty("background-color", toRgb(interpolate(WHITE_RGB, RED_RGB, 6 * count / youthMembers.length)));
                rewardRow.appendChild(x);
            });
        });
    });
    table.appendChild(rewardRow);

    youthMembers.forEach((member) => {
        let tr = document.createElement("tr");
        tr.appendChild(td(member.firstname + " " + member.lastname));
        //tr.appendChild(td(data[memberId].isnonparticipant));
        //tr.appendChild(td(data[memberId].membershiptype));
        //tr.appendChild(td(data[memberId].patrolid));
        //tr.appendChild(td(data[memberId].programid));
        //tr.appendChild(td(data[memberId].role));
        //tr.appendChild(td(data[memberId].status));
        //tr.appendChild(td(data[memberId].exitdate));
        oasRequirementsMap.forEach((levelToBadge, oasBadgeGroupName) => {
            levelToBadge.forEach((requirementIds, level) => {
                requirementIds.forEach((requirementId) => {
                    const x = document.createElement("td");
                    const notCompleted = oasRequirementsNotCompleted.get(member.memberid).get(oasBadgeGroupName).get(level);
                    if (notCompleted.size === 0) {
                        x.className = "all-completed";
                    } else if (!notCompleted.has(requirementId)) {
                        x.className = "completed";
                    } else if (notCompleted.size === 1) {
                        x.className = "sole-remaining";
                    }
                    tr.appendChild(x);
                });
            });
        });
        table.appendChild(tr);
    });

    setTimeout(() => {
        console.log("clearing");
        document.getElementById("startpage").className = "";
        document.body.style.setProperty("overflow-x", "auto");
        document.body.style.setProperty("overflow-y", "auto");
    }, 6_000);
}

go();