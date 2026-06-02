const colors = ["blue", "green", "yellow", "red", "purple", "cyan", "pink", "orange", "grey"];
const chipPalette = [
  { bg: "#fff1c2", border: "#f4c542", accent: "#f2b705" },
  { bg: "#dff7ed", border: "#4cc38a", accent: "#1f9d63" },
  { bg: "#dfefff", border: "#6aa7e8", accent: "#2f78d4" },
  { bg: "#ffe5ef", border: "#ef7aa9", accent: "#d94883" },
  { bg: "#efe7ff", border: "#a78bfa", accent: "#7c3aed" },
  { bg: "#e2fbff", border: "#58c8d8", accent: "#0f91a5" },
  { bg: "#ffe7d6", border: "#fb923c", accent: "#ea580c" }
];
const multiPartSuffixes = new Set([
  "com.tw",
  "org.tw",
  "net.tw",
  "edu.tw",
  "gov.tw",
  "co.uk",
  "ac.uk",
  "gov.uk",
  "com.au",
  "net.au",
  "org.au",
  "co.jp",
  "ne.jp",
  "or.jp",
  "com.hk",
  "com.sg",
  "com.cn",
  "com.br",
  "com.mx"
]);

let scannedSites = [];
let groups = [];
let nextGroupNumber = 1;
let lastPlan = [];
let lastRun = null;

const statusNode = document.getElementById("status");
const planNode = document.getElementById("plan");
const siteListNode = document.getElementById("site-list");
const groupListNode = document.getElementById("group-list");
const sourcePanelNode = document.getElementById("source-panel");
const scan_button = document.getElementById("scan");
const auto_groups_button = document.getElementById("auto-groups");
const add_group_button = document.getElementById("add-group");
const preview_button = document.getElementById("preview");
const group_button = document.getElementById("group");
const undo_button = document.getElementById("undo");

function setStatus(text) {
  statusNode.textContent = text;
}

function getOptions() {
  return {
    closeDuplicates: document.getElementById("close-duplicates").checked,
    splitLargeGroups: document.getElementById("split-large-groups").checked,
    largeGroupSize: Math.max(10, Math.min(200, Number(document.getElementById("large-group-size").value) || 50)),
    collapseGroups: document.getElementById("collapse-groups").checked
  };
}

function siteKey(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;

  const hostname = parsed.hostname.toLowerCase().replace(/^www\./, "");
  const parts = hostname.split(".").filter(Boolean);
  if (parts.length <= 2) return hostname;

  const tail2 = parts.slice(-2).join(".");
  if (multiPartSuffixes.has(tail2)) return parts.slice(-3).join(".");
  return tail2;
}

function ruleForSite(site) {
  if (!site) return null;
  return { key: site, title: site };
}

