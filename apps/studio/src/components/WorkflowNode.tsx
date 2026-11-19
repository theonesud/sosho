import { Handle, type NodeProps, Position } from "@xyflow/react";
import { NODE_META, type NodeKind } from "../types";

export interface WorkflowNodeData extends Record<string, unknown> {
  nodeType: NodeKind;
  title: string;
  tier?: string;
  subtitle?: string;
  isEntry?: boolean;
  runStatus?: string;
  preview?: string;
}

const STATUS_DOT: Record<string, { color: string; text: string }> = {
  running: { color: "#f59e0b", text: "Running" },
  waiting_checkpoint: { color: "#f97316", text: "Needs Review" },
  done: { color: "#10b981", text: "Done" },
  failed: { color: "#ef4444", text: "Failed" },
};

export function WorkflowNode({ data, selected }: NodeProps) {
  const d = data as WorkflowNodeData;
  const meta = NODE_META[d.nodeType] || NODE_META.agent;
  const st = d.runStatus ? STATUS_DOT[d.runStatus] : undefined;

  return (
    <div className={`wf-node ${selected ? "selected" : ""} ${d.runStatus ? `status-${d.runStatus}` : ""}`}>
      <Handle type="target" position={Position.Left} />

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6, marginBottom: 6 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span className="dot" style={{ background: meta.color }} />
          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", color: meta.color }}>
            {meta.badge}
          </span>
          {d.isEntry && (
            <span style={{ fontSize: 9.5, padding: "1px 5px", borderRadius: 4, background: "rgba(99,102,241,0.18)", color: "#a5b4fc", fontWeight: 600 }}>
              START
            </span>
          )}
        </div>
        {st && (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10, color: st.color, fontWeight: 600 }}>
            <span className="dot" style={{ background: st.color, width: 6, height: 6 }} />
            {st.text}
          </span>
        )}
      </div>

      <div style={{ fontSize: 13, fontWeight: 600, color: "#fafafa", lineHeight: 1.3 }}>
        {d.title}
      </div>

      {(d.tier || d.subtitle) && (
        <div style={{ fontSize: 11, color: "#71717a", marginTop: 4, display: "flex", gap: 6, flexWrap: "wrap" }}>
          {d.tier && <span style={{ color: "#a1a1aa" }}>{d.tier}</span>}
          {d.subtitle && <span>· {d.subtitle}</span>}
        </div>
      )}

      {d.preview && (
        <div
          style={{
            marginTop: 7,
            padding: "5px 7px",
            borderRadius: 6,
            background: "#09090b",
            border: "1px solid #27272a",
            fontSize: 10.5,
            color: "#a1a1aa",
            overflow: "hidden",
            textOverflow: "ellipsis",
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            lineHeight: 1.35,
          }}
        >
          {d.preview}
        </div>
      )}

      <Handle type="source" position={Position.Right} />
    </div>
  );
}
