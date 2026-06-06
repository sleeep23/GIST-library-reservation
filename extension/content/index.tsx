import React from "react";
import { createRoot, type Root } from "react-dom/client";
import { ExtensionPanel } from "../panel/ExtensionPanel";
import { shouldShowReservationAssistant } from "./detectReservationPage";

const rootId = "gist-library-reservation-assistant-root";
let reactRoot: Root | null = null;
let syncTimer: number | undefined;

function syncAssistantRoot() {
  if (shouldShowReservationAssistant()) {
    mountAssistant();
    return;
  }

  unmountAssistant();
}

function mountAssistant() {
  if (reactRoot) {
    return;
  }

  const container = document.createElement("div");
  container.id = rootId;
  document.body.append(container);

  reactRoot = createRoot(container);
  reactRoot.render(<AssistantRoot />);
}

function unmountAssistant() {
  if (!reactRoot) {
    document.getElementById(rootId)?.remove();
    return;
  }

  reactRoot.unmount();
  reactRoot = null;
  document.getElementById(rootId)?.remove();
}

function scheduleSync() {
  window.clearTimeout(syncTimer);
  syncTimer = window.setTimeout(syncAssistantRoot, 200);
}

function AssistantRoot() {
  const [expanded, setExpanded] = React.useState(false);
  return <ExtensionPanel expanded={expanded} onExpandedChange={setExpanded} />;
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", syncAssistantRoot, { once: true });
} else {
  syncAssistantRoot();
}

window.addEventListener("hashchange", syncAssistantRoot);
window.addEventListener("popstate", syncAssistantRoot);

const observer = new MutationObserver(scheduleSync);
observer.observe(document.documentElement, {
  childList: true,
  subtree: true
});