function mostCommonWindowId(tabs) {
  const counts = new Map();
  for (const tab of tabs) {
    counts.set(tab.windowId, (counts.get(tab.windowId) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || tabs[0]?.windowId;
}

function canonicalUrl(tab) {
  const rawUrl = tab.url || tab.pendingUrl || "";
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return null;
  }
}

function siteByKey(key) {
  return scannedSites.find((site) => site.key === key);
}

function palette(index) {
  return chipPalette[index % chipPalette.length];
}

function renderSiteChip(site, paletteIndex) {
  const color = palette(paletteIndex);
  const chip = document.createElement("div");
  chip.className = "site-chip";
  chip.draggable = true;
  chip.dataset.siteKey = site.key;
  chip.style.setProperty("--chip-bg", color.bg);
  chip.style.setProperty("--chip-border", color.border);

  const name = document.createElement("span");
  name.textContent = site.title;

  const count = document.createElement("span");
  count.className = "site-count";
  count.textContent = t("tab_count", String(site.count));

  chip.append(name, count);
  chip.addEventListener("dragstart", (event) => {
    event.dataTransfer.setData("text/plain", site.key);
    event.dataTransfer.effectAllowed = "move";
  });
  return chip;
}

function assignedSiteKeys() {
  return new Set(groups.flatMap((group) => group.siteKeys));
}

function renderSites() {
  siteListNode.replaceChildren();
  const assigned = assignedSiteKeys();
  const unassigned = scannedSites.filter((site) => !assigned.has(site.key));

  if (scannedSites.length === 0) {
    siteListNode.append(emptyState(t("no_sites_found")));
    return;
  }
  if (unassigned.length === 0) {
    siteListNode.append(emptyState(t("all_sites_assigned")));
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const site of unassigned) {
    fragment.append(renderSiteChip(site, scannedSites.indexOf(site)));
  }
  siteListNode.append(fragment);
}

function renderGroups() {
  groupListNode.replaceChildren();
  if (groups.length === 0) {
    groupListNode.append(emptyState(t("no_groups_yet")));
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const group of groups) {
    const color = palette(group.colorIndex);
    const box = document.createElement("section");
    box.className = "group-box";
    box.dataset.groupId = group.id;
    box.style.setProperty("--group-bg", color.bg);
    box.style.setProperty("--group-border", color.border);
    box.style.setProperty("--group-accent", color.accent);

    const top = document.createElement("div");
    top.className = "group-top";

    const input = document.createElement("input");
    input.className = "group-title";
    input.value = group.title;
    input.placeholder = t("group_name_placeholder");
    input.addEventListener("input", () => {
      group.title = input.value;
      clearPreview();
    });

    const remove = document.createElement("button");
    remove.className = "remove-group";
    remove.type = "button";
    remove.textContent = "x";
    remove.title = t("remove_group_label");
    remove.addEventListener("click", () => {
      groups = groups.filter((item) => item.id !== group.id);
      clearPreview();
      renderAll();
    });

    top.append(input, remove);

    const drop = document.createElement("div");
    drop.className = "group-sites drop-target";
    drop.dataset.dropZone = "group";
    drop.dataset.groupId = group.id;
    if (group.siteKeys.length === 0) {
      drop.append(emptyState(t("drop_sites_here")));
    } else {
      for (const key of group.siteKeys) {
        const site = siteByKey(key);
        if (site) drop.append(renderSiteChip(site, scannedSites.indexOf(site)));
      }
    }

    box.append(top, drop);
    fragment.append(box);
  }
  groupListNode.append(fragment);
  bindDropTargets();
}

function emptyState(text) {
  const node = document.createElement("div");
  node.className = "empty-state";
  node.textContent = text;
  return node;
}

function renderAll() {
  renderSites();
  renderGroups();
}

function clearPreview() {
  lastPlan = [];
  renderPlan([]);
}

function createGroup() {
  groups.push({
    id: String(Date.now()) + "-" + String(nextGroupNumber),
    title: t("default_group_name", String(nextGroupNumber)),
    siteKeys: [],
    colorIndex: nextGroupNumber - 1
  });
  nextGroupNumber += 1;
  clearPreview();
  renderAll();
}

function createAutoGroups() {
  groups = scannedSites.map((site, index) => ({
    id: `auto-${Date.now()}-${index}`,
    title: site.title,
    siteKeys: [site.key],
    colorIndex: index
  }));
  nextGroupNumber = groups.length + 1;
  clearPreview();
  renderAll();
  setStatus(t("auto_groups_status", String(groups.length)));
}

function removeSiteFromGroups(siteKey) {
  for (const group of groups) {
    group.siteKeys = group.siteKeys.filter((key) => key !== siteKey);
  }
}

function assignSiteToGroup(siteKey, groupId) {
  if (!siteByKey(siteKey)) return;
  removeSiteFromGroups(siteKey);
  const group = groups.find((item) => item.id === groupId);
  if (!group) return;
  group.siteKeys.push(siteKey);
}

function bindDropTargets() {
  bindDropTarget(sourcePanelNode);
  document.querySelectorAll(".group-sites").forEach(bindDropTarget);
}

function bindDropTarget(target) {
  if (target.dataset.dropReady === "true") return;
  target.dataset.dropReady = "true";

  target.addEventListener("dragover", (event) => {
    event.preventDefault();
    target.classList.add("drag-over");
  });
  target.addEventListener("dragleave", () => {
    target.classList.remove("drag-over");
  });
  target.addEventListener("drop", (event) => {
    event.preventDefault();
    target.classList.remove("drag-over");
    const siteKey = event.dataTransfer.getData("text/plain");
    if (!siteKey) return;
    if (target.dataset.dropZone === "source") {
      removeSiteFromGroups(siteKey);
    } else {
      assignSiteToGroup(siteKey, target.dataset.groupId);
    }
    clearPreview();
    renderAll();
  });
}

function renderPlan(plan) {
  planNode.replaceChildren();
  const fragment = document.createDocumentFragment();
  for (const item of plan) {
    const row = document.createElement("tr");
    const groupCell = document.createElement("td");
    const sitesCell = document.createElement("td");
    const tabsCell = document.createElement("td");
    const duplicatesCell = document.createElement("td");

    groupCell.textContent = item.title;
    sitesCell.textContent = item.siteTitles.join(", ");
    tabsCell.textContent = String(item.tabs.length);
    duplicatesCell.textContent = String(item.duplicateTabs?.length || 0);

    row.append(groupCell, sitesCell, tabsCell, duplicatesCell);
    fragment.append(row);
  }
  planNode.append(fragment);
}

async function scanDomains() {
  setBusy(true);
  try {
    const threshold = Math.max(2, Number(document.getElementById("scan-threshold").value) || 3);
    const tabs = await chrome.tabs.query({ windowType: "normal" });
    const buckets = new Map();

    for (const tab of tabs) {
      if (!tab.id || !tab.windowId || tab.pinned) continue;
      const site = siteKey(tab.url || tab.pendingUrl || "");
      const rule = ruleForSite(site);
      if (!rule) continue;
      if (!buckets.has(rule.key)) buckets.set(rule.key, { ...rule, count: 0 });
      buckets.get(rule.key).count += 1;
    }

    scannedSites = [...buckets.values()]
      .filter((site) => site.count >= threshold)
      .sort((a, b) => b.count - a.count || a.title.localeCompare(b.title));
    const available = new Set(scannedSites.map((site) => site.key));
    for (const group of groups) {
      group.siteKeys = group.siteKeys.filter((key) => available.has(key));
    }
    clearPreview();
    renderAll();
    setStatus(t("scan_found", [String(scannedSites.length), String(threshold)]));
  } catch (error) {
    console.error(error);
    setStatus(t("scan_failed", String(error.message || error)));
  } finally {
    setBusy(false);
  }
}

function applyDuplicatePlan(plan, options) {
  if (!options.closeDuplicates) return plan;

  const seen = new Map();
  const duplicateIdsByPlanItem = new Map();

  for (const item of plan) {
    for (const tab of item.tabs) {
      const url = canonicalUrl(tab);
      if (!url || !tab.id) continue;
      if (seen.has(url)) {
        if (!duplicateIdsByPlanItem.has(item)) duplicateIdsByPlanItem.set(item, []);
        duplicateIdsByPlanItem.get(item).push(tab.id);
        continue;
      }
      seen.set(url, tab.id);
    }
  }

  return plan.map((item) => {
    const duplicateTabs = duplicateIdsByPlanItem.get(item) || [];
    if (duplicateTabs.length === 0) return item;
    const duplicateSet = new Set(duplicateTabs);
    return {
      ...item,
      duplicateTabs,
      tabs: item.tabs.filter((tab) => !duplicateSet.has(tab.id))
    };
  });
}

function splitLargeGroups(plan, options) {
  if (!options.splitLargeGroups) return plan;

  const chunkSize = options.largeGroupSize;
  const result = [];
  for (const item of plan) {
    if (item.tabs.length <= chunkSize) {
      result.push(item);
      continue;
    }
    for (let start = 0; start < item.tabs.length; start += chunkSize) {
      const end = Math.min(start + chunkSize, item.tabs.length);
      result.push({
        ...item,
        title: `${item.title} ${start + 1}-${end}`,
        tabs: item.tabs.slice(start, end),
        duplicateTabs: start === 0 ? item.duplicateTabs : []
      });
    }
  }
  return result;
}

async function buildPlan(options) {
  const activeGroups = groups.filter((group) => group.siteKeys.length > 0);
  if (activeGroups.length === 0) return [];

  const selectedKeys = new Set(activeGroups.flatMap((group) => group.siteKeys));
  const tabs = await chrome.tabs.query({ windowType: "normal" });
  const tabsBySite = new Map();

  for (const tab of tabs) {
    if (!tab.id || !tab.windowId || tab.pinned) continue;
    const site = siteKey(tab.url || tab.pendingUrl || "");
    const rule = ruleForSite(site);
    if (!rule || !selectedKeys.has(rule.key)) continue;
    if (!tabsBySite.has(rule.key)) tabsBySite.set(rule.key, []);
    tabsBySite.get(rule.key).push(tab);
  }

  const basePlan = activeGroups
    .map((group) => {
      const siteTitles = group.siteKeys.map((key) => siteByKey(key)?.title || key);
      const tabsForGroup = group.siteKeys.flatMap((key) => tabsBySite.get(key) || []);
      return {
        groupId: group.id,
        title: (group.title || "").trim() || t("untitled_group"),
        siteKeys: [...group.siteKeys],
        siteTitles,
        colorIndex: group.colorIndex,
        tabs: tabsForGroup,
        duplicateTabs: []
      };
    })
    .filter((item) => item.tabs.length > 0);

  return splitLargeGroups(applyDuplicatePlan(basePlan, options), options);
}

async function withRetry(operation) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      const message = String(error && error.message ? error.message : error);
      if (!message.includes("Tabs cannot be edited right now") || attempt === 7) throw error;
      await new Promise((resolve) => setTimeout(resolve, 80 + attempt * 40));
    }
  }
}

