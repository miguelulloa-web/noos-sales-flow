import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
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
  saveConfirmedFacts,
  getCurrentConfirmedFactsByLeadId,
  getConfirmedFactsHistoryByLeadId,
  saveResponseDraft,
  getDraftById,
  getLatestDraftByLeadId,
  getDraftsHistoryByLeadId,
  updateResponseDraft,
  validateDraftForCopy,
  markDraftCopied,
  listLeadsWithTriageSummary,
  listActiveUsers,
  createLeadAction,
  completeLeadAction,
  cancelLeadAction,
  transitionOverdueActions,
  archiveLead,
  getActionsByLeadId,
  getLatestActionByLeadId,
  getExportLeadsBatch,
  getOperationalSummary,
  resetSyntheticDemoData,
  getDb
} from './db.js';
import {
  generateLeadsCsv,
  generateLeadsJson
} from './export_service.js';
import {
  parseDueDateToUtc,
  isActionOverdue
} from './time_service.js';
import { 
  csrfOriginProtection, 
  sessionMiddleware, 
  requireAuth, 
  requireRole 
} from './middleware.js';
import { extractLeadData, resolveEffectiveModel } from './extraction.js';
import { generateCommercialDraft } from './draft_generation.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function createApp(options = {}) {
  const app = express();
  const fetchFn = options.fetchFn || fetch;

  // Favicon handler to prevent 404 noise
  app.get('/favicon.ico', (req, res) => res.status(204).end());

  // Serve static assets from public/ directory
  app.use(express.static(path.join(__dirname, '..', 'public')));

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
    try {
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
    } catch (err) {
      console.error('Login error:', err);
      return res.status(500).json({ error: err.message, stack: err.stack });
    }
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
      status: 'PENDING_TRIAGE',
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
        status: 'PENDING_TRIAGE',
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
        const updates = { status: 'IN_REVIEW' };
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
            status: 'IN_REVIEW',
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
            status: 'PENDING_TRIAGE'
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

  // Leads: Master List for Triage with Filter tabs (Todas, Pendientes, Vencidas, Posibles Duplicados)
  app.get('/api/leads', requireAuth, (req, res) => {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 100);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
    const status = req.query.status || null;
    const filter = req.query.filter || null;
    const search = req.query.search || null;

    const leads = listLeadsWithTriageSummary({ limit, offset, status, filter, search });
    return res.json({ leads });
  });

  // Exports: Safe CSV export with formula injection mitigation (CWE-1236)
  app.get('/api/leads/export/csv', requireAuth, (req, res) => {
    const fullLeads = getExportLeadsBatch({ limit: 2000, offset: 0, includeHistory: false });
    const csvContent = generateLeadsCsv(fullLeads);
    const dateStr = new Date().toISOString().split('T')[0];
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="leads_export_${dateStr}.csv"`);
    return res.status(200).send(csvContent);
  });

  // Exports: Structured JSON export
  app.get('/api/leads/export/json', requireAuth, (req, res) => {
    const fullLeads = getExportLeadsBatch({ limit: 2000, offset: 0, includeHistory: true });
    const jsonContent = generateLeadsJson(fullLeads);
    const dateStr = new Date().toISOString().split('T')[0];
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="leads_export_${dateStr}.json"`);
    return res.status(200).json(jsonContent);
  });

  // Operators: List active users for commercial assignment dropdown
  app.get('/api/operators', requireAuth, (req, res) => {
    const operators = listActiveUsers();
    return res.json({ operators });
  });

  // Leads: Get Lead by ID with Extraction, Evidence, Confirmed Facts, Drafts, and Actions
  app.get('/api/leads/:id', requireAuth, (req, res) => {
    const lead = getLeadById(req.params.id);
    if (!lead) {
      return res.status(404).json({ error: 'Lead no encontrado' });
    }

    const extraction = getLatestExtractionByLeadId(lead.id);
    const evidence = extraction ? getEvidenceByExtractionId(extraction.id) : [];
    const currentConfirmedFacts = getCurrentConfirmedFactsByLeadId(lead.id);
    const confirmedFactsHistory = getConfirmedFactsHistoryByLeadId(lead.id);
    const currentDraft = getLatestDraftByLeadId(lead.id);
    const draftsHistory = getDraftsHistoryByLeadId(lead.id);
    const actions = getActionsByLeadId(lead.id);
    const latestAction = getLatestActionByLeadId(lead.id);

    return res.json({
      lead,
      extraction,
      evidence,
      current_confirmed_facts: currentConfirmedFacts,
      confirmed_facts_history: confirmedFactsHistory,
      current_draft: currentDraft,
      drafts_history: draftsHistory,
      actions,
      latest_action: latestAction
    });
  });

  // Actions: Assign commercial action to lead
  app.post('/api/leads/:id/actions', requireAuth, (req, res) => {
    const leadId = req.params.id;
    const { assigned_user_id, action_type, description, due_date } = req.body || {};

    try {
      const action = createLeadAction({
        leadId,
        assignedUserId: assigned_user_id,
        actionType: action_type,
        description,
        dueDate: due_date,
        actorUserId: req.user.id
      });
      return res.status(201).json({ status: 'ok', action });
    } catch (err) {
      if (err.code === 'ACTIVE_ACTION_EXISTS') {
        return res.status(409).json({ error: err.message, code: err.code });
      }
      if (err.code === 'USER_NOT_FOUND' || err.code === 'LEAD_NOT_FOUND') {
        return res.status(404).json({ error: err.message, code: err.code });
      }
      if (['MISSING_ASSIGNED_USER', 'INVALID_ACTION_TYPE', 'MISSING_ACTION_DESCRIPTION', 'INVALID_DUE_DATE', 'INVALID_DUE_DATE_NONEXISTENT', 'INVALID_DUE_DATE_AMBIGUOUS'].includes(err.code)) {
        return res.status(400).json({ error: err.message, code: err.code });
      }
      return res.status(500).json({ error: err.message });
    }
  });

  // Actions: Complete commercial action with result and optional next action
  app.post('/api/leads/:id/actions/:actionId/complete', requireAuth, (req, res) => {
    const leadId = req.params.id;
    const { actionId } = req.params;
    const { result_summary, next_action } = req.body || {};

    try {
      const result = completeLeadAction({
        leadId,
        actionId,
        resultSummary: result_summary,
        completedByUserId: req.user.id,
        nextAction: next_action ? {
          assignedUserId: next_action.assigned_user_id,
          actionType: next_action.action_type,
          description: next_action.description,
          dueDate: next_action.due_date
        } : null
      });
      return res.json({ status: 'ok', ...result });
    } catch (err) {
      if (err.code === 'ACTION_NOT_FOUND') {
        return res.status(404).json({ error: err.message, code: err.code });
      }
      if (['ACTION_ALREADY_COMPLETED', 'ACTION_ALREADY_CANCELLED'].includes(err.code)) {
        return res.status(409).json({ error: err.message, code: err.code });
      }
      if (['MISSING_RESULT_SUMMARY', 'MISSING_ASSIGNED_USER', 'INVALID_ACTION_TYPE', 'MISSING_ACTION_DESCRIPTION', 'INVALID_DUE_DATE', 'INVALID_DUE_DATE_NONEXISTENT', 'INVALID_DUE_DATE_AMBIGUOUS'].includes(err.code)) {
        return res.status(400).json({ error: err.message, code: err.code });
      }
      return res.status(500).json({ error: err.message });
    }
  });

  // Actions: Cancel commercial action
  app.post('/api/leads/:id/actions/:actionId/cancel', requireAuth, (req, res) => {
    const leadId = req.params.id;
    const { actionId } = req.params;
    const { cancellation_reason } = req.body || {};

    try {
      const action = cancelLeadAction({
        leadId,
        actionId,
        actorUserId: req.user.id,
        cancellationReason: cancellation_reason
      });
      return res.json({ status: 'ok', action });
    } catch (err) {
      if (err.code === 'ACTION_NOT_FOUND') {
        return res.status(404).json({ error: err.message, code: err.code });
      }
      if (['CANNOT_CANCEL_COMPLETED_ACTION', 'ACTION_ALREADY_CANCELLED'].includes(err.code)) {
        return res.status(409).json({ error: err.message, code: err.code });
      }
      return res.status(500).json({ error: err.message });
    }
  });

  // Actions: Get actions history for lead
  app.get('/api/leads/:id/actions', requireAuth, (req, res) => {
    const leadId = req.params.id;
    const lead = getLeadById(leadId);
    if (!lead) {
      return res.status(404).json({ error: 'Lead no encontrado' });
    }
    const actions = getActionsByLeadId(leadId);
    return res.json({ actions });
  });

  // Actions: Overdue transition batch/cron job
  app.post('/api/leads/overdue/transition', requireAuth, (req, res) => {
    const result = transitionOverdueActions(getDb(), new Date(), req.user.id);
    return res.json({ status: 'ok', ...result });
  });

  // Leads: Explicit archive endpoint
  app.post('/api/leads/:id/archive', requireAuth, (req, res) => {
    const leadId = req.params.id;
    const { reason } = req.body || {};
    try {
      const lead = archiveLead({ leadId, reason, actorUserId: req.user.id });
      return res.json({ status: 'ok', lead });
    } catch (err) {
      if (err.code === 'LEAD_NOT_FOUND') {
        return res.status(404).json({ error: err.message, code: err.code });
      }
      return res.status(500).json({ error: err.message });
    }
  });

  // Confirmed Facts: Save and version confirmed facts (atomically invalidates older drafts to STALE)
  app.post('/api/leads/:id/confirmed-facts', requireAuth, (req, res) => {
    const leadId = req.params.id;
    const lead = getLeadById(leadId);
    if (!lead) {
      return res.status(404).json({ error: 'Lead no encontrado' });
    }

    const {
      contact_name,
      company_name,
      contact_email,
      contact_phone,
      request_type,
      scope_summary,
      urgency
    } = req.body || {};

    const validRequestTypes = ['QUOTE', 'INQUIRY', 'DEMO', 'OTHER'];
    if (!request_type || !validRequestTypes.includes(request_type)) {
      return res.status(400).json({ 
        error: `request_type inválido. Debe ser uno de: ${validRequestTypes.join(', ')}`,
        code: 'INVALID_REQUEST_TYPE'
      });
    }

    const rawScope = req.body?.scope_summary || req.body?.scopeSummary;
    if (!rawScope || typeof rawScope !== 'string' || rawScope.trim().length < 3) {
      return res.status(400).json({
        error: 'scope_summary es requerido y debe tener al menos 3 caracteres',
        code: 'INVALID_SCOPE_SUMMARY'
      });
    }

    const validUrgencies = ['LOW', 'MEDIUM', 'HIGH'];
    if (!urgency || !validUrgencies.includes(urgency)) {
      return res.status(400).json({
        error: `urgency inválida. Debe ser una de: ${validUrgencies.join(', ')}`,
        code: 'INVALID_URGENCY'
      });
    }

    try {
      const result = saveConfirmedFacts({
        leadId,
        contactName: contact_name ? contact_name.trim() : null,
        companyName: company_name ? company_name.trim() : null,
        contactEmail: contact_email ? contact_email.trim() : null,
        contactPhone: contact_phone ? contact_phone.trim() : null,
        requestType: request_type,
        scopeSummary: rawScope.trim(),
        urgency,
        confirmedByUserId: req.user.id
      });

      return res.status(201).json({
        confirmed_facts: result.confirmedFacts,
        stale_drafts_count: result.staleDraftsCount
      });
    } catch (err) {
      console.error('Error al guardar hechos confirmados:', err);
      return res.status(500).json({ error: err.message, code: 'SAVE_FAILED' });
    }
  });

  // Drafts: Generate commercial response draft based exclusively on confirmed facts
  app.post('/api/leads/:id/drafts/generate', requireAuth, async (req, res) => {
    const leadId = req.params.id;
    const lead = getLeadById(leadId);
    if (!lead) {
      return res.status(404).json({ error: 'Lead no encontrado' });
    }

    const currentFacts = getCurrentConfirmedFactsByLeadId(leadId);
    if (!currentFacts) {
      return res.status(400).json({
        error: 'No se puede generar borrador sin hechos confirmados vigentes',
        code: 'NO_CONFIRMED_FACTS'
      });
    }

    try {
      const result = await generateCommercialDraft({
        confirmedFacts: currentFacts,
        fetchFn,
        db: getDb()
      });

      const savedDraft = saveResponseDraft({
        leadId,
        confirmedFactsVersion: currentFacts.version,
        modelIdentifier: result.modelIdentifier,
        promptVersion: result.promptVersion,
        initialDraftText: result.draftText,
        status: 'GENERATED',
        reviewedByUserId: req.user.id
      });

      return res.status(201).json({
        draft: savedDraft,
        latency_ms: result.latencyMs,
        retry_count: result.retryCount
      });
    } catch (err) {
      if (err.code === 'FACTS_VERSION_CHANGED') {
        return res.status(409).json({
          error: 'Los hechos confirmados cambiaron durante la generación. El borrador quedó en estado STALE; por favor regenere.',
          code: 'FACTS_VERSION_CHANGED',
          draft: err.draft,
          current_version: err.currentVersion
        });
      }
      if (err.code === 'NO_CONFIRMED_FACTS') {
        return res.status(400).json({ error: err.message, code: 'NO_CONFIRMED_FACTS' });
      }
      if (err.code === 'BLOCKED_BY_CREDENTIAL') {
        return res.status(503).json({
          error: 'Servicio de generación de borrador no disponible: credencial no configurada',
          code: 'BLOCKED_BY_CREDENTIAL'
        });
      }
      if (err.code === 'QUOTA_EXCEEDED') {
        return res.status(429).json({
          error: 'Cuota de Google Gemini API agotada (HTTP 429)',
          code: 'QUOTA_EXCEEDED'
        });
      }
      if (err.code === 'TIMEOUT') {
        return res.status(504).json({
          error: 'Tiempo de espera agotado al generar el borrador con la IA',
          code: 'TIMEOUT'
        });
      }
      return res.status(502).json({
        error: `Fallo al generar borrador con IA: ${err.message}`,
        code: err.code || 'DRAFT_GENERATION_FAILED'
      });
    }
  });

  // Drafts: Manual edition of response draft
  app.patch('/api/leads/:id/drafts/:draftId', requireAuth, (req, res) => {
    const leadId = req.params.id;
    const { draftId } = req.params;
    const { edited_text } = req.body || {};

    if (typeof edited_text !== 'string' || !edited_text.trim()) {
      return res.status(400).json({
        error: 'edited_text es requerido',
        code: 'INVALID_EDITED_TEXT'
      });
    }

    try {
      const updated = updateResponseDraft({
        draftId,
        leadId,
        editedText: edited_text.trim(),
        reviewedByUserId: req.user.id
      });

      return res.json({ draft: updated });
    } catch (err) {
      if (err.code === 'DRAFT_NOT_FOUND') {
        return res.status(404).json({ error: err.message, code: 'DRAFT_NOT_FOUND' });
      }
      if (err.code === 'DRAFT_STALE') {
        return res.status(409).json({
          error: 'No se puede editar un borrador en estado STALE',
          code: 'DRAFT_STALE'
        });
      }
      if (err.code === 'DRAFT_DISCARDED') {
        return res.status(409).json({
          error: 'No se puede editar un borrador descartado (DISCARDED)',
          code: 'DRAFT_DISCARDED'
        });
      }
      return res.status(500).json({ error: err.message, code: 'UPDATE_FAILED' });
    }
  });

  // Drafts: Pre-authorize draft copy (validates lead ownership and STALE state without altering DB or audit)
  app.post('/api/leads/:id/drafts/:draftId/copy-authorize', requireAuth, (req, res) => {
    const leadId = req.params.id;
    const { draftId } = req.params;

    try {
      const draft = validateDraftForCopy({
        draftId,
        leadId
      });

      return res.json({
        status: 'ok',
        authorized: true,
        draft
      });
    } catch (err) {
      if (err.code === 'DRAFT_NOT_FOUND') {
        return res.status(404).json({ error: err.message, code: 'DRAFT_NOT_FOUND' });
      }
      if (err.code === 'DRAFT_STALE') {
        return res.status(409).json({
          error: 'Borrador desactualizado (STALE) no puede ser copiado',
          code: 'DRAFT_STALE'
        });
      }
      if (err.code === 'DRAFT_DISCARDED') {
        return res.status(409).json({
          error: 'No se puede copiar un borrador descartado (DISCARDED)',
          code: 'DRAFT_DISCARDED'
        });
      }
      if (err.code === 'DRAFT_NOT_CURRENT') {
        return res.status(409).json({
          error: err.message,
          code: 'DRAFT_NOT_CURRENT'
        });
      }
      return res.status(500).json({ error: err.message, code: 'AUTHORIZATION_FAILED' });
    }
  });

  // Drafts: Confirm draft copied (registers status and appends DRAFT_COPIED to audit log)
  const handleCopyConfirmation = (req, res) => {
    const leadId = req.params.id;
    const { draftId } = req.params;

    try {
      const updated = markDraftCopied({
        draftId,
        leadId,
        reviewedByUserId: req.user.id
      });

      return res.json({
        status: 'ok',
        draft: updated
      });
    } catch (err) {
      if (err.code === 'DRAFT_NOT_FOUND') {
        return res.status(404).json({ error: err.message, code: 'DRAFT_NOT_FOUND' });
      }
      if (err.code === 'DRAFT_STALE') {
        return res.status(409).json({
          error: 'Borrador desactualizado (STALE) no puede ser copiado',
          code: 'DRAFT_STALE'
        });
      }
      if (err.code === 'DRAFT_DISCARDED') {
        return res.status(409).json({
          error: 'No se puede copiar un borrador descartado (DISCARDED)',
          code: 'DRAFT_DISCARDED'
        });
      }
      if (err.code === 'DRAFT_NOT_CURRENT') {
        return res.status(409).json({
          error: err.message,
          code: 'DRAFT_NOT_CURRENT'
        });
      }
      return res.status(500).json({ error: err.message, code: 'COPY_FAILED' });
    }
  };

  app.post('/api/leads/:id/drafts/:draftId/copy-confirm', requireAuth, handleCopyConfirmation);

  // Operational Summary Endpoint (MVP-10)
  app.get('/api/operational-summary', requireAuth, (req, res) => {
    try {
      const summary = getOperationalSummary(getDb());
      res.json(summary);
    } catch (err) {
      res.status(500).json({ error: 'Error al obtener el resumen operativo', code: 'SUMMARY_FAILED' });
    }
  });

  // Controlled Synthetic Demo Data Administration (MVP-13)
  app.post('/api/admin/reset-demo-data', requireAuth, requireRole('ADMIN'), (req, res) => {
    const { confirmation } = req.body || {};
    if (confirmation !== 'RESET_SYNTHETIC_DEMO_DATA') {
      return res.status(400).json({
        error: 'Se requiere confirmación explícita (confirmation: "RESET_SYNTHETIC_DEMO_DATA") para restablecer datos sintéticos.',
        code: 'CONFIRMATION_REQUIRED'
      });
    }

    try {
      const result = resetSyntheticDemoData(req.user.id, getDb());
      const summary = getOperationalSummary(getDb());
      res.json({
        success: true,
        message: 'Datos sintéticos de demostración restablecidos con éxito.',
        result,
        summary
      });
    } catch (err) {
      res.status(err.code === 'FORBIDDEN_ROLE' ? 403 : 500).json({
        error: err.message,
        code: err.code || 'RESET_FAILED'
      });
    }
  });

  // Drafts: Manual draft creation/replacement without AI (MVP-11 Continuidad Manual)
  app.post('/api/leads/:id/drafts/manual', requireAuth, (req, res) => {
    const leadId = req.params.id;
    const { draft_text } = req.body || {};

    if (typeof draft_text !== 'string' || !draft_text.trim()) {
      return res.status(400).json({
        error: 'El texto del borrador manual es obligatorio',
        code: 'INVALID_DRAFT_TEXT'
      });
    }

    try {
      const currentFacts = getCurrentConfirmedFactsByLeadId(leadId);
      if (!currentFacts) {
        return res.status(400).json({
          error: 'No se puede crear un borrador sin hechos confirmados previos',
          code: 'FACTS_REQUIRED'
        });
      }

      const draft = saveResponseDraft({
        leadId,
        confirmedFactsVersion: currentFacts.version,
        modelIdentifier: 'MANUAL_OPERATOR',
        promptVersion: 'NONE',
        initialDraftText: draft_text.trim(),
        editedText: draft_text.trim(),
        status: 'EDITED',
        reviewedByUserId: req.user.id
      });

      return res.status(201).json({ draft });
    } catch (err) {
      return res.status(500).json({ error: err.message, code: 'MANUAL_DRAFT_FAILED' });
    }
  });

  // Deprecated direct copy route: explicitly rejected with 410 to prevent bypassing copy-authorize and client writeText
  app.all('/api/leads/:id/drafts/:draftId/copy', (req, res) => {
    return res.status(410).json({
      error: 'Endpoint retirado. La copia exige el flujo estricto copy-authorize y confirmación posterior copy-confirm.',
      code: 'ENDPOINT_DEPRECATED'
    });
  });

  // 404 handler
  app.use((req, res) => {
    res.status(404).json({ error: 'Endpoint not found' });
  });

  // Generic error handler
  app.use((err, req, res, next) => {
    console.error('Unhandled server error:', err);
    res.status(500).json({ error: 'Internal server error', message: err.message, stack: err.stack });
  });

  return app;
}

