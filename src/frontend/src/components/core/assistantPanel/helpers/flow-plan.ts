import { cloneDeep } from "lodash";
import type {
  AgenticFlowPlanComponent,
  AgenticFlowPlanResult,
} from "@/controllers/API/queries/agentic";
import type { APIClassType } from "@/types/api";
import type {
  AllNodeType,
  EdgeType,
  sourceHandleType,
  targetHandleType,
} from "@/types/flow";
import {
  getHandleId,
  getNodeId,
  scapedJSONStringfy,
} from "@/utils/reactflowUtils";
import { getNodeRenderType } from "@/utils/utils";

const REUSABLE_SINGLETON_TYPES = new Set(["ChatInput", "Webhook"]);
const EXPANDED_NODE_WIDTH = 320;
const MINIMIZED_NODE_WIDTH = 192;
const MINIMIZED_NODE_HEIGHT = 52;
const BASE_NODE_HEIGHT = 44;
const NODE_FIELD_ROW_HEIGHT = 24;
const NODE_MULTILINE_BONUS = 18;
const NODE_OUTPUT_ROW_HEIGHT = 28;
const NODE_DESCRIPTION_HEIGHT = 40;
const MIN_ESTIMATED_NODE_HEIGHT = 176;
const MAX_ESTIMATED_NODE_HEIGHT = 760;
const DEFAULT_VIEWPORT_WIDTH = 1440;
const DEFAULT_VIEWPORT_HEIGHT = 900;
const VIEWPORT_HEIGHT_USAGE = 0.78;
const MIN_COLUMN_GAP = 88;
const MAX_COLUMN_GAP = 132;
const MIN_ROW_GAP = 28;
const MAX_ROW_GAP = 72;

type TemplateMap = Record<string, APIClassType>;
type NodeDimensions = { width: number; height: number };
type TemplateField = Record<string, unknown> & {
  advanced?: boolean;
  hidden?: boolean;
  multiline?: boolean;
  show?: boolean;
};

interface BuildFlowPlanCanvasDataOptions {
  plan: AgenticFlowPlanResult;
  templates: TemplateMap;
  existingNodes: AllNodeType[];
  anchor: { x: number; y: number };
  viewport?: {
    width: number;
    height: number;
    centerX?: number;
    centerY?: number;
  };
  preferCentered?: boolean;
}