async function preview() {
  setBusy(true);
  try {
    const options = getOptions();
    lastPlan = await buildPlan(options);
    renderPlan(lastPlan);
    const tab_count = lastPlan.reduce((sum, item) => sum + item.tabs.length, 0);
    const duplicateCount = lastPlan.reduce((sum, item) => sum + (item.duplicateTabs?.length || 0), 0);
    setStatus(t("preview_status", [String(lastPlan.length), String(tab_count), String(duplicateCount)]));
  } catch (error) {
    console.error(error);
    setStatus(t("preview_failed", String(error.message || error)));
  } finally {
    setBusy(false);
  }
}

async function groupTabs() {
  setBusy(true);
  try {
    const options = getOptions();
    const plan = await buildPlan(options);
    renderPlan(plan);

    const duplicateTabs = [...new Set(plan.flatMap((item) => item.duplicateTabs || []))];
    if (options.closeDuplicates && duplicateTabs.length > 0) {
      await chrome.tabs.remove(duplicateTabs);
    }

    const activeTabs = await chrome.tabs.query({ active: true, windowType: "normal" });
    const updated = [];
    for (const item of plan) {
      const tabIds = item.tabs.map((tab) => tab.id).filter((id) => Number.isInteger(id) && !duplicateTabs.includes(id));
      if (tabIds.length === 0) continue;

      const destinationWindowId = mostCommonWindowId(item.tabs);
      const tabsInOtherWindows = item.tabs
        .filter((tab) => tab.windowId !== destinationWindowId && !duplicateTabs.includes(tab.id))
        .map((tab) => tab.id)
        .filter(Number.isInteger);
      if (tabsInOtherWindows.length > 0) {
        await withRetry(() => chrome.tabs.move(tabsInOtherWindows, { windowId: destinationWindowId, index: -1 }));
      }

      const chromeGroupId = await withRetry(() =>
        chrome.tabs.group({
          tabIds,
          createProperties: { windowId: destinationWindowId }
        })
      );
      await chrome.tabGroups.update(chromeGroupId, {
        title: item.title,
        color: colors[item.colorIndex % colors.length],
        collapsed: options.collapseGroups
      });
      updated.push({ chromeGroupId, tabIds, title: item.title });
    }

    for (const tab of activeTabs) {
      if (tab.id && tab.windowId) {
        await chrome.tabs.update(tab.id, { active: true }).catch(() => {});
      }
    }

    lastRun = updated;
    undo_button.disabled = updated.length === 0;
    const movedTabs = updated.reduce((sum, item) => sum + item.tabIds.length, 0);
    setStatus(t("done_status", [String(updated.length), String(movedTabs), String(duplicateTabs.length)]));
  } catch (error) {
    console.error(error);
    setStatus(t("grouping_failed", String(error.message || error)));
  } finally {
    setBusy(false);
  }
}

