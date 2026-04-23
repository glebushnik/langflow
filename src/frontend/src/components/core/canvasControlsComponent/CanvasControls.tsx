import { Panel, useStoreApi } from "@xyflow/react";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import ForwardedIconComponent from "@/components/common/genericIconComponent";
import { Button } from "@/components/ui/button";
import { ENABLE_INSPECTION_PANEL } from "@/customization/feature-flags";
import useFlowStore from "@/stores/flowStore";
import type { AllNodeType } from "@/types/flow";
import CanvasControlsDropdown from "./CanvasControlsDropdown";
import HelpDropdown from "./HelpDropdown";

const CanvasControls = ({
  children,
  selectedNode,
  effectiveLocked,
}: {
  children?: ReactNode;
  selectedNode: AllNodeType | null;
  effectiveLocked?: boolean;
}) => {
  const reactFlowStoreApi = useStoreApi();
  const isFlowLocked = useFlowStore(
    useShallow((state) => state.currentFlow?.locked),
  );
  const inspectionPanelVisible = useFlowStore(
    (state) => state.inspectionPanelVisible,
  );
  const setInspectionPanelVisible = useFlowStore(
    (state) => state.setInspectionPanelVisible,
  );

  const [isAddNoteActive, setIsAddNoteActive] = useState(false);

  const handleAddNote = useCallback(() => {
    window.dispatchEvent(new Event("lf:start-add-note"));
    setIsAddNoteActive(true);
  }, []);

  useEffect(() => {
    const onEnd = () => setIsAddNoteActive(false);
    window.addEventListener("lf:end-add-note", onEnd);
    return () => window.removeEventListener("lf:end-add-note", onEnd);
  }, []);

  const locked = effectiveLocked ?? isFlowLocked;

  useEffect(() => {
    reactFlowStoreApi.setState({
      nodesDraggable: !locked,
      nodesConnectable: !locked,
      elementsSelectable: !locked,
    });
  }, [locked, reactFlowStoreApi]);

  return (
    <>
      <Panel
        data-testid="main_canvas_controls"
        className="react-flow__controls flex !flex-row items-center gap-1 !overflow-visible rounded-lg bg-background px-2 py-1 fill-foreground stroke-foreground text-primary [&>button]:border-0"
        position="bottom-center"
      >
        <CanvasControlsDropdown selectedNode={selectedNode} />
        <Button
          unstyled
          size="icon"
          data-testid="canvas-add-note-button"
          className="group flex h-8 w-8 items-center justify-center rounded-md hover:bg-muted"
          title="Add Sticky Note"
          onClick={handleAddNote}
        >
          <ForwardedIconComponent
            name="sticky-note"
            className={`h-[18px] w-[18px] transition-colors ${
              isAddNoteActive
                ? "text-foreground"
                : "text-muted-foreground group-hover:text-foreground"
            }`}
          />
        </Button>
        <HelpDropdown />
        {children}
        {ENABLE_INSPECTION_PANEL && (
          <Button
            unstyled
            size="icon"
            data-testid="canvas_controls_toggle_inspector"
            className="group flex h-8 w-8 items-center justify-center rounded-md hover:bg-muted"
            title={
              !selectedNode
                ? "Select a node to open the Inspector Panel"
                : inspectionPanelVisible
                  ? "Hide Inspector Panel"
                  : "Show Inspector Panel"
            }
            onClick={() => setInspectionPanelVisible(!inspectionPanelVisible)}
          >
            <ForwardedIconComponent
              name={inspectionPanelVisible ? "PanelRightClose" : "PanelRight"}
              className="!h-5 !w-5 text-muted-foreground group-hover:text-foreground"
            />
          </Button>
        )}
      </Panel>
    </>
  );
};

export default CanvasControls;
