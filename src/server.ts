/**
 * Server entry point.
 *
 * Swaps the global `Response` for srvx's `FastResponse`, which has an
 * optimised `_toNodeResponse()` path. Worth roughly 5% throughput on the Node
 * deployment and costs nothing — it is the same interface.
 */
import { FastResponse } from 'srvx'

globalThis.Response = FastResponse as typeof Response
