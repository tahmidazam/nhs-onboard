import { v } from 'convex/values'
import { internalMutation, query } from './_generated/server'

/** Lookup key shared by the seeder and every caller. */
export function normalise(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9]/g, '')
}

/**
 * Resolves a foreign brand to a UK formulary entry.
 * Deterministic. See docs/adr/0002-drug-mapping-is-deterministic.md.
 */
export const resolve = query({
  args: { brand: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      brand: v.string(),
      generic: v.optional(v.string()),
      via: v.string(),
      unresolved: v.boolean(),
      ukIngredient: v.optional(v.string()),
      prescribable: v.optional(v.string()),
      vmpId: v.optional(v.string()),
      ukFormularyName: v.optional(v.string()),
      rag: v.optional(v.string()),
      formularyMatches: v.optional(
        v.array(v.object({ drug: v.string(), rag: v.string(), chapter: v.string() })),
      ),
    }),
  ),
  handler: async (ctx, { brand }) => {
    const key = normalise(brand)
    if (!key) return null

    let hit = await ctx.db
      .query('brands')
      .withIndex('by_key', (q) => q.eq('key', key))
      .first()

    if (!hit) {
      const prefixed = await ctx.db
        .query('brands')
        .withIndex('by_key', (q) => q.gte('key', key).lt('key', key + '￿'))
        .take(20)
      hit = prefixed.sort((a, b) => a.brand.length - b.brand.length)[0] ?? null
    }

    if (!hit) return { brand, unresolved: true as const, via: 'unresolved' as const }

    const stem = normalise(hit.generic.split(/[ (]/)[0])

    const dmd = await ctx.db
      .query('dmd')
      .withIndex('by_key', (q) => q.gte('key', stem).lt('key', stem + '￿'))
      .take(1)

    /** dm+d carries the UK spelling, so search the formulary with it when present. */
    const formularyStem = dmd[0] ? normalise(dmd[0].vtmName.split(/[ (]/)[0]) : stem
    const formulary = await ctx.db
      .query('formulary')
      .withIndex('by_key', (q) => q.gte('key', formularyStem).lt('key', formularyStem + '￿'))
      .take(5)

    return {
      brand,
      generic: hit.generic,
      via: hit.via,
      unresolved: false as const,
      ukIngredient: dmd[0]?.vtmName,
      prescribable: dmd[0]?.vmpName,
      vmpId: dmd[0]?.vmpId,
      ukFormularyName: formulary[0]?.drug,
      rag: formulary[0]?.rag,
      formularyMatches: formulary.map((f) => ({ drug: f.drug, rag: f.rag, chapter: f.chapter })),
    }
  },
})

export const insertBrands = internalMutation({
  args: {
    rows: v.array(
      v.object({
        key: v.string(),
        brand: v.string(),
        generic: v.string(),
        country: v.string(),
        via: v.string(),
      }),
    ),
  },
  returns: v.number(),
  handler: async (ctx, { rows }) => {
    for (const row of rows) await ctx.db.insert('brands', row)
    return rows.length
  },
})

export const insertFormulary = internalMutation({
  args: {
    rows: v.array(
      v.object({ key: v.string(), drug: v.string(), chapter: v.string(), rag: v.string() }),
    ),
  },
  returns: v.number(),
  handler: async (ctx, { rows }) => {
    for (const row of rows) await ctx.db.insert('formulary', row)
    return rows.length
  },
})

export const insertDmd = internalMutation({
  args: {
    rows: v.array(
      v.object({
        key: v.string(),
        vtmId: v.string(),
        vtmName: v.string(),
        vmpId: v.optional(v.string()),
        vmpName: v.optional(v.string()),
        form: v.optional(v.string()),
        route: v.optional(v.string()),
        bnfCode: v.optional(v.string()),
      }),
    ),
  },
  returns: v.number(),
  handler: async (ctx, { rows }) => {
    for (const row of rows) await ctx.db.insert('dmd', row)
    return rows.length
  },
})

export const counts = query({
  args: {},
  returns: v.object({ brands: v.number(), formulary: v.number() }),
  handler: async (ctx) => ({
    brands: (await ctx.db.query('brands').take(1)).length,
    formulary: (await ctx.db.query('formulary').take(1)).length,
  }),
})
