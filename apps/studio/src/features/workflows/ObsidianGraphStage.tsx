"use client";

import {
  AlertCircle,
  CheckCircle2,
  Clock,
  History,
  PanelLeft,
  Play,
  Plus,
  Redo2,
  RotateCcw,
  Save,
  ShieldCheck,
  Undo2,
} from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useWorkflowStore } from "@/stores/workflow-store";
import {
  BRANCH_COLORS,
  checkNodeCompatibility,
  extractTemplateVariables,
  formatLatency,
  type ModelCatalogEntry,
  NODE_META,
  type NodeExecutionLog,
  type NodeKind,
  type PortCompatibility,
  type RawGraph,
  type RawGraphNode,
  type RunDetail,
  type SkillInfo,
  validateGraphIssues,
  type WorkflowVersion,
} from "@/types";
import {
  AnchoredEdgePopover,
  AnchoredNodePicker,
  AnchoredNodePopover,
  PRIMARY_NODE_KINDS,
  SECONDARY_NODE_KINDS,
} from "./AnchoredNodePopover";
import {
  type BezierGeometry,
  type CanvasRipple,
  computeEdgeBezier,
  DEFAULT_PHYSICS_PARAMS,
  distanceToBezier,
  drawNodeGlyph,
  pointOnQuadraticBezier,
  type SimNode,
  stepPhysics,
  syncSimNodes,
} from "./graph-physics";

interface ObsidianGraphStageProps {
  graph: RawGraph | null;
  runDetail: RunDetail | null;
  isLoading?: boolean;
  readOnly?: boolean;
  drawerOpen: boolean;
  onToggleDrawer: () => void;
  isDirty: boolean;
  isSaving: boolean;
  isStartingRun: boolean;
  saveStatus: string | null;
  versions: WorkflowVersion[];
  availableSkills?: Array<string | SkillInfo>;
  modelCatalog?: ModelCatalogEntry[];
  onSaveWorkflow: () => void;
  onStartRun: (initialData: Record<string, unknown>) => void;
  onRestoreVersion: (version: WorkflowVersion) => void;
  onCreateStarterGraph: (kind: NodeKind) => void;
  onEditGraph?: () => void;
  onForkSnapshot?: () => void;
  onRollbackRun?: (toStep?: number) => void;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.max(0, Math.round(ms))}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function getNodeMetaLine(node: RawGraphNode, latency: string | null): string {
  const parts: string[] = [];
  if (typeof node.modelId === "string" && node.modelId) parts.push(node.modelId.split("/").pop() ?? node.modelId);
  else if (typeof node.tier === "string" && node.tier) parts.push(node.tier);
  else if (typeof node.toolKind === "string" && node.toolKind) parts.push(node.toolKind);
  else if (typeof node.operation === "string" && node.operation) parts.push(node.operation);
  else if (typeof node.skillName === "string" && node.skillName) parts.push(node.skillName);

  if (node.queue) parts.push(node.queue);
  if (latency) parts.push(latency);
  return parts.join(" · ");
}

function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace("#", "");
  const r = Number.parseInt(clean.slice(0, 2), 16);
  const g = Number.parseInt(clean.slice(2, 4), 16);
  const b = Number.parseInt(clean.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function getDecisionBranchPorts(
  node: RawGraphNode,
  sim: SimNode,
): Array<{ branch: string; x: number; y: number; color: string }> {
  if (node.type !== "decision") return [];
  const branches =
    Array.isArray(node.branches) && node.branches.length > 0 ? (node.branches as string[]) : ["yes", "no"];
  const r = sim.radius * sim.scale + 12;
  const spread = Math.min(Math.PI * 0.72, branches.length * 0.42);
  return branches.map((branch, idx) => {
    const angle = branches.length === 1 ? 0 : -spread / 2 + (idx / (branches.length - 1)) * spread;
    return {
      branch,
      x: sim.x + Math.cos(angle) * r,
      y: sim.y + Math.sin(angle) * r,
      color: BRANCH_COLORS[idx % BRANCH_COLORS.length],
    };
  });
}

export function ObsidianGraphStage({
  graph,
  runDetail,
  isLoading = false,
  readOnly = false,
  drawerOpen,
  onToggleDrawer,
  isDirty,
  isSaving,
  isStartingRun,
  saveStatus,
  versions,
  availableSkills = [],
  modelCatalog = [],
  onSaveWorkflow,
  onStartRun,
  onRestoreVersion,
  onCreateStarterGraph,
  onEditGraph,
  onForkSnapshot,
  onRollbackRun,
}: ObsidianGraphStageProps) {
  const selectedNodeId = useWorkflowStore((s) => s.selectedNodeId);
  const selectedEdgeId = useWorkflowStore((s) => s.selectedEdgeId);
  const canUndo = useWorkflowStore((s) => s.past.length > 0);
  const canRedo = useWorkflowStore((s) => s.future.length > 0);
  const selectNode = useWorkflowStore((s) => s.selectNode);
  const selectEdge = useWorkflowStore((s) => s.selectEdge);
  const addNode = useWorkflowStore((s) => s.addNode);
  const addEdge = useWorkflowStore((s) => s.addEdge);
  const rewireEdge = useWorkflowStore((s) => s.rewireEdge);
  const removeNodes = useWorkflowStore((s) => s.removeNodes);
  const removeEdges = useWorkflowStore((s) => s.removeEdges);
  const setNodePositions = useWorkflowStore((s) => s.setNodePositions);
  const updateGraphMeta = useWorkflowStore((s) => s.updateGraphMeta);
  const updatePolicy = useWorkflowStore((s) => s.updatePolicy);
  const undo = useWorkflowStore((s) => s.undo);
  const redo = useWorkflowStore((s) => s.redo);

  const [cursorStyle, setCursorStyle] = useState<string>("default");
  const [canvasBounds, setCanvasBounds] = useState<{ width: number; height: number }>({ width: 960, height: 640 });
  const [editingTitle, setEditingTitle] = useState(false);
  const [runPopoverOpen, setRunPopoverOpen] = useState(false);
  const [runInputs, setRunInputs] = useState<Record<string, string>>({});
  const [pickerAnchor, setPickerAnchor] = useState<{
    connectFromId?: string;
    condition?: string;
    worldPos: { x: number; y: number };
    screenPos: { x: number; y: number };
  } | null>(null);
  const [popoverAnchor, setPopoverAnchor] = useState<{ x: number; y: number }>({ x: 400, y: 260 });

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  const simNodesRef = useRef<Map<string, SimNode>>(new Map());
  const ripplesRef = useRef<CanvasRipple[]>([]);
  const graphIdRef = useRef<string | null>(null);
  const edgeGeometriesRef = useRef<Map<string, BezierGeometry>>(new Map());
  const alignGuidesRef = useRef<{ x: number | null; y: number | null }>({ x: null, y: null });

  const camRef = useRef({
    x: 0,
    y: 0,
    zoom: 1,
    targetX: 0,
    targetY: 0,
    targetZoom: 1,
  });

  const pointerRef = useRef<{
    hoveredNodeId: string | null;
    hoveredEdgeId: string | null;
    hoveredLinkPortNodeId: string | null;
    hoveredBranch: string | null;
    draggedNodeId: string | null;
    dragMoved: boolean;
    dragOffsetX: number;
    dragOffsetY: number;
    panning: boolean;
    panStartScreenX: number;
    panStartScreenY: number;
    panStartCamX: number;
    panStartCamY: number;
    portDownNodeId: string | null;
    portDownBranch: string | null;
    portDownScreenX: number;
    portDownScreenY: number;
    connectingFromId: string | null;
    connectingCondition: string | null;
    connectCursorX: number;
    connectCursorY: number;
    connectSnapTargetId: string | null;
    connectCompat: PortCompatibility | null;
    rewiringEdgeId: string | null;
    rewiringEnd: "source" | "target" | null;
  }>({
    hoveredNodeId: null,
    hoveredEdgeId: null,
    hoveredLinkPortNodeId: null,
    hoveredBranch: null,
    draggedNodeId: null,
    dragMoved: false,
    dragOffsetX: 0,
    dragOffsetY: 0,
    panning: false,
    panStartScreenX: 0,
    panStartScreenY: 0,
    panStartCamX: 0,
    panStartCamY: 0,
    portDownNodeId: null,
    portDownBranch: null,
    portDownScreenX: 0,
    portDownScreenY: 0,
    connectingFromId: null,
    connectingCondition: null,
    connectCursorX: 0,
    connectCursorY: 0,
    connectSnapTargetId: null,
    connectCompat: null,
    rewiringEdgeId: null,
    rewiringEnd: null,
  });

  const graphRef = useRef<RawGraph | null>(graph);
  graphRef.current = graph;
  const selectedNodeRef = useRef(selectedNodeId);
  selectedNodeRef.current = selectedNodeId;
  const selectedEdgeRef = useRef(selectedEdgeId);
  selectedEdgeRef.current = selectedEdgeId;
  const readOnlyRef = useRef(readOnly);
  readOnlyRef.current = readOnly;

  const logsByNode = useMemo(() => {
    const map = new Map<string, NodeExecutionLog>();
    for (const log of runDetail?.history ?? []) {
      map.set(log.nodeId, log);
    }
    return map;
  }, [runDetail]);
  const logsByNodeRef = useRef(logsByNode);
  logsByNodeRef.current = logsByNode;

  const activeNodeIds = useMemo(() => {
    const set = new Set<string>();
    if (runDetail?.status === "running") {
      if (runDetail.currentNodeId) set.add(runDetail.currentNodeId);
      for (const id of runDetail.activeNodeIds ?? []) set.add(id);
    }
    return set;
  }, [runDetail]);
  const activeNodeIdsRef = useRef(activeNodeIds);
  activeNodeIdsRef.current = activeNodeIds;

  const validationIssues = useMemo(() => validateGraphIssues(graph), [graph]);
  const templateVars = useMemo(() => extractTemplateVariables(graph), [graph]);

  const emitRipple = useCallback((x: number, y: number, color: string, maxRadius = 64) => {
    ripplesRef.current.push({ x, y, radius: 14, maxRadius, alpha: 0.72, color });
  }, []);

  const worldToScreen = useCallback((wx: number, wy: number) => {
    const wrapper = wrapperRef.current;
    const width = wrapper?.clientWidth ?? 960;
    const height = wrapper?.clientHeight ?? 640;
    const cam = camRef.current;
    return {
      x: (wx + cam.x) * cam.zoom + width / 2,
      y: (wy + cam.y) * cam.zoom + height / 2,
    };
  }, []);

  const screenToWorld = useCallback((clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const sx = clientX - rect.left;
    const sy = clientY - rect.top;
    const cam = camRef.current;
    return {
      x: (sx - rect.width / 2) / cam.zoom - cam.x,
      y: (sy - rect.height / 2) / cam.zoom - cam.y,
    };
  }, []);

  const fitView = useCallback((immediate = false) => {
    const wrapper = wrapperRef.current;
    const nodes = Array.from(simNodesRef.current.values());
    if (!wrapper || nodes.length === 0) return;

    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const n of nodes) {
      minX = Math.min(minX, n.anchorX - n.radius - 76);
      maxX = Math.max(maxX, n.anchorX + n.radius + 76);
      minY = Math.min(minY, n.anchorY - n.radius - 58);
      maxY = Math.max(maxY, n.anchorY + n.radius + 92);
    }

    const width = Math.max(1, wrapper.clientWidth);
    const height = Math.max(1, wrapper.clientHeight);
    const spanX = Math.max(260, maxX - minX);
    const spanY = Math.max(220, maxY - minY);
    const nextZoom = Math.max(0.42, Math.min(1.22, Math.min((width * 0.84) / spanX, (height * 0.78) / spanY)));
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;

    camRef.current.targetX = -centerX;
    camRef.current.targetY = -centerY;
    camRef.current.targetZoom = nextZoom;

    if (immediate) {
      camRef.current.x = -centerX;
      camRef.current.y = -centerY;
      camRef.current.zoom = nextZoom;
    }
  }, []);

  useLayoutEffect(() => {
    if (!graph) {
      simNodesRef.current = new Map();
      graphIdRef.current = null;
      return;
    }

    const switchedGraph = graphIdRef.current !== graph.id;
    const prevIds = new Set(simNodesRef.current.keys());
    const baseMap = switchedGraph ? new Map<string, SimNode>() : simNodesRef.current;
    const synced = syncSimNodes(baseMap, graph);
    simNodesRef.current = synced;
    graphIdRef.current = graph.id;

    if (switchedGraph) {
      setPickerAnchor(null);
      fitView(true);
    } else {
      let added = false;
      for (const n of graph.nodes) {
        if (!prevIds.has(n.id)) {
          added = true;
          const sim = synced.get(n.id);
          if (sim) emitRipple(sim.x, sim.y, NODE_META[n.type].color, 72);
        }
      }
      if (added || prevIds.size !== graph.nodes.length) {
        fitView(false);
      }
    }
  }, [graph, fitView, emitRipple]);

  useEffect(() => {
    if (selectedNodeId) {
      const sim = simNodesRef.current.get(selectedNodeId);
      if (sim) setPopoverAnchor(worldToScreen(sim.x, sim.y));
    } else if (selectedEdgeId) {
      const geom = edgeGeometriesRef.current.get(selectedEdgeId);
      if (geom) setPopoverAnchor(worldToScreen(geom.midX, geom.midY));
    }
  }, [selectedNodeId, selectedEdgeId, worldToScreen]);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    setCanvasBounds({ width: wrapper.clientWidth, height: wrapper.clientHeight });
    let lastW = wrapper.clientWidth;
    let lastH = wrapper.clientHeight;
    const ro = new ResizeObserver(() => {
      const w = wrapper.clientWidth;
      const h = wrapper.clientHeight;
      if (Math.abs(w - lastW) > 4 || Math.abs(h - lastH) > 4) {
        lastW = w;
        lastH = h;
        setCanvasBounds({ width: w, height: h });
        fitView(true);
      }
    });
    ro.observe(wrapper);
    return () => ro.disconnect();
  }, [fitView]);

  const hitTestNode = useCallback((wx: number, wy: number): SimNode | null => {
    const nodes = Array.from(simNodesRef.current.values());
    for (let i = nodes.length - 1; i >= 0; i--) {
      const n = nodes[i];
      if (Math.hypot(wx - n.x, wy - n.y) <= n.radius * n.scale + 8) {
        return n;
      }
    }
    return null;
  }, []);

  const hitTestLinkPort = useCallback((wx: number, wy: number): { sim: SimNode; branch: string | null } | null => {
    if (readOnlyRef.current || !graphRef.current) return null;
    const candidateId = pointerRef.current.hoveredNodeId ?? selectedNodeRef.current;
    if (!candidateId) return null;
    const sim = simNodesRef.current.get(candidateId);
    const nodeData = graphRef.current.nodes.find((n) => n.id === candidateId);
    if (!sim || !nodeData) return null;

    if (nodeData.type === "decision") {
      const ports = getDecisionBranchPorts(nodeData, sim);
      for (const p of ports) {
        if (Math.hypot(wx - p.x, wy - p.y) <= 11) {
          return { sim, branch: p.branch };
        }
      }
    }

    const portX = sim.x + sim.radius * sim.scale + 12;
    const portY = sim.y;
    if (Math.hypot(wx - portX, wy - portY) <= 11) return { sim, branch: null };
    return null;
  }, []);

  const hitTestEdgeHandle = useCallback(
    (wx: number, wy: number): { edgeId: string; kind: "source" | "target" | "delete" } | null => {
      if (readOnlyRef.current) return null;
      const activeEdgeId = selectedEdgeRef.current ?? pointerRef.current.hoveredEdgeId;
      if (!activeEdgeId) return null;
      const geom = edgeGeometriesRef.current.get(activeEdgeId);
      if (!geom) return null;
      if (Math.hypot(wx - geom.midX, wy - geom.midY) <= 10) {
        return { edgeId: activeEdgeId, kind: "delete" };
      }
      if (Math.hypot(wx - geom.sx, wy - geom.sy) <= 10) {
        return { edgeId: activeEdgeId, kind: "source" };
      }
      if (Math.hypot(wx - geom.tx, wy - geom.ty) <= 10) {
        return { edgeId: activeEdgeId, kind: "target" };
      }
      return null;
    },
    [],
  );

  const hitTestEdge = useCallback((wx: number, wy: number): string | null => {
    let bestId: string | null = null;
    let bestDist = 12 / Math.max(0.5, camRef.current.zoom);
    for (const [edgeId, geom] of edgeGeometriesRef.current.entries()) {
      const d = distanceToBezier(wx, wy, geom);
      if (d < bestDist) {
        bestDist = d;
        bestId = edgeId;
      }
    }
    return bestId;
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isInput =
        target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT");
      if (isInput) return;

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z" && !readOnlyRef.current) {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "y" && !readOnlyRef.current) {
        e.preventDefault();
        redo();
        return;
      }

      if (e.key === "Escape") {
        pointerRef.current.connectingFromId = null;
        pointerRef.current.connectingCondition = null;
        pointerRef.current.portDownNodeId = null;
        pointerRef.current.portDownBranch = null;
        pointerRef.current.rewiringEdgeId = null;
        pointerRef.current.rewiringEnd = null;
        pointerRef.current.connectSnapTargetId = null;
        pointerRef.current.connectCompat = null;
        setPickerAnchor(null);
        selectNode(null);
        selectEdge(null);
        setCursorStyle("default");
        return;
      }

      if ((e.key === "Delete" || e.key === "Backspace") && !readOnlyRef.current) {
        if (selectedNodeRef.current) {
          e.preventDefault();
          const sim = simNodesRef.current.get(selectedNodeRef.current);
          if (sim) emitRipple(sim.x, sim.y, "#ef4444", 56);
          removeNodes([selectedNodeRef.current]);
        } else if (selectedEdgeRef.current) {
          e.preventDefault();
          removeEdges([selectedEdgeRef.current]);
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [undo, redo, removeEdges, removeNodes, selectEdge, selectNode, emitRipple]);

  // 60fps Canvas Render Loop
  useEffect(() => {
    let rafId = 0;
    let lastTime = performance.now();

    const renderFrame = (now: number) => {
      const dtSec = (now - lastTime) / 1000;
      lastTime = now;

      const canvas = canvasRef.current;
      const wrapper = wrapperRef.current;
      const currentGraph = graphRef.current;

      if (canvas && wrapper && currentGraph && currentGraph.nodes.length > 0) {
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const width = wrapper.clientWidth;
        const height = wrapper.clientHeight;
        if (canvas.width !== Math.floor(width * dpr) || canvas.height !== Math.floor(height * dpr)) {
          canvas.width = Math.floor(width * dpr);
          canvas.height = Math.floor(height * dpr);
        }

        const ctx = canvas.getContext("2d");
        if (ctx) {
          const simNodes = simNodesRef.current;
          const ptr = pointerRef.current;
          const cam = camRef.current;
          const selNodeId = selectedNodeRef.current;
          const selEdgeId = selectedEdgeRef.current;

          let focusedIds: Set<string> | null = null;
          const spotlightId = ptr.connectingFromId ?? ptr.hoveredNodeId;
          if (spotlightId) {
            focusedIds = new Set([spotlightId]);
            for (const e of currentGraph.edges) {
              if (e.source === spotlightId) focusedIds.add(e.target);
              if (e.target === spotlightId) focusedIds.add(e.source);
            }
          } else if (ptr.hoveredEdgeId) {
            const hoveredEdge = currentGraph.edges.find((e) => e.id === ptr.hoveredEdgeId);
            if (hoveredEdge) focusedIds = new Set([hoveredEdge.source, hoveredEdge.target]);
          }

          stepPhysics(simNodes, currentGraph.edges, DEFAULT_PHYSICS_PARAMS, dtSec, {
            draggedNodeId: ptr.draggedNodeId,
            hoveredNodeId: ptr.hoveredNodeId,
            selectedNodeId: selNodeId,
            focusedIds,
            activeNodeIds: activeNodeIdsRef.current,
          });

          if (!ptr.panning) {
            const camLerp = Math.min(1, dtSec * 9);
            cam.x += (cam.targetX - cam.x) * camLerp;
            cam.y += (cam.targetY - cam.y) * camLerp;
            cam.zoom += (cam.targetZoom - cam.zoom) * camLerp;
          }

          ctx.save();
          ctx.scale(dpr, dpr);
          ctx.fillStyle = "#09090b";
          ctx.fillRect(0, 0, width, height);

          const scaledSpacing = 32 * cam.zoom;
          if (scaledSpacing >= 12) {
            const dotAlpha = Math.min(0.22, Math.max(0.05, (scaledSpacing - 12) / 90));
            ctx.fillStyle = `rgba(161, 161, 170, ${dotAlpha})`;
            const offsetX = (((width / 2 + cam.x * cam.zoom) % scaledSpacing) + scaledSpacing) % scaledSpacing;
            const offsetY = (((height / 2 + cam.y * cam.zoom) % scaledSpacing) + scaledSpacing) % scaledSpacing;
            for (let x = offsetX; x < width; x += scaledSpacing) {
              for (let y = offsetY; y < height; y += scaledSpacing) {
                ctx.fillRect(x - 0.5, y - 0.5, 1.2, 1.2);
              }
            }
          }

          ctx.save();
          ctx.translate(width / 2, height / 2);
          ctx.scale(cam.zoom, cam.zoom);
          ctx.translate(cam.x, cam.y);

          const guides = alignGuidesRef.current;
          if (ptr.draggedNodeId && (guides.x !== null || guides.y !== null)) {
            ctx.save();
            ctx.strokeStyle = "rgba(16, 185, 129, 0.28)";
            ctx.lineWidth = 1 / cam.zoom;
            ctx.setLineDash([4 / cam.zoom, 4 / cam.zoom]);
            if (guides.x !== null) {
              ctx.beginPath();
              ctx.moveTo(guides.x, -2000);
              ctx.lineTo(guides.x, 2000);
              ctx.stroke();
            }
            if (guides.y !== null) {
              ctx.beginPath();
              ctx.moveTo(-2000, guides.y);
              ctx.lineTo(2000, guides.y);
              ctx.stroke();
            }
            ctx.restore();
          }

          const nextRipples: CanvasRipple[] = [];
          for (const rp of ripplesRef.current) {
            rp.radius += (rp.maxRadius - rp.radius) * Math.min(1, dtSec * 8.5);
            rp.alpha *= 0.88 ** (dtSec * 60);
            if (rp.alpha > 0.02) {
              ctx.beginPath();
              ctx.arc(rp.x, rp.y, rp.radius, 0, Math.PI * 2);
              ctx.strokeStyle = hexToRgba(rp.color, rp.alpha);
              ctx.lineWidth = 1.4 / cam.zoom;
              ctx.stroke();
              nextRipples.push(rp);
            }
          }
          ripplesRef.current = nextRipples;

          const edgePairs = new Set(currentGraph.edges.map((e) => `${e.source}->${e.target}`));
          const nextGeoms = new Map<string, BezierGeometry>();
          let graphCenterY = 0;
          if (simNodes.size > 0) {
            for (const n of simNodes.values()) graphCenterY += n.y;
            graphCenterY /= simNodes.size;
          }

          const nodeById = new Map(currentGraph.nodes.map((n) => [n.id, n]));
          const timeSec = now * 0.001;

          for (const edge of currentGraph.edges) {
            const src = simNodes.get(edge.source);
            const tgt = simNodes.get(edge.target);
            if (!src || !tgt) continue;

            const hasReverse = edgePairs.has(`${edge.target}->${edge.source}`);
            const geom = computeEdgeBezier(src, tgt, hasReverse, graphCenterY);
            nextGeoms.set(edge.id, geom);

            const isEdgeSelected = edge.id === selEdgeId;
            const isEdgeHovered = edge.id === ptr.hoveredEdgeId;
            const isConnectedToSpotlight = !spotlightId || edge.source === spotlightId || edge.target === spotlightId;
            const isSrcActive = activeNodeIdsRef.current.has(edge.source);
            const isTgtActive = activeNodeIdsRef.current.has(edge.target);
            const srcLog = logsByNodeRef.current.get(edge.source);
            const tgtLog = logsByNodeRef.current.get(edge.target);
            const isTraversed = Boolean(srcLog?.status === "done" && tgtLog);

            const srcNodeData = nodeById.get(edge.source);
            let branchColor: string | null = null;
            if (srcNodeData?.type === "decision" && edge.condition && Array.isArray(srcNodeData.branches)) {
              const bIdx = (srcNodeData.branches as string[]).indexOf(edge.condition);
              if (bIdx >= 0) branchColor = BRANCH_COLORS[bIdx % BRANCH_COLORS.length];
            }

            const baseAlpha = Math.min(src.alpha, tgt.alpha);
            const edgeAlpha =
              isEdgeSelected || isEdgeHovered ? 1 : isConnectedToSpotlight ? Math.max(0.45, baseAlpha) : 0.1;

            let strokeColor = branchColor ?? "#3f3f46";
            let strokeWidth = branchColor ? 1.6 : 1.35;
            if (isEdgeSelected) {
              strokeColor = "#10b981";
              strokeWidth = 2.2;
            } else if (isEdgeHovered) {
              strokeColor = "#fafafa";
              strokeWidth = 2.0;
            } else if (isSrcActive || isTgtActive) {
              strokeColor = "#38bdf8";
              strokeWidth = 2.0;
            } else if (geom.isLoop) {
              strokeColor = "#f59e0b";
              strokeWidth = 1.5;
            } else if (isTraversed) {
              strokeColor = "#10b981";
              strokeWidth = 1.7;
            } else if (spotlightId && isConnectedToSpotlight && !branchColor) {
              strokeColor = "#71717a";
              strokeWidth = 1.65;
            }

            ctx.save();
            ctx.globalAlpha = edgeAlpha;
            ctx.beginPath();
            ctx.moveTo(geom.sx, geom.sy);
            ctx.quadraticCurveTo(geom.cx, geom.cy, geom.tx, geom.ty);
            ctx.strokeStyle = strokeColor;
            ctx.lineWidth = strokeWidth;
            if (geom.isLoop) ctx.setLineDash([5, 4]);
            ctx.stroke();
            ctx.setLineDash([]);

            const headLen = 7;
            ctx.beginPath();
            ctx.moveTo(geom.tx, geom.ty);
            ctx.lineTo(
              geom.tx - headLen * Math.cos(geom.endAngle - Math.PI / 6.5),
              geom.ty - headLen * Math.sin(geom.endAngle - Math.PI / 6.5),
            );
            ctx.lineTo(
              geom.tx - headLen * Math.cos(geom.endAngle + Math.PI / 6.5),
              geom.ty - headLen * Math.sin(geom.endAngle + Math.PI / 6.5),
            );
            ctx.closePath();
            ctx.fillStyle = strokeColor;
            ctx.fill();

            if (
              isSrcActive ||
              isTgtActive ||
              isEdgeSelected ||
              isEdgeHovered ||
              (spotlightId && isConnectedToSpotlight)
            ) {
              const speed = isSrcActive || isTgtActive ? 0.65 : 0.34;
              const phase = (timeSec * speed + (edge.id.charCodeAt(edge.id.length - 1) % 7) * 0.17) % 1;
              const pt = pointOnQuadraticBezier(geom, phase);
              ctx.beginPath();
              ctx.arc(pt.x, pt.y, isSrcActive || isTgtActive ? 3.2 : 2.3, 0, Math.PI * 2);
              ctx.fillStyle = isSrcActive || isTgtActive ? "#38bdf8" : geom.isLoop ? "#f59e0b" : "#fafafa";
              ctx.fill();
            }

            if (edge.condition) {
              ctx.font = '500 10px "JetBrains Mono", ui-monospace, monospace';
              const textW = ctx.measureText(edge.condition).width;
              const pillW = textW + 12;
              const pillH = 18;
              ctx.fillStyle = "#111114";
              ctx.strokeStyle = isEdgeSelected ? "#10b981" : (branchColor ?? "#27272a");
              ctx.lineWidth = 1;
              ctx.beginPath();
              ctx.roundRect(geom.midX - pillW / 2, geom.midY - pillH / 2, pillW, pillH, 9);
              ctx.fill();
              ctx.stroke();

              ctx.fillStyle = branchColor ?? (isEdgeSelected ? "#10b981" : "#a1a1aa");
              ctx.textAlign = "center";
              ctx.textBaseline = "middle";
              ctx.fillText(edge.condition, geom.midX, geom.midY + 0.5);
            }

            // Endpoint rewire handles & midpoint delete 'x' on hovered/selected edge
            if (!readOnlyRef.current && (isEdgeSelected || isEdgeHovered)) {
              for (const [hx, hy] of [
                [geom.sx, geom.sy],
                [geom.tx, geom.ty],
              ]) {
                ctx.beginPath();
                ctx.arc(hx, hy, 5, 0, Math.PI * 2);
                ctx.fillStyle = "#18181c";
                ctx.fill();
                ctx.strokeStyle = "#10b981";
                ctx.lineWidth = 1.5;
                ctx.stroke();
              }

              const delY = edge.condition ? geom.midY - 18 : geom.midY;
              ctx.beginPath();
              ctx.arc(geom.midX, delY, 7, 0, Math.PI * 2);
              ctx.fillStyle = "#18181c";
              ctx.fill();
              ctx.strokeStyle = "#ef4444";
              ctx.lineWidth = 1.2;
              ctx.stroke();
              ctx.beginPath();
              ctx.moveTo(geom.midX - 2.5, delY - 2.5);
              ctx.lineTo(geom.midX + 2.5, delY + 2.5);
              ctx.moveTo(geom.midX + 2.5, delY - 2.5);
              ctx.lineTo(geom.midX - 2.5, delY + 2.5);
              ctx.strokeStyle = "#ef4444";
              ctx.lineWidth = 1.3;
              ctx.stroke();
            }

            ctx.restore();
          }
          edgeGeometriesRef.current = nextGeoms;

          // Live elastic link wire + compatibility ring
          if (ptr.connectingFromId) {
            const fromSim = simNodes.get(ptr.connectingFromId);
            if (fromSim) {
              const snapSim = ptr.connectSnapTargetId ? simNodes.get(ptr.connectSnapTargetId) : null;
              const tx = snapSim ? snapSim.x : ptr.connectCursorX;
              const ty = snapSim ? snapSim.y : ptr.connectCursorY;
              const cx = (fromSim.x + tx) / 2;
              const cy = (fromSim.y + ty) / 2 - 22;
              const compatColor =
                ptr.connectCompat === "incompatible" ? "#ef4444" : ptr.connectCompat === "cast" ? "#f59e0b" : "#10b981";

              ctx.save();
              ctx.beginPath();
              ctx.moveTo(fromSim.x, fromSim.y);
              ctx.quadraticCurveTo(cx, cy, tx, ty);
              ctx.strokeStyle = snapSim ? compatColor : "#38bdf8";
              ctx.lineWidth = 2;
              ctx.setLineDash([6, 4]);
              ctx.stroke();
              ctx.setLineDash([]);

              if (snapSim) {
                ctx.beginPath();
                ctx.arc(snapSim.x, snapSim.y, snapSim.radius * snapSim.scale + 9, 0, Math.PI * 2);
                ctx.strokeStyle = compatColor;
                ctx.lineWidth = 2.4;
                ctx.stroke();
              }
              ctx.restore();
            }
          }

          // Draw Nodes
          for (const node of currentGraph.nodes) {
            const sim = simNodes.get(node.id);
            if (!sim) continue;

            const meta = NODE_META[node.type] ?? NODE_META.agent;
            const log = logsByNodeRef.current.get(node.id);
            const isActive = activeNodeIdsRef.current.has(node.id);
            const status = isActive ? "running" : log?.status;
            const isSelected = node.id === selNodeId;
            const isHovered = node.id === ptr.hoveredNodeId;
            const isEntry = node.id === currentGraph.entryNode;
            const isOutput = Boolean(node.isOutput);
            const r = sim.radius * sim.scale;

            ctx.save();
            ctx.globalAlpha = sim.alpha;

            if (sim.glow > 0.03) {
              const haloColor =
                status === "running"
                  ? "#38bdf8"
                  : status === "failed"
                    ? "#ef4444"
                    : status === "waiting_checkpoint"
                      ? "#f59e0b"
                      : meta.color;
              const grad = ctx.createRadialGradient(sim.x, sim.y, r * 0.4, sim.x, sim.y, r * 2.25);
              grad.addColorStop(0, hexToRgba(haloColor, 0.28 * sim.glow));
              grad.addColorStop(1, hexToRgba(haloColor, 0));
              ctx.fillStyle = grad;
              ctx.beginPath();
              ctx.arc(sim.x, sim.y, r * 2.25, 0, Math.PI * 2);
              ctx.fill();
            }

            if (isEntry) {
              ctx.beginPath();
              ctx.arc(sim.x, sim.y, r + 5.5, 0, Math.PI * 2);
              ctx.strokeStyle = "rgba(16, 185, 129, 0.55)";
              ctx.lineWidth = 1.2;
              ctx.setLineDash([3, 3]);
              ctx.stroke();
              ctx.setLineDash([]);
            }

            if (isOutput) {
              ctx.beginPath();
              ctx.arc(sim.x, sim.y, r + (isEntry ? 9 : 5.5), 0, Math.PI * 2);
              ctx.strokeStyle = "rgba(56, 189, 248, 0.55)";
              ctx.lineWidth = 1.2;
              ctx.setLineDash([3, 3]);
              ctx.stroke();
              ctx.setLineDash([]);
            }

            if (status === "running") {
              const spin = timeSec * 2.6;
              ctx.beginPath();
              ctx.arc(sim.x, sim.y, r + 5, spin, spin + Math.PI * 1.15);
              ctx.strokeStyle = "#38bdf8";
              ctx.lineWidth = 2;
              ctx.lineCap = "round";
              ctx.stroke();
            }

            ctx.beginPath();
            ctx.arc(sim.x, sim.y, r, 0, Math.PI * 2);
            ctx.fillStyle = isSelected || isHovered ? "#18181c" : "#111114";
            ctx.fill();

            let ringColor = meta.color;
            const ringWidth = isSelected ? 2.4 : isHovered ? 2.0 : 1.5;
            if (status === "running") ringColor = "#38bdf8";
            else if (status === "failed") ringColor = "#ef4444";
            else if (status === "waiting_checkpoint") ringColor = "#f59e0b";
            else if (status === "done") ringColor = "#10b981";
            else if (!isSelected && !isHovered) ringColor = hexToRgba(meta.color, 0.78);

            ctx.strokeStyle = ringColor;
            ctx.lineWidth = ringWidth;
            ctx.stroke();

            ctx.beginPath();
            ctx.arc(sim.x, sim.y, Math.max(2, r - 2.5), 0, Math.PI * 2);
            ctx.strokeStyle = "rgba(255, 255, 255, 0.05)";
            ctx.lineWidth = 1;
            ctx.stroke();

            drawNodeGlyph(ctx, node.type, sim.x, sim.y, r * 0.95, isSelected || isHovered ? "#fafafa" : meta.color);

            if (status === "done" || status === "failed" || status === "waiting_checkpoint") {
              const dotX = sim.x + r * 0.72;
              const dotY = sim.y - r * 0.72;
              ctx.beginPath();
              ctx.arc(dotX, dotY, 4.5, 0, Math.PI * 2);
              ctx.fillStyle = "#09090b";
              ctx.fill();
              ctx.beginPath();
              ctx.arc(dotX, dotY, 3, 0, Math.PI * 2);
              ctx.fillStyle = status === "done" ? "#10b981" : status === "failed" ? "#ef4444" : "#f59e0b";
              ctx.fill();
            }

            // Decision branch ports or standard '+' rim port
            if (!readOnlyRef.current && (isHovered || isSelected) && !ptr.draggedNodeId && !ptr.connectingFromId) {
              if (node.type === "decision") {
                const bPorts = getDecisionBranchPorts(node, sim);
                for (const bp of bPorts) {
                  const isBpHover = ptr.hoveredLinkPortNodeId === node.id && ptr.hoveredBranch === bp.branch;
                  ctx.beginPath();
                  ctx.arc(bp.x, bp.y, isBpHover ? 7.5 : 6, 0, Math.PI * 2);
                  ctx.fillStyle = isBpHover ? bp.color : "#18181c";
                  ctx.fill();
                  ctx.strokeStyle = bp.color;
                  ctx.lineWidth = 1.4;
                  ctx.stroke();

                  ctx.font = '500 9px "JetBrains Mono", ui-monospace, monospace';
                  ctx.fillStyle = bp.color;
                  ctx.textAlign = "left";
                  ctx.textBaseline = "middle";
                  ctx.fillText(bp.branch, bp.x + 10, bp.y);
                }
              } else {
                const portX = sim.x + r + 12;
                const portY = sim.y;
                const portHovered = ptr.hoveredLinkPortNodeId === node.id;
                ctx.beginPath();
                ctx.arc(portX, portY, portHovered ? 8 : 6.8, 0, Math.PI * 2);
                ctx.fillStyle = portHovered ? "#10b981" : "#18181c";
                ctx.fill();
                ctx.strokeStyle = portHovered ? "#10b981" : "#52525b";
                ctx.lineWidth = 1.25;
                ctx.stroke();

                ctx.beginPath();
                ctx.moveTo(portX - 3, portY);
                ctx.lineTo(portX + 3, portY);
                ctx.moveTo(portX, portY - 3);
                ctx.lineTo(portX, portY + 3);
                ctx.strokeStyle = portHovered ? "#09090b" : "#fafafa";
                ctx.lineWidth = 1.45;
                ctx.stroke();
              }
            }

            const labelY = sim.y + r + 14;
            const label = node.label || node.id;
            ctx.font = `${isSelected || isHovered ? "600" : "500"} 12px Inter, system-ui, sans-serif`;
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";

            const tw = ctx.measureText(label).width;
            ctx.fillStyle = isHovered || isSelected ? "rgba(9, 9, 11, 0.92)" : "rgba(9, 9, 11, 0.74)";
            ctx.beginPath();
            ctx.roundRect(sim.x - tw / 2 - 6, labelY - 9, tw + 12, 18, 5);
            ctx.fill();

            ctx.fillStyle = isSelected || isHovered ? "#fafafa" : "#e4e4e7";
            ctx.fillText(label, sim.x, labelY);

            if (cam.zoom >= 0.72 || isHovered || isSelected) {
              const latency = formatLatency(log?.startedAt, log?.finishedAt);
              const metaLine = getNodeMetaLine(node, latency);
              if (metaLine) {
                ctx.font = '400 10px "JetBrains Mono", ui-monospace, monospace';
                const mw = ctx.measureText(metaLine).width;
                ctx.fillStyle = "rgba(9, 9, 11, 0.68)";
                ctx.beginPath();
                ctx.roundRect(sim.x - mw / 2 - 4, labelY + 8, mw + 8, 13, 3);
                ctx.fill();
                ctx.fillStyle = "#71717a";
                ctx.fillText(metaLine, sim.x, labelY + 14.5);
              }
            }

            ctx.restore();
          }

          ctx.restore();
          ctx.restore();
        }
      }

      rafId = requestAnimationFrame(renderFrame);
    };

    rafId = requestAnimationFrame(renderFrame);
    return () => cancelAnimationFrame(rafId);
  }, []);

  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    const cam = camRef.current;
    const factor = e.deltaY < 0 ? 1.1 : 0.91;
    const nextZoom = Math.max(0.35, Math.min(2.2, cam.targetZoom * factor));
    cam.targetZoom = nextZoom;
    cam.zoom = nextZoom;
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const { x: wx, y: wy } = screenToWorld(e.clientX, e.clientY);
    const ptr = pointerRef.current;

    const portHit = hitTestLinkPort(wx, wy);
    if (portHit && !readOnly) {
      ptr.portDownNodeId = portHit.sim.id;
      ptr.portDownBranch = portHit.branch;
      ptr.portDownScreenX = e.clientX;
      ptr.portDownScreenY = e.clientY;
      setCursorStyle("crosshair");
      return;
    }

    const edgeHandle = hitTestEdgeHandle(wx, wy);
    if (edgeHandle && !readOnly && graphRef.current) {
      if (edgeHandle.kind === "delete") {
        removeEdges([edgeHandle.edgeId]);
        selectEdge(null);
        return;
      }
      const edge = graphRef.current.edges.find((ed) => ed.id === edgeHandle.edgeId);
      if (edge) {
        ptr.rewiringEdgeId = edge.id;
        ptr.rewiringEnd = edgeHandle.kind;
        ptr.connectingFromId = edgeHandle.kind === "target" ? edge.source : edge.target;
        ptr.connectingCondition = edge.condition ?? null;
        ptr.connectCursorX = wx;
        ptr.connectCursorY = wy;
        setCursorStyle("crosshair");
        return;
      }
    }

    const hitNode = hitTestNode(wx, wy);
    if (hitNode) {
      setPickerAnchor(null);
      if (!readOnly && e.shiftKey) {
        ptr.connectingFromId = hitNode.id;
        ptr.connectingCondition = null;
        ptr.connectCursorX = wx;
        ptr.connectCursorY = wy;
        ptr.connectSnapTargetId = null;
        ptr.connectCompat = null;
        setCursorStyle("crosshair");
        return;
      }

      ptr.draggedNodeId = hitNode.id;
      ptr.dragMoved = false;
      ptr.dragOffsetX = hitNode.x - wx;
      ptr.dragOffsetY = hitNode.y - wy;
      hitNode.vx = 0;
      hitNode.vy = 0;
      setCursorStyle(readOnly ? "pointer" : "grabbing");
      return;
    }

    const hitEdgeId = hitTestEdge(wx, wy);
    if (hitEdgeId) {
      setPickerAnchor(null);
      const geom = edgeGeometriesRef.current.get(hitEdgeId);
      if (geom) setPopoverAnchor(worldToScreen(geom.midX, geom.midY));
      selectEdge(hitEdgeId);
      return;
    }

    // Pan background
    setPickerAnchor(null);
    selectNode(null);
    selectEdge(null);
    ptr.panning = true;
    ptr.panStartScreenX = e.clientX;
    ptr.panStartScreenY = e.clientY;
    ptr.panStartCamX = camRef.current.x;
    ptr.panStartCamY = camRef.current.y;
    setCursorStyle("grabbing");
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const { x: wx, y: wy } = screenToWorld(e.clientX, e.clientY);
    const ptr = pointerRef.current;

    if (ptr.panning) {
      const dx = (e.clientX - ptr.panStartScreenX) / camRef.current.zoom;
      const dy = (e.clientY - ptr.panStartScreenY) / camRef.current.zoom;
      camRef.current.x = ptr.panStartCamX + dx;
      camRef.current.y = ptr.panStartCamY + dy;
      camRef.current.targetX = camRef.current.x;
      camRef.current.targetY = camRef.current.y;
      return;
    }

    if (ptr.portDownNodeId) {
      if (Math.hypot(e.clientX - ptr.portDownScreenX, e.clientY - ptr.portDownScreenY) > 5) {
        ptr.connectingFromId = ptr.portDownNodeId;
        ptr.connectingCondition = ptr.portDownBranch;
        ptr.portDownNodeId = null;
        ptr.portDownBranch = null;
        ptr.connectCursorX = wx;
        ptr.connectCursorY = wy;
        ptr.connectSnapTargetId = null;
        ptr.connectCompat = null;
      }
      return;
    }

    if (ptr.connectingFromId) {
      ptr.connectCursorX = wx;
      ptr.connectCursorY = wy;
      const candidate = hitTestNode(wx, wy);
      if (candidate && candidate.id !== ptr.connectingFromId && graphRef.current) {
        ptr.connectSnapTargetId = candidate.id;
        const srcNode = graphRef.current.nodes.find((n) => n.id === ptr.connectingFromId);
        const tgtNode = graphRef.current.nodes.find((n) => n.id === candidate.id);
        ptr.connectCompat =
          srcNode && tgtNode
            ? checkNodeCompatibility(srcNode, tgtNode, undefined, Boolean(graphRef.current.policy?.strictCompatibility))
            : "compatible";
      } else {
        ptr.connectSnapTargetId = null;
        ptr.connectCompat = null;
      }
      return;
    }

    if (ptr.draggedNodeId && !readOnly) {
      const node = simNodesRef.current.get(ptr.draggedNodeId);
      if (node) {
        let nextX = wx + ptr.dragOffsetX;
        let nextY = wy + ptr.dragOffsetY;

        if (Math.hypot(nextX - node.x, nextY - node.y) > 2) {
          ptr.dragMoved = true;
        }

        let snapX: number | null = null;
        let snapY: number | null = null;
        for (const peer of simNodesRef.current.values()) {
          if (peer.id === node.id) continue;
          if (Math.abs(nextX - peer.anchorX) < 10) {
            nextX = peer.anchorX;
            snapX = peer.anchorX;
          }
          if (Math.abs(nextY - peer.anchorY) < 10) {
            nextY = peer.anchorY;
            snapY = peer.anchorY;
          }
        }
        alignGuidesRef.current = { x: snapX, y: snapY };

        node.x = nextX;
        node.y = nextY;
        if (selectedNodeRef.current === node.id) {
          setPopoverAnchor(worldToScreen(node.x, node.y));
        }
      }
      return;
    }

    const portHit = hitTestLinkPort(wx, wy);
    if (portHit) {
      ptr.hoveredLinkPortNodeId = portHit.sim.id;
      ptr.hoveredBranch = portHit.branch;
      ptr.hoveredNodeId = portHit.sim.id;
      ptr.hoveredEdgeId = null;
      setCursorStyle("crosshair");
      return;
    }
    ptr.hoveredLinkPortNodeId = null;
    ptr.hoveredBranch = null;

    const hitNode = hitTestNode(wx, wy);
    if (hitNode) {
      ptr.hoveredNodeId = hitNode.id;
      ptr.hoveredEdgeId = null;
      setCursorStyle("pointer");
      return;
    }

    ptr.hoveredNodeId = null;
    const hitEdge = hitTestEdge(wx, wy);
    ptr.hoveredEdgeId = hitEdge;
    setCursorStyle(hitEdge ? "pointer" : "default");
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    const ptr = pointerRef.current;

    if (ptr.panning) {
      ptr.panning = false;
      setCursorStyle("default");
      return;
    }

    if (ptr.portDownNodeId) {
      const sourceId = ptr.portDownNodeId;
      const branch = ptr.portDownBranch;
      ptr.portDownNodeId = null;
      ptr.portDownBranch = null;
      const sim = simNodesRef.current.get(sourceId);
      if (sim && !readOnly) {
        selectNode(null);
        selectEdge(null);
        setPickerAnchor({
          connectFromId: sourceId,
          condition: branch ?? undefined,
          worldPos: { x: sim.anchorX + 240, y: sim.anchorY },
          screenPos: worldToScreen(sim.x + sim.radius + 16, sim.y),
        });
      }
      setCursorStyle("default");
      return;
    }

    if (ptr.connectingFromId) {
      if (ptr.connectSnapTargetId && !readOnly && graphRef.current) {
        const strict = Boolean(graphRef.current.policy?.strictCompatibility);
        if (!(strict && ptr.connectCompat === "incompatible")) {
          if (ptr.rewiringEdgeId && ptr.rewiringEnd) {
            const oldEdge = graphRef.current.edges.find((ed) => ed.id === ptr.rewiringEdgeId);
            if (oldEdge) {
              const nextSrc = ptr.rewiringEnd === "source" ? ptr.connectSnapTargetId : oldEdge.source;
              const nextTgt = ptr.rewiringEnd === "target" ? ptr.connectSnapTargetId : oldEdge.target;
              rewireEdge(oldEdge.id, nextSrc, nextTgt);
            }
          } else {
            addEdge(ptr.connectingFromId, ptr.connectSnapTargetId, ptr.connectingCondition ?? undefined);
          }
          const tgt = simNodesRef.current.get(ptr.connectSnapTargetId);
          if (tgt) {
            tgt.scaleVel += 0.14;
            emitRipple(tgt.x, tgt.y, "#10b981", 68);
          }
        }
      }
      ptr.connectingFromId = null;
      ptr.connectingCondition = null;
      ptr.connectSnapTargetId = null;
      ptr.connectCompat = null;
      ptr.rewiringEdgeId = null;
      ptr.rewiringEnd = null;
      setCursorStyle("default");
      return;
    }

    if (ptr.draggedNodeId) {
      const draggedId = ptr.draggedNodeId;
      const moved = ptr.dragMoved;
      ptr.draggedNodeId = null;
      alignGuidesRef.current = { x: null, y: null };

      const sim = simNodesRef.current.get(draggedId);
      if (!moved) {
        if (sim) {
          setPopoverAnchor(worldToScreen(sim.x, sim.y));
          sim.scaleVel += 0.1;
          const nodeData = graphRef.current?.nodes.find((n) => n.id === draggedId);
          emitRipple(sim.x, sim.y, nodeData ? NODE_META[nodeData.type].color : "#10b981", 56);
        }
        selectNode(draggedId);
      } else if (sim && !readOnly) {
        sim.anchorX = sim.x;
        sim.anchorY = sim.y;
        setNodePositions([{ id: draggedId, position: { x: Math.round(sim.x), y: Math.round(sim.y) } }]);
      }
      setCursorStyle("pointer");
    }
  };

  const handlePickNodeKind = (kind: NodeKind) => {
    if (!pickerAnchor || readOnly) return;
    const created = addNode(kind, {
      position: pickerAnchor.worldPos,
      connectFromId: pickerAnchor.connectFromId,
      condition: pickerAnchor.condition,
    });
    setPickerAnchor(null);
    if (created) {
      const pos = worldToScreen(pickerAnchor.worldPos.x, pickerAnchor.worldPos.y);
      setPopoverAnchor(pos);
    }
  };

  if (isLoading) {
    return (
      <div className="flex h-full w-full flex-col bg-canvas">
        <header className="flex h-11 shrink-0 items-center border-b border-border-subtle bg-surface px-4">
          <Skeleton className="h-4 w-48" />
        </header>
        <div className="flex flex-1 items-center justify-center">
          <div className="flex items-center gap-12">
            <Skeleton className="h-12 w-12 rounded-full" />
            <Skeleton className="h-12 w-12 rounded-full" />
            <Skeleton className="h-12 w-12 rounded-full" />
          </div>
        </div>
      </div>
    );
  }

  const totalRunMs =
    runDetail?.createdAt && runDetail?.updatedAt
      ? new Date(runDetail.updatedAt).getTime() - new Date(runDetail.createdAt).getTime()
      : null;

  const doneCount = runDetail?.history.filter((l) => l.status === "done").length ?? 0;
  const failedCount = runDetail?.history.filter((l) => l.status === "failed").length ?? 0;

  const selectedNode = graph && selectedNodeId ? (graph.nodes.find((n) => n.id === selectedNodeId) ?? null) : null;
  const selectedEdge = graph && selectedEdgeId ? (graph.edges.find((e) => e.id === selectedEdgeId) ?? null) : null;
  const policy = graph?.policy ?? {
    memoryRecallBefore: "decision" as const,
    saveRunSummary: true,
    autoCheckpointBefore: [] as Array<"gpu" | "yue2" | "tool">,
    strictCompatibility: false,
  };

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-canvas">
      {/* Current Editor Precision Header (No Arrange, No Add Node) */}
      <header className="flex h-11 shrink-0 items-center justify-between gap-3 border-b border-border-subtle bg-surface px-3">
        <div className="flex min-w-0 items-center gap-2">
          <Button
            variant={drawerOpen ? "secondary" : "ghost"}
            size="icon"
            onClick={onToggleDrawer}
            title="Toggle Sources drawer"
            className="h-7 w-7 shrink-0"
          >
            <PanelLeft className="h-3.5 w-3.5" />
          </Button>

          {graph ? (
            editingTitle && !readOnly ? (
              <input
                ref={(el) => el?.focus()}
                value={graph.name}
                onChange={(e) => updateGraphMeta({ name: e.target.value })}
                onBlur={() => setEditingTitle(false)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === "Escape") setEditingTitle(false);
                }}
                className="h-6 rounded border border-accent/60 bg-canvas px-2 text-[13px] font-semibold text-text-primary focus:outline-none"
              />
            ) : (
              <button
                type="button"
                disabled={readOnly}
                onClick={() => !readOnly && setEditingTitle(true)}
                className="truncate text-left text-[13px] font-semibold text-text-primary hover:text-accent disabled:hover:text-text-primary"
              >
                {graph.name}
              </button>
            )
          ) : (
            <span className="text-[13px] font-semibold text-text-primary">Current Workflow</span>
          )}

          {!readOnly && graph ? (
            <span
              className={cn(
                "shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px]",
                isDirty ? "bg-warning/15 text-warning" : "text-text-muted",
              )}
            >
              {isSaving ? "Saving..." : isDirty ? "Unsaved" : saveStatus || "Saved"}
            </span>
          ) : null}

          {runDetail ? (
            <div className="flex items-center gap-2">
              <Badge
                variant={
                  runDetail.status === "completed"
                    ? "accent"
                    : runDetail.status === "failed"
                      ? "error"
                      : runDetail.status === "waiting_checkpoint"
                        ? "warning"
                        : "info"
                }
              >
                {runDetail.status}
              </Badge>
              <span className="flex items-center gap-1 font-mono text-[11px] text-text-secondary tabular-nums">
                <Clock className="h-3 w-3 text-text-muted" />
                {totalRunMs !== null ? formatDuration(totalRunMs) : "live"}
              </span>
              <span className="hidden font-mono text-[11px] text-text-muted tabular-nums lg:inline">
                {doneCount}/{graph?.nodes.length ?? 0} done
                {failedCount > 0 ? ` · ${failedCount} failed` : ""}
              </span>
            </div>
          ) : null}
        </div>

        {/* Right Controls */}
        <div className="flex shrink-0 items-center gap-1.5">
          {!readOnly ? (
            <>
              <Button
                variant="ghost"
                size="icon"
                disabled={!canUndo}
                onClick={undo}
                title="Undo (Ctrl+Z)"
                className="h-7 w-7"
              >
                <Undo2 className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                disabled={!canRedo}
                onClick={redo}
                title="Redo (Ctrl+Shift+Z)"
                className="h-7 w-7"
              >
                <Redo2 className="h-3.5 w-3.5" />
              </Button>

              {graph ? (
                <>
                  {/* Graph Policy Popover */}
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="ghost" size="xs" title="Graph run policy">
                        <ShieldCheck className="h-3.5 w-3.5" />
                        <span className="hidden md:inline">Policy</span>
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent align="end" className="w-72 space-y-3 p-3">
                      <div className="text-[12px] font-semibold text-text-primary">Durable Run Policy</div>
                      <div className="space-y-1">
                        <label className="block text-[10px] font-medium text-text-secondary">
                          Memory recall before
                        </label>
                        <select
                          value={policy.memoryRecallBefore ?? "decision"}
                          onChange={(e) =>
                            updatePolicy({
                              memoryRecallBefore: e.target.value as "off" | "entry" | "decision" | "all",
                            })
                          }
                          className="flex h-7 w-full rounded-md border border-border-subtle bg-canvas px-2 text-[11px] text-text-primary"
                        >
                          <option value="decision">decision nodes (default)</option>
                          <option value="entry">entry node</option>
                          <option value="all">all nodes</option>
                          <option value="off">off</option>
                        </select>
                      </div>

                      <label className="flex cursor-pointer items-center gap-2 text-[11px] text-text-secondary">
                        <input
                          type="checkbox"
                          checked={policy.saveRunSummary !== false}
                          onChange={(e) => updatePolicy({ saveRunSummary: e.target.checked })}
                          className="accent-emerald-500"
                        />
                        <span>Save run summary to memory</span>
                      </label>

                      <div className="space-y-1">
                        <div className="text-[10px] font-medium text-text-secondary">Auto-checkpoint before</div>
                        <div className="flex gap-2">
                          {(["gpu", "yue2", "tool"] as const).map((cat) => {
                            const active = (policy.autoCheckpointBefore ?? []).includes(cat);
                            return (
                              <label
                                key={cat}
                                className="flex cursor-pointer items-center gap-1 text-[11px] text-text-secondary"
                              >
                                <input
                                  type="checkbox"
                                  checked={active}
                                  onChange={(e) => {
                                    const current = policy.autoCheckpointBefore ?? [];
                                    updatePolicy({
                                      autoCheckpointBefore: e.target.checked
                                        ? Array.from(new Set([...current, cat]))
                                        : current.filter((c) => c !== cat),
                                    });
                                  }}
                                  className="accent-emerald-500"
                                />
                                <span className="font-mono text-[10px]">{cat}</span>
                              </label>
                            );
                          })}
                        </div>
                      </div>

                      <label className="flex cursor-pointer items-center gap-2 text-[11px] text-text-secondary">
                        <input
                          type="checkbox"
                          checked={Boolean(policy.strictCompatibility)}
                          onChange={(e) => updatePolicy({ strictCompatibility: e.target.checked })}
                          className="accent-emerald-500"
                        />
                        <span>Strict port compatibility</span>
                      </label>
                    </PopoverContent>
                  </Popover>

                  {/* Version History Popover */}
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="ghost" size="xs" title="Version history">
                        <History className="h-3.5 w-3.5" />
                        <span className="hidden md:inline">History</span>
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent align="end" className="w-72 space-y-2 p-3">
                      <div className="text-[12px] font-semibold text-text-primary">Saved Versions</div>
                      {versions.length === 0 ? (
                        <div className="text-[11px] text-text-muted">No saved versions yet.</div>
                      ) : (
                        <div className="max-h-56 space-y-1 overflow-y-auto">
                          {versions.map((v) => (
                            <div
                              key={v.versionId}
                              className="flex items-center justify-between gap-2 rounded border border-border-subtle bg-canvas px-2 py-1.5"
                            >
                              <div className="min-w-0">
                                <div className="truncate text-[11px] font-medium text-text-primary">{v.label}</div>
                                <div className="font-mono text-[9px] text-text-muted">
                                  {new Date(v.createdAt).toLocaleTimeString()}
                                </div>
                              </div>
                              <Button variant="secondary" size="xs" onClick={() => onRestoreVersion(v)}>
                                Restore
                              </Button>
                            </div>
                          ))}
                        </div>
                      )}
                    </PopoverContent>
                  </Popover>

                  <Button
                    variant="secondary"
                    size="xs"
                    disabled={isSaving || !isDirty}
                    onClick={onSaveWorkflow}
                    title="Save workflow (Ctrl+S)"
                  >
                    <Save className="h-3 w-3" />
                    <span>Save</span>
                  </Button>

                  {templateVars.length > 0 ? (
                    <Popover
                      open={runPopoverOpen}
                      onOpenChange={(open) => {
                        setRunPopoverOpen(open);
                        if (open) setRunInputs({});
                      }}
                    >
                      <PopoverTrigger asChild>
                        <Button variant="primary" size="xs" disabled={isStartingRun || graph.nodes.length === 0}>
                          <Play className="h-3 w-3" />
                          <span>Run</span>
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent align="end" className="w-64 space-y-2.5 p-3">
                        <div className="text-[12px] font-semibold text-text-primary">Run {graph.name}</div>
                        {templateVars.map((v) => (
                          <div key={v} className="space-y-1">
                            <label className="block font-mono text-[10px] text-text-muted">{v}</label>
                            <Input
                              autoFocus={templateVars[0] === v}
                              value={runInputs[v] ?? ""}
                              onChange={(e) => setRunInputs((prev) => ({ ...prev, [v]: e.target.value }))}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  setRunPopoverOpen(false);
                                  onStartRun(runInputs);
                                }
                              }}
                              placeholder={`Enter ${v}...`}
                              className="h-7 text-[12px]"
                            />
                          </div>
                        ))}
                        <div className="flex justify-end gap-1.5">
                          <Button variant="ghost" size="xs" onClick={() => setRunPopoverOpen(false)}>
                            Cancel
                          </Button>
                          <Button
                            variant="primary"
                            size="xs"
                            disabled={isStartingRun}
                            onClick={() => {
                              setRunPopoverOpen(false);
                              onStartRun(runInputs);
                            }}
                          >
                            <Play className="h-3 w-3" />
                            Start
                          </Button>
                        </div>
                      </PopoverContent>
                    </Popover>
                  ) : (
                    <Button
                      variant="primary"
                      size="xs"
                      disabled={isStartingRun || graph.nodes.length === 0}
                      onClick={() => onStartRun({})}
                    >
                      <Play className="h-3 w-3" />
                      <span>Run</span>
                    </Button>
                  )}
                </>
              ) : null}
            </>
          ) : (
            <>
              {onRollbackRun && runDetail && runDetail.status !== "running" && runDetail.history.length > 0 ? (
                <Button variant="secondary" size="xs" onClick={() => onRollbackRun()}>
                  <RotateCcw className="h-3 w-3" />
                  <span>Resume / Rollback</span>
                </Button>
              ) : null}
              {onEditGraph ? (
                <Button variant="secondary" size="xs" onClick={onEditGraph}>
                  Edit Workflow
                </Button>
              ) : null}
              {onForkSnapshot ? (
                <Button variant="primary" size="xs" onClick={onForkSnapshot}>
                  Fork Snapshot
                </Button>
              ) : null}
            </>
          )}
        </div>
      </header>

      {/* Canvas or Empty State */}
      <div ref={wrapperRef} className="relative min-h-0 min-w-0 flex-1 overflow-hidden select-none">
        {!graph || graph.nodes.length === 0 ? (
          <div className="flex h-full w-full flex-col items-center justify-center gap-5 bg-canvas p-6 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full border border-border-strong bg-surface text-accent">
              <Plus className="h-5 w-5" />
            </div>
            <div className="space-y-1">
              <div className="text-[14px] font-semibold text-text-primary">Start a workflow in Current</div>
              <p className="max-w-sm text-[12px] text-text-secondary">
                Pick a starter node below or load a saved workflow from Sources.
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-2">
              {PRIMARY_NODE_KINDS.map((item) => {
                const Icon = item.icon;
                return (
                  <Button
                    key={item.kind}
                    variant="secondary"
                    size="sm"
                    onClick={() => onCreateStarterGraph(item.kind)}
                    className="gap-2"
                  >
                    <Icon className="h-3.5 w-3.5" style={{ color: NODE_META[item.kind].color }} />
                    <span>{item.label}</span>
                  </Button>
                );
              })}
            </div>
            <div className="flex flex-wrap items-center justify-center gap-1.5">
              {SECONDARY_NODE_KINDS.filter((k) => k.kind !== "subagent").map((item) => {
                const Icon = item.icon;
                return (
                  <Button
                    key={item.kind}
                    variant="ghost"
                    size="xs"
                    onClick={() => onCreateStarterGraph(item.kind)}
                    className="gap-1.5 text-text-secondary"
                  >
                    <Icon className="h-3 w-3" style={{ color: NODE_META[item.kind].color }} />
                    <span>{item.label}</span>
                  </Button>
                );
              })}
            </div>
          </div>
        ) : (
          <canvas
            ref={canvasRef}
            onWheel={handleWheel}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            style={{ cursor: cursorStyle }}
            className="block h-full w-full touch-none"
          />
        )}

        {graph && selectedNode ? (
          <AnchoredNodePopover
            graph={graph}
            node={selectedNode}
            runDetail={runDetail}
            readOnly={readOnly}
            availableSkills={availableSkills}
            modelCatalog={modelCatalog}
            screenPos={popoverAnchor}
            bounds={canvasBounds}
            onClose={() => selectNode(null)}
            onSelectNode={(id) => selectNode(id)}
            onSelectEdge={(id) => selectEdge(id)}
            onRollbackToStep={onRollbackRun}
          />
        ) : null}

        {graph && selectedEdge ? (
          <AnchoredEdgePopover
            graph={graph}
            edge={selectedEdge}
            readOnly={readOnly}
            screenPos={popoverAnchor}
            bounds={canvasBounds}
            onClose={() => selectEdge(null)}
          />
        ) : null}

        {pickerAnchor && !readOnly ? (
          <AnchoredNodePicker
            screenPos={pickerAnchor.screenPos}
            bounds={canvasBounds}
            onPick={handlePickNodeKind}
            onClose={() => setPickerAnchor(null)}
          />
        ) : null}
      </div>

      {/* Validation Strip */}
      {graph && graph.nodes.length > 0 ? (
        <footer className="flex h-7 shrink-0 items-center justify-between gap-2 border-t border-border-subtle bg-surface px-3 text-[11px]">
          <div className="flex min-w-0 items-center gap-2 overflow-x-auto">
            {validationIssues.length === 0 ? (
              <span className="flex items-center gap-1.5 text-accent">
                <CheckCircle2 className="h-3 w-3" />
                <span>
                  Graph valid · {graph.nodes.length} node{graph.nodes.length === 1 ? "" : "s"} · {graph.edges.length}{" "}
                  edge
                  {graph.edges.length === 1 ? "" : "s"}
                </span>
              </span>
            ) : (
              validationIssues.slice(0, 4).map((issue) => (
                <button
                  key={issue.id}
                  type="button"
                  onClick={() => {
                    if (issue.nodeId) selectNode(issue.nodeId);
                    else if (issue.edgeId) selectEdge(issue.edgeId);
                  }}
                  className={cn(
                    "flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[10px] hover:bg-elevated",
                    issue.severity === "error" ? "text-error" : "text-warning",
                  )}
                >
                  <AlertCircle className="h-3 w-3" />
                  <span>{issue.message}</span>
                </button>
              ))
            )}
          </div>
          <span className="shrink-0 font-mono text-[10px] text-text-muted">
            {policy.strictCompatibility ? "strict" : "auto-cast"} · recall:{policy.memoryRecallBefore ?? "decision"}
          </span>
        </footer>
      ) : null}
    </div>
  );
}
