import React, { useEffect } from "react";
import type { CorePluginContext } from '@voiden/sdk/ui';
type PluginContext = CorePluginContext;
import { OpenAPIImportPanel } from "./components/OpenAPIImportPanel";
import * as ReactDomClient from "react-dom/client";
import * as ReactDom from "react-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ExtendedPluginContextExplicit } from "./plugin";
import { X } from "lucide-react";

const OVERLAY_ID = "voiden-openapi-overlay-root";
const TARGET_SELECTOR = "#main-editor";

function ensureRoot(el: HTMLElement) {
  const canCreateRoot = (ReactDomClient as any)?.createRoot;
  if (canCreateRoot) {
    const root = (ReactDomClient as any).createRoot(el);
    return {
      render: (node: React.ReactNode) => root.render(node),
      unmount: () => root.unmount?.(),
    };
  }
  return {
    render: (node: React.ReactNode) => ReactDom.render(node as any, el),
    unmount: () => ReactDom.unmountComponentAtNode(el),
  };
}

// Shell fills the host which fills #main-editor (position: relative).
// No z-index fighting with sidebar or context-menu portals — those live
// outside #main-editor entirely or are portaled to body at z-[100+].
const shellStyle: React.CSSProperties = {
  position: "absolute",
  inset: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "rgba(0,0,0,0.4)",
};

const frameStyle: React.CSSProperties = {
  width: "100%",
  height: "100%",
  overflow: "hidden",
  background: "var(--ui-bg)",
  display: "flex",
  flexDirection: "column",
};

const headerStyle: React.CSSProperties = {
  height: 40,
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "0 12px",
  borderBottom: "1px solid var(--ui-line)",
  background: "var(--ui-panel-bg)",
  color: "var(--editor-fg)",
  fontSize: 13,
};

const bodyStyle: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflow: "hidden",
};


function OverlayApp({ onClose, context }: { onClose: () => void; context: ExtendedPluginContextExplicit }) {
  const [client] = React.useState(() => new QueryClient());

  return (
    <QueryClientProvider client={client}>
      <OverlayShell onClose={onClose} context={context} />
    </QueryClientProvider>
  );
}

const OverlayShell: React.FC<{ onClose: () => void; context: PluginContext }> = ({ onClose, context }) => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div style={shellStyle} className="border border-border" role="dialog" aria-modal="true">
      <div style={frameStyle}>
        <div style={headerStyle}>
          <div className="text-text text-md">OpenAPI Preview</div>
          <button className="flex items-center p-1 gap-2 text-comment border border-border rounded hover:border-accent hover:text-text transition" onClick={onClose}>
             <X size={14}></X> (Esc)
          </button>
        </div>
        <div style={bodyStyle} className="bg-bg flex justify-center items-center">
          <OpenAPIImportPanel context={context} />
        </div>
      </div>
    </div>
  );
};

export function createOpenApiOverlay(context: PluginContext) {
  let host: HTMLDivElement | null = null;
  let root: { render: (n: React.ReactNode) => void; unmount: () => void } | null = null;
  let openState = false;

  // Mount the host as a direct child of #main-editor (position: relative).
  // Being inside the editor element means the overlay is naturally clipped to
  // the editor area and never competes with the sidebar, explorer panels, or
  // context menus portaled to document.body.
  const mount = () => {
    if (host) return;

    const targetEl = document.querySelector(TARGET_SELECTOR) as HTMLElement | null;
    if (!targetEl) return;

    host = document.createElement("div");
    host.id = OVERLAY_ID;
    host.style.position = "absolute";
    host.style.inset = "0";
    // z-index only needs to exceed the editor's own content layers (all < 20).
    // Context menus (z-[110]) and dialogs (z-[9999]) live outside this element
    // so they are never affected.
    host.style.zIndex = "40";
    host.style.pointerEvents = "auto";

    targetEl.appendChild(host);
    root = ensureRoot(host);
  };

  const toggleVisible = (makeVisible: boolean) => {
    if (host && openState) {
      host.style.display = makeVisible ? "block" : "none";
    }
  };

  const open = () => {
    if (openState && host?.style.display === "block") return;
    openState = true;
    mount();
    if (!root) return; // target element not in DOM yet
    root.render(<OverlayApp context={context} onClose={destroy} />);
    if (host) host.style.display = "block";
  };

  const close = () => {
    if (!openState) return;
    openState = false;
    if (root) root.render(<></>);
  };

  const destroy = () => {
    close();
    if (root) {
      root.unmount?.();
      root = null;
    }
    if (host && host.parentNode) host.parentNode.removeChild(host);
    host = null;
  };

  return { open, close, destroy, toggleVisible };
}
