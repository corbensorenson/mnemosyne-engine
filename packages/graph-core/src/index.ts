import type {
  ConceptEdge,
  ConceptNode,
  Goal,
  MasterGraph,
  UserConceptState,
  UserKnowledgeGraph
} from "@mnemosyne/schema";
import { clamp, round, sortByScore, unique } from "@mnemosyne/shared-utils";

export type ConceptWindow = "known" | "frontier" | "horizon" | "blocked" | "decaying";

export type GraphGap = {
  targetConceptIds: string[];
  missingConceptIds: string[];
  weakConceptIds: string[];
  blockedConceptIds: string[];
  prerequisiteDebt: number;
  priorityConceptIds: string[];
};

export type GraphSnapshotNode = {
  id: string;
  title: string;
  domain: string;
  window: ConceptWindow;
  mastery: number;
  prerequisiteHealth: number;
  x: number;
  y: number;
};

export type GraphSnapshot = {
  nodes: GraphSnapshotNode[];
  edges: ConceptEdge[];
  metrics: {
    graphVelocity: number;
    retentionHalfLifeDays: number;
    transferScore: number;
    falseConfidenceRate: number;
    prerequisiteDebt: number;
  };
};

export function getState(states: UserConceptState[], conceptId: string): UserConceptState | undefined {
  return states.find((state) => state.concept_id === conceptId);
}

export function classifyConceptWindow(
  concept: ConceptNode,
  state: UserConceptState | undefined,
  states: UserConceptState[]
): ConceptWindow {
  if (concept.status === "deprecated" || concept.status === "archived") return "blocked";
  if (!state || state.status === "unknown") return prerequisitesMet(concept, states) ? "horizon" : "blocked";
  if (state.false_confidence_risk > 0.62 || state.recall_strength < 0.35) return "frontier";
  if (state.recall_stability < 0.45 && state.mastery > 0.45) return "decaying";
  if (state.mastery >= 0.78 && state.transfer_score >= 0.62) return "known";
  if (state.prerequisite_health < 0.48) return "blocked";
  return "frontier";
}

export function prerequisitesMet(concept: ConceptNode, states: UserConceptState[]): boolean {
  if (concept.prerequisites.length === 0) return true;
  return concept.prerequisites.every((edge) => {
    const prerequisite = getState(states, edge.from_id);
    return prerequisite && prerequisite.mastery >= 0.45 && prerequisite.false_confidence_risk < 0.65;
  });
}

export function computeGoalGap(
  userGraph: UserKnowledgeGraph,
  masterGraph: MasterGraph,
  goals: Goal[]
): GraphGap {
  const targets = unique(
    goals.flatMap((goal) => [
      ...goal.target_concept_ids,
      ...masterGraph.concepts
        .filter((concept) => goal.target_domain_ids.includes(concept.domain))
        .map((concept) => concept.id)
    ])
  );

  const missing = targets.filter((id) => !getState(userGraph.states, id));
  const weak = targets.filter((id) => {
    const state = getState(userGraph.states, id);
    return state ? state.mastery < 0.7 || state.transfer_score < 0.6 : false;
  });

  const blocked = targets.filter((id) => {
    const concept = masterGraph.concepts.find((candidate) => candidate.id === id);
    return concept ? !prerequisitesMet(concept, userGraph.states) : false;
  });

  const priority = sortByScore(unique([...blocked, ...weak, ...missing]), (id) =>
    priorityScore(id, masterGraph, goals, userGraph.states)
  );

  return {
    targetConceptIds: targets,
    missingConceptIds: missing,
    weakConceptIds: weak,
    blockedConceptIds: blocked,
    prerequisiteDebt: estimatePrerequisiteDebt(masterGraph.concepts, userGraph.states, targets),
    priorityConceptIds: priority
  };
}

export function estimatePrerequisiteDebt(
  concepts: ConceptNode[],
  states: UserConceptState[],
  conceptIds = concepts.map((concept) => concept.id)
): number {
  const relevant = concepts.filter((concept) => conceptIds.includes(concept.id));
  if (relevant.length === 0) return 0;
  const debt = relevant.map((concept) => {
    const prereqHealth =
      concept.prerequisites.length === 0
        ? 1
        : concept.prerequisites.reduce((sum, edge) => {
            const state = getState(states, edge.from_id);
            return sum + (state?.mastery ?? 0) * edge.strength;
          }, 0) / concept.prerequisites.length;
    return clamp(1 - prereqHealth);
  });
  return round(debt.reduce((sum, value) => sum + value, 0) / relevant.length, 3);
}

export function selectKnownDueForReview(userGraph: UserKnowledgeGraph, gap: GraphGap, limit = 6): string[] {
  return sortByScore(
    userGraph.states.filter((state) => state.mastery >= 0.55),
    (state) =>
      (gap.targetConceptIds.includes(state.concept_id) ? 0.25 : 0) +
      (1 - state.recall_stability) * 0.45 +
      state.false_confidence_risk * 0.3
  )
    .slice(0, limit)
    .map((state) => state.concept_id);
}

export function selectFrontierConcepts(
  userGraph: UserKnowledgeGraph,
  masterGraph: MasterGraph,
  gap: GraphGap,
  limit = 7
): ConceptNode[] {
  return sortByScore(
    masterGraph.concepts.filter((concept) => {
      const state = getState(userGraph.states, concept.id);
      const window = classifyConceptWindow(concept, state, userGraph.states);
      return window === "frontier" || gap.priorityConceptIds.includes(concept.id);
    }),
    (concept) => priorityScore(concept.id, masterGraph, [], userGraph.states)
  ).slice(0, limit);
}

export function selectHorizonConcepts(
  userGraph: UserKnowledgeGraph,
  masterGraph: MasterGraph,
  frontier: ConceptNode[],
  goals: Goal[],
  limit = 4
): ConceptNode[] {
  const successorIds = unique(frontier.flatMap((concept) => concept.successors.map((edge) => edge.to_id)));
  const goalDomains = new Set(goals.flatMap((goal) => goal.target_domain_ids));
  return sortByScore(
    masterGraph.concepts.filter((concept) => {
      const state = getState(userGraph.states, concept.id);
      if (state && state.mastery > 0.35) return false;
      return successorIds.includes(concept.id) || goalDomains.has(concept.domain);
    }),
    (concept) =>
      concept.importance * 0.4 +
      concept.difficulty * 0.2 +
      (successorIds.includes(concept.id) ? 0.25 : 0) +
      (goalDomains.has(concept.domain) ? 0.15 : 0)
  ).slice(0, limit);
}

export function buildGraphSnapshot(masterGraph: MasterGraph, userGraph: UserKnowledgeGraph): GraphSnapshot {
  const domainOffsets = new Map<string, number>();
  const nodes = masterGraph.concepts.map((concept, index) => {
    const domainIndex = domainOffsets.get(concept.domain) ?? domainOffsets.size;
    domainOffsets.set(concept.domain, domainIndex);
    const state = getState(userGraph.states, concept.id);
    const window = classifyConceptWindow(concept, state, userGraph.states);
    const ring = 140 + (domainIndex % 3) * 54;
    const angle = (index / Math.max(masterGraph.concepts.length, 1)) * Math.PI * 2;
    return {
      id: concept.id,
      title: concept.title,
      domain: concept.domain,
      window,
      mastery: state?.mastery ?? 0,
      prerequisiteHealth:
        state?.prerequisite_health ?? (prerequisitesMet(concept, userGraph.states) ? 1 : 0.25),
      x: round(260 + Math.cos(angle) * ring, 1),
      y: round(220 + Math.sin(angle) * ring, 1)
    };
  });

  const states = userGraph.states;
  const known = states.filter((state) => state.mastery >= 0.7).length;
  const transferScore =
    states.reduce((sum, state) => sum + state.transfer_score, 0) / Math.max(states.length, 1);
  const falseConfidenceRate =
    states.filter((state) => state.false_confidence_risk > 0.55).length / Math.max(states.length, 1);

  return {
    nodes,
    edges: masterGraph.edges,
    metrics: {
      graphVelocity: round(known / 4.3, 2),
      retentionHalfLifeDays: round(
        7 + states.reduce((sum, state) => sum + state.recall_stability * 19, 0) / Math.max(states.length, 1),
        1
      ),
      transferScore: round(transferScore, 2),
      falseConfidenceRate: round(falseConfidenceRate, 2),
      prerequisiteDebt: estimatePrerequisiteDebt(masterGraph.concepts, states)
    }
  };
}

export function graphPath(edges: ConceptEdge[], fromId: string, toId: string, maxDepth = 6): string[] {
  const queue: Array<{ id: string; path: string[] }> = [{ id: fromId, path: [fromId] }];
  const visited = new Set<string>();
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) break;
    if (current.id === toId) return current.path;
    if (current.path.length > maxDepth || visited.has(current.id)) continue;
    visited.add(current.id);
    for (const edge of edges.filter((candidate) => candidate.from_id === current.id)) {
      queue.push({ id: edge.to_id, path: [...current.path, edge.to_id] });
    }
  }
  return [];
}

function priorityScore(
  conceptId: string,
  masterGraph: MasterGraph,
  goals: Goal[],
  states: UserConceptState[]
): number {
  const concept = masterGraph.concepts.find((candidate) => candidate.id === conceptId);
  const state = getState(states, conceptId);
  const goalBoost = goals.some((goal) => goal.target_concept_ids.includes(conceptId)) ? 0.25 : 0;
  return (
    goalBoost +
    (concept?.importance ?? 0.5) * 0.3 +
    (1 - (state?.mastery ?? 0)) * 0.22 +
    (state?.false_confidence_risk ?? 0.2) * 0.18 +
    (1 - (state?.prerequisite_health ?? 0.5)) * 0.1
  );
}
