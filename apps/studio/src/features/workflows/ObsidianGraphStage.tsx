"use client";

import {
  Bot,
  Brain,
  Clock,
  Crosshair,
  GitFork,
  Link2,
  Maximize2,
  Minus,
  PauseCircle,
  Plus,
  RotateCcw,
  Search,
  Settings2,
  SlidersHorizontal,
  Sparkles,
  Users,
  Workflow,
  Wrench,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useWorkflowStore } from "@/stores/workflow-store";
import {
  formatLatency,
  NODE_META,
  type NodeExecutionLog,
  type NodeKind,
  type RawGraph,
  type RawGraphNode,
  type RunDetail,
  type SkillInfo,
} from "@/types";
import { GraphInspectorDrawer } from "./GraphInspectorDrawer";
import {
  type BezierGeometry,
  type CanvasRipple,
  computeEdgeBezier,
  DEFAULT_PHYSICS_PARAMS,
  distanceToBezier,
  drawNodeGlyph,
  type GraphLayoutMode,
  type PhysicsParams,
  pointOnQuadraticBezier,
  type SimNode,
  stepPhysics,
  syncSimNodes,
} from "./graph-physics";

interface ObsidianGraphStageProps {
  graph: RawGraph | null;
  runDetail: RunDetail | null;
  readOnly?: boolean;
  availableSkills?: Array<string | SkillInfo>;
  onEditGraph?: () => void;
  onForkSnapshot?: () => void;
}

const DOCK_NODES: Array<{ kind: NodeKind; label: string; icon: typeof Bot }> = [
  { kind: "agent", label: "Agent", icon: Bot },
  { kind: "subagent", label: "Subagent", icon: Users },
  { kind: "decision", label: "Decision", icon: GitFork },
  { kind: "tool", label: "Tool", icon: Wrench },
  { kind: "skill", label: "Skill", icon: Sparkles },
  { kind: "checkpoint", label: "Checkpoint", icon: PauseCircle },
  { kind: "memory", label: "Memory", icon: Brain },
];

interface DisplaySettings {
  showLabels: boolean;
  showConditions: boolean;
  showMetadata: boolean;
  showArrows: boolean;
  showParticles: boolean;
}

