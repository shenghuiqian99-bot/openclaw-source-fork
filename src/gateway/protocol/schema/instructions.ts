import { Type } from "@sinclair/typebox";
import { NonBlankString, NonEmptyString } from "./primitives.js";

export const InstructionsDiagnosticsParamsSchema = Type.Object(
  {
    agentId: Type.Optional(NonBlankString),
    sessionKey: Type.Optional(NonBlankString),
    workspaceDir: Type.Optional(NonBlankString),
  },
  { additionalProperties: false },
);

export const InstructionDiagnosticsEntrySchema = Type.Object(
  {
    name: NonEmptyString,
    path: Type.Optional(Type.String()),
    missing: Type.Boolean(),
    kind: NonEmptyString,
    loadMode: NonEmptyString,
    order: Type.Optional(Type.Integer({ minimum: 0 })),
    frontMatterStripped: Type.Optional(Type.Boolean()),
    rulePaths: Type.Optional(Type.Array(Type.String())),
    matchedRuleContextPaths: Type.Optional(Type.Array(Type.String())),
    importErrors: Type.Optional(Type.Integer({ minimum: 0 })),
  },
  { additionalProperties: false },
);

export const InstructionDiagnosticsReportSchema = Type.Object(
  {
    agentId: NonEmptyString,
    sessionKey: NonEmptyString,
    sessionId: Type.Optional(Type.String()),
    updatedAt: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
    age: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
    generatedAt: Type.Integer({ minimum: 0 }),
    workspaceDir: Type.Union([Type.String(), Type.Null()]),
    total: Type.Integer({ minimum: 0 }),
    loaded: Type.Integer({ minimum: 0 }),
    missing: Type.Integer({ minimum: 0 }),
    importErrorCount: Type.Integer({ minimum: 0 }),
    entries: Type.Array(InstructionDiagnosticsEntrySchema),
  },
  { additionalProperties: false },
);

export const InstructionsDiagnosticsResultSchema = Type.Object(
  {
    reports: Type.Integer({ minimum: 0 }),
    byAgent: Type.Array(InstructionDiagnosticsReportSchema),
  },
  { additionalProperties: false },
);