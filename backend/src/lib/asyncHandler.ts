import type { RequestHandler } from "express";
import { BadRequestError } from "./queryParams.js";

// Express 4 doesn't catch rejected promises from async handlers, so an unhandled
// rejection (e.g. Postgres is down) leaves the request hanging. Wrap handlers so
// any error becomes a response instead.
export function asyncHandler(handler: RequestHandler): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch((err) => {
      // A bad query string is the caller's mistake, not ours - surface it as a 400
      // with the reason, rather than the 500 an unvalidated `new Date("banana")`
      // used to produce once Postgres choked on it.
      if (err instanceof BadRequestError) {
        res.status(400).json({ error: err.message });
        return;
      }
      console.error(`[api] ${req.method} ${req.originalUrl} failed:`, err);
      res.status(500).json({ error: "internal server error" });
    });
  };
}
