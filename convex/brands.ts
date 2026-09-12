import { v } from 'convex/values'
import { internalAction, internalMutation, internalQuery, query } from './_generated/server'
import type { QueryCtx } from './_generated/server'
import { internal } from './_generated/api'

/** Lookup key shared by the seeder and every caller. */
export function normalise(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9]/g, '')
}

/** Normalised first word of a generic/composition string. Shares its rule with resolveBrand's stem. */
export function genericKeyFor(generic: string): string {
  return normalise(generic.split(/[ (]/)[0])
}

export interface Resolution {
  brand: string
  generic?: string
  via: string
  unresolved: boolean
  ukIngredient?: string
  prescribable?: string
  vmpId?: string
  ukFormularyName?: string
  rag?: string
  formularyMatches?: { drug: string; rag: string; chapter: string }[]
}

/**
 * Resolves a foreign brand to a UK formulary entry.
 * Deterministic. See docs/adr/0002-drug-mapping-is-deterministic.md.
 */
export async function resolveBrand(ctx: QueryCtx, brand: string): Promise<Resolution | null> {
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

  if (!hit) return { brand, unresolved: true, via: 'unresolved' }

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
    unresolved: false,
    ukIngredient: dmd[0]?.vtmName,
    prescribable: dmd[0]?.vmpName,
    vmpId: dmd[0]?.vmpId,
    ukFormularyName: formulary[0]?.drug,
    rag: formulary[0]?.rag,
    formularyMatches: formulary.map((f) => ({ drug: f.drug, rag: f.rag, chapter: f.chapter })),
  }
}

/** Thin query wrapper. The mapping path calls resolveBrand directly. */
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
  handler: async (ctx, { brand }) => resolveBrand(ctx, brand),
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
        atcCode: v.optional(v.string()),
      }),
    ),
  },
  returns: v.number(),
  handler: async (ctx, { rows }) => {
    for (const row of rows) await ctx.db.insert('dmd', row)
    return rows.length
  },
})

export const insertCountryGuides = internalMutation({
  args: {
    rows: v.array(
      v.object({
        countrySlug: v.string(),
        country: v.string(),
        section: v.string(),
        text: v.string(),
        citations: v.array(v.object({ url: v.string(), label: v.string() })),
        emphasis: v.optional(v.boolean()),
      }),
    ),
  },
  returns: v.number(),
  handler: async (ctx, { rows }) => {
    for (const row of rows) await ctx.db.insert('countryGuides', row)
    return rows.length
  },
})

/**
 * Runs the brand mapping backwards: given a country and a generic name from
 * `patients.truth`, finds a brand from that country's dataset. Used by the
 * degrader, never by the forward extraction path. See
 * docs/adr/0010-degrader-is-template-driven.md.
 */
export const brandForGeneric = internalQuery({
  args: { country: v.string(), genericName: v.string() },
  returns: v.union(v.null(), v.string()),
  handler: async (ctx, { country, genericName }) => {
    const key = genericKeyFor(genericName)
    if (!key) return null

    const matches = await ctx.db
      .query('brands')
      .withIndex('by_country_and_genericKey', (q) =>
        q.eq('country', country.toUpperCase()).eq('genericKey', key),
      )
      .take(20)

    return matches.sort((a, b) => a.brand.length - b.brand.length)[0]?.brand ?? null
  },
})

/** One page of the `genericKey` backfill. Idempotent, so re-running is harmless. */
export const backfillGenericKeysBatch = internalMutation({
  args: { cursor: v.union(v.string(), v.null()) },
  returns: v.object({ isDone: v.boolean(), continueCursor: v.string(), patched: v.number() }),
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db.query('brands').paginate({ numItems: 1000, cursor })
    for (const row of page.page) {
      await ctx.db.patch(row._id, { genericKey: genericKeyFor(row.generic) })
    }
    return { isDone: page.isDone, continueCursor: page.continueCursor, patched: page.page.length }
  },
})

/**
 * Backfills `genericKey` on every row seeded before that field existed. A
 * one-off operator action, not part of `pnpm data:seed`.
 */
export const backfillGenericKeys = internalAction({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    let cursor: string | null = null
    let total = 0
    for (;;) {
      const result: { isDone: boolean; continueCursor: string; patched: number } = await ctx.runMutation(
        internal.brands.backfillGenericKeysBatch,
        { cursor },
      )
      total += result.patched
      if (result.isDone) break
      cursor = result.continueCursor
    }
    console.log(`[brands] backfilled genericKey on ${total} rows`)
    return total
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
