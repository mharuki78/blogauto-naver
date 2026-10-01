const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const FALLBACK_MODELS = [
  { id: "gpt-6.1-sol", label: "GPT-6.1 Sol" },
  { id: "gpt-6-astra", label: "GPT-6 Astra" },
  { id: "gpt-6-sol", label: "GPT-6 Sol" },
  { id: "gpt-6-luna", label: "GPT-6 Luna" },
  { id: "gpt-5.6-sol", label: "GPT-5.6 Sol" },
  { id: "gpt-5.6-terra", label: "GPT-5.6 Terra" },
  { id: "gpt-5.6-luna", label: "GPT-5.6 Luna" },
  { id: "gpt-5.5", label: "GPT-5.5" }
];

function codexModelsCachePath() {
  const codexHome = String(process.env.CODEX_HOME || "").trim() || path.join(os.homedir(), ".codex");
  return path.join(codexHome, "models_cache.json");
}

function parseAvailableModels(cache) {
  if (!Array.isArray(cache?.models)) return [];
  const seen = new Set();
  return cache.models
    .filter((model) => model?.visibility === "list" && model?.supported_in_api !== false)
    .map((model) => ({
      id: String(model.slug || "").trim().toLowerCase(),
      label: String(model.display_name || model.slug || "").trim(),
      priority: Number(model.priority)
    }))
    .filter((model) => {
      if (!/^[a-z0-9][a-z0-9.-]{0,79}$/.test(model.id) || !model.label || seen.has(model.id)) return false;
      seen.add(model.id);
      return true;
    })
    .sort((a, b) => (Number.isFinite(a.priority) ? a.priority : 999) - (Number.isFinite(b.priority) ? b.priority : 999))
    .map(({ id, label }) => ({ id, label }));
}

function getAvailableCodexModels() {
  try {
    const models = parseAvailableModels(JSON.parse(fs.readFileSync(codexModelsCachePath(), "utf8")));
    if (models.length) {
      const cachedById = new Map(models.map((model) => [model.id, model]));
      const bundledIds = new Set(FALLBACK_MODELS.map((model) => model.id));
      return [
        ...FALLBACK_MODELS.map((model) => ({ ...(cachedById.get(model.id) || model) })),
        ...models.filter((model) => !bundledIds.has(model.id))
      ];
    }
  } catch {
    // The bundled list keeps model selection available before Codex creates its cache.
  }
  return FALLBACK_MODELS.map((model) => ({ ...model }));
}

function normalizeCodexModel(value) {
  const id = String(value || "").trim().toLowerCase();
  return getAvailableCodexModels().some((model) => model.id === id) ? id : "";
}

module.exports = { getAvailableCodexModels, normalizeCodexModel, parseAvailableModels };
