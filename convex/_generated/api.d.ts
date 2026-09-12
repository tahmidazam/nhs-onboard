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
import type * as degrade from "../degrade.js";
import type * as dev from "../dev.js";
import type * as http from "../http.js";
import type * as lib_degradeConstants from "../lib/degradeConstants.js";
import type * as lib_degradeRecord from "../lib/degradeRecord.js";
import type * as lib_matchRecovery from "../lib/matchRecovery.js";
import type * as lib_normalisePatient from "../lib/normalisePatient.js";
import type * as lib_simClient from "../lib/simClient.js";
import type * as meds from "../meds.js";
import type * as patients from "../patients.js";
import type * as recovery from "../recovery.js";
import type * as rules from "../rules.js";
import type * as sim from "../sim.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  brands: typeof brands;
  call: typeof call;
  degrade: typeof degrade;
  dev: typeof dev;
  http: typeof http;
  "lib/degradeConstants": typeof lib_degradeConstants;
  "lib/degradeRecord": typeof lib_degradeRecord;
  "lib/matchRecovery": typeof lib_matchRecovery;
  "lib/normalisePatient": typeof lib_normalisePatient;
  "lib/simClient": typeof lib_simClient;
  meds: typeof meds;
  patients: typeof patients;
  recovery: typeof recovery;
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
