let fallbackMessages = null;

function t(key, substitutions) {
  const chromeMessage = chrome.i18n.getMessage(key, substitutions);
  if (chromeMessage) return chromeMessage;

  const entry = fallbackMessages?.[key];
  if (!entry) return key;

  let message = entry.message;
  const values = Array.isArray(substitutions) ? substitutions : substitutions == null ? [] : [substitutions];
  if (entry.placeholders) {
    for (const [name, placeholder] of Object.entries(entry.placeholders)) {
      const match = /^\$(\d+)$/.exec(placeholder.content);
      if (!match) continue;
      const value = values[Number(match[1]) - 1] ?? "";
      message = message.replaceAll(`$${name.toUpperCase()}$`, String(value));
    }
  } else {
    for (let index = 0; index < values.length; index += 1) {
      message = message.replace(/\$[A-Z_]+\$/i, String(values[index]));
    }
  }
  return message;
}

function localeCandidates() {
  const ui = chrome.i18n.getUILanguage().replace("-", "_");
  const short = ui.split("_")[0];
  const candidates = [ui];
  if (short === "zh") candidates.push("zh_TW");
  candidates.push(short, "en");
  return [...new Set(candidates)];
}

async function loadFallbackMessages() {
  for (const locale of localeCandidates()) {
    try {
      const response = await fetch(chrome.runtime.getURL(`_locales/${locale}/messages.json`));
      if (response.ok) {
        fallbackMessages = await response.json();
        return;
      }
    } catch {
      // Try the next locale candidate.
    }
  }
}

function applyI18n() {
  document.documentElement.lang = chrome.i18n.getUILanguage();
  document.querySelectorAll("[data-i18n]").forEach((node) => {
    node.textContent = t(node.dataset.i18n);
  });
  document.querySelectorAll("[data-i18n-title]").forEach((node) => {
    node.title = t(node.dataset.i18nTitle);
  });
}

window.i18nReady = (async () => {
  if (!chrome.i18n.getMessage("app_name")) await loadFallbackMessages();
  applyI18n();
})();
