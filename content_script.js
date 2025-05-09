// TODO
// - switch from member ID to person ID as key?
// - Add reward total per Cub
// - Fix table border mode to not overlap cells
// - Fix table border during sticky scroll

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
// We use the requirement ID as a unique identifier of the requirement but do not assume anything about its syntax,
// ie how it relates to the group ID, badge ID or requirement.
// Presumably the tally ID can differ from the requirement ID?
const TALLY_REGEX = /tally:(?<tallyId>[a-z\d\.]+)-(?<requiredCount>\d+)/;
const SUB_REQUIREMENT_REGEX = /requirement:(?<requirementId>[a-z\d\.]+)/g

const HIGHLIGHT_RGB = [30, 102, 133];  // Based on #195670 used in site
const WHITE_RGB = [255, 255, 255];

function td(x) {
    const td = document.createElement("td");
    td.textContent = x;
    return td;
}

function th(x) {
    const th = document.createElement("th");
    th.textContent = x;
    return th;
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

function getSubRequirementIds(requirement) {
    // It seems the descriptions include whether the subrequirements are disjunctions or conjunctions, we don't need to
    // worry about this here.
    const result = requirement.subreqlogic.matchAll(SUB_REQUIREMENT_REGEX);
    return new Array(...result.map((e) => e.groups.requirementId));
}

function getRequirementDescription(requirementId, requirementsRaw) {
    const requirement = requirementsRaw[requirementId];
    const subRequirementIds = getSubRequirementIds(requirement);
    if (subRequirementIds.length === 0) {
        return requirement.description;
    }
    return requirement.description + subRequirementIds
        .map((subRequirementId) => requirementsRaw[subRequirementId].description)
        .join(" ");
}

function getName(member) {
    return member.firstname + " " + member.lastname;
}

function colgroup(span) {
    const x = document.createElement("colgroup");
    x.span = span;
    return x;
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
    console.log("talliesRaw");
    console.log(talliesRaw);

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
    console.log("autocompletionRequirements");
    console.log(autocompletionRequirements);

    // Identify sub-requirements so we can skip those below.
    const subRequirementIds = new Set(Object.values(requirementsRaw)
        .filter((requirement) => requirement.subreqlogic)
        .map(getSubRequirementIds)
        .flat()
    );
    console.log("subRequirementIds");
    console.log(subRequirementIds);

    // A map from OAS badge group ID to a map from level to an array of requirement IDs.
    console.log("requirementsRaw");
    console.log(requirementsRaw);
    const oasRequirementsMapUnsorted = new Map();
    Object.values(requirementsRaw).forEach((requirement) => {
        if (subRequirementIds.has(requirement.requirementid)) {
            return;
        }
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
            () => []).push(requirement.requirementid);
    });
    console.log("oasRequirementsMapUnsorted");
    console.log(oasRequirementsMapUnsorted);

    // A map from OAS badge group ID to a map from level to a sorted Set of requirement IDs.
    const oasRequirementsMap = new Map();
    Array.from(oasRequirementsMapUnsorted.keys()).toSorted().forEach((groupId) => {
        Array.from(oasRequirementsMapUnsorted.get(groupId).keys()).toSorted().forEach((level) => {
            getOrCreate(oasRequirementsMap, groupId, () => new Map())
                .set(level, new Set(oasRequirementsMapUnsorted.get(groupId).get(level).toSorted(
                    (a, b) => requirementsRaw[a].requirement - requirementsRaw[b].requirement)));
        });
    });
    console.log("oasRequirementsMap");
    console.log(oasRequirementsMap);

    // A Map from year to an array of member IDs.
    const youthMemberIdsMapUnsorted = new Map();
    Object.values(membersRaw)
        .filter((member) => true &&
            member.isnonparticipant === 0 &&
            member.membershiptype === 1 &&
            member.role === 10 &&
            member.status === 1 &&
            true)
        .forEach((member) => {
            getOrCreate(youthMemberIdsMapUnsorted, member.label, () => []).push(member.memberid);
        });
    console.log("youthMemberIdsMapUnsorted");
    console.log(youthMemberIdsMapUnsorted);

    // A Map from year to an array of member IDs.
    const youthMemberIdsMap = new Map();
    Array.from(youthMemberIdsMapUnsorted.keys()).toSorted((a, b) => b - a).forEach((year) => {
        youthMemberIdsMap.set(year, youthMemberIdsMapUnsorted.get(year).toSorted(
            (a, b) => getName(membersRaw[a]).localeCompare(getName(membersRaw[b]))));
    });
    console.log("youthMemberIdsMap");
    console.log(youthMemberIdsMap);

    const youthMemberIds = Array.from(youthMemberIdsMap.values()).flat();

    // A map from member ID to a map from OAS group ID to a map from level to a set of IDs of requirements not
    // completed.
    const oasRequirementsNotCompleted = new Map();
    youthMemberIds.forEach((memberId) => {
        const personId = membersRaw[memberId].personid;
        const completedRequirementIds = new Set(
            Object.keys(completedRequirementsRaw[personId] || {}));
        oasRequirementsNotCompleted.set(memberId, new Map());
        oasRequirementsMap.forEach((levelToBadge, oasBadgeGroupName) => {
            oasRequirementsNotCompleted.get(memberId).set(oasBadgeGroupName, new Map());
            levelToBadge.forEach((requirementIds, level) => {
                const autocompletedRequirementIds = new Set(requirementIds.values().filter((requirementId) => {
                    const autocompletionRequirement = autocompletionRequirements.get(requirementId);
                    if (!autocompletionRequirement) {
                        return false;
                    }
                    const count = talliesRaw[personId]?.[autocompletionRequirement.tallyId]?.list
                        .map((tally) => tally.count)
                        .reduce((a, b) => a + b, 0);
                    return count >= autocompletionRequirement.requiredCount;
                }));
                oasRequirementsNotCompleted.get(memberId).get(oasBadgeGroupName).set(
                    level, requirementIds.difference(completedRequirementIds).difference(autocompletedRequirementIds));
            });
        });
    });
    console.log("oasRequirementsNotCompleted");
    console.log(oasRequirementsNotCompleted);

    const table = document.createElement("table");

    table.appendChild(colgroup(1));
    oasRequirementsMap.forEach((levelToBadge) => {
        levelToBadge.forEach((requirementIds) => {
            table.appendChild(colgroup(requirementIds.size));
        });
    });

    const headerRowGroup = document.createElement("tbody");
    headerRowGroup.className = "header";

    const badgeGroupNameRow = document.createElement("tr");
    const help = document.createElement("a");
    help.textContent = "Help !";
    help.setAttribute("onclick", "showLegend();");
    const legendHeader = document.createElement("th");
    legendHeader.rowSpan = 3;
    legendHeader.appendChild(help);
    badgeGroupNameRow.appendChild(legendHeader);  // Name
    oasRequirementsMap.forEach((levelToBadge, oasBadgeGroupName) => {
        const td1 = th(OAS_BADGE_GROUPS[oasBadgeGroupName]);
        td1.colSpan = levelToBadge.values()
            .map((requirementIds) => requirementIds.size)
            .reduce((a, b) => a + b, 0);
        badgeGroupNameRow.appendChild(td1)
    });
    headerRowGroup.appendChild(badgeGroupNameRow);

    const levelRow = document.createElement("tr");
    oasRequirementsMap.forEach((levelToBadge) => {
        levelToBadge.forEach((requirementIds, level) => {
            const tdx = th(level);
            tdx.colSpan = requirementIds.size;
            levelRow.appendChild(tdx);
        });
    });
    headerRowGroup.appendChild(levelRow);

    const requirementRow = document.createElement("tr");
    oasRequirementsMap.forEach((levelToBadge) => {
        levelToBadge.forEach((requirementIds) => {
            requirementIds.forEach((requirementId) => {
                const x = th(requirementsRaw[requirementId].requirement);
                x.title = getRequirementDescription(requirementId, requirementsRaw);
                requirementRow.appendChild(x);
            });
        });
    });
    headerRowGroup.appendChild(requirementRow);
    table.appendChild(headerRowGroup);

    const summaryRowGroup = document.createElement("tbody");
    summaryRowGroup.className = "content";

    const potentialRow = document.createElement("tr");
    const potentialTh = th("Potential");
    potentialTh.title = "The number of Cubs that have not completed this requirement";
    potentialRow.appendChild(potentialTh);
    oasRequirementsMap.forEach((levelToBadge, oasBadgeGroupName) => {
        levelToBadge.forEach((requirementIds, level) => {
            requirementIds.forEach((requirementId) => {
                const count = youthMemberIds
                    .filter((memberId) => oasRequirementsNotCompleted.get(memberId).get(oasBadgeGroupName).get(level).has(requirementId))
                    .length;
                const x = td(count > 0 ? count : "");
                x.style.setProperty("background-color", toRgb(interpolate(WHITE_RGB, HIGHLIGHT_RGB, count / youthMemberIds.length)));
                potentialRow.appendChild(x);
            });
        });
    });
    summaryRowGroup.appendChild(potentialRow);

    const rewardRow = document.createElement("tr");
    const rewardTh = th("Reward");
    rewardTh.title = "The number of Cubs that will complete this OAS level if they complete this requirement"
    rewardRow.appendChild(rewardTh);
    oasRequirementsMap.forEach((levelToBadge, oasBadgeGroupName) => {
        levelToBadge.forEach((requirementIds, level) => {
            requirementIds.forEach((requirementId) => {
                const count = youthMemberIds
                    .filter((memberId) => oasRequirementsNotCompleted.get(memberId).get(oasBadgeGroupName).get(level).size === 1)
                    .filter((memberId) => oasRequirementsNotCompleted.get(memberId).get(oasBadgeGroupName).get(level).has(requirementId))
                    .length;
                const x = td(count > 0 ? count : "");
                x.style.setProperty("background-color", toRgb(interpolate(WHITE_RGB, HIGHLIGHT_RGB, 6 * count / youthMemberIds.length)));
                rewardRow.appendChild(x);
            });
        });
    });
    summaryRowGroup.appendChild(rewardRow);
    table.appendChild(summaryRowGroup);

    youthMemberIdsMap.forEach((memberIds, year) => {
        const yearRowGroup = document.createElement("tbody");
        yearRowGroup.className = "content";
        memberIds.forEach((memberId) => {
            const tr = document.createElement("tr");
            tr.appendChild(th(getName(membersRaw[memberId])));
            oasRequirementsMap.forEach((levelToBadge, oasBadgeGroupName) => {
                levelToBadge.forEach((requirementIds, level) => {
                    requirementIds.forEach((requirementId) => {
                        const x = document.createElement("td");
                        const notCompleted = oasRequirementsNotCompleted.get(memberId).get(oasBadgeGroupName).get(level);
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
            yearRowGroup.appendChild(tr);
        });
        table.appendChild(yearRowGroup);
    });
    return table;
}

const POTENTIAL = "The number of Cubs that have not completed this requirement";
const REWARD = "The number of Cubs that will complete this OAS level if they complete this requirement";

function buildLegend() {
    const a = document.createElement("a");
    a.textContent = "Close"
    a.setAttribute("onclick", "hideLegend();");
    const p = document.createElement("p");
    p.textContent = "This table shows the OAS requirements completed by each Cub, grouped by badge and level. "
        + "Hover over the requirement ID for a description of the requirement.";
    const table = document.createElement("table");
    const body = document.createElement("tbody");
    table.appendChild(body);
    const completed = document.createElement("div");
    completed.className = "completed"
    body.appendChild(tr(completed, "Requirement completed"));
    const allCompleted = document.createElement("div");
    allCompleted.className = "all-completed"
    body.appendChild(tr(allCompleted, "All requirements in this OAS level completed"));
    const soleRemaining = document.createElement("div");
    soleRemaining.className = "sole-remaining"
    body.appendChild(tr(soleRemaining, "Last remaining uncompleted requirement in this OAS level"));
    body.appendChild(tr("Potential", POTENTIAL));
    body.appendChild(tr("Reward", REWARD));
    const legend = document.createElement("div");
    legend.id = "oas-summary-legend";
    legend.style.display = "none";
    const mask = document.createElement("div");
    mask.className = "mask"
    legend.appendChild(mask);
    const inner = document.createElement("div");
    inner.className = "inner"
    legend.appendChild(inner);
    inner.appendChild(a);
    inner.appendChild(p);
    inner.appendChild(table);
    return legend;
}

function tr(a, b) {
    const x = document.createElement("tr");
    const th = document.createElement("th");
    if (a instanceof Node) {
        th.appendChild(a);
    } else {
        th.textContent = a;
    }
    x.appendChild(th);
    x.appendChild(td(b));
    return x
}

function prep() {
    // Clone Reports > History because it is simple.
    const oasSummary = document.getElementById("history").cloneNode(true);
    oasSummary.id = "oas-summary";
    // Update the title
    oasSummary
        .getElementsByTagName("div")
        .item(0)
        .getElementsByTagName("h1")
        .item(0)
        .textContent = "OAS Summary";
    // Remove the top margin from page content. Not sure why that's here.
    oasSummary
        .getElementsByTagName("div")
        .item(1)
        .getElementsByClassName("page-content")
        .item(0)
        .style
        .marginTop = "0";
    document.body.appendChild(oasSummary);

    const ul = document
        .getElementById("reports")
        .getElementsByClassName("page-content").item(0)
        .getElementsByTagName("div").item(1)
        .getElementsByTagName("ul").item(0);
    const li = ul.getElementsByTagName("li").item(0).cloneNode(true);
    const a = li.getElementsByTagName("a").item(0);
    a.setAttribute("onclick", "show();");
    a.textContent = "OAS Summary"
    ul.appendChild(li);
}

async function show() {
    resetUpPoint("#oas-summary")
    const content = document.getElementById("oas-summary")
        .getElementsByClassName("page-content")
        .item(0);
    // TODO: Don't replace the legend!
    content.innerHTML = "";
    content.appendChild(await go());
    // We put this after the table to avoid complexity with the stacking contexts created by the sticky positions in the table.
    content.appendChild(buildLegend());
}

function showLegend() {
    document.getElementById("oas-summary-legend").style.display = null;
}

function hideLegend() {
    document.getElementById("oas-summary-legend").style.display = "none";
}

prep();
