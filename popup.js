document.getElementById("open-organizer").addEventListener("click", async () => {
  await chrome.tabs.create({ url: chrome.runtime.getURL("organizer.html") });
  window.close();
});
