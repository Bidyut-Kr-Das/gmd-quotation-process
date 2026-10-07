"use server";

import { prisma } from "@/lib/prisma";

export async function getItems() {
  return prisma.items.findMany({ orderBy: { itemcode: "asc" } });
}