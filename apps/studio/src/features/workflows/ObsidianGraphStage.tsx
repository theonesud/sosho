"use client";

import { Clock, LayoutGrid, Plus, Redo2, Undo2 } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
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
import { AnchoredEdgePopover, AnchoredNodePicker, AnchoredNodePopover } from "./AnchoredNodePopover";
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
  availableSkills?: Array<string | SkillInfo>;
  onEditGraph?: () => void;
  onForkSnapshot?: () => void;
}

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
  isLoading = false,
  readOnly = false,
  availableSkills = [],
  onEditGraph,
  onForkSnapshot,
}: ObsidianGraphStageProps) {
  const selectedNodeId = useWorkflowStore((s) => s.selectedNodeId);
  const selectedEdgeId = useWorkflowStore((s) => s.selectedEdgeId);
  const canUndo = useWorkflowStore((s) => s.past.length > 0);
  const canRedo = useWorkflowStore((s) => s.future.length > 0);
  const selectNode = useWorkflowStore((s) => s.selectNode);
  const selectEdge = useWorkflowStore((s) => s.selectEdge);
  const addNode = useWorkflowStore((s) => s.addNode);
  const addEdge = useWorkflowStore((s) => s.addEdge);
  const removeNodes = useWorkflowStore((s) => s.removeNodes);
  const removeEdges = useWorkflowStore((s) => s.removeEdges);
  const setNodePositions = useWorkflowStore((s) => s.setNodePositions);
  const undo = useWorkflowStore((s) => s.undo);
  const redo = useWorkflowStore((s) => s.redo);

  const [cursorStyle, setCursorStyle] = useState<string>("default");
  const [canvasBounds, setCanvasBounds] = useState<{ width: number; height: number }>({ width: 960, height: 640 });
  const [pickerAnchor, setPickerAnchor] = useState<{
    connectFromId?: string;
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
    draggedNodeId: string | null;
    dragMoved: boolean;
    dragOffsetX: number;
    dragOffsetY: number;
    portDownNodeId: string | null;
    portDownScreenX: number;
    portDownScreenY: number;
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
    portDownNodeId: null,
    portDownScreenX: 0,
    portDownScreenY: 0,
    connectingFromId: null,
    connectCursorX: 0,
    connectCursorY: 0,
    connectSnapTargetId: null,
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

  // Synchronously sync simulation before browser paint so graph switches never flicker
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

  // Update popover anchor when selection changes
  useEffect(() => {
    if (selectedNodeId) {
      const sim = simNodesRef.current.get(selectedNodeId);
      if (sim) setPopoverAnchor(worldToScreen(sim.x, sim.y));
    } else if (selectedEdgeId) {
      const geom = edgeGeometriesRef.current.get(selectedEdgeId);
      if (geom) setPopoverAnchor(worldToScreen(geom.midX, geom.midY));
    }
  }, [selectedNodeId, selectedEdgeId, worldToScreen]);

  // Keep canvas fitted cleanly when viewport dimensions change
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

  const hitTestLinkPort = useCallback((wx: number, wy: number): SimNode | null => {
    if (readOnlyRef.current) return null;
    const candidateId = pointerRef.current.hoveredNodeId ?? selectedNodeRef.current;
    if (!candidateId) return null;
    const n = simNodesRef.current.get(candidateId);
    if (!n) return null;
    const portX = n.x + n.radius * n.scale + 12;
    const portY = n.y;
    if (Math.hypot(wx - portX, wy - portY) <= 11) return n;
    return null;
  }, []);

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

  // Keyboard shortcuts (Undo, Redo, Delete, Escape)
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
        pointerRef.current.portDownNodeId = null;
        setPickerAnchor(null);
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
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [undo, redo, removeEdges, removeNodes, selectEdge, selectNode, emitRipple]);

  // Auto-arrange all nodes back to clean topological Flow columns
  const handleAutoArrange = useCallback(() => {
    if (readOnly) return;
    const updates: Array<{ id: string; position: { x: number; y: number } }> = [];
    for (const sim of simNodesRef.current.values()) {
      sim.anchorX = sim.flowAnchorX;
      sim.anchorY = sim.flowAnchorY;
      updates.push({ id: sim.id, position: { x: Math.round(sim.flowAnchorX), y: Math.round(sim.flowAnchorY) } });
    }
    if (updates.length > 0) setNodePositions(updates);
    fitView(false);
  }, [readOnly, setNodePositions, fitView]);

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
          const selNodeId = selectedNodeRef.current;
          const selEdgeId = selectedEdgeRef.current;

          // Obsidian neighborhood spotlight
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

          // Smooth auto-fit camera interpolation
          const camLerp = Math.min(1, dtSec * 9);
          cam.x += (cam.targetX - cam.x) * camLerp;
          cam.y += (cam.targetY - cam.y) * camLerp;
          cam.zoom += (cam.targetZoom - cam.zoom) * camLerp;

          ctx.save();
          ctx.scale(dpr, dpr);
          ctx.fillStyle = "#09090b";
          ctx.fillRect(0, 0, width, height);

          // Subtle obsidian dot field
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

          // World transform
          ctx.save();
          ctx.translate(width / 2, height / 2);
          ctx.scale(cam.zoom, cam.zoom);
          ctx.translate(cam.x, cam.y);

          // Magnetic alignment guides while dragging a node
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

          // Expanding tactile ripples
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

          // Edge geometry & vertical centroid
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

            // Flow pulse photon on highlighted or live edges
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

            // Condition pill at curve midpoint
            if (edge.condition) {
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

          // Live elastic link wire
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
            const isOutput = Boolean(node.isOutput);
            const r = sim.radius * sim.scale;

            ctx.save();
            ctx.globalAlpha = sim.alpha;

            // Ambient halo on focus or active
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

            // Input orbit dashed ring
            if (isEntry) {
              ctx.beginPath();
              ctx.arc(sim.x, sim.y, r + 5.5, 0, Math.PI * 2);
              ctx.strokeStyle = "rgba(16, 185, 129, 0.55)";
              ctx.lineWidth = 1.2;
              ctx.setLineDash([3, 3]);
              ctx.stroke();
              ctx.setLineDash([]);
            }

            // Output orbit dashed ring
            if (isOutput) {
              ctx.beginPath();
              ctx.arc(sim.x, sim.y, r + (isEntry ? 9 : 5.5), 0, Math.PI * 2);
              ctx.strokeStyle = "rgba(56, 189, 248, 0.55)";
              ctx.lineWidth = 1.2;
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

            // Status corner dot
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

            // Right rim '+' port (click to add next node, or drag to link)
            if (!readOnlyRef.current && (isHovered || isSelected) && !ptr.draggedNodeId && !ptr.connectingFromId) {
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

            // Label & metadata
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

  // Pointer handlers
  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const { x: wx, y: wy } = screenToWorld(e.clientX, e.clientY);
    const ptr = pointerRef.current;

    // 1. Check '+' rim port (click to add node, drag to link)
    const portNode = hitTestLinkPort(wx, wy);
    if (portNode && !readOnly) {
      ptr.portDownNodeId = portNode.id;
      ptr.portDownScreenX = e.clientX;
      ptr.portDownScreenY = e.clientY;
      setCursorStyle("crosshair");
      return;
    }

    // 2. Check node hit
    const hitNode = hitTestNode(wx, wy);
    if (hitNode) {
      setPickerAnchor(null);
      if (!readOnly && e.shiftKey) {
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
      hitNode.vx = 0;
      hitNode.vy = 0;
      setCursorStyle(readOnly ? "pointer" : "grabbing");
      return;
    }

    // 3. Check edge hit
    const hitEdgeId = hitTestEdge(wx, wy);
    if (hitEdgeId) {
      setPickerAnchor(null);
      const geom = edgeGeometriesRef.current.get(hitEdgeId);
      if (geom) setPopoverAnchor(worldToScreen(geom.midX, geom.midY));
      selectEdge(hitEdgeId);
      return;
    }

    // 4. Empty space click dismisses popovers
    setPickerAnchor(null);
    selectNode(null);
    selectEdge(null);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const { x: wx, y: wy } = screenToWorld(e.clientX, e.clientY);
    const ptr = pointerRef.current;

    // Transition from port press to magnetic link wire when dragged > 5px
    if (ptr.portDownNodeId) {
      if (Math.hypot(e.clientX - ptr.portDownScreenX, e.clientY - ptr.portDownScreenY) > 5) {
        ptr.connectingFromId = ptr.portDownNodeId;
        ptr.portDownNodeId = null;
        ptr.connectCursorX = wx;
        ptr.connectCursorY = wy;
        ptr.connectSnapTargetId = null;
      }
      return;
    }

    if (ptr.connectingFromId) {
      ptr.connectCursorX = wx;
      ptr.connectCursorY = wy;
      const candidate = hitTestNode(wx, wy);
      ptr.connectSnapTargetId = candidate && candidate.id !== ptr.connectingFromId ? candidate.id : null;
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

        // Magnetic alignment snap to peer nodes (within 10px)
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

    // Clicked '+' rim port without dragging -> open Node Picker beside node
    if (ptr.portDownNodeId) {
      const sourceId = ptr.portDownNodeId;
      ptr.portDownNodeId = null;
      const sim = simNodesRef.current.get(sourceId);
      if (sim && !readOnly) {
        selectNode(null);
        selectEdge(null);
        setPickerAnchor({
          connectFromId: sourceId,
          worldPos: { x: sim.anchorX + 240, y: sim.anchorY },
          screenPos: worldToScreen(sim.x + sim.radius + 16, sim.y),
        });
      }
      setCursorStyle("default");
      return;
    }

    // Released magnetic link wire
    if (ptr.connectingFromId) {
      if (ptr.connectSnapTargetId && !readOnly) {
        addEdge(ptr.connectingFromId, ptr.connectSnapTargetId);
        const tgt = simNodesRef.current.get(ptr.connectSnapTargetId);
        if (tgt) {
          tgt.scaleVel += 0.14;
          emitRipple(tgt.x, tgt.y, "#10b981", 68);
        }
      }
      ptr.connectingFromId = null;
      ptr.connectSnapTargetId = null;
      setCursorStyle("default");
      return;
    }

    // Released node (click -> open details; drag -> lock new arranged position)
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
        fitView(false);
      }
      setCursorStyle("pointer");
    }
  };

  const handlePickNodeKind = (kind: NodeKind) => {
    if (!pickerAnchor || readOnly) return;
    const created = addNode(kind, {
      position: pickerAnchor.worldPos,
      connectFromId: pickerAnchor.connectFromId,
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

  if (!graph) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-canvas text-center">
        <div className="text-[14px] font-medium text-text-primary">No workflow selected</div>
        <p className="max-w-xs text-[12px] text-text-secondary">
          Select a saved workflow from the sidebar or create a new one.
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

  const selectedNode = selectedNodeId ? (graph.nodes.find((n) => n.id === selectedNodeId) ?? null) : null;
  const selectedEdge = selectedEdgeId ? (graph.edges.find((e) => e.id === selectedEdgeId) ?? null) : null;

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-canvas">
      {/* Compact Precision Header */}
      <header className="flex h-11 shrink-0 items-center justify-between gap-3 border-b border-border-subtle bg-surface px-4">
        <div className="flex min-w-0 items-center gap-2.5">
          <h2 className="truncate text-[13px] font-semibold text-text-primary">{graph.name}</h2>

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
        <div className="flex shrink-0 items-center gap-1">
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
              <Button variant="ghost" size="xs" onClick={handleAutoArrange} title="Auto-arrange flow layout">
                <LayoutGrid className="h-3 w-3" />
                <span className="hidden sm:inline">Arrange</span>
              </Button>
              <Button
                variant="secondary"
                size="xs"
                onClick={() => {
                  selectNode(null);
                  selectEdge(null);
                  setPickerAnchor({
                    worldPos: { x: 0, y: 0 },
                    screenPos: { x: canvasBounds.width - 240, y: 56 },
                  });
                }}
              >
                <Plus className="h-3 w-3" />
                <span>Add Node</span>
              </Button>
            </>
          ) : (
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
          )}
        </div>
      </header>

      {/* Interactive Always-Fit Flow Canvas */}
      <div ref={wrapperRef} className="relative min-h-0 min-w-0 flex-1 overflow-hidden select-none">
        <canvas
          ref={canvasRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          style={{ cursor: cursorStyle }}
          className="block h-full w-full touch-none"
        />

        {/* Anchored Node Detail & Edit Card */}
        {selectedNode ? (
          <AnchoredNodePopover
            graph={graph}
            node={selectedNode}
            runDetail={runDetail}
            readOnly={readOnly}
            availableSkills={availableSkills}
            screenPos={popoverAnchor}
            bounds={canvasBounds}
            onClose={() => selectNode(null)}
            onSelectNode={(id) => selectNode(id)}
            onSelectEdge={(id) => selectEdge(id)}
          />
        ) : null}

        {/* Anchored Edge Condition Editor */}
        {selectedEdge ? (
          <AnchoredEdgePopover
            edge={selectedEdge}
            readOnly={readOnly}
            screenPos={popoverAnchor}
            bounds={canvasBounds}
            onClose={() => selectEdge(null)}
          />
        ) : null}

        {/* Anchored Node Picker */}
        {pickerAnchor && !readOnly ? (
          <AnchoredNodePicker
            screenPos={pickerAnchor.screenPos}
            bounds={canvasBounds}
            onPick={handlePickNodeKind}
            onClose={() => setPickerAnchor(null)}
          />
        ) : null}
      </div>
    </div>
  );
}
