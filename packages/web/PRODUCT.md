# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
One technical owner. They build and watch AI workflows on a local machine. (Inferred from the task brief, not interviewed.)

## Product Purpose
Sosho is a local workflow engine. The UI lets the owner list workflows, edit a graph, watch runs, answer human inputs, manage triggers, and review versions.

## Operating Context
Node kinds: trigger, llm, agent, skill, tool, router, map, join, human, subworkflow, wait. Run states: pending, running, waiting for input, succeeded, failed, cancelled.

## Capabilities and Constraints
Stack: React, Vite, TypeScript strict, ui-sdk only, dagre for layout. No new dependencies. System font stacks and inline SVG icons only.

## Brand Commitments
Dark theme. Sleek, modern, minimalist. Glass only where it earns its place. Dense but calm. The graph and run status carry the most visual weight.

## Evidence on Hand
All data in `src/showcase/mock.ts` is synthetic.

## Product Principles
- Signal over decoration.
- Status is readable at a glance.
- The graph is the hero.
- One owner: favor density and keyboard use.
