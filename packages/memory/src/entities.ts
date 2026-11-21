import type { SqliteDb } from "./fts.ts";

export interface EntityGraphState {
  directEntityHits: Map<string, number>;
  entityToDocs: Map<string, Set<string>>;
  docToEntities: Map<string, string[]>;
}

export function createEntityGraphState(): EntityGraphState {
  return {
    directEntityHits: new Map(),
    entityToDocs: new Map(),
    docToEntities: new Map(),
  };
}

export function loadScopeEntities(
  db: SqliteDb,
  validIds: Set<string>,
  queryLower: string,
  state: EntityGraphState,
): void {
  const entRows = db.prepare("SELECT memory_id, entity FROM memory_entities").all();
  for (const er of entRows) {
    const mid = String(er.memory_id);
    if (!validIds.has(mid)) continue;
    const entity = String(er.entity);
    let set = state.entityToDocs.get(entity);
    if (!set) {
      set = new Set();
      state.entityToDocs.set(entity, set);
    }
    set.add(mid);
    const list = state.docToEntities.get(mid) || [];
    list.push(entity);
    state.docToEntities.set(mid, list);

    if (entity.length >= 2 && queryLower.includes(entity)) {
      state.directEntityHits.set(mid, (state.directEntityHits.get(mid) || 0) + 1);
    }
  }
}

export function expandOneHopEntities(seedIds: Set<string>, state: EntityGraphState): Map<string, number> {
  const oneHopHits = new Map<string, number>();
  for (const sid of seedIds) {
    const ents = state.docToEntities.get(sid) || [];
    for (const e of ents) {
      const neighbors = state.entityToDocs.get(e);
      if (!neighbors) continue;
      for (const nid of neighbors) {
        if (nid === sid) continue;
        oneHopHits.set(nid, (oneHopHits.get(nid) || 0) + 1);
      }
    }
  }
  return oneHopHits;
}
