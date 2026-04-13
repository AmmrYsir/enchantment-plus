import {
  Enchantment,
  EnchantmentSlot,
  EnchantmentType,
  EnchantmentTypes,
  ItemEnchantableComponent,
  ItemStack,
  Vector3,
} from "@minecraft/server";
import { EnchantmentOffer } from "./types";

type OfferTier = {
  label: string;
  lapisCost: number;
  levelCost: number;
  basePower: number;
  extraChance: number;
};

const OFFER_TIERS: OfferTier[] = [
  { label: "Focused", lapisCost: 1, levelCost: 5, basePower: 16, extraChance: 0.18 },
  { label: "Empowered", lapisCost: 2, levelCost: 15, basePower: 28, extraChance: 0.45 },
  { label: "Mythic", lapisCost: 3, levelCost: 30, basePower: 40, extraChance: 0.72 },
];

const TREASURE_ENCHANTMENTS = new Set([
  "minecraft:mending",
  "minecraft:soul_speed",
  "minecraft:frost_walker",
  "minecraft:binding",
  "minecraft:vanishing",
  "minecraft:swift_sneak",
]);

const POWER_BONUS_BY_ENCHANTMENT: Record<string, number> = {
  "minecraft:efficiency": 3,
  "minecraft:fortune": 4,
  "minecraft:looting": 4,
  "minecraft:power": 3,
  "minecraft:protection": 3,
  "minecraft:sharpness": 3,
  "minecraft:unbreaking": 2,
};

const SLOT_POWER_BONUS: Partial<Record<EnchantmentSlot, number>> = {
  [EnchantmentSlot.Sword]: 4,
  [EnchantmentSlot.Pickaxe]: 4,
  [EnchantmentSlot.Axe]: 3,
  [EnchantmentSlot.Bow]: 3,
  [EnchantmentSlot.Crossbow]: 3,
  [EnchantmentSlot.ArmorHead]: 2,
  [EnchantmentSlot.ArmorTorso]: 2,
  [EnchantmentSlot.ArmorLegs]: 2,
  [EnchantmentSlot.ArmorFeet]: 2,
  [EnchantmentSlot.FishingRod]: 2,
};

class SeededRandom {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  nextFloat(): number {
    this.state = (1664525 * this.state + 1013904223) >>> 0;
    return this.state / 4294967296;
  }
}

export function buildEnchantingOffers(
  item: ItemStack,
  playerId: string,
  tableLocation: Vector3,
  bookshelfCount: number,
  rollSeed: number
): EnchantmentOffer[] {
  const enchantable = item.getComponent("minecraft:enchantable") as ItemEnchantableComponent | undefined;
  if (!enchantable) {
    return [];
  }

  const compatibleTypes = getCompatibleTypes(item);
  if (compatibleTypes.length === 0) {
    return [];
  }

  return OFFER_TIERS.map((tier, tierIndex) => {
    const rng = new SeededRandom(
      hashSeed(`${playerId}|${itemFingerprint(item)}|${locationKey(tableLocation)}|${rollSeed}|${tierIndex}`)
    );
    const powerScore = tier.basePower + bookshelfCount * 2 + getSlotPowerBonus(enchantable.slots);
    const workingItem = item.clone();
    const enchantments: Enchantment[] = [];

    const primaryType = pickWeightedType(compatibleTypes, enchantable.slots, tierIndex, rng);
    const primary = { type: primaryType, level: rollLevel(primaryType, powerScore, rng) };

    if (canAddEnchantment(workingItem, primary)) {
      applyPreviewEnchantment(workingItem, primary);
      enchantments.push(primary);
    }

    while (enchantments.length < 3 && shouldAddExtraEnchantment(tier, bookshelfCount, enchantments.length, rng)) {
      const remainingTypes = getCompatibleTypes(workingItem).filter(
        (candidate) => !enchantments.some((existing) => existing.type.id === candidate.id)
      );
      if (remainingTypes.length === 0) {
        break;
      }

      const nextType = pickWeightedType(remainingTypes, enchantable.slots, tierIndex, rng);
      const extra = { type: nextType, level: rollLevel(nextType, powerScore - enchantments.length * 4, rng) };

      if (!canAddEnchantment(workingItem, extra)) {
        continue;
      }

      applyPreviewEnchantment(workingItem, extra);
      enchantments.push(extra);
    }

    return {
      id: `offer-${tierIndex}`,
      label: tier.label,
      lapisCost: tier.lapisCost,
      levelCost: tier.levelCost,
      powerScore,
      enchantments,
    };
  }).filter((offer) => offer.enchantments.length > 0);
}

function getCompatibleTypes(item: ItemStack): EnchantmentType[] {
  const enchantable = item.getComponent("minecraft:enchantable") as ItemEnchantableComponent | undefined;
  if (!enchantable) {
    return [];
  }

  return EnchantmentTypes.getAll().filter((type) => {
    if (TREASURE_ENCHANTMENTS.has(type.id)) {
      return false;
    }

    return canAddEnchantment(item, { type, level: 1 });
  });
}

function canAddEnchantment(item: ItemStack, enchantment: Enchantment): boolean {
  const enchantable = item.getComponent("minecraft:enchantable") as ItemEnchantableComponent | undefined;
  if (!enchantable) {
    return false;
  }

  try {
    return enchantable.canAddEnchantment(enchantment);
  } catch {
    return false;
  }
}

function applyPreviewEnchantment(item: ItemStack, enchantment: Enchantment): void {
  const enchantable = item.getComponent("minecraft:enchantable") as ItemEnchantableComponent | undefined;
  if (!enchantable) {
    return;
  }

  enchantable.addEnchantment(enchantment);
}

function pickWeightedType(
  types: EnchantmentType[],
  slots: EnchantmentSlot[],
  tierIndex: number,
  rng: SeededRandom
): EnchantmentType {
  let totalWeight = 0;
  const weighted = types.map((type) => {
    const weight =
      1 +
      type.maxLevel * (1.1 + tierIndex * 0.18) +
      (POWER_BONUS_BY_ENCHANTMENT[type.id] ?? 0) +
      getSlotPowerBonus(slots) * 0.25;
    totalWeight += weight;
    return { type, weight };
  });

  let roll = rng.nextFloat() * totalWeight;
  for (const entry of weighted) {
    roll -= entry.weight;
    if (roll <= 0) {
      return entry.type;
    }
  }

  return weighted[weighted.length - 1].type;
}

function rollLevel(type: EnchantmentType, powerScore: number, rng: SeededRandom): number {
  if (type.maxLevel <= 1) {
    return 1;
  }

  const strength = Math.max(0, Math.min(0.98, powerScore / 55));
  const curvedRoll = 1 - Math.pow(1 - rng.nextFloat(), 1 + strength * 2.4);
  let level = 1 + Math.floor(curvedRoll * type.maxLevel);

  if (rng.nextFloat() < strength * 0.35) {
    level += 1;
  }

  return Math.max(1, Math.min(type.maxLevel, level));
}

function shouldAddExtraEnchantment(
  tier: OfferTier,
  bookshelfCount: number,
  existingEnchantmentCount: number,
  rng: SeededRandom
): boolean {
  const bonusChance = bookshelfCount * 0.02;
  const diminishingReturns = existingEnchantmentCount * 0.28;
  return rng.nextFloat() < tier.extraChance + bonusChance - diminishingReturns;
}

function getSlotPowerBonus(slots: EnchantmentSlot[]): number {
  return slots.reduce((sum, slot) => sum + (SLOT_POWER_BONUS[slot] ?? 0), 0);
}

function hashSeed(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

function itemFingerprint(item: ItemStack): string {
  const enchantable = item.getComponent("minecraft:enchantable") as ItemEnchantableComponent | undefined;
  const enchantments = enchantable?.getEnchantments() ?? [];
  const enchantmentKey = enchantments
    .map((entry) => `${entry.type.id}:${entry.level}`)
    .sort()
    .join(",");

  return `${item.typeId}|${item.amount}|${item.nameTag ?? ""}|${enchantmentKey}`;
}

function locationKey(location: Vector3): string {
  return `${location.x},${location.y},${location.z}`;
}