const DEFAULT_DISPLAY: DisplaySettings = {
  showLabels: true,
  showConditions: true,
  showMetadata: true,
  showArrows: true,
  showParticles: true,
};

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.max(0, Math.round(ms))}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function getNodeMetaLine(node: RawGraphNode, latency: string | null): string {
  const parts: string[] = [];
  if (typeof node.tier === "string" && node.tier) parts.push(node.tier);
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

export function ObsidianGraphStage({
  graph,
  runDetail,
  readOnly = false,
  availableSkills = [],
  onEditGraph,
  onForkSnapshot,
}: ObsidianGraphStageProps) {
  const selectedNodeId = useWorkflowStore((s) => s.selectedNodeId);
  const selectedEdgeId = useWorkflowStore((s) => s.selectedEdgeId);
  const selectNode = useWorkflowStore((s) => s.selectNode);
  const selectEdge = useWorkflowStore((s) => s.selectEdge);
  const addNode = useWorkflowStore((s) => s.addNode);
  const addEdge = useWorkflowStore((s) => s.addEdge);
  const removeNodes = useWorkflowStore((s) => s.removeNodes);
  const removeEdges = useWorkflowStore((s) => s.removeEdges);
  const setNodePositions = useWorkflowStore((s) => s.setNodePositions);
  const updateGraphMeta = useWorkflowStore((s) => s.updateGraphMeta);

  const [physics, setPhysics] = useState<PhysicsParams>(DEFAULT_PHYSICS_PARAMS);
  const [display, setDisplay] = useState<DisplaySettings>(DEFAULT_DISPLAY);
  const [controlsOpen, setControlsOpen] = useState(false);
  const [inspectorPinnedOpen, setInspectorPinnedOpen] = useState(false);
  const [connectMode, setConnectMode] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterKind, setFilterKind] = useState<NodeKind | null>(null);
  const [zoomPct, setZoomPct] = useState(100);
  const [cursorStyle, setCursorStyle] = useState<string>("grab");

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  // Simulation mutable refs for 60fps zero-re-render loop
  const simNodesRef = useRef<Map<string, SimNode>>(new Map());
  const ripplesRef = useRef<CanvasRipple[]>([]);
  const graphIdRef = useRef<string | null>(null);
  const edgeGeometriesRef = useRef<Map<string, BezierGeometry>>(new Map());

  // Camera state with smooth damped target interpolation
  const camRef = useRef({
    x: 0,
    y: 0,
    zoom: 1,
    targetX: 0,
    targetY: 0,
    targetZoom: 1,
  });

  // Pointer interaction state
  const pointerRef = useRef<{
    hoveredNodeId: string | null;
    hoveredEdgeId: string | null;
    hoveredLinkPortNodeId: string | null;
    draggedNodeId: string | null;
    dragMoved: boolean;
    dragOffsetX: number;
    dragOffsetY: number;
    lastWorldX: number;
    lastWorldY: number;
    isPanning: boolean;
    panStartScreenX: number;
    panStartScreenY: number;
    panStartCamX: number;
    panStartCamY: number;
    connectingFromId: string | null;
    connectCursorX: number;
    connectCursorY: number;
    connectSnapTargetId: string | null;
  }>({
    hoveredNodeId: null,
    hoveredEdgeId: null,
    hoveredLinkPortNodeId: null,
    draggedNodeId: null,
    dragMoved: false,
    dragOffsetX: 0,
    dragOffsetY: 0,
    lastWorldX: 0,
    lastWorldY: 0,
    isPanning: false,
    panStartScreenX: 0,
    panStartScreenY: 0,
    panStartCamX: 0,
    panStartCamY: 0,
    connectingFromId: null,
    connectCursorX: 0,
    connectCursorY: 0,
    connectSnapTargetId: null,
  });

  // Keep fresh reactive props in refs for the RAF loop
  const graphRef = useRef<RawGraph | null>(graph);
  graphRef.current = graph;
  const physicsRef = useRef(physics);
  physicsRef.current = physics;
  const displayRef = useRef(display);
  displayRef.current = display;
  const selectedNodeRef = useRef(selectedNodeId);
  selectedNodeRef.current = selectedNodeId;
  const selectedEdgeRef = useRef(selectedEdgeId);
  selectedEdgeRef.current = selectedEdgeId;
  const readOnlyRef = useRef(readOnly);
  readOnlyRef.current = readOnly;
  const connectModeRef = useRef(connectMode);
  connectModeRef.current = connectMode;
  const searchQueryRef = useRef(searchQuery);
  searchQueryRef.current = searchQuery;
  const filterKindRef = useRef(filterKind);
  filterKindRef.current = filterKind;

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

  const emitRipple = useCallback((x: number, y: number, color: string, maxRadius = 64) => {
    ripplesRef.current.push({ x, y, radius: 14, maxRadius, alpha: 0.72, color });
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
      minX = Math.min(minX, n.x - n.radius - 60);
      maxX = Math.max(maxX, n.x + n.radius + 60);
      minY = Math.min(minY, n.y - n.radius - 50);
      maxY = Math.max(maxY, n.y + n.radius + 70);
    }

    const width = Math.max(1, wrapper.clientWidth);
    const height = Math.max(1, wrapper.clientHeight);
    const spanX = Math.max(240, maxX - minX);
    const spanY = Math.max(200, maxY - minY);
    const nextZoom = Math.max(0.45, Math.min(1.35, Math.min((width * 0.82) / spanX, (height * 0.78) / spanY)));
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
    setZoomPct(Math.round(nextZoom * 100));
  }, []);

  const focusNode = useCallback(
    (nodeId: string) => {
      const n = simNodesRef.current.get(nodeId);
      if (!n) return;
      camRef.current.targetX = -n.x;
      camRef.current.targetY = -n.y;
      camRef.current.targetZoom = Math.max(camRef.current.targetZoom, 1.05);
      n.scaleVel += 0.12;
      const nodeData = graphRef.current?.nodes.find((item) => item.id === nodeId);
      emitRipple(n.x, n.y, nodeData ? NODE_META[nodeData.type].color : "#10b981", 68);
    },
    [emitRipple],
  );

  // Sync graph into physics simulation whenever graph changes
  useEffect(() => {
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
      // Pre-warm physics so the initial constellation opens poised and spacious
      for (let i = 0; i < 64; i++) {
        stepPhysics(synced, graph.edges, physicsRef.current, 0.016, {
          draggedNodeId: null,
          hoveredNodeId: null,
          selectedNodeId: null,
          focusedIds: null,
          activeNodeIds: activeNodeIdsRef.current,
        });
      }
      fitView(true);
    } else {
      // Trigger tactile ripple on any newly added node
      for (const n of graph.nodes) {
        if (!prevIds.has(n.id)) {
          const sim = synced.get(n.id);
          if (sim) {
            emitRipple(sim.x, sim.y, NODE_META[n.type].color, 76);
          }
        }
      }
    }
  }, [graph, fitView, emitRipple]);

  // Tactile re-heat helper
  const reheatPhysics = useCallback(() => {
    for (const n of simNodesRef.current.values()) {
      n.vx += (Math.random() - 0.5) * 7;
      n.vy += (Math.random() - 0.5) * 7;
    }
  }, []);

  // Coordinate transforms
  const screenToWorld = useCallback((clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const sx = clientX - rect.left;
    const sy = clientY - rect.top;
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    const cam = camRef.current;
    return {
      x: (sx - cx) / cam.zoom - cam.x,
      y: (sy - cy) / cam.zoom - cam.y,
    };
  }, []);

  const hitTestNode = useCallback((wx: number, wy: number): SimNode | null => {
    const nodes = Array.from(simNodesRef.current.values());
    for (let i = nodes.length - 1; i >= 0; i--) {
      const n = nodes[i];
      const hitRadius = n.radius * n.scale + 8;
      if (Math.hypot(wx - n.x, wy - n.y) <= hitRadius) {
        return n;
      }
    }
    return null;
  }, []);

  const hitTestLinkPort = useCallback((wx: number, wy: number): SimNode | null => {
    if (readOnlyRef.current) return null;
    const hoveredId = pointerRef.current.hoveredNodeId;
    if (!hoveredId) return null;
    const n = simNodesRef.current.get(hoveredId);
    if (!n) return null;
    const portX = n.x + n.radius * n.scale + 11;
    const portY = n.y;
    if (Math.hypot(wx - portX, wy - portY) <= 10) return n;
    return null;
  }, []);

  const hitTestEdge = useCallback((wx: number, wy: number): string | null => {
    let bestId: string | null = null;
    let bestDist = 11 / Math.max(0.5, camRef.current.zoom);
    for (const [edgeId, geom] of edgeGeometriesRef.current.entries()) {
      const d = distanceToBezier(wx, wy, geom);
      if (d < bestDist) {
        bestDist = d;
        bestId = edgeId;
      }
    }
    return bestId;
  }, []);

  // Keyboard shortcuts (Delete, Escape, Fit, Reheat)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isInput =
        target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT");
      if (isInput) return;

      if (e.key === "Escape") {
        pointerRef.current.connectingFromId = null;
        setConnectMode(false);
        setControlsOpen(false);
        setInspectorPinnedOpen(false);
        selectNode(null);
        selectEdge(null);
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
        return;
      }

      if (e.key.toLowerCase() === "f" && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        fitView(false);
      } else if (e.key.toLowerCase() === "r" && !e.metaKey && !e.ctrlKey) {
        reheatPhysics();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [fitView, reheatPhysics, removeEdges, removeNodes, selectEdge, selectNode, emitRipple]);

  // Main 60fps Physics + Canvas Renderer
  useEffect(() => {
    let rafId = 0;
    let lastTime = performance.now();

    const renderFrame = (now: number) => {
      const dtSec = (now - lastTime) / 1000;
      lastTime = now;

      const canvas = canvasRef.current;
      const wrapper = wrapperRef.current;
      const currentGraph = graphRef.current;

      if (canvas && wrapper && currentGraph) {
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
          const phys = physicsRef.current;
          const disp = displayRef.current;
          const selNodeId = selectedNodeRef.current;
          const selEdgeId = selectedEdgeRef.current;
          const query = searchQueryRef.current.trim().toLowerCase();
          const kindFilter = filterKindRef.current;

          // Compute Obsidian neighborhood spotlight focus set
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
            if (hoveredEdge) {
              focusedIds = new Set([hoveredEdge.source, hoveredEdge.target]);
            }
          } else if (query || kindFilter) {
            focusedIds = new Set();
            for (const n of currentGraph.nodes) {
              const matchesQuery =
                !query ||
                n.label.toLowerCase().includes(query) ||
                n.id.toLowerCase().includes(query) ||
                n.type.toLowerCase().includes(query);
              const matchesKind = !kindFilter || n.type === kindFilter;
              if (matchesQuery && matchesKind) focusedIds.add(n.id);
            }
          }

          // Advance physics simulation
          stepPhysics(simNodes, currentGraph.edges, phys, dtSec, {
            draggedNodeId: ptr.draggedNodeId,
            hoveredNodeId: ptr.hoveredNodeId,
            selectedNodeId: selNodeId,
            focusedIds,
            activeNodeIds: activeNodeIdsRef.current,
          });

          // Smooth camera interpolation
          const camLerp = Math.min(1, dtSec * 11);
          cam.x += (cam.targetX - cam.x) * camLerp;
          cam.y += (cam.targetY - cam.y) * camLerp;
          cam.zoom += (cam.targetZoom - cam.zoom) * camLerp;

          // Clear canvas
          ctx.save();
          ctx.scale(dpr, dpr);
          ctx.fillStyle = "#09090b";
          ctx.fillRect(0, 0, width, height);

          // Subtle Obsidian dot matrix backdrop in world space
          const dotSpacing = 32;
          const scaledSpacing = dotSpacing * cam.zoom;
          if (scaledSpacing >= 12) {
            const dotAlpha = Math.min(0.24, Math.max(0.05, (scaledSpacing - 12) / 90));
            ctx.fillStyle = `rgba(161, 161, 170, ${dotAlpha})`;
            const offsetX = (((width / 2 + cam.x * cam.zoom) % scaledSpacing) + scaledSpacing) % scaledSpacing;
            const offsetY = (((height / 2 + cam.y * cam.zoom) % scaledSpacing) + scaledSpacing) % scaledSpacing;
            for (let x = offsetX; x < width; x += scaledSpacing) {
              for (let y = offsetY; y < height; y += scaledSpacing) {
                ctx.fillRect(x - 0.5, y - 0.5, 1.2, 1.2);
              }
            }
          }

          // Enter world coordinate space
          ctx.save();
          ctx.translate(width / 2, height / 2);
          ctx.scale(cam.zoom, cam.zoom);
          ctx.translate(cam.x, cam.y);

          // Update and draw expanding tactile ripples
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

          // Build reverse-edge lookup and vertical centroid for clean loop-back curves
          const edgePairs = new Set(currentGraph.edges.map((e) => `${e.source}->${e.target}`));
          const nextGeoms = new Map<string, BezierGeometry>();
          let graphCenterY = 0;
          if (simNodes.size > 0) {
            for (const n of simNodes.values()) graphCenterY += n.y;
            graphCenterY /= simNodes.size;
          }

          // Draw Edges
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

            const baseAlpha = Math.min(src.alpha, tgt.alpha);
            const edgeAlpha =
              isEdgeSelected || isEdgeHovered ? 1 : isConnectedToSpotlight ? Math.max(0.45, baseAlpha) : 0.1;

            let strokeColor = "#3f3f46";
            let strokeWidth = 1.35;
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
            } else if (spotlightId && isConnectedToSpotlight) {
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

            // Directional arrowhead
            if (disp.showArrows) {
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
            }

            // Animated flow photon on highlighted, loop, or live edges
            if (
              disp.showParticles &&
              (isSrcActive || isTgtActive || isEdgeSelected || isEdgeHovered || (spotlightId && isConnectedToSpotlight))
            ) {
              const speed = isSrcActive || isTgtActive ? 0.65 : 0.34;
              const phase = (timeSec * speed + (edge.id.charCodeAt(edge.id.length - 1) % 7) * 0.17) % 1;
              const pt = pointOnQuadraticBezier(geom, phase);
              ctx.beginPath();
              ctx.arc(pt.x, pt.y, isSrcActive || isTgtActive ? 3.2 : 2.3, 0, Math.PI * 2);
              ctx.fillStyle = isSrcActive || isTgtActive ? "#38bdf8" : geom.isLoop ? "#f59e0b" : "#fafafa";
              ctx.fill();
            }

            // Condition pill at curve midpoint
            if (disp.showConditions && edge.condition) {
              ctx.font = '500 10px "JetBrains Mono", ui-monospace, monospace';
              const textW = ctx.measureText(edge.condition).width;
              const pillW = textW + 12;
              const pillH = 18;
              ctx.fillStyle = "#111114";
              ctx.strokeStyle = isEdgeSelected ? "#10b981" : geom.isLoop ? "rgba(245, 158, 11, 0.65)" : "#27272a";
              ctx.lineWidth = 1;
              ctx.beginPath();
              ctx.roundRect(geom.midX - pillW / 2, geom.midY - pillH / 2, pillW, pillH, 9);
              ctx.fill();
              ctx.stroke();

              ctx.fillStyle = geom.isLoop ? "#f59e0b" : isEdgeSelected ? "#10b981" : "#a1a1aa";
              ctx.textAlign = "center";
              ctx.textBaseline = "middle";
              ctx.fillText(edge.condition, geom.midX, geom.midY + 0.5);
            }
            ctx.restore();
          }
          edgeGeometriesRef.current = nextGeoms;

          // Draw live elastic connection wire when linking two nodes
          if (ptr.connectingFromId) {
            const fromSim = simNodes.get(ptr.connectingFromId);
            if (fromSim) {
              const snapSim = ptr.connectSnapTargetId ? simNodes.get(ptr.connectSnapTargetId) : null;
              const tx = snapSim ? snapSim.x : ptr.connectCursorX;
              const ty = snapSim ? snapSim.y : ptr.connectCursorY;
              const cx = (fromSim.x + tx) / 2;
              const cy = (fromSim.y + ty) / 2 - 22;

              ctx.save();
              ctx.beginPath();
              ctx.moveTo(fromSim.x, fromSim.y);
              ctx.quadraticCurveTo(cx, cy, tx, ty);
              ctx.strokeStyle = snapSim ? "#10b981" : "#38bdf8";
              ctx.lineWidth = 2;
              ctx.setLineDash([6, 4]);
              ctx.stroke();
              ctx.setLineDash([]);

              if (snapSim) {
                ctx.beginPath();
                ctx.arc(snapSim.x, snapSim.y, snapSim.radius * snapSim.scale + 9, 0, Math.PI * 2);
                ctx.strokeStyle = "rgba(16, 185, 129, 0.85)";
                ctx.lineWidth = 2;
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
            const r = sim.radius * sim.scale;

            ctx.save();
            ctx.globalAlpha = sim.alpha;

            // Subtle ambient radial halo on focus/active
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

            // Entry orbit dashed ring
            if (isEntry) {
              ctx.beginPath();
              ctx.arc(sim.x, sim.y, r + 5.5, 0, Math.PI * 2);
              ctx.strokeStyle = "rgba(16, 185, 129, 0.45)";
              ctx.lineWidth = 1;
              ctx.setLineDash([3, 3]);
              ctx.stroke();
              ctx.setLineDash([]);
            }

            // Live running orbiting arc
            if (status === "running") {
              const spin = timeSec * 2.6;
              ctx.beginPath();
              ctx.arc(sim.x, sim.y, r + 5, spin, spin + Math.PI * 1.15);
              ctx.strokeStyle = "#38bdf8";
              ctx.lineWidth = 2;
              ctx.lineCap = "round";
              ctx.stroke();
            }

            // Matte obsidian node body
            ctx.beginPath();
            ctx.arc(sim.x, sim.y, r, 0, Math.PI * 2);
            ctx.fillStyle = isSelected || isHovered ? "#18181c" : "#111114";
            ctx.fill();

            // Crisp perimeter ring
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

            // Subtle inner highlight rim
            ctx.beginPath();
            ctx.arc(sim.x, sim.y, Math.max(2, r - 2.5), 0, Math.PI * 2);
            ctx.strokeStyle = "rgba(255, 255, 255, 0.05)";
            ctx.lineWidth = 1;
            ctx.stroke();

            // Vector icon glyph
            drawNodeGlyph(ctx, node.type, sim.x, sim.y, r * 0.95, isSelected || isHovered ? "#fafafa" : meta.color);

            // Status corner dot for completed / failed / checkpoint
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

            // Tactile link port on right rim when hovered in edit mode
            if (!readOnlyRef.current && isHovered && !ptr.draggedNodeId && !ptr.connectingFromId) {
              const portX = sim.x + r + 11;
              const portY = sim.y;
              const portHovered = ptr.hoveredLinkPortNodeId === node.id;
              ctx.beginPath();
              ctx.arc(portX, portY, portHovered ? 7.5 : 6.5, 0, Math.PI * 2);
              ctx.fillStyle = portHovered ? "#10b981" : "#18181c";
              ctx.fill();
              ctx.strokeStyle = portHovered ? "#10b981" : "#52525b";
              ctx.lineWidth = 1.25;
              ctx.stroke();

              // Tiny '+' glyph inside port
              ctx.beginPath();
              ctx.moveTo(portX - 2.8, portY);
              ctx.lineTo(portX + 2.8, portY);
              ctx.moveTo(portX, portY - 2.8);
              ctx.lineTo(portX, portY + 2.8);
              ctx.strokeStyle = portHovered ? "#09090b" : "#fafafa";
              ctx.lineWidth = 1.4;
              ctx.stroke();
            }

            // Label & metadata anchored beneath node orb
            if (disp.showLabels && (cam.zoom >= 0.42 || isHovered || isSelected)) {
              const labelY = sim.y + r + 14;
              const label = node.label || node.id;
              ctx.font = `${isSelected || isHovered ? "600" : "500"} 12px Inter, system-ui, sans-serif`;
              ctx.textAlign = "center";
              ctx.textBaseline = "middle";

              // Clean dark backing pill so edges never cut through text characters
              const tw = ctx.measureText(label).width;
              ctx.fillStyle = isHovered || isSelected ? "rgba(9, 9, 11, 0.92)" : "rgba(9, 9, 11, 0.74)";
              ctx.beginPath();
              ctx.roundRect(sim.x - tw / 2 - 6, labelY - 9, tw + 12, 18, 5);
              ctx.fill();

              ctx.fillStyle = isSelected || isHovered ? "#fafafa" : "#e4e4e7";
              ctx.fillText(label, sim.x, labelY);

              // Secondary mono metadata (tier · queue · latency)
              if (disp.showMetadata && (cam.zoom >= 0.82 || isHovered || isSelected)) {
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

  // Pointer handlers on canvas
  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const { x: wx, y: wy } = screenToWorld(e.clientX, e.clientY);
    const ptr = pointerRef.current;

    // 1. Check link port first
    const portNode = hitTestLinkPort(wx, wy);
    if (portNode && !readOnly) {
      ptr.connectingFromId = portNode.id;
      ptr.connectCursorX = wx;
      ptr.connectCursorY = wy;
      ptr.connectSnapTargetId = null;
      setCursorStyle("crosshair");
      return;
    }

    // 2. Check node hit
    const hitNode = hitTestNode(wx, wy);
    if (hitNode) {
      if (!readOnly && (e.shiftKey || connectModeRef.current)) {
        ptr.connectingFromId = hitNode.id;
        ptr.connectCursorX = wx;
        ptr.connectCursorY = wy;
        ptr.connectSnapTargetId = null;
        setCursorStyle("crosshair");
        return;
      }

      ptr.draggedNodeId = hitNode.id;
      ptr.dragMoved = false;
      ptr.dragOffsetX = hitNode.x - wx;
      ptr.dragOffsetY = hitNode.y - wy;
      ptr.lastWorldX = wx;
      ptr.lastWorldY = wy;
      hitNode.vx = 0;
      hitNode.vy = 0;
      setCursorStyle("grabbing");
      return;
    }

    // 3. Check edge hit
    const hitEdgeId = hitTestEdge(wx, wy);
    if (hitEdgeId) {
      selectEdge(hitEdgeId);
      setInspectorPinnedOpen(true);
      return;
    }

    // 4. Pan canvas
    ptr.isPanning = true;
    ptr.dragMoved = false;
    ptr.panStartScreenX = e.clientX;
    ptr.panStartScreenY = e.clientY;
    ptr.panStartCamX = camRef.current.targetX;
    ptr.panStartCamY = camRef.current.targetY;
    setCursorStyle("grabbing");
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const { x: wx, y: wy } = screenToWorld(e.clientX, e.clientY);
    const ptr = pointerRef.current;

    if (ptr.connectingFromId) {
      ptr.connectCursorX = wx;
      ptr.connectCursorY = wy;
      const candidate = hitTestNode(wx, wy);
      ptr.connectSnapTargetId = candidate && candidate.id !== ptr.connectingFromId ? candidate.id : null;
      return;
    }

    if (ptr.draggedNodeId) {
      const node = simNodesRef.current.get(ptr.draggedNodeId);
      if (node) {
        const nextX = wx + ptr.dragOffsetX;
        const nextY = wy + ptr.dragOffsetY;
        const dx = wx - ptr.lastWorldX;
        const dy = wy - ptr.lastWorldY;
        if (Math.hypot(dx, dy) > 1.5) ptr.dragMoved = true;
        node.vx = dx * 0.45;
        node.vy = dy * 0.45;
        node.x = nextX;
        node.y = nextY;
        ptr.lastWorldX = wx;
        ptr.lastWorldY = wy;
      }
      return;
    }

    if (ptr.isPanning) {
      const dx = e.clientX - ptr.panStartScreenX;
      const dy = e.clientY - ptr.panStartScreenY;
      if (Math.hypot(dx, dy) > 3) ptr.dragMoved = true;
      const cam = camRef.current;
      cam.targetX = ptr.panStartCamX + dx / cam.zoom;
      cam.targetY = ptr.panStartCamY + dy / cam.zoom;
      cam.x = cam.targetX;
      cam.y = cam.targetY;
      return;
    }

    // Hover detection
    const portNode = hitTestLinkPort(wx, wy);
    if (portNode) {
      ptr.hoveredLinkPortNodeId = portNode.id;
      ptr.hoveredNodeId = portNode.id;
      ptr.hoveredEdgeId = null;
      setCursorStyle("crosshair");
      return;
    }
    ptr.hoveredLinkPortNodeId = null;

    const hitNode = hitTestNode(wx, wy);
    if (hitNode) {
      ptr.hoveredNodeId = hitNode.id;
      ptr.hoveredEdgeId = null;
      setCursorStyle(connectModeRef.current ? "crosshair" : "pointer");
      return;
    }

    ptr.hoveredNodeId = null;
    const hitEdge = hitTestEdge(wx, wy);
    ptr.hoveredEdgeId = hitEdge;
    setCursorStyle(hitEdge ? "pointer" : "grab");
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    const ptr = pointerRef.current;

    if (ptr.connectingFromId) {
      if (ptr.connectSnapTargetId && !readOnly) {
        addEdge(ptr.connectingFromId, ptr.connectSnapTargetId);
        const tgt = simNodesRef.current.get(ptr.connectSnapTargetId);
        if (tgt) {
          tgt.scaleVel += 0.14;
          emitRipple(tgt.x, tgt.y, "#10b981", 68);
        }
        setInspectorPinnedOpen(true);
      }
      ptr.connectingFromId = null;
      ptr.connectSnapTargetId = null;
      setCursorStyle(connectModeRef.current ? "crosshair" : "grab");
      return;
    }

    if (ptr.draggedNodeId) {
      const draggedId = ptr.draggedNodeId;
      const moved = ptr.dragMoved;
      ptr.draggedNodeId = null;

      if (!moved) {
        selectNode(draggedId);
        setInspectorPinnedOpen(true);
        const sim = simNodesRef.current.get(draggedId);
        const nodeData = graphRef.current?.nodes.find((n) => n.id === draggedId);
        if (sim) {
          sim.scaleVel += 0.11;
          emitRipple(sim.x, sim.y, nodeData ? NODE_META[nodeData.type].color : "#10b981", 58);
        }
      } else if (!readOnly) {
        // Persist updated coordinates into workflow store without disturbing physics
        const updates = Array.from(simNodesRef.current.values()).map((n) => ({
          id: n.id,
          position: { x: Math.round(n.x), y: Math.round(n.y) },
        }));
        setNodePositions(updates);
      }
      setCursorStyle("pointer");
      return;
    }

    if (ptr.isPanning) {
      const moved = ptr.dragMoved;
      ptr.isPanning = false;
      if (!moved) {
        selectNode(null);
        selectEdge(null);
        setInspectorPinnedOpen(false);
      }
      setCursorStyle("grab");
    }
  };

  const handleDoubleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (readOnly || !graph) return;
    const { x: wx, y: wy } = screenToWorld(e.clientX, e.clientY);
    const hit = hitTestNode(wx, wy);
    if (hit) {
      focusNode(hit.id);
      return;
    }
    const created = addNode("agent", { position: { x: wx, y: wy } });
    if (created) {
      setInspectorPinnedOpen(true);
    }
  };

  // Native non-passive wheel listener for smooth cursor-anchored zoom without console warnings
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left - rect.width / 2;
      const sy = e.clientY - rect.top - rect.height / 2;

      const cam = camRef.current;
      const zoomFactor = Math.exp(-e.deltaY * 0.0014);
      const nextZoom = Math.max(0.28, Math.min(2.6, cam.targetZoom * zoomFactor));

      const worldBeforeX = sx / cam.targetZoom - cam.targetX;
      const worldBeforeY = sy / cam.targetZoom - cam.targetY;
      cam.targetZoom = nextZoom;
      cam.targetX = sx / nextZoom - worldBeforeX;
      cam.targetY = sy / nextZoom - worldBeforeY;
      setZoomPct(Math.round(nextZoom * 100));
    };

    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, []);

  const handleSpawnNodeFromDock = (kind: NodeKind) => {
    if (readOnly || !graph) return;
    const selectedSim = selectedNodeId ? simNodesRef.current.get(selectedNodeId) : null;
    const cam = camRef.current;
    const spawnPos = selectedSim
      ? {
          x: selectedSim.x + 150 + (Math.random() - 0.5) * 36,
          y: selectedSim.y + (Math.random() - 0.5) * 90,
        }
      : {
          x: -cam.targetX + (Math.random() - 0.5) * 70,
          y: -cam.targetY + (Math.random() - 0.5) * 70,
        };

    const created = addNode(kind, {
      position: spawnPos,
      connectFromId: selectedSim ? selectedSim.id : undefined,
    });
    if (created) {
      setInspectorPinnedOpen(true);
    }
  };

  const adjustZoom = (factor: number) => {
    const nextZoom = Math.max(0.28, Math.min(2.6, camRef.current.targetZoom * factor));
    camRef.current.targetZoom = nextZoom;
    setZoomPct(Math.round(nextZoom * 100));
  };

  const setLayoutMode = (mode: GraphLayoutMode) => {
    setPhysics((prev) => ({ ...prev, layoutMode: mode }));
    reheatPhysics();
  };

  const kindCounts = useMemo(() => {
    const map = new Map<NodeKind, number>();
    for (const n of graph?.nodes ?? []) {
      map.set(n.type, (map.get(n.type) ?? 0) + 1);
    }
    return map;
  }, [graph]);

  if (!graph) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-canvas text-center">
        <div className="text-[14px] font-medium text-text-primary">No workflow selected</div>
        <p className="max-w-xs text-[12px] text-text-secondary">
          Choose a workflow from the sidebar or create a new graph to open the physics canvas.
        </p>
      </div>
    );
  }

  const totalRunMs =
    runDetail?.createdAt && runDetail?.updatedAt
      ? new Date(runDetail.updatedAt).getTime() - new Date(runDetail.createdAt).getTime()
      : null;

  const doneCount = runDetail?.history.filter((l) => l.status === "done").length ?? 0;
  const failedCount = runDetail?.history.filter((l) => l.status === "failed").length ?? 0;
  const drawerOpen = inspectorPinnedOpen || Boolean(selectedNodeId || selectedEdgeId);

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-canvas">
      {/* Compact Precision Header */}
      <header className="flex h-11 shrink-0 items-center justify-between gap-3 border-b border-border-subtle bg-surface px-4">
        <div className="flex min-w-0 items-center gap-2.5">
          {readOnly ? (
            <h2 className="truncate text-[13px] font-semibold text-text-primary">{graph.name}</h2>
          ) : (
            <input
              aria-label="Workflow name"
              value={graph.name}
              onChange={(e) => updateGraphMeta({ name: e.target.value })}
              className="w-[260px] max-w-[380px] truncate rounded px-1.5 py-0.5 text-[13px] font-semibold text-text-primary bg-transparent hover:bg-elevated focus:bg-canvas focus:outline-none focus:ring-1 focus:ring-accent"
            />
          )}

          <span className="shrink-0 font-mono text-[11px] text-text-muted tabular-nums">
            {graph.nodes.length} nodes · {graph.edges.length} links
          </span>

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
                {doneCount}/{graph.nodes.length} done
                {failedCount > 0 ? ` · ${failedCount} failed` : ""}
              </span>
            </div>
          ) : null}
        </div>

        {/* Right Controls */}
        <div className="flex shrink-0 items-center gap-1.5">
          {/* Layout Mode Segmented Switch */}
          <div className="flex items-center rounded-md border border-border-subtle bg-canvas p-0.5">
            <button
              type="button"
              onClick={() => setLayoutMode("physics")}
              className={cn(
                "flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-medium transition-colors",
                physics.layoutMode === "physics"
                  ? "bg-elevated text-text-primary"
                  : "text-text-muted hover:text-text-secondary",
              )}
            >
              <Crosshair className="h-3 w-3" />
              Physics
            </button>
            <button
              type="button"
              onClick={() => setLayoutMode("flow")}
              className={cn(
                "flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-medium transition-colors",
                physics.layoutMode === "flow"
                  ? "bg-elevated text-text-primary"
                  : "text-text-muted hover:text-text-secondary",
              )}
            >
              <Workflow className="h-3 w-3" />
              Flow
            </button>
          </div>

          <Button variant="ghost" size="xs" onClick={() => fitView(false)} title="Fit graph (F)">
            <Maximize2 className="h-3 w-3" />
            <span className="hidden sm:inline">Fit</span>
          </Button>

          <Button
            variant={controlsOpen ? "secondary" : "ghost"}
            size="xs"
            onClick={() => setControlsOpen((v) => !v)}
            title="Graph physics and display settings"
          >
            <SlidersHorizontal className="h-3 w-3" />
            <span className="hidden sm:inline">Graph</span>
          </Button>

          {!readOnly ? (
            <Button
              variant={drawerOpen && !selectedNodeId && !selectedEdgeId ? "secondary" : "ghost"}
              size="xs"
              onClick={() => {
                if (drawerOpen && !selectedNodeId && !selectedEdgeId) {
                  setInspectorPinnedOpen(false);
                } else {
                  selectNode(null);
                  selectEdge(null);
                  setInspectorPinnedOpen(true);
                }
              }}
              title="Workflow settings"
            >
              <Settings2 className="h-3 w-3" />
            </Button>
          ) : null}

          {readOnly ? (
            <>
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
          ) : null}
        </div>
      </header>

      {/* Main Split: Interactive Physics Canvas + Slide-Over Inspector */}
      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        <div ref={wrapperRef} className="relative min-w-0 flex-1 overflow-hidden select-none">
          <canvas
            ref={canvasRef}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            onDoubleClick={handleDoubleClick}
            style={{ cursor: cursorStyle }}
            className="block h-full w-full touch-none"
          />

          {/* Collapsible Obsidian Graph Controls Panel (Top-Right) */}
          {controlsOpen ? (
            <div className="absolute right-3 top-3 z-20 w-[264px] rounded-xl border border-border-strong bg-surface/95 p-3 shadow-[0_12px_32px_rgba(0,0,0,0.55)] backdrop-blur-sm">
              <div className="mb-2.5 flex items-center justify-between">
                <span className="text-[12px] font-semibold text-text-primary">Graph Controls</span>
                <button
                  type="button"
                  onClick={() => setControlsOpen(false)}
                  className="rounded p-0.5 text-text-muted hover:bg-elevated hover:text-text-primary"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>

              {/* Filter Search */}
              <div className="relative mb-3">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" />
                <Input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Filter nodes..."
                  className="h-7 pl-8 pr-7 text-[11px]"
                />
                {searchQuery ? (
                  <button
                    type="button"
                    onClick={() => setSearchQuery("")}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary"
                  >
                    <X className="h-3 w-3" />
                  </button>
                ) : null}
              </div>

              {/* Node Type Groups */}
              <div className="mb-3 space-y-1.5 border-b border-border-subtle pb-3">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-medium uppercase tracking-wider text-text-muted">Groups</span>
                  {filterKind ? (
                    <button
                      type="button"
                      onClick={() => setFilterKind(null)}
                      className="text-[10px] text-accent hover:underline"
                    >
                      Clear
                    </button>
                  ) : null}
                </div>
                <div className="flex flex-wrap gap-1">
                  {DOCK_NODES.filter((item) => (kindCounts.get(item.kind) ?? 0) > 0).map((item) => {
                    const active = filterKind === item.kind;
                    return (
                      <button
                        key={item.kind}
                        type="button"
                        onClick={() => setFilterKind(active ? null : item.kind)}
                        className={cn(
                          "flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-medium transition-colors",
                          active
                            ? "border-accent/60 bg-accent/15 text-text-primary"
                            : "border-border-subtle bg-canvas text-text-secondary hover:border-border-strong",
                        )}
                      >
                        <span
                          className="h-1.5 w-1.5 rounded-full"
                          style={{ backgroundColor: NODE_META[item.kind].color }}
                        />
                        <span>{item.label}</span>
                        <span className="font-mono text-[9px] text-text-muted">{kindCounts.get(item.kind)}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Display Toggles */}
              <div className="mb-3 space-y-1.5 border-b border-border-subtle pb-3">
                <span className="block text-[10px] font-medium uppercase tracking-wider text-text-muted">Display</span>
                <div className="grid grid-cols-2 gap-1.5">
                  {(
                    [
                      ["showLabels", "Labels"],
                      ["showConditions", "Conditions"],
                      ["showMetadata", "Metadata"],
                      ["showArrows", "Arrows"],
                      ["showParticles", "Flow Pulse"],
                    ] as const
                  ).map(([key, label]) => (
                    <label
                      key={key}
                      className="flex cursor-pointer items-center gap-1.5 text-[11px] text-text-secondary hover:text-text-primary"
                    >
                      <input
                        type="checkbox"
                        checked={display[key]}
                        onChange={(e) => setDisplay((prev) => ({ ...prev, [key]: e.target.checked }))}
                        className="accent-emerald-500"
                      />
                      <span>{label}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Physics Force Sliders */}
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-medium uppercase tracking-wider text-text-muted">Forces</span>
                  <button
                    type="button"
                    onClick={() => {
                      setPhysics(DEFAULT_PHYSICS_PARAMS);
                      reheatPhysics();
                    }}
                    className="flex items-center gap-1 text-[10px] text-text-muted hover:text-text-primary"
                  >
                    <RotateCcw className="h-2.5 w-2.5" />
                    Reset
                  </button>
                </div>

                <div className="space-y-1">
                  <div className="flex justify-between font-mono text-[10px] text-text-secondary">
                    <span>Repulsion</span>
                    <span className="tabular-nums text-text-muted">{physics.repelStrength}</span>
                  </div>
                  <input
                    type="range"
                    min={1200}
                    max={12000}
                    step={200}
                    value={physics.repelStrength}
                    onChange={(e) => setPhysics((p) => ({ ...p, repelStrength: Number(e.target.value) }))}
                    className="h-1 w-full cursor-pointer accent-emerald-500"
                  />
                </div>

                <div className="space-y-1">
                  <div className="flex justify-between font-mono text-[10px] text-text-secondary">
                    <span>Link Distance</span>
                    <span className="tabular-nums text-text-muted">{physics.linkDistance}px</span>
                  </div>
                  <input
                    type="range"
                    min={100}
                    max={300}
                    step={5}
                    value={physics.linkDistance}
                    onChange={(e) => setPhysics((p) => ({ ...p, linkDistance: Number(e.target.value) }))}
                    className="h-1 w-full cursor-pointer accent-emerald-500"
                  />
                </div>

                <div className="space-y-1">
                  <div className="flex justify-between font-mono text-[10px] text-text-secondary">
                    <span>Link Tension</span>
                    <span className="tabular-nums text-text-muted">{physics.linkStrength.toFixed(3)}</span>
                  </div>
                  <input
                    type="range"
                    min={0.015}
                    max={0.16}
                    step={0.005}
                    value={physics.linkStrength}
                    onChange={(e) => setPhysics((p) => ({ ...p, linkStrength: Number(e.target.value) }))}
                    className="h-1 w-full cursor-pointer accent-emerald-500"
                  />
                </div>

                <div className="space-y-1">
                  <div className="flex justify-between font-mono text-[10px] text-text-secondary">
                    <span>Center Gravity</span>
                    <span className="tabular-nums text-text-muted">{physics.centerStrength.toFixed(3)}</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={0.06}
                    step={0.002}
                    value={physics.centerStrength}
                    onChange={(e) => setPhysics((p) => ({ ...p, centerStrength: Number(e.target.value) }))}
                    className="h-1 w-full cursor-pointer accent-emerald-500"
                  />
                </div>
              </div>
            </div>
          ) : null}

          {/* Bottom-Left Compact Zoom Pill */}
          <div className="absolute bottom-3 left-3 z-10 flex items-center gap-0.5 rounded-lg border border-border-subtle bg-surface/90 p-1">
            <button
              type="button"
              onClick={() => adjustZoom(0.84)}
              title="Zoom out"
              className="flex h-6 w-6 items-center justify-center rounded text-text-secondary hover:bg-elevated hover:text-text-primary"
            >
              <Minus className="h-3 w-3" />
            </button>
            <button
              type="button"
              onClick={() => fitView(false)}
              title="Fit graph (F)"
              className="min-w-[44px] rounded px-1.5 py-0.5 font-mono text-[10px] text-text-secondary tabular-nums hover:bg-elevated hover:text-text-primary"
            >
              {zoomPct}%
            </button>
            <button
              type="button"
              onClick={() => adjustZoom(1.18)}
              title="Zoom in"
              className="flex h-6 w-6 items-center justify-center rounded text-text-secondary hover:bg-elevated hover:text-text-primary"
            >
              <Plus className="h-3 w-3" />
            </button>
          </div>

          {/* Bottom-Center Tactile Add-Node & Connect Dock */}
          {!readOnly ? (
            <div className="absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1 rounded-xl border border-border-strong bg-surface/95 p-1.5 shadow-[0_12px_32px_rgba(0,0,0,0.55)]">
              {DOCK_NODES.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.kind}
                    type="button"
                    onClick={() => handleSpawnNodeFromDock(item.kind)}
                    title={`Add ${item.label}: ${NODE_META[item.kind].hint}`}
                    className="flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium text-text-secondary transition-colors duration-150 hover:bg-elevated hover:text-text-primary active:scale-95"
                  >
                    <Icon className="h-3.5 w-3.5" style={{ color: NODE_META[item.kind].color }} />
                    <span className="hidden xl:inline">{item.label}</span>
                  </button>
                );
              })}

              <div className="mx-0.5 h-4 w-px bg-border-subtle" />

              <button
                type="button"
                onClick={() => setConnectMode((v) => !v)}
                title="Drag between nodes to link (or hold Shift + Drag)"
                className={cn(
                  "flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium transition-colors duration-150",
                  connectMode
                    ? "bg-accent/15 text-accent"
                    : "text-text-secondary hover:bg-elevated hover:text-text-primary",
                )}
              >
                <Link2 className="h-3.5 w-3.5" />
                <span className="hidden lg:inline">Link</span>
              </button>
            </div>
          ) : null}
        </div>

        {/* Right Slide-Over Inspector Drawer */}
        <GraphInspectorDrawer
          graph={graph}
          runDetail={runDetail}
          readOnly={readOnly}
          availableSkills={availableSkills}
          open={drawerOpen}
          onClose={() => {
            setInspectorPinnedOpen(false);
            selectNode(null);
            selectEdge(null);
          }}
          onFocusNode={focusNode}
        />
      </div>
    </div>
  );
}
