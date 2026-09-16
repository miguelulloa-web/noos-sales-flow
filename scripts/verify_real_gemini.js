import 'dotenv/config';
import { callGeminiApi, validateAndSanitizeExtraction } from '../src/extraction.js';

async function main() {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    console.log(JSON.stringify({
      status: 'BLOCKED_BY_CREDENTIAL',
      message: 'GEMINI_API_KEY no está configurada en el entorno local de Noos Sales Flow (.env o variables del host).',
      empirical_test: 'SKIPPED'
    }, null, 2));
    process.exit(2);
  }

  // Completely synthetic and new test inquiry
  const syntheticInquiry = "Hola equipo de NoosAdvisory, mi nombre es Fernando Morales de Retail Austral S.A. (f.morales@retailaustral.cl). Requerimos cotización formal para consultoría de optimización comercial y triage de solicitudes. Favor contactar esta semana.";

  console.log('[EMPIRICAL_TEST] Ejecutando prueba empírica con Gemini real...');
  const startTime = Date.now();

  try {
    const result = await callGeminiApi({
      rawText: syntheticInquiry,
      modelIdentifier: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
      apiKey
    });

    const sanitized = validateAndSanitizeExtraction(syntheticInquiry, result.parsedOutput);
    const latencyMs = Date.now() - startTime;

    console.log(JSON.stringify({
      status: 'PASS',
      model: result.modelIdentifier,
      latency_ms: latencyMs,
      extraction: {
        is_commercial: sanitized.isCommercial,
        confidence_score: sanitized.confidenceScore,
        contact_name: sanitized.contactName,
        company_name: sanitized.companyName,
        contact_email: sanitized.contactEmail,
        request_type: sanitized.requestType,
        scope_summary: sanitized.scopeSummary,
        urgency: sanitized.urgency
      },
      evidence_count: sanitized.evidence.length,
      evidence_snippets: sanitized.evidence.map(e => ({
        field: e.fieldName,
        quote: e.verbatimQuote,
        verified: e.isVerified
      }))
    }, null, 2));

    process.exit(0);
  } catch (err) {
    console.error(JSON.stringify({
      status: 'FAILED',
      error_code: err.code || 'UNKNOWN',
      error_message: err.message
    }, null, 2));
    process.exit(1);
  }
}

main();