interface FlowPlanCanvasData {
  nodes: AllNodeType[];
  edges: EdgeType[];
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function getTemplateForComponent(
  component: AgenticFlowPlanComponent,
  templates: TemplateMap,
): APIClassType {
  const template =
    templates[component.component_name] ||
    (component.display_name ? templates[component.display_name] : undefined);

  if (!template) {
    throw new Error(
      `Component template '${component.component_name}' is not available in the frontend store.`,
    );
  }

  return cloneDeep(template);
}

function getRenderableTemplateFields(
  template: APIClassType["template"] | undefined,
): TemplateField[] {
  return Object.entries(template ?? {})
    .filter(([key, value]) => {
      if (key === "_type" || key === "code") {
        return false;
      }
      return Boolean(value) && typeof value === "object";
    })
    .map(([, value]) => value as TemplateField)
    .filter((field) => field.show !== false && field.hidden !== true);
}

export function estimateFlowPlanNodeDimensions(
  template: APIClassType,
): NodeDimensions {
  if (template.minimized) {
    return {
      width: MINIMIZED_NODE_WIDTH,
      height: MINIMIZED_NODE_HEIGHT,
    };
  }

  const visibleFields = getRenderableTemplateFields(template.template);
  const multilineFieldCount = visibleFields.filter((field) =>
    Boolean(field.multiline),
  ).length;
  const outputCount = template.outputs?.length ?? 0;
  const estimatedHeight =
    BASE_NODE_HEIGHT +
    visibleFields.length * NODE_FIELD_ROW_HEIGHT +
    multilineFieldCount * NODE_MULTILINE_BONUS +
    outputCount * NODE_OUTPUT_ROW_HEIGHT +
    (template.description ? NODE_DESCRIPTION_HEIGHT : 0);

  return {
    width: EXPANDED_NODE_WIDTH,
    height: clamp(
      Math.round(estimatedHeight),
      MIN_ESTIMATED_NODE_HEIGHT,
      MAX_ESTIMATED_NODE_HEIGHT,
    ),
  };
}

function getComponentLevel(
  componentId: string,
  connections: AgenticFlowPlanResult["connections"],
): number {
  const levels = new Map<string, number>();
  for (let iteration = 0; iteration < connections.length; iteration += 1) {
    let changed = false;
    for (const connection of connections) {
      const nextLevel = (levels.get(connection.source_id) ?? 0) + 1;
      if (nextLevel > (levels.get(connection.target_id) ?? 0)) {
        levels.set(connection.target_id, nextLevel);
        changed = true;
      }
    }
    if (!changed) {
      break;
    }
  }
  return levels.get(componentId) ?? 0;
}

function buildNodePositions(
  plan: AgenticFlowPlanResult,
  newComponents: AgenticFlowPlanComponent[],
  anchor: { x: number; y: number },
  dimensionsByPlanId: Map<string, NodeDimensions>,
  viewport?: BuildFlowPlanCanvasDataOptions["viewport"],
  preferCentered?: boolean,
): Map<string, { x: number; y: number }> {
  const componentsByLevel = new Map<number, AgenticFlowPlanComponent[]>();

  for (const component of newComponents) {
    const level = getComponentLevel(component.id, plan.connections);
    const levelComponents = componentsByLevel.get(level) ?? [];
    levelComponents.push(component);
    componentsByLevel.set(level, levelComponents);
  }

  const orderedLevels = Array.from(componentsByLevel.entries()).sort(
    ([leftLevel], [rightLevel]) => leftLevel - rightLevel,
  );
  const viewportWidth = Math.max(
    viewport?.width ?? DEFAULT_VIEWPORT_WIDTH,
    640,
  );
  const viewportHeight = Math.max(
    viewport?.height ?? DEFAULT_VIEWPORT_HEIGHT,
    520,
  );
  const viewportCenterX = viewport?.centerX ?? anchor.x;
  const viewportCenterY = viewport?.centerY ?? anchor.y;
  const columnWidths = new Map<number, number>();
  const stackedColumnHeights = new Map<number, number>();

  for (const [level, levelComponents] of orderedLevels) {
    columnWidths.set(
      level,
      Math.max(
        ...levelComponents.map(
          (component) =>
            dimensionsByPlanId.get(component.id)?.width ?? EXPANDED_NODE_WIDTH,
        ),
      ),
    );
    stackedColumnHeights.set(
      level,
      levelComponents.reduce(
        (totalHeight, component) =>
          totalHeight +
          (dimensionsByPlanId.get(component.id)?.height ??
            MIN_ESTIMATED_NODE_HEIGHT),
        0,
      ),
    );
  }

  const totalColumnWidth = Array.from(columnWidths.values()).reduce(
    (sum, width) => sum + width,
    0,
  );
  const columnCount = Math.max(orderedLevels.length, 1);
  const availableHorizontalSpace = viewportWidth * 0.92 - totalColumnWidth;
  const columnGap =
    columnCount > 1
      ? clamp(
          Math.floor(availableHorizontalSpace / (columnCount - 1)),
          MIN_COLUMN_GAP,
          MAX_COLUMN_GAP,
        )
      : MIN_COLUMN_GAP;

  const maxColumnCount = Math.max(
    ...orderedLevels.map(([, levelComponents]) => levelComponents.length),
    1,
  );
  const maxStackedColumnHeight = Math.max(
    ...Array.from(stackedColumnHeights.values()),
    0,
  );
  const availableVerticalSpace = Math.max(
    viewportHeight * VIEWPORT_HEIGHT_USAGE,
    420,
  );
  const rowGap =
    maxColumnCount > 1
      ? clamp(
          Math.floor(
            (availableVerticalSpace - maxStackedColumnHeight) /
              (maxColumnCount - 1),
          ),
          MIN_ROW_GAP,
          MAX_ROW_GAP,
        )
      : MIN_ROW_GAP;

  const columnHeights = new Map<number, number>();
  for (const [level, levelComponents] of orderedLevels) {
    const stackedHeight = stackedColumnHeights.get(level) ?? 0;
    columnHeights.set(
      level,
      stackedHeight + Math.max(levelComponents.length - 1, 0) * rowGap,
    );
  }

  const clusterHeight = Math.max(...Array.from(columnHeights.values()), 0);
  const totalClusterWidth =
    totalColumnWidth + Math.max(columnCount - 1, 0) * columnGap;
  const clusterTop = viewportCenterY - clusterHeight / 2;
  let currentX = preferCentered
    ? viewportCenterX - totalClusterWidth / 2
    : anchor.x;

  const positions = new Map<string, { x: number; y: number }>();
  for (const [level, levelComponents] of orderedLevels) {
    const columnWidth = columnWidths.get(level) ?? EXPANDED_NODE_WIDTH;
    const columnHeight = columnHeights.get(level) ?? 0;
    let currentY = clusterTop + Math.max((clusterHeight - columnHeight) / 2, 0);

    levelComponents.forEach((component) => {
      const dimensions = dimensionsByPlanId.get(component.id) ?? {
        width: EXPANDED_NODE_WIDTH,
        height: MIN_ESTIMATED_NODE_HEIGHT,
      };

      positions.set(component.id, {
        x: currentX + (columnWidth - dimensions.width) / 2,
        y: currentY,
      });
      currentY += dimensions.height + rowGap;
    });

    currentX += columnWidth + columnGap;
  }

  return positions;
}

function getSourceHandle(
  sourceNode: AllNodeType,
  sourceOutputName: string,
): { encoded: string; raw: sourceHandleType } {
  const output = sourceNode.data.node.outputs?.find(
    (item) => item.name === sourceOutputName,
  );

  if (!output) {
    throw new Error(
      `Output '${sourceOutputName}' was not found on '${sourceNode.data.type}'.`,
    );
  }

  const outputTypes = output.selected ? [output.selected] : output.types;
  const raw: sourceHandleType = {
    id: sourceNode.id,
    name: sourceOutputName,
    output_types: outputTypes,
    dataType: sourceNode.data.type,
  };

  return {
    raw,
    encoded: scapedJSONStringfy(raw),
  };
}

function getTargetHandle(
  targetNode: AllNodeType,
  targetFieldName: string,
): { encoded: string; raw: targetHandleType } {
  const templateField = targetNode.data.node.template[targetFieldName];

  if (!templateField) {
    throw new Error(
      `Field '${targetFieldName}' was not found on '${targetNode.data.type}'.`,
    );
  }

  const raw: targetHandleType = {
    id: targetNode.id,
    fieldName: targetFieldName,
    type: templateField.type,
    inputTypes: templateField.input_types ?? [],
  };

  if (templateField.proxy) {
    raw.proxy = templateField.proxy;
  }

  return {
    raw,
    encoded: scapedJSONStringfy(raw),
  };
}

export function buildFlowPlanCanvasData({
  plan,
  templates,
  existingNodes,
  anchor,
  viewport,
  preferCentered,
}: BuildFlowPlanCanvasDataOptions): FlowPlanCanvasData {
  if (plan.status !== "approval_required") {
    throw new Error("Only approval-ready plans can be added to the canvas.");
  }

  const reusedNodeByPlanId = new Map<string, AllNodeType>();
  for (const component of plan.components) {
    if (!REUSABLE_SINGLETON_TYPES.has(component.component_name)) {
      continue;
    }

    const existingNode = existingNodes.find(
      (node) => node.data.type === component.component_name,
    );
    if (existingNode) {
      reusedNodeByPlanId.set(component.id, existingNode);
    }
  }

  const newComponents = plan.components.filter(
    (component) => !reusedNodeByPlanId.has(component.id),
  );
  const dimensionsByPlanId = new Map<string, NodeDimensions>(
    newComponents.map((component) => {
      const template = getTemplateForComponent(component, templates);
      return [component.id, estimateFlowPlanNodeDimensions(template)];
    }),
  );
  const positions = buildNodePositions(
    plan,
    newComponents,
    anchor,
    dimensionsByPlanId,
    viewport,
    preferCentered,
  );

  const nodeByPlanId = new Map<string, AllNodeType>(reusedNodeByPlanId);
  const newNodes: AllNodeType[] = newComponents.map((component) => {
    const template = getTemplateForComponent(component, templates);
    const nodeId = getNodeId(component.component_name);
    const dimensions = dimensionsByPlanId.get(component.id) ?? {
      width: EXPANDED_NODE_WIDTH,
      height: MIN_ESTIMATED_NODE_HEIGHT,
    };

    for (const [fieldName, fieldValue] of Object.entries(
      component.field_values ?? {},
    )) {
      if (template.template[fieldName]) {
        template.template[fieldName].value = fieldValue;
      }
    }

    if (component.display_name) {
      template.display_name = component.display_name;
    }
    if (component.purpose) {
      template.description = component.purpose;
    }

    const preferredOutput = plan.connections.find(
      (connection) => connection.source_id === component.id,
    )?.source_output;

    const node: AllNodeType = {
      id: nodeId,
      type: getNodeRenderType("genericnode"),
      position: positions.get(component.id) ?? anchor,
      width: dimensions.width,
      height: dimensions.height,
      measured: {
        width: dimensions.width,
        height: dimensions.height,
      },
      selected: true,
      data: {
        node: template,
        showNode: !template.minimized,
        type: component.component_name,
        id: nodeId,
        ...(preferredOutput && { selected_output: preferredOutput }),
      },
    };

    nodeByPlanId.set(component.id, node);
    return node;
  });

  const newEdges: EdgeType[] = plan.connections.map((connection) => {
    const sourceNode = nodeByPlanId.get(connection.source_id);
    const targetNode = nodeByPlanId.get(connection.target_id);
    if (!sourceNode || !targetNode) {
      throw new Error(
        "The flow plan referenced a node that could not be built.",
      );
    }

    const sourceHandle = getSourceHandle(sourceNode, connection.source_output);
    const targetHandle = getTargetHandle(targetNode, connection.target_field);

    return {
      id: getHandleId(
        sourceNode.id,
        sourceHandle.encoded,
        targetNode.id,
        targetHandle.encoded,
      ),
      source: sourceNode.id,
      target: targetNode.id,
      sourceHandle: sourceHandle.encoded,
      targetHandle: targetHandle.encoded,
      type: "default",
      selected: false,
      data: {
        sourceHandle: sourceHandle.raw,
        targetHandle: targetHandle.raw,
      },
    };
  });

  return {
    nodes: newNodes,
    edges: newEdges,
  };
}
