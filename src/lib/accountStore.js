const fs = require("node:fs");
const {writeJsonAtomic}=require("./atomicJson");
const path = require("node:path");

const DEFAULT_ACCOUNT_STORE = {
  selectedAccountId: "",
  accounts: []
};

function getAccountStorePath(runtimeRoot) {
  return path.join(runtimeRoot, "account-categories.json");
}

function makeId(prefix = "acct") {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeSearchChannel(value) {
  return ["blog", "news", "web"].includes(value) ? value : "blog";
}

function normalizeSearchProvider(value, fallback = "naver") {
  return ["naver", "google"].includes(value) ? value : fallback;
}

function normalizeCategory(category) {
  if (typeof category === "string") {
    return {
      id: makeId("cat"),
      name: category.trim(),
      keyword: "",
      excludedTopics: "",
      publishPurpose: "",
      preferredTone: "",
      freshnessLevel: "auto",
      searchChannel: "blog",
      primarySearchProvider: "naver",
      fallbackSearchProvider: "google",
      trustBlogAsSource: false,
      checked: true
    };
  }
  return {
    id: String(category?.id || makeId("cat")),
    name: String(category?.name || category?.category || "").trim(),
    keyword: String(category?.keyword || "").trim(),
    excludedTopics: String(category?.excludedTopics || "").trim(),
    publishPurpose: String(category?.publishPurpose || "").trim(),
    preferredTone: String(category?.preferredTone || "").trim(),
    freshnessLevel: ["auto", "low", "medium", "high"].includes(category?.freshnessLevel)
      ? category.freshnessLevel
      : "auto",
    searchChannel: normalizeSearchChannel(category?.searchChannel),
    primarySearchProvider: normalizeSearchProvider(category?.primarySearchProvider, "naver"),
    fallbackSearchProvider: normalizeSearchProvider(category?.fallbackSearchProvider, "google"),
    trustBlogAsSource: category?.trustBlogAsSource === true,
    checked: category?.checked !== false
  };
}

function normalizeReferenceImages(account) {
  const rawImages = Array.isArray(account?.referenceImages)
    ? account.referenceImages
    : (account?.sampleImagePath ? [{
      id: "legacy-sample",
      path: account.sampleImagePath,
      hash: account.sampleImageHash,
      name: path.basename(String(account.sampleImagePath)),
      updatedAt: account.sampleImageUpdatedAt
    }] : []);
  const seen = new Set();
  return rawImages.map((image, index) => ({
    id: String(image?.id || `reference-${index + 1}`).trim(),
    path: String(image?.path || "").trim(),
    hash: String(image?.hash || "").trim(),
    name: String(image?.name || path.basename(String(image?.path || ""))).trim(),
    updatedAt: String(image?.updatedAt || "")
  })).filter((image) => {
    if (!image.id || !image.path || seen.has(image.id)) return false;
    seen.add(image.id);
    return true;
  });
}

function normalizeAccount(account) {
  // Existing profile folders were named with naverId. Keep this legacy key only
  // so upgrades reuse the same browser profile; it is never used to fill login forms.
  const naverId = String(account?.naverId || account?.idValue || "").trim();
  const blogId = String(account?.blogId || account?.naverBlogId || naverId || "").trim();
  const id = String(account?.id || "").trim() || makeId("acct");
  const categories = (Array.isArray(account?.categories) ? account.categories : [])
    .map(normalizeCategory)
    .filter((category) => category.name);
  const referenceImages = normalizeReferenceImages(account);
  const firstReference = referenceImages[0];

  return {
    id,
    label: String(account?.label || blogId || naverId || "Naver 계정").trim(),
    naverId,
    blogId,
    referenceImages,
    sampleImagePath: firstReference?.path || "",
    sampleImageHash: firstReference?.hash || "",
    sampleImageUpdatedAt: firstReference?.updatedAt || "",
    imageStylePrompt: String(account?.imageStylePrompt || ""),
    imageStylePromptUpdatedAt: String(account?.imageStylePromptUpdatedAt || ""),
    imageStylePromptStatus: ["missing", "ready", "stale", "failed"].includes(account?.imageStylePromptStatus)
      ? account.imageStylePromptStatus
      : (account?.imageStylePrompt ? "ready" : "missing"),
    imageStylePromptSourceImageHash: String(account?.imageStylePromptSourceImageHash || ""),
    imageStylePromptError: String(account?.imageStylePromptError || ""),
    checked: account?.checked !== false,
    sessionStatus: ["valid", "expired", "unknown"].includes(account?.sessionStatus)
      ? account.sessionStatus
      : "unknown",
    sessionCheckedAt: String(account?.sessionCheckedAt || ""),
    categories
  };
}

function migrateFromSettings(settings) {
  const blogId = String(settings?.blogId || settings?.naverId || "").trim();
  const category = String(settings?.category || "").trim();
  const keyword = String(settings?.keyword || "").trim();
  if (!blogId && !category) return null;

  return normalizeAccount({
    label: blogId || "기본 계정",
    blogId,
    checked: true,
    categories: category ? [{ name: category, keyword, checked: true }] : []
  });
}

function normalizeStore(rawStore, settingsForMigration, options = {}) {
  const hasExplicitAccounts = Array.isArray(rawStore?.accounts);
  const rawAccounts = hasExplicitAccounts ? rawStore.accounts : [];
  let accounts = rawAccounts.map(normalizeAccount);
  if (!accounts.length && !hasExplicitAccounts && options.allowSettingsMigration !== false) {
    const migrated = migrateFromSettings(settingsForMigration);
    if (migrated) accounts = [migrated];
  }

  const selectedAccountId = accounts.some((account) => account.id === rawStore?.selectedAccountId)
    ? rawStore.selectedAccountId
    : (accounts[0]?.id || "");

  return {
    selectedAccountId,
    accounts
  };
}

function ensureAccountStoreFile(runtimeRoot, settingsForMigration = {}) {
  fs.mkdirSync(runtimeRoot, { recursive: true });
  const storePath = getAccountStorePath(runtimeRoot);
  if (!fs.existsSync(storePath)) {
    const initial = normalizeStore({}, settingsForMigration);
    writeJsonAtomic(storePath, initial);
  }
}

function readAccountStore(runtimeRoot, settingsForMigration = {}) {
  ensureAccountStoreFile(runtimeRoot, settingsForMigration);
  const storePath = getAccountStorePath(runtimeRoot);
  try {
    const raw = fs.readFileSync(storePath, "utf8").replace(/^\uFEFF/, "");
    const parsed = JSON.parse(raw);
    const normalized = normalizeStore(parsed, settingsForMigration);
    const containsStoredPassword = (Array.isArray(parsed?.accounts) ? parsed.accounts : [])
      .some((account) => (
        Object.prototype.hasOwnProperty.call(account || {}, "naverPassword")
        || Object.prototype.hasOwnProperty.call(account || {}, "password")
      ));
    if (containsStoredPassword) {
      try {
        writeJsonAtomic(storePath, normalized);
      } catch {
        // Keep using the in-memory credential-free data even if a legacy file is read-only.
      }
    }
    return normalized;
  } catch {
    return normalizeStore({}, settingsForMigration);
  }
}

function writeAccountStore(runtimeRoot, nextStore, settingsForMigration = {}) {
  ensureAccountStoreFile(runtimeRoot, settingsForMigration);
  const normalized = normalizeStore(nextStore || DEFAULT_ACCOUNT_STORE, settingsForMigration, {
    allowSettingsMigration: false
  });
  writeJsonAtomic(getAccountStorePath(runtimeRoot), normalized);
  return normalized;
}

function updateAccountSession(runtimeRoot, accountId, sessionStatus, settingsForMigration = {}) {
  const store = readAccountStore(runtimeRoot, settingsForMigration);
  let changed = false;
  for (const account of store.accounts) {
    if (account.id === accountId) {
      account.sessionStatus = sessionStatus;
      account.sessionCheckedAt = new Date().toISOString();
      changed = true;
      break;
    }
  }
  return changed ? writeAccountStore(runtimeRoot, store, settingsForMigration) : store;
}

function safeProfileSegment(value) {
  return String(value || "account")
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 80);
}

function getAccountProfileDir(runtimeRoot, account) {
  const segment = safeProfileSegment(`${account?.naverId || account?.blogId || "naver"}_${account?.id || "profile"}`);
  return path.join(runtimeRoot, "browser-profiles", segment);
}

function revokeChangedConnections(bridge, previous, next) {
  for(const account of previous.accounts || []) {
    const replacement=(next.accounts || []).find(item=>item.id===account.id);
    if(!replacement || String(replacement.blogId || '')!==account.blogId)bridge.revoke(account.id);
  }
}

module.exports = {
  revokeChangedConnections,
  DEFAULT_ACCOUNT_STORE,
  ensureAccountStoreFile,
  readAccountStore,
  writeAccountStore,
  updateAccountSession,
  getAccountProfileDir,
  getAccountStorePath,
  normalizeReferenceImages
};
