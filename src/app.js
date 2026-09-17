import express from 'express';
import cookieParser from 'cookie-parser';
import { 
  SESSION_COOKIE_NAME, 
  generateSessionToken, 
  hashSessionToken, 
  verifyPassword, 
  getSessionCookieOptions 
} from './auth.js';
import { 
  getUserByEmail, 
  createSession, 
  revokeSessionByTokenHash, 
  appendAuditLog, 
  getAuditLogs, 
  getActiveAiConfig,
  createLead,
  getLeadById,
  getLeadByIdempotencyKey,
  findPossibleDuplicateLead,
  updateLead,
  listLeads,
  createLeadExtraction,
  getLatestExtractionByLeadId,
  createLeadEvidenceBatch,
  getEvidenceByExtractionId,
  getEvidenceByLeadId,
  getDb
} from './db.js';
import { 
  csrfOriginProtection, 
  sessionMiddleware, 
  requireAuth, 
  requireRole 
} from './middleware.js';
import { extractLeadData, resolveEffectiveModel } from './extraction.js';
import crypto from 'node:crypto';

export function createApp(options = {}) {
  const app = express();
  const fetchFn = options.fetchFn || fetch;

  // Basic parsers
  app.use(express.json());
  app.use(cookieParser());

  // Security & Session middlewares
  app.use(csrfOriginProtection);
  app.use(sessionMiddleware);

  // Health check endpoint
  app.get('/api/health', (req, res) => {
    res.json({
      status: 'ok',
      environment: process.env.NODE_ENV || 'development',
      persistence: 'SQLite (local file)',
      timestamp: new Date().toISOString()
    });
  });

  // Auth: Login
  app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body || {};

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const user = getUserByEmail(email);
    if (!user || !user.is_active) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const isMatch = await verifyPassword(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Generate secure session token and compute hash
    const rawToken = generateSessionToken();
    const tokenHash = hashSessionToken(rawToken);

    // Persist session hash
    const session = createSession({
      userId: user.id,
      sessionTokenHash: tokenHash,
      durationHours: 24
    });

    // Append audit log for login
    appendAuditLog({
      eventType: 'USER_LOGIN',
      entityType: 'USER',
      entityId: user.id,
      actorUserId: user.id,
      newState: { email: user.email, role: user.role }
    });

    // Set HttpOnly cookie
    const cookieOptions = getSessionCookieOptions(req);
    res.cookie(SESSION_COOKIE_NAME, rawToken, cookieOptions);

    return res.json({
      message: 'Login successful',
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role
      },
      expiresAt: session.expiresAt
    });
  });

  // Auth: Logout
  app.post('/api/auth/logout', requireAuth, (req, res) => {
    if (req.sessionTokenHash) {
      revokeSessionByTokenHash(req.sessionTokenHash);
    }

    appendAuditLog({
      eventType: 'USER_LOGOUT',
      entityType: 'USER',
      entityId: req.user.id,
      actorUserId: req.user.id
    });

    const cookieOptions = getSessionCookieOptions(req);
    res.clearCookie(SESSION_COOKIE_NAME, cookieOptions);

    return res.json({ message: 'Logged out successfully' });
  });

  // Auth: Get current session profile
  app.get('/api/auth/me', requireAuth, (req, res) => {
    return res.json({
      user: req.user,
      expiresAt: req.session.expiresAt
    });
  });

  // Audit Logs: Admin only
  app.get('/api/audit-logs', requireRole('ADMIN'), (req, res) => {
    const limit = parseInt(req.query.limit, 10) || 50;
    const offset = parseInt(req.query.offset, 10) || 0;
    const entityType = req.query.entityType || null;
    const entityId = req.query.entityId || null;

    const logs = getAuditLogs({ limit, offset, entityType, entityId });
    return res.json({ logs, count: logs.length });
  });

  // AI Configuration: Read-only check
  app.get('/api/config', requireAuth, (req, res) => {
    const config = getActiveAiConfig('LEAD_EXTRACTION_CONFIG');
    if (!config) {
      return res.status(404).json({ error: 'Active AI config not found' });
    }

    return res.json({
      configKey: config.config_key,
      modelIdentifier: config.model_identifier,
      promptTemplate: config.prompt_template,
      version: config.version,
      updatedAt: config.updated_at
    });
  });

  // Leads: Analyze free text without creating a lead record
  app.post('/api/leads/analyze', requireAuth, async (req, res) => {
    const { text, model } = req.body || {};

    if (!text || typeof text !== 'string' || text.trim().length < 5) {
      return res.status(400).json({ error: 'El campo text es obligatorio y debe tener al menos 5 caracteres' });
    }

    if (text.length > 25000) {
      return res.status(400).json({ error: 'El texto excede el límite máximo permitido de 25.000 caracteres' });
    }

    try {
      const result = await extractLeadData({
        rawText: text,
        modelIdentifier: model || null,
        fetchFn,
        db: getDb()
      });

      return res.json({
        extraction: {
          modelIdentifier: result.modelIdentifier,
          promptVersion: result.promptVersion,
          schemaVersion: result.schemaVersion,
          latencyMs: result.latencyMs,
          isCommercial: result.sanitized.isCommercial,
          confidenceScore: result.sanitized.confidenceScore,
          contactName: result.sanitized.contactName,
          companyName: result.sanitized.companyName,
          contactEmail: result.sanitized.contactEmail,
          contactPhone: result.sanitized.contactPhone,
          requestType: result.sanitized.requestType,
          scopeSummary: result.sanitized.scopeSummary,
          urgency: result.sanitized.urgency,
          suggestedResponseDraft: result.sanitized.suggestedResponseDraft
        },
        evidence: result.sanitized.evidence,
        allEvidenceChecked: result.sanitized.allEvidenceChecked
      });
    } catch (err) {
      if (err.code === 'BLOCKED_BY_CREDENTIAL') {
        return res.status(503).json({
          error: 'Servicio de IA temporalmente no disponible: credencial no configurada en el entorno',
          code: 'BLOCKED_BY_CREDENTIAL'
        });
      }
      if (err.code === 'QUOTA_EXCEEDED') {
        return res.status(429).json({
          error: 'Cuota de Google Gemini API agotada (HTTP 429). Intente nuevamente más tarde o proceda manualmente.',
          code: 'QUOTA_EXCEEDED'
        });
      }
      if (err.code === 'TIMEOUT') {
        return res.status(504).json({
          error: 'Tiempo de espera agotado al consultar la IA. Intente nuevamente.',
          code: 'TIMEOUT'
        });
      }
      if (err.code === 'INVALID_MODEL_IDENTIFIER') {
        return res.status(400).json({
          error: err.message,
          code: 'INVALID_MODEL_IDENTIFIER'
        });
      }
      return res.status(502).json({
        error: `Fallo al procesar la solicitud con IA: ${err.message}`,
        code: err.code || 'EXTRACTION_FAILED'
      });
    }
  });

  // Leads: Ingestion, Idempotency and AI Extraction
  app.post('/api/leads', requireAuth, async (req, res) => {
    const { 
      raw_text, 
      idempotency_key, 
      sender_name, 
      sender_email, 
      company_name, 
      source = 'MANUAL',
      auto_analyze = true 
    } = req.body || {};

    const rawKey = idempotency_key || req.headers['x-idempotency-key'];

    if (!raw_text || typeof raw_text !== 'string' || raw_text.trim().length < 5) {
      return res.status(400).json({ error: 'El campo raw_text es obligatorio y debe tener al menos 5 caracteres' });
    }

    if (raw_text.length > 25000) {
      return res.status(400).json({ error: 'El texto excede el límite máximo permitido de 25.000 caracteres' });
    }

    // 1. Strict Idempotency Check: Existing key replay
    if (rawKey) {
      const existingLead = getLeadByIdempotencyKey(rawKey);
      if (existingLead) {
        const extraction = getLatestExtractionByLeadId(existingLead.id);
        const evidence = extraction ? getEvidenceByExtractionId(extraction.id) : [];
        res.set('X-Idempotent-Replay', 'true');
        return res.status(200).json({
          lead: existingLead,
          extraction,
          evidence,
          idempotent_replay: true
        });
      }
    }

    const key = rawKey || crypto.randomUUID();
    const textHash = crypto.createHash('sha256').update(raw_text.trim()).digest('hex');

    // 2. Possible Duplicate Detection (Does not auto-merge)
    const duplicateCandidate = findPossibleDuplicateLead({
      textHash,
      senderEmail: sender_email || null
    });

    const isPossibleDuplicate = duplicateCandidate ? 1 : 0;
    const duplicateOfLeadId = duplicateCandidate ? duplicateCandidate.id : null;

    // 3. Persist Lead in database
    const lead = createLead({
      idempotencyKey: key,
      textHash,
      rawText: raw_text,
      source,
      status: 'CAPTURED',
      isPossibleDuplicate,
      duplicateOfLeadId,
      senderName: sender_name || null,
      senderEmail: sender_email || null,
      companyName: company_name || null,
      createdByUserId: req.user.id
    });

    appendAuditLog({
      leadId: lead.id,
      eventType: 'LEAD_CAPTURED',
      entityType: 'LEAD',
      entityId: lead.id,
      actorUserId: req.user.id,
      newState: {
        idempotency_key: key,
        status: 'CAPTURED',
        is_possible_duplicate: isPossibleDuplicate,
        duplicate_of_lead_id: duplicateOfLeadId
      }
    });

    // 4. Extraction Motor (if auto_analyze is enabled)
    let extractionRecord = null;
    let evidenceRecords = [];
    let updatedLead = lead;

    if (auto_analyze !== false) {
      const effectiveModel = resolveEffectiveModel(null, getDb());
      try {
        const extractionResult = await extractLeadData({
          rawText: raw_text,
          fetchFn,
          db: getDb()
        });

        const { sanitized, latencyMs, modelIdentifier, promptVersion, schemaVersion } = extractionResult;

        // Persist extraction
        extractionRecord = createLeadExtraction({
          leadId: lead.id,
          modelIdentifier,
          promptVersion,
          schemaVersion,
          rawResponseJson: extractionResult.rawResponseJson,
          structuredOutputJson: extractionResult.structuredOutputJson,
          isCommercial: sanitized.isCommercial ? 1 : 0,
          confidenceScore: sanitized.confidenceScore,
          requestType: sanitized.requestType,
          scopeSummary: sanitized.scopeSummary,
          urgency: sanitized.urgency,
          suggestedResponseDraft: sanitized.suggestedResponseDraft,
          latencyMs,
          retryCount: extractionResult.retryCount || 0,
          status: 'SUCCESS'
        });

        // Persist evidence snippets
        if (sanitized.evidence && sanitized.evidence.length > 0) {
          evidenceRecords = createLeadEvidenceBatch(
            sanitized.evidence.map(ev => ({
              leadId: lead.id,
              extractionId: extractionRecord.id,
              fieldName: ev.fieldName,
              verbatimQuote: ev.verbatimQuote,
              charStart: ev.charStart,
              charEnd: ev.charEnd,
              isVerified: ev.isVerified
            }))
          );
        }

        // Update lead fields if extracted and not provided
        const updates = { status: 'ANALYZED' };
        if (!lead.company_name && sanitized.companyName) {
          updates.company_name = sanitized.companyName;
        }
        if (!lead.sender_name && sanitized.contactName) {
          updates.sender_name = sanitized.contactName;
        }
        if (!lead.sender_email && sanitized.contactEmail) {
          updates.sender_email = sanitized.contactEmail;
        }

        updatedLead = updateLead(lead.id, updates);

        appendAuditLog({
          leadId: lead.id,
          eventType: 'LEAD_ANALYZED',
          entityType: 'LEAD',
          entityId: lead.id,
          actorUserId: req.user.id,
          newState: {
            status: 'ANALYZED',
            extraction_id: extractionRecord.id,
            is_commercial: sanitized.isCommercial,
            confidence_score: sanitized.confidenceScore
          }
        });

      } catch (err) {
        // Record extraction failure without blocking or destroying the lead
        const status = ['TIMEOUT', 'QUOTA_EXCEEDED', 'VALIDATION_ERROR'].includes(err.code)
          ? err.code
          : 'FAILED';

        extractionRecord = createLeadExtraction({
          leadId: lead.id,
          modelIdentifier: err.modelIdentifier || effectiveModel,
          latencyMs: err.latencyMs || 0,
          retryCount: err.retryCount || 0,
          status,
          errorMessage: err.message,
          confidenceScore: 'NOT_FOUND',
          isCommercial: 0
        });

        appendAuditLog({
          leadId: lead.id,
          eventType: 'LEAD_EXTRACTION_FAILED',
          entityType: 'LEAD',
          entityId: lead.id,
          actorUserId: req.user.id,
          newState: {
            error_code: err.code || 'FAILED',
            error_message: err.message,
            status: 'CAPTURED'
          }
        });
      }
    }

    return res.status(201).json({
      lead: updatedLead,
      extraction: extractionRecord,
      evidence: evidenceRecords,
      is_possible_duplicate: isPossibleDuplicate === 1,
      duplicate_of_lead_id: duplicateOfLeadId
    });
  });

  // Leads: Get Lead by ID with Extraction and Evidence
  app.get('/api/leads/:id', requireAuth, (req, res) => {
    const lead = getLeadById(req.params.id);
    if (!lead) {
      return res.status(404).json({ error: 'Lead no encontrado' });
    }

    const extraction = getLatestExtractionByLeadId(lead.id);
    const evidence = extraction ? getEvidenceByExtractionId(extraction.id) : [];

    return res.json({
      lead,
      extraction,
      evidence
    });
  });

  // 404 handler
  app.use((req, res) => {
    res.status(404).json({ error: 'Endpoint not found' });
  });

  // Generic error handler
  app.use((err, req, res, next) => {
    console.error('Unhandled server error:', err);
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}
