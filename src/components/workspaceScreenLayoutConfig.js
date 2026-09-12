const WIDTHS = new Set(["full", "half", "third"]);

const PRESENTATION_FIELDS = Object.freeze(["title", "description"]);

export const DEFAULT_WORKSPACE_LAYOUT = Object.freeze({
  version: 1,
  blocks: [{ id: "system-content", type: "system-content", width: "full", locked: true }],
});

export function normalizeWorkspaceLayout(layout, { requireSystemContent = true } = {}) {
  const source = Array.isArray(layout?.blocks) ? layout.blocks : [];
  const blocks = source
    .filter((block) => block && typeof block === "object" && typeof block.type === "string")
    .slice(0, 40)
    .map((block, index) => ({
      ...block,
      id: String(block.id || `block-${index + 1}`),
      width: WIDTHS.has(block.width) ? block.width : "full",
    }));
  if (requireSystemContent && !blocks.some((block) => block.type === "system-content")) {
    blocks.push({ ...DEFAULT_WORKSPACE_LAYOUT.blocks[0] });
  }
  const presentation = Object.fromEntries(PRESENTATION_FIELDS
    .filter((field) => typeof layout?.presentation?.[field] === "string")
    .map((field) => [field, layout.presentation[field].trim().slice(0, 500)]));
  return { version: 1, presentation, blocks };
}
