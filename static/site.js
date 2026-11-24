(() => {
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
  }

  const status = document.querySelector("#engine-status");
  const dot = document.querySelector("#engine-dot");
  if (status) {
    fetch("/api/health").then(response => {
      if (!response.ok) throw new Error("Local AI is not available");
      return response.json();
    }).then(health => {
      const models = health.models || {};
      const available = Object.values(models).some(model => model?.available);
      status.textContent = available ? "Local AI ready" : "Local AI needs setup";
      dot?.classList.toggle("ready", available);
    }).catch(() => { status.textContent = "Start the local AI service"; });
  }

  const installButtons = [...document.querySelectorAll("#install-button, #install-hero")];
  let installPrompt = null;
  const isInstalled = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
  if (isInstalled) installButtons.forEach(button => { button.textContent = "App installed"; button.disabled = true; button.classList.remove("hidden"); });
  window.addEventListener("beforeinstallprompt", event => {
    event.preventDefault();
    installPrompt = event;
    installButtons.forEach(button => button.classList.remove("hidden"));
  });
  installButtons.forEach(button => button.addEventListener("click", async () => {
    if (!installPrompt) {
      const statusMessage = document.querySelector("#engine-status");
      if (statusMessage) statusMessage.textContent = "Use your browser menu → Install Sonora";
      return;
    }
    installPrompt.prompt();
    await installPrompt.userChoice;
    installPrompt = null;
    installButtons.forEach(item => item.classList.add("hidden"));
  }));
})();
