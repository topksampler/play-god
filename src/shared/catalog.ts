import type { BiomeKind, HazardKind, ItemKind, NodeKind, ObstacleShape, RecipeKind, StructureKind } from './types';

/** What each resource node is (truth) vs what agents see (appearance). */
export const NODES: Record<
  NodeKind,
  {
    appearance: string;
    /** Detail returned by `inspect` — sensory hints, never the truth label. */
    detail: string;
    yields: ItemKind | null;
    itemLabel: string;
    drink?: { hydration: number; sickSec?: number };
    maxUnits: number;
    regrowPerMin: number;
    color: string;
  }
> = {
  berry_bush: { appearance: 'bush with clusters of dark blue berries', detail: 'sweet smell; birds peck at it', yields: 'berries', itemLabel: 'dark blue berries', maxUnits: 5, regrowPerMin: 3, color: '#3a5bd9' },
  fruit_tree: { appearance: 'tree hanging with round orange fruit', detail: 'ripe fruit, some fallen and half-eaten by animals', yields: 'fruit', itemLabel: 'orange fruit', maxUnits: 6, regrowPerMin: 1.5, color: '#ff9f1c' },
  mushroom_patch: { appearance: 'patch of brown-capped mushrooms', detail: 'earthy smell; a few caps nibbled by small animals', yields: 'mushroom', itemLabel: 'brown-capped mushroom', maxUnits: 4, regrowPerMin: 2, color: '#8d6e63' },
  toxic_mushroom_patch: { appearance: 'patch of red-capped mushrooms with white spots', detail: 'sharp acrid smell; untouched by animals, a dead beetle nearby', yields: 'toxic_mushroom', itemLabel: 'red spotted mushroom', maxUnits: 5, regrowPerMin: 3, color: '#e63946' },
  fish_spot: { appearance: 'shallow water with fish darting', detail: 'silver fish; catchable by hand', yields: 'fish', itemLabel: 'raw fish', maxUnits: 4, regrowPerMin: 2, color: '#adb5bd' },
  cactus: { appearance: 'squat cactus with pink fruit', detail: 'spiny; the fruit is juicy', yields: 'cactus_fruit', itemLabel: 'pink cactus fruit', maxUnits: 3, regrowPerMin: 1, color: '#d63384' },
  honey_hive: { appearance: 'hollow tree trunk dripping golden honey', detail: 'loud buzzing inside', yields: 'honey', itemLabel: 'honeycomb', maxUnits: 3, regrowPerMin: 0.6, color: '#ffc300' },
  herb_patch: { appearance: 'clump of fragrant silvery-leaved herbs', detail: 'minty, medicinal smell', yields: 'herb', itemLabel: 'silvery herb', maxUnits: 3, regrowPerMin: 1, color: '#c0c0c0' },
  moss_patch: { appearance: 'thick pale-green moss on rotting logs', detail: 'damp and bitter; animals lick it', yields: 'moss', itemLabel: 'pale moss', maxUnits: 3, regrowPerMin: 1, color: '#9bd770' },
  wood_pile: { appearance: 'pile of fallen dry branches', detail: 'dry, would burn well', yields: 'wood', itemLabel: 'wood', maxUnits: 6, regrowPerMin: 1.5, color: '#8b5a2b' },
  stone_pile: { appearance: 'scatter of loose flat stones', detail: 'hard flint-like stones', yields: 'stone', itemLabel: 'stone', maxUnits: 6, regrowPerMin: 1, color: '#9e9e9e' },
  fiber_grass: { appearance: 'tall fibrous grass', detail: 'long tough strands, good for binding', yields: 'fiber', itemLabel: 'fiber', maxUnits: 6, regrowPerMin: 3, color: '#c9b458' },
  fresh_water: { appearance: 'clear, cool water', detail: 'clean and cold', yields: null, itemLabel: '', drink: { hydration: 40 }, maxUnits: 99, regrowPerMin: 99, color: '#4dabf7' },
  toxic_water: { appearance: 'murky greenish water', detail: 'sulfur smell; bubbles rise from the bottom', yields: null, itemLabel: '', drink: { hydration: 25, sickSec: 25 }, maxUnits: 99, regrowPerMin: 99, color: '#6b8e23' },
};

/** True effects of eating an item. Agents only learn these through outcomes. */
export const ITEMS: Record<
  ItemKind,
  { energy?: number; hydration?: number; health?: number; poisonSec?: number; sickSec?: number; sickChance?: number; cures?: ('poison' | 'sick')[]; spoilSec?: number; edible: boolean }
> = {
  berries: { energy: 12, hydration: 4, spoilSec: 90, edible: true },
  fruit: { energy: 22, hydration: 6, spoilSec: 150, edible: true },
  mushroom: { energy: 12, spoilSec: 100, edible: true },
  toxic_mushroom: { energy: 4, poisonSec: 20, spoilSec: 100, edible: true },
  cooked_mushroom: { energy: 16, spoilSec: 120, edible: true },
  fish: { energy: 12, sickChance: 0.3, sickSec: 15, spoilSec: 60, edible: true },
  cooked_fish: { energy: 32, spoilSec: 120, edible: true },
  cactus_fruit: { energy: 8, hydration: 22, spoilSec: 120, edible: true },
  honey: { energy: 30, edible: true },
  herb: { health: 20, cures: ['sick'], edible: true },
  moss: { health: 6, cures: ['poison'], edible: true },
  wood: { edible: false },
  stone: { edible: false },
  fiber: { edible: false },
  rotten_food: { energy: 2, sickSec: 20, edible: true },
};

