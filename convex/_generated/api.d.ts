/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as brands from "../brands.js";
import type * as call from "../call.js";
import type * as dev from "../dev.js";
import type * as extract from "../extract.js";
import type * as extractDb from "../extractDb.js";
import type * as http from "../http.js";
import type * as lib_adjudicate from "../lib/adjudicate.js";
import type * as lib_agents from "../lib/agents.js";
import type * as lib_anchor from "../lib/anchor.js";
import type * as lib_confidence from "../lib/confidence.js";
import type * as lib_guard from "../lib/guard.js";
import type * as map from "../map.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  brands: typeof brands;
  call: typeof call;
  dev: typeof dev;
  extract: typeof extract;
  extractDb: typeof extractDb;
  http: typeof http;
  "lib/adjudicate": typeof lib_adjudicate;
  "lib/agents": typeof lib_agents;
  "lib/anchor": typeof lib_anchor;
  "lib/confidence": typeof lib_confidence;
  "lib/guard": typeof lib_guard;
  map: typeof map;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
