import { fireEvent, render, screen } from "@testing-library/react";
import { AssistantWidget } from "../assistant-widget";

jest.mock("@/assets/langflow_assistant.svg", () => "langflow-assistant.svg");

jest.mock("@/utils/utils", () => ({
  cn: (...args: Array<string | false | null | undefined>) =>
    args.filter(Boolean).join(" "),
}));

jest.mock("../assistant-panel", () => ({
  AssistantPanel: ({
    isOpen,
    onClose,
  }: {
    isOpen: boolean;
    onClose: () => void;
  }) =>
    isOpen ? (
      <button data-testid="assistant-panel" onClick={onClose}>
        Panel
      </button>
    ) : null,
}));

describe("AssistantWidget", () => {
  it("renders the floating launcher in the bottom corner", () => {
    render(<AssistantWidget isOpen={false} onOpenChange={jest.fn()} />);

    expect(screen.getByTestId("assistant-button")).toBeInTheDocument();
    expect(screen.getByText("Ассистент-Копилот")).toBeInTheDocument();
    expect(screen.getByText("Describe a workflow")).toBeInTheDocument();
  });

  it("toggles the assistant open state from the launcher", () => {
    const onOpenChange = jest.fn();

    render(<AssistantWidget isOpen={false} onOpenChange={onOpenChange} />);

    fireEvent.click(screen.getByTestId("assistant-button"));

    expect(onOpenChange).toHaveBeenCalledWith(true);
  });

  it("closes the assistant panel through the panel callback", () => {
    const onOpenChange = jest.fn();

    render(<AssistantWidget isOpen={true} onOpenChange={onOpenChange} />);

    fireEvent.click(screen.getByTestId("assistant-panel"));

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