export const HAZARDS: Record<
  HazardKind,
  { appearance: string; damagePerSec: number; speedMul: number; poisonChancePerSec?: number; hitChancePerSec?: number; hitDamage?: number; color: string }
> = {
  thorns: { appearance: 'dense thorny brambles', damagePerSec: 3, speedMul: 0.6, color: '#6a4c93' },
  mud: { appearance: 'sticky deep mud', damagePerSec: 0, speedMul: 0.4, color: '#5c4033' },
  wasps: { appearance: 'swarm of buzzing insects', damagePerSec: 5, speedMul: 1, color: '#ffd000' },
  snakes: { appearance: 'rustling in the dry grass', damagePerSec: 0, speedMul: 1, poisonChancePerSec: 0.25, color: '#b08968' },
  rockfall: { appearance: 'loose rocks tumbling from above', damagePerSec: 0, speedMul: 0.8, hitChancePerSec: 0.15, hitDamage: 20, color: '#7f7f7f' },
  leeches: { appearance: 'dark stagnant pools', damagePerSec: 1.5, speedMul: 0.7, color: '#2d3a2e' },
};

export const BIOMES: Record<
  BiomeKind,
  {
    color: string;
    speedMul: number;
    visionMul: number;
    energyDrainMul: number;
    thirstMul: number;
    nodes: [NodeKind, number][];
    hazards: [HazardKind, number][];
    obstacles: [ObstacleShape, number][];
  }
> = {
  meadow: {
    color: '#8fbf73', speedMul: 1, visionMul: 1, energyDrainMul: 1, thirstMul: 1,
    nodes: [['berry_bush', 4], ['fiber_grass', 2], ['fresh_water', 1], ['herb_patch', 1]],
    hazards: [['thorns', 2]],
    obstacles: [['rock', 2], ['bush', 4], ['tree', 2]],
  },
  forest: {
    color: '#4f7942', speedMul: 0.9, visionMul: 0.7, energyDrainMul: 1, thirstMul: 1,
    nodes: [['fruit_tree', 2], ['mushroom_patch', 2], ['toxic_mushroom_patch', 2], ['wood_pile', 3], ['honey_hive', 1]],
    hazards: [['wasps', 1]],
    obstacles: [['tree', 10], ['log', 2]],
  },
  lake: {
    color: '#a8c686', speedMul: 1, visionMul: 1, energyDrainMul: 1, thirstMul: 1,
    nodes: [['fresh_water', 3], ['fish_spot', 2], ['fiber_grass', 2]],
    hazards: [['mud', 2]],
    obstacles: [['lake', 1], ['rock', 2]],
  },
  highlands: {
    color: '#a39e8b', speedMul: 0.85, visionMul: 1.2, energyDrainMul: 1.25, thirstMul: 1.1,
    nodes: [['stone_pile', 3], ['herb_patch', 2], ['fresh_water', 1]],
    hazards: [['rockfall', 2]],
    obstacles: [['cliff', 2], ['boulder', 5]],
  },
  scrub: {
    color: '#d4b483', speedMul: 1, visionMul: 1.1, energyDrainMul: 1.1, thirstMul: 2,
    nodes: [['cactus', 4], ['honey_hive', 1], ['stone_pile', 1]],
    hazards: [['snakes', 2]],
    obstacles: [['rock', 3], ['boulder', 1]],
  },
  swamp: {
    color: '#5e7d5a', speedMul: 0.7, visionMul: 0.8, energyDrainMul: 1.1, thirstMul: 0.8,
    nodes: [['moss_patch', 2], ['fish_spot', 2], ['toxic_water', 3], ['toxic_mushroom_patch', 1], ['wood_pile', 1]],
    hazards: [['leeches', 3], ['mud', 1]],
    obstacles: [['tree', 4], ['log', 2]],
  },
};

export const RECIPES: Record<RecipeKind, { needs: Partial<Record<ItemKind, number>>; effect: string }> = {
  basket: { needs: { fiber: 3 }, effect: 'carry capacity +3' },
  torch: { needs: { wood: 1, fiber: 1 }, effect: 'see further at night' },
};

export const STRUCTURES: Record<StructureKind, { needs: Partial<Record<ItemKind, number>>; effect: string }> = {
  campfire: { needs: { wood: 3, stone: 1 }, effect: 'light and warmth at night; enables cook' },
  shelter: { needs: { wood: 5, fiber: 3 }, effect: 'protects from storms; faster rest' },
  cache: { needs: { wood: 4 }, effect: 'shared storage for 10 items' },
  sign: { needs: { wood: 1 }, effect: 'leaves a short text message readable by anyone' },
};

export const COOKED: Partial<Record<ItemKind, { kind: ItemKind; label: string }>> = {
  fish: { kind: 'cooked_fish', label: 'cooked fish' },
  mushroom: { kind: 'cooked_mushroom', label: 'roasted mushroom' },
  toxic_mushroom: { kind: 'cooked_mushroom', label: 'roasted mushroom' },
};
