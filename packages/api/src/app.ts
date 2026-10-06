// packages/api/src/app.ts
/**
 * App factory, separated from server.ts so tests can build and exercise
 * the full route tree via Fastify's inject() without binding a real port.
 */

import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import { loadPack } from "./packLoader.js";
import { buildSourcesResponse } from "./sources.js";
import { buildPublicCitationMap } from "./publicCitations.js";
import {
  adaptPack,
  buildFeatureMetaFromPack,
  buildCitationResolver,
  type SessionConfig as EngineSessionConfig,
} from "@cds/engine";
import { CANDIDATE_IDS, CARE_SETTINGS } from "@cds/shared-types";
import { SessionManager, createSessionStore } from "@cds/session-store";
import {
  createSessionSchema,
  submitEvidenceSchema,
  correctEvidenceSchema,
  sessionIdParamSchema,
  deferSchema,
} from "./schemas.js";

export interface BuildAppOptions {
  packPath: string;
  logger?: boolean;
}

export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const fastify = Fastify({
    logger: options.logger ?? false,
    ajv: {
      customOptions: {
        allowUnionTypes: true,
      },
    },
  });

  // Vite dev server (5173) and this API (3000) are different origins, so the
  // browser sends a preflight OPTIONS request ahead of every POST.
  await fastify.register(cors, {
    origin: ["http://localhost:5173"],
    methods: ["GET", "POST", "PATCH", "OPTIONS"],
  });

  const pack = await loadPack(options.packPath);

  // A care setting is servable only if EVERY condition (shadows included) has
  // a prior for it. evaluate() throws otherwise, which would surface as a 500
  // on the request that completes the minimum safety set. Reject at intake.
  const supportedCareSettings = CARE_SETTINGS.filter((cs) =>
    Object.values(pack.conditions).every((c) => c.priors[cs] !== undefined)
  );

  const adaptedConditions = adaptPack(pack.conditions);

  // A question may be ASKED only if a reportable condition declares it. A
  // feature declared solely by the hidden conditions has wording that can
  // name them (e.g. "triggered by anxiety/panic"), and asking it would tell
  // the clinician those hypotheses exist. Shadows still take part in the
  // probability maths; this only narrows which questions are offered.
  const inScopeIds: ReadonlySet<string> = new Set<string>(CANDIDATE_IDS);
  const askableFeatureIds = new Set<string>(
    Object.values(pack.conditions)
      .filter((c) => inScopeIds.has(c.condition_id))
      .flatMap((c) => c.features.map((f) => f.feature_id))
  );
  const featureMeta = Object.fromEntries(
    Object.entries(buildFeatureMetaFromPack(pack.conditions)).filter(([featureId]) =>
      askableFeatureIds.has(featureId)
    )
  );

  const baseEngineConfig: Omit<EngineSessionConfig, "careSetting"> = {
    conditions: adaptedConditions,
    inScopeConditionIds: CANDIDATE_IDS,
    featureMeta,
    resolveCitation: buildCitationResolver(pack.conditions),
    strictCitations: true,
    // Pack stores raw ratios (e.g. PERC_RULE lr: 0.17 / 1.28), not log-space.
    lrScale: "RAW",
  };

  // Citations that support only the UNKNOWN aggregate are replaced by one
  // neutral id wherever they leave the server (trace and /sources).
  const publicCitations = buildPublicCitationMap(pack);

  const store = createSessionStore();
  const sessionManager = new SessionManager(
    store,
    baseEngineConfig,
    pack.redFlags,
    pack.featuresRegistry,
    publicCitations.publicId
  );

  // ================================================================
  // GET /health
  // ================================================================
  fastify.get("/health", async () => {
    return {
      status: "ok",
      knowledgePackVersion: pack.knowledgePackVersion,
      knowledgePackHash: pack.knowledgePackHash,
      supportedCareSettings,
    };
  });

  // ================================================================
  // GET /sources
  // ================================================================
  fastify.get("/sources", async () => {
    return buildSourcesResponse(pack);
  });

  // ================================================================
  // POST /session
  // ================================================================
  fastify.post<{
    Body: {
      careSetting: string;
      patientAge: number;
      patientSex: "MALE" | "FEMALE" | "INTERSEX" | "UNKNOWN";
      patientPregnancy?: string;
    };
  }>("/session", { schema: createSessionSchema }, async (request, reply) => {
    const { careSetting, patientAge, patientSex, patientPregnancy } = request.body;

    if (!(supportedCareSettings as readonly string[]).includes(careSetting)) {
      return reply.code(422).send({
        error:
          `Care setting ${careSetting} is not supported by the loaded knowledge pack. ` +
          `Supported: ${supportedCareSettings.join(", ")}`,
      });
    }

    try {
      const session = await sessionManager.createSession({
        careSetting,
        patientAge,
        patientSex,
        patientPregnancy: patientPregnancy as any,
      });
      return reply.code(201).send(session);
    } catch (err) {
      request.log.error(err);
      return reply.code(500).send({ error: "Failed to create session" });
    }
  });

  // ================================================================
  // GET /session/:id
  // ================================================================
  fastify.get<{ Params: { id: string } }>(
    "/session/:id",
    { schema: sessionIdParamSchema },
    async (request, reply) => {
      const session = await sessionManager.getSession(request.params.id);
      if (!session) {
        return reply.code(404).send({ error: "Session not found" });
      }
      return session;
    }
  );

  // ================================================================
  // GET /session/:id/trace
  // ================================================================
  fastify.get<{ Params: { id: string } }>(
    "/session/:id/trace",
    { schema: sessionIdParamSchema },
    async (request, reply) => {
      const session = await sessionManager.getSession(request.params.id);
      if (!session) {
        return reply.code(404).send({ error: "Session not found" });
      }
      return {
        sessionId: request.params.id,
        evidenceLog: session.evidenceLog,
        trace: session.trace,
        distribution: session.distribution,
        haltRule: session.haltRule,
        halted: session.halted,
      };
    }
  );

  // ================================================================
  // POST /session/:id/evidence
  // ================================================================
  fastify.post<{
    Params: { id: string };
    Body: {
      featureId: string;
      value: string;
      rawValue?: number | string;
      source: "MEASURED" | "OBSERVED" | "PATIENT_REPORTED" | "CARER_REPORTED" | "RECORD";
      observedAt: string;
      observerConfidence: "HIGH" | "MEDIUM" | "LOW";
    };
  }>("/session/:id/evidence", { schema: submitEvidenceSchema }, async (request, reply) => {
    const { id } = request.params;

    try {
      const session = await sessionManager.submitEvidence(id, request.body);
      return session;
    } catch (err) {
      const message = (err as Error).message;
      if (message.includes("not found")) {
        return reply.code(404).send({ error: message });
      }
      if (message.includes("halted")) {
        return reply.code(423).send({ error: message });
      }
      if (message.includes("Canonicalisation failed")) {
        return reply.code(422).send({ error: message });
      }
      request.log.error(err);
      return reply.code(500).send({ error: "Internal error processing evidence" });
    }
  });

  // ================================================================
  // POST /session/:id/evidence/:eid
  // ================================================================
  fastify.post<{
    Params: { id: string; eid: string };
    Body: {
      featureId: string;
      value: string;
      rawValue?: number | string;
      source: "MEASURED" | "OBSERVED" | "PATIENT_REPORTED" | "CARER_REPORTED" | "RECORD";
      observedAt: string;
      observerConfidence: "HIGH" | "MEDIUM" | "LOW";
    };
  }>(
    "/session/:id/evidence/:eid",
    { schema: correctEvidenceSchema },
    async (request, reply) => {
      const { id, eid } = request.params;

      try {
        const session = await sessionManager.correctEvidence(id, eid, {
          ...request.body,
          evidenceId: eid,
        });
        return session;
      } catch (err) {
        const message = (err as Error).message;
        if (message.includes("not found")) {
          return reply.code(404).send({ error: message });
        }
        if (message.includes("Canonicalisation failed")) {
          return reply.code(422).send({ error: message });
        }
        request.log.error(err);
        return reply.code(500).send({ error: "Internal error processing correction" });
      }
    }
  );

  // ================================================================
  // POST /session/:id/defer
  // ================================================================
  fastify.post<{
    Params: { id: string };
    Body: { featureId: string };
  }>("/session/:id/defer", { schema: deferSchema }, async (request, reply) => {
    const { id } = request.params;

    try {
      const session = await sessionManager.deferQuestion(id, request.body.featureId);
      return session;
    } catch (err) {
      const message = (err as Error).message;
      if (message.includes("not found")) {
        return reply.code(404).send({ error: message });
      }
      if (message.includes("halted")) {
        return reply.code(423).send({ error: message });
      }
      request.log.error(err);
      return reply.code(500).send({ error: "Internal error processing deferral" });
    }
  });

  return fastify;
}