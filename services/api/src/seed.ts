import {
  defaultReadiness,
  demoGoals,
  demoMasterGraph,
  demoProposals,
  demoUser,
  initialUserStates
} from "@mnemosyne/demo-fixtures";
import type { KnowledgePackRecord, MnemosyneSeedData, MnemosyneStore } from "@mnemosyne/persistence-core";

export const demoKnowledgePacks: KnowledgePackRecord[] = [
  pack("pack_spanish_travel", "spanish-travel", "Spanish Travel", "language", "tested"),
  pack("pack_python_basics", "python-basics", "Python Basics", "coding", "tested"),
  pack("pack_linear_algebra", "linear-algebra", "Linear Algebra", "math", "community"),
  pack("pack_world_history", "world-history", "World History", "history", "community"),
  pack("pack_ai_systems", "ai-systems", "AI Systems", "ai", "expert_reviewed")
];

export function createDemoSeedData(): MnemosyneSeedData {
  return {
    user: demoUser,
    goals: demoGoals,
    masterGraph: demoMasterGraph,
    userStates: initialUserStates,
    readiness: defaultReadiness,
    proposals: demoProposals,
    packs: demoKnowledgePacks
  };
}

export async function seedDemoStore(store: MnemosyneStore): Promise<MnemosyneSeedData> {
  const seed = createDemoSeedData();
  await store.saveUser(seed.user);
  await store.saveMasterGraph(seed.masterGraph);
  await store.saveUserConceptStates(seed.user.id, seed.userStates);
  await store.saveReadiness(seed.user.id, seed.readiness);
  await Promise.all(seed.goals.map((goal) => store.saveGoal(goal)));
  await Promise.all((seed.proposals ?? []).map((proposal) => store.saveProposal(proposal)));
  await Promise.all((seed.packs ?? []).map((knowledgePack) => store.savePack(knowledgePack)));
  await store.appendAuditEvent({
    actor_id: "system",
    action: "demo_seed_loaded",
    object_type: "store",
    payload: {
      user_id: seed.user.id,
      concepts: seed.masterGraph.concepts.length,
      goals: seed.goals.length,
      packs: seed.packs?.length ?? 0
    }
  });
  return seed;
}

function pack(
  id: string,
  slug: string,
  title: string,
  domain: string,
  quality_tier: string
): KnowledgePackRecord {
  return {
    id,
    slug,
    title,
    domain,
    quality_tier,
    graph_version: "0.1.0",
    installed_for_user_ids: []
  };
}
