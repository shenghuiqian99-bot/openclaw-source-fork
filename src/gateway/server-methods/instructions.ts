import { collectLatestInstructionDiagnostics } from "../../commands/instruction-diagnostics.js";
import { loadConfig } from "../../config/config.js";
import {
  ErrorCodes,
  errorShape,
  type InstructionsDiagnosticsParams,
  type InstructionsDiagnosticsResult,
  validateInstructionsDiagnosticsParams,
} from "../protocol/index.js";
import { formatError } from "../server-utils.js";
import { assertValidParams } from "./validation.js";
import type { GatewayRequestHandlers } from "./types.js";

export type InstructionDiagnosticsPayload = InstructionsDiagnosticsResult;

export const instructionsHandlers: GatewayRequestHandlers = {
  "instructions.diagnostics": ({ params, respond }) => {
    if (
      !assertValidParams(
        params,
        validateInstructionsDiagnosticsParams,
        "instructions.diagnostics",
        respond,
      )
    ) {
      return;
    }
    try {
      const cfg = loadConfig();
      const typedParams = params as InstructionsDiagnosticsParams;
      const byAgent = collectLatestInstructionDiagnostics(cfg, Date.now(), typedParams);
      const payload: InstructionDiagnosticsPayload = {
        reports: byAgent.length,
        byAgent,
      };
      respond(true, payload, undefined);
    } catch (err) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, `failed to load instruction diagnostics: ${formatError(err)}`),
      );
    }
  },
};