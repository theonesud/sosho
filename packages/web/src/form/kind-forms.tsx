import type { ComponentType } from "react";
import type { Issue, Node, NodeKind } from "../api/types";
import type { EditApi } from "../canvas/edit-api";
import { TriggerBody } from "./trigger-form";
import { triggerLabel, triggerMessages } from "./trigger-spec";

export interface KindBodyProps {
  readonly node: Node;
  readonly issues: readonly Issue[];
  readonly edit: EditApi;
}

export interface KindForm {
  readonly Body: ComponentType<KindBodyProps>;
  readonly label: (node: Node) => string | null;
  readonly messages: (node: Node, issues: readonly Issue[]) => readonly string[];
}

const triggerForm: KindForm = {
  Body: TriggerBody,
  label: (node) => (node.kind === "trigger" ? triggerLabel(node) : null),
  messages: (node, issues) => (node.kind === "trigger" ? triggerMessages(node, issues) : []),
};

const KIND_FORMS: Partial<Record<NodeKind, KindForm>> = { trigger: triggerForm };

export const kindFormOf = (kind: NodeKind): KindForm | undefined => KIND_FORMS[kind];

export function nodeLabel(node: Node): string {
  return kindFormOf(node.kind)?.label(node) ?? node.name ?? node.id;
}
