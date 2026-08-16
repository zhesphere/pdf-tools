const RECIPE_KEY = 'orbitvo-pdf-tools:recipe:v1';
const SETTINGS_KEY = 'orbitvo-pdf-tools:settings:v1';
const RECIPE_TTL_MS = 24 * 60 * 60 * 1000;

function readJson(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || 'null');
  } catch {
    return null;
  }
}

export function loadSettings() {
  const settings = readJson(SETTINGS_KEY);
  return settings && typeof settings === 'object' ? settings : {};
}

export function saveSettings(settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Storage can be unavailable in private browsing; the tool remains usable.
  }
}

export function saveRecipe(recipe) {
  try {
    localStorage.setItem(RECIPE_KEY, JSON.stringify({ ...recipe, savedAt: Date.now() }));
  } catch {
    // Recovery is optional and must never block PDF processing.
  }
}

export function loadRecipe(fingerprint) {
  const recipe = readJson(RECIPE_KEY);
  if (!recipe || recipe.fingerprint !== fingerprint) return null;
  if (!Number.isFinite(recipe.savedAt) || Date.now() - recipe.savedAt > RECIPE_TTL_MS) {
    try {
      localStorage.removeItem(RECIPE_KEY);
    } catch {
      // Expired recovery data can be ignored even if storage is unavailable.
    }
    return null;
  }
  return recipe;
}

export function clearLocalSession() {
  try {
    localStorage.removeItem(RECIPE_KEY);
    localStorage.removeItem(SETTINGS_KEY);
  } catch {
    // Nothing else to clear when storage access is unavailable.
  }
}
