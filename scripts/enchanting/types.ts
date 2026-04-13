import { Enchantment, ItemStack, Vector3 } from "@minecraft/server";

export type EnchantmentOffer = {
  id: string;
  label: string;
  lapisCost: number;
  levelCost: number;
  powerScore: number;
  enchantments: Enchantment[];
};

export type EnchantingContext = {
  slot: number;
  item: ItemStack;
  fingerprint: string;
};

export type EnchantingFailure = {
  message: string;
};

export type TableContext = {
  location: Vector3;
  bookshelfCount: number;
};
