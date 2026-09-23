/**
 * Export Service for NoosAdvisory Leads
 * Supports CSV and JSON exports with strict CSV formula injection mitigation (CWE-1236)
 * and RFC 4180 compliant escaping.
 */

/**
 * Sanitizes a cell value to prevent CSV Formula Injection (CWE-1236).
 * Neutralizes cells starting with '=', '+', '-', '@', or any ASCII control character (code <= 31 or code === 127),
 * even when preceded by spaces.
 * Enforces RFC 4180 escaping for commas, double quotes, newlines, and carriage returns.
 *
 * @param {any} value
 * @returns {string}
 */
export function sanitizeCsvCell(value) {
  if (value === null || value === undefined) {
    return '';
  }

  let str = String(value);

  // Check if string begins with, or has leading spaces followed by:
  // 1. Formula triggers: '=', '+', '-', '@'
  // 2. Any ASCII control character: code <= 31 or code === 127
  let shouldNeutralize = false;

  if (str.length > 0) {
    const firstCode = str.charCodeAt(0);
    if (firstCode <= 31 || firstCode === 127 || ['=', '+', '-', '@'].includes(str[0])) {
      shouldNeutralize = true;
    } else {
      // Check if preceded by spaces (ASCII 32 ' ')
      let idx = 0;
      while (idx < str.length && str.charCodeAt(idx) === 32) {
        idx++;
      }
      if (idx < str.length) {
        const nextCode = str.charCodeAt(idx);
        if (nextCode <= 31 || nextCode === 127 || ['=', '+', '-', '@'].includes(str[idx])) {
          shouldNeutralize = true;
        }
      }
    }
  }

  if (shouldNeutralize) {
    str = "'" + str;
  }

  // Standard RFC 4180 CSV escaping:
  // If the string contains comma, double quote, carriage return, or newline,
  // enclose it in double quotes and escape internal double quotes with double-quotes.
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }

  return str;
}

/**
 * Generates CSV string representation for a collection of lead records with triage and commercial actions.
 * @param {Array} leads
 * @returns {string}
 */
export function generateLeadsCsv(leads = []) {
  const headers = [
    'ID Solicitud',
    'Fecha Recepción',
    'Estado Lead',
    'Posible Duplicado',
    'Canal Ingesta',
    'Empresa',
    'Contacto',
    'Email',
    'Teléfono',
    'Tipo Solicitud',
    'Urgencia',
    'Resumen Alcance',
    'Versión Hechos',
    'Estado Borrador',
    'Responsable Asignado',
    'Tipo Próxima Acción',
    'Detalle Próxima Acción',
    'Fecha Límite Acción',
    'Estado Acción',
    'Texto Original'
  ];

  const headerLine = headers.map(h => sanitizeCsvCell(h)).join(',');

  const rows = leads.map(item => {
    const lead = item.lead || item;
    const facts = item.current_confirmed_facts || item.confirmed_facts || {};
    const draft = item.current_draft || {};
    const action = item.latest_action || item.action || {};

    const company = facts.company_name || lead.company_name || '';
    const contact = facts.contact_name || lead.sender_name || '';
    const email = facts.contact_email || lead.sender_email || '';
    const phone = facts.contact_phone || '';
    const reqType = facts.request_type || '';
    const urgency = facts.urgency || '';
    const scope = facts.scope_summary || '';
    const factsVersion = facts.version ? `v${facts.version}` : 'Sin confirmar';
    const draftStatus = draft.status || item.draft_status || 'SIN BORRADOR';
    const assignedUser = action.assigned_user_name || item.assigned_user_name || '';
    const actionType = action.action_type || item.latest_action_type || '';
    const actionDesc = action.description || item.latest_action_description || '';
    const actionDue = action.due_date || item.latest_action_due_date || '';
    const actionStatus = action.effective_status || action.status || item.latest_action_status || '';

    const values = [
      lead.id,
      lead.created_at,
      lead.status,
      lead.is_possible_duplicate ? 'SÍ' : 'NO',
      lead.source || 'MANUAL',
      company,
      contact,
      email,
      phone,
      reqType,
      urgency,
      scope,
      factsVersion,
      draftStatus,
      assignedUser,
      actionType,
      actionDesc,
      actionDue,
      actionStatus,
      lead.raw_text
    ];

    return values.map(v => sanitizeCsvCell(v)).join(',');
  });

  return [headerLine, ...rows].join('\r\n');
}

/**
 * Generates structured JSON export array containing leads, confirmed facts, drafts, and actions history.
 * @param {Array} leads
 * @returns {Array}
 */
export function generateLeadsJson(leads = []) {
  return leads.map(item => {
    const lead = item.lead || item;
    const facts = item.current_confirmed_facts || item.confirmed_facts || null;
    const factsHistory = item.confirmed_facts_history || [];
    const draft = item.current_draft || null;
    const draftsHistory = item.drafts_history || [];
    const actions = item.actions_history || item.actions || (item.latest_action ? [item.latest_action] : []);

    return {
      lead: {
        id: lead.id,
        idempotency_key: lead.idempotency_key,
        status: lead.status,
        source: lead.source,
        is_possible_duplicate: Boolean(lead.is_possible_duplicate),
        duplicate_of_lead_id: lead.duplicate_of_lead_id,
        sender_name: lead.sender_name,
        sender_email: lead.sender_email,
        company_name: lead.company_name,
        raw_text: lead.raw_text,
        created_at: lead.created_at,
        updated_at: lead.updated_at
      },
      confirmed_facts: facts,
      confirmed_facts_history: factsHistory,
      current_draft: draft,
      drafts_history: draftsHistory,
      actions: actions
    };
  });
}