async function undoLastRun() {
  if (!lastRun || lastRun.length === 0) return;
  setBusy(true);
  try {
    const tabIds = lastRun.flatMap((item) => item.tabIds);
    if (tabIds.length > 0) await chrome.tabs.ungroup(tabIds);
    setStatus(t("undo_status", String(tabIds.length)));
    lastRun = null;
    undo_button.disabled = true;
    await preview();
  } catch (error) {
    console.error(error);
    setStatus(t("undo_failed", String(error.message || error)));
  } finally {
    setBusy(false);
  }
}

function setBusy(isBusy) {
  scan_button.disabled = isBusy;
  auto_groups_button.disabled = isBusy || scannedSites.length === 0;
  add_group_button.disabled = isBusy;
  preview_button.disabled = isBusy;
  group_button.disabled = isBusy;
  if (!lastRun || lastRun.length === 0) {
    undo_button.disabled = true;
  } else {
    undo_button.disabled = isBusy;
  }
}

scan_button.addEventListener("click", scanDomains);
auto_groups_button.addEventListener("click", createAutoGroups);
add_group_button.addEventListener("click", createGroup);
preview_button.addEventListener("click", preview);
group_button.addEventListener("click", groupTabs);
undo_button.addEventListener("click", undoLastRun);

async function init() {
  await window.i18nReady;
  bindDropTargets();
  await scanDomains();
}

init();
