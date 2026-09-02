// src/openapi-import/plugin.ts
import React from "react";
import type { CorePluginContext } from '@voiden/sdk/ui';
type PluginContext = CorePluginContext;
import { OpenAPIImportButton } from "./components/OpenAPIImportButton";
import { createOpenApiOverlay } from "./OverlayHost";
import { NodeViewWrapper } from "@tiptap/react";
import { extractOpenAPIValidationFromDoc, OpenAPIValidationContext } from "./lib/pipelineHook";
import { enhanceResponseWithOpenAPIValidation } from "./lib/responseEnhancer";

type EditorTab = { title?: string; content?: string; tabId?: string };



export interface ExtendedPluginContextExplicit extends Omit<PluginContext, 'project'> {
  tab?: {
    getActiveTab(): Promise<any>;
  };

  project: PluginContext['project'] & {
    /**
     * Open a file in the editor
     * @param filePath - The path to the file (relative or absolute)
     * @param skipJoin - If true, treats filePath as absolute path without joining with project root
     * @returns Promise that resolves when the file is opened
     */
    openFile(filePath: string, skipJoin?: boolean): Promise<void>;
  };
  files?: {
    read: (path: string) => Promise<string>;
  }
}

const openapiImportPlugin = (context: ExtendedPluginContextExplicit) => {
  let currentTab: EditorTab | null = null;
  let overlay: ReturnType<typeof createOpenApiOverlay> | null = null;
  let lastTabReopen = "";

  // Opens the import overlay/panel and feeds it `raw` spec text, resolving
  // `activeSource` (the path shown to the user, relative to the project when
  // possible) the same way regardless of whether the caller is the in-tab
  // "OpenAPI Preview" button (reads the currently open editor) or the file-tree
  // "Import as OpenAPI Collection..." context menu item (reads the file directly).
  const openImportOverlay = async (raw: string, sourcePath: string) => {
    const currentActiveProject = await context.project.getActiveProject();
    let activeSource = "";
    try {
      const normalizedSource = (sourcePath || "").replace(/\\/g, "/");
      const normalizedProject = (currentActiveProject ?? "").replace(/\\/g, "/");
      activeSource =
        normalizedProject && normalizedSource.startsWith(normalizedProject)
          ? normalizedSource.slice(normalizedProject.length).replace(/^[/\\]+/, "")
          : normalizedSource;
    } catch {
      // leave activeSource as ""
    }

    const payload = { raw, currentActiveProject, activeSource, selectAll: false, autoGenerate: false };

    // Stash payload so the panel can consume it synchronously on first render
    (window as any).__voidenOpenAPILastPayload__ = payload;

    overlay?.open();
    lastTabReopen = "";

    // Dispatch event after the overlay/panel mounts
    // (panel also has a mount-time fallback to the "last payload" above)
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent("voiden.openapi.process", { detail: payload }));
    }, 0);
  };

  return {
    onload: async () => {
      // Create overlay only after the app is mounted
      overlay = createOpenApiOverlay(context);
      const { createOpenApiSpecLink } = await import('./nodes/OpenApiSpecLink');
      const { createOpenApiValidationResultsNode } = await import('./nodes/OpenApiResult');
      const { NodeViewWrapper } = context.ui.components;
      const { useParentResponseDoc } = context.ui.hooks;
      const OpenAPISpec = createOpenApiSpecLink(context);
      const OpenAPIResult = createOpenApiValidationResultsNode(NodeViewWrapper, useParentResponseDoc);
      // Provide the helper your panel optionally calls in its event handler
      (window as any).__voidenOpenOpenAPIPreview__ = () => overlay?.open();
      context.registerVoidenExtension(OpenAPISpec);
      context.registerVoidenExtension(OpenAPIResult);
      context.registerLinkableNodeTypes(["openapi-validation-results"]);
      context.registerNodeDisplayNames({
        'openapi-validation-results': 'OpenAPI Result',
      });
      context.registerEditorAction({
        id: "openapi-import-button",
        component: () =>
          React.createElement(OpenAPIImportButton, {
            context,
            onClickCallback: async () => {
              try {
                // Read text directly from the active editor as a reliable source
                const readActiveEditorText = () => {
                  try {
                    const code = context.project.getActiveEditor?.("code");
                    const voiden = context.project.getActiveEditor?.("voiden");
                    const value =
                      (code && typeof code.getText === "function" && code.getText()) ||
                      (voiden && typeof voiden.getText === "function" && voiden.getText()) ||
                      "";
                    return value || "";
                  } catch {
                    return "";
                  }
                };

                // Capture the active tab's source path NOW, before the overlay
                // opens and potentially changes which tab is considered "active".
                let sourcePath = "";
                try {
                  const tab = await context.tab?.getActiveTab?.() as any;
                  if (tab?.source) sourcePath = tab.source;
                } catch {
                  // leave sourcePath as ""
                }

                const rawFromEditor = readActiveEditorText();

                // Fallbacks if you still want to try the tab snapshot
                const rawFromTab = (currentTab?.content ?? "").trim();
                const raw = rawFromEditor.trim() || rawFromTab;

                await openImportOverlay(raw, sourcePath);
              } catch (e) {
                console.error("[openapi-import] failed to open overlay", e);
              }
            },
          }),
        predicate: (tab) => {
          // Close if tab changes
          if (currentTab?.tabId && !lastTabReopen && currentTab?.tabId != tab.tabId) {
            setTimeout(() => overlay?.toggleVisible(false), 0);
            lastTabReopen = currentTab?.tabId;
          }

          if (lastTabReopen && lastTabReopen == tab.tabId) {
            setTimeout(() => overlay?.toggleVisible(true), 0);
            lastTabReopen = "";
          }

          // Check should it be shown on tab
          currentTab = tab;
          const name = tab.title?.toLowerCase() || "";
          // The "openapi": "3.x" version field is always at the top level, so a
          // bounded prefix is enough — keeps this independent of file size instead
          // of rescanning the full buffer on every render. Match the actual
          // field-assignment shape (key, colon, "3." version), not a bare
          // "openapi" substring — a loose word match false-positives on any
          // file whose description/name/comment merely mentions "OpenAPI"
          // without the document actually being one. Covers both JSON
          // (`"openapi": "3.0.1"`) and YAML (`openapi: 3.0.1`, quoted or not).
          const contentPrefix = (tab.content ?? "").slice(0, 65536);
          const hasOpenApi = /["']?openapi["']?\s*:\s*["']?3\./.test(contentPrefix);
          // A real OpenAPI *document*'s "openapi" field sits at the actual
          // top level. But another tool's own export can legitimately embed
          // a whole linked OpenAPI spec nested inside it — confirmed real
          // for Insomnia v5's "spec.insomnia.rest/5.0" collection type,
          // whose `spec.contents.openapi` field satisfies the check above
          // even though the file is fundamentally an Insomnia export, not a
          // raw OpenAPI document. A bounded prefix scan can't reliably tell
          // "top-level" from "nested" without actually parsing the
          // structure, so instead: if the file also carries another tool's
          // own real format marker, that tool's importer owns this file —
          // don't compete for the same tab.
          const isAnotherToolsExport =
            contentPrefix.includes("insomnia.rest/") || contentPrefix.includes("__export_format") ||
            contentPrefix.includes('"_type":"export"') || contentPrefix.includes('"_type": "export"') ||
            contentPrefix.includes("schema.getpostman.com") || contentPrefix.includes("_postman_variable_scope") ||
            /^\s*opencollection\s*:/m.test(contentPrefix);
          return (name.endsWith(".json") || name.endsWith(".yaml") || name.endsWith(".yml")) && hasOpenApi && !isAnotherToolsExport;
        },
      });

      // The button above only ever appears once an OpenAPI file is already the
      // active tab — easy to miss. Mirror the same import flow as a file-tree
      // right-click action so it's discoverable without opening the file first.
      context.registerContextMenu?.({
        id: "openapi-import-context-menu",
        label: "Import as OpenAPI Collection...",
        surface: "file",
        when: (target: any) => {
          const name = (target?.name ?? "").toLowerCase();
          return target?.type === "file" && (name.endsWith(".json") || name.endsWith(".yaml") || name.endsWith(".yml"));
        },
        action: async (target: any) => {
          try {
            const raw = (await context.files?.read?.(target?.path)) ?? "";
            await openImportOverlay(raw, target?.path ?? "");
          } catch (e) {
            console.error("[openapi-import] failed to open overlay from context menu", e);
          }
        },
      });

      if (context.pipeline?.registerHook) {
        await context.pipeline.registerHook(
          "post-processing",
          async (hookContext: any) => {
            const { requestState, responseState, metadata } = hookContext;
            try {
              const requestDoc = requestState?.metadata?.editorDocument ||
                metadata?.requestDocument ||
                metadata?.editorDocument;

              if (!requestDoc) {
                return;
              }

              const validation = extractOpenAPIValidationFromDoc(requestDoc);
              if (!validation) {
                return;
              }

              // Build validation context
              const validationContext: OpenAPIValidationContext = {
                response: {
                  status: responseState.status,
                  statusText: responseState.statusText,
                  headers: responseState.headers || [],
                  body: responseState.body,
                  contentType: responseState.contentType,
                },
                request: {
                  method: requestState.method || 'GET',
                  path: requestState.url ? (requestState.url.startsWith('http') ? new URL(requestState.url).pathname : requestState.url.split('?')[0]) : '/',
                  url: requestState.url || '',
                  headers: requestState.headers || {},
                  body: (() => {
                    if (!requestState.body) return {};
                    if (typeof requestState.body !== 'string') return requestState.body;
                    try { return JSON.parse(requestState.body); } catch { return requestState.body; }
                  })(),
                  query: requestState.queryParams || [],
                  contentType: requestState.contentType
                },
              };

              const { validateOpenAPI } = await import('./lib/openapiValidationEngine')
              // Execute validation - pass plugin context (not hookContext) so project/files APIs are available
              const result = await validateOpenAPI(validation, validationContext, context);

              // Store results in responseState.metadata
              if (!responseState.metadata) {
                responseState.metadata = {};
              }

              responseState.metadata.openAPIValidation = result;
            } catch (error) {
              console.error('[OpenAPI Validation] Error in post-process hook:', error);
            }
          },
          15 // Priority: run after response is processed but before display
        );
      }
      context.exposeHelpers({
        enhanceResponseWithOpenAPIValidation
      })


    },

    onunload: () => {
      if ((window as any).__voidenOpenOpenAPIPreview__) {
        delete (window as any).__voidenOpenOpenAPIPreview__;
      }
      overlay?.destroy();
      overlay = null;
    },
  };
};

export default openapiImportPlugin;
