/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as board from "../board.js";
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
import type * as lib_matchRecovery from "../lib/matchRecovery.js";
import type * as lib_normalisePatient from "../lib/normalisePatient.js";
import type * as lib_simClient from "../lib/simClient.js";
import type * as map from "../map.js";
import type * as patients from "../patients.js";
import type * as recovery from "../recovery.js";
import type * as review from "../review.js";
import type * as rules from "../rules.js";
import type * as sim from "../sim.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  board: typeof board;
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
  "lib/matchRecovery": typeof lib_matchRecovery;
  "lib/normalisePatient": typeof lib_normalisePatient;
  "lib/simClient": typeof lib_simClient;
  map: typeof map;
  patients: typeof patients;
  recovery: typeof recovery;
  review: typeof review;
  rules: typeof rules;
  sim: typeof sim;
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
