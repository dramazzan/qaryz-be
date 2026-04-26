export type ActionState = {
  status: "idle" | "error";
  message?: string;
};

export const initialActionState: ActionState = {
  status: "idle"
};

export type ActivityKind = "expense" | "debt";
export type ActivityEventType = "created" | "updated" | "settled";

