import { executeDraftCopy } from './clipboard_workflow.js';

// Noos Sales Flow — Frontend Client Application (TP-03)
(function () {
  let currentUser = null;
  let activeLeadId = null;
  let activeLeadData = null;
  let leadsCache = [];

  // DOM Elements
  const loginModal = document.getElementById('loginModal');
  const loginForm = document.getElementById('loginForm');
  const loginEmail = document.getElementById('loginEmail');
  const loginPassword = document.getElementById('loginPassword');
  const loginError = document.getElementById('loginError');
  const userPill = document.getElementById('userPill');
  const userName = document.getElementById('userName');
  const userRole = document.getElementById('userRole');
  const btnLogout = document.getElementById('btnLogout');

  const btnOpenNewLeadModal = document.getElementById('btnOpenNewLeadModal');
  const newLeadModal = document.getElementById('newLeadModal');
  const btnCloseNewLeadModal = document.getElementById('btnCloseNewLeadModal');
  const btnCancelNewLead = document.getElementById('btnCancelNewLead');
  const newLeadForm = document.getElementById('newLeadForm');
  const newLeadText = document.getElementById('newLeadText');
  const newLeadIdempKey = document.getElementById('newLeadIdempKey');
  const newLeadError = document.getElementById('newLeadError');
  const btnSubmitNewLead = document.getElementById('btnSubmitNewLead');

  const leadsListContainer = document.getElementById('leadsListContainer');
  const searchLeadsInput = document.getElementById('searchLeadsInput');
  const statusFilter = document.getElementById('statusFilter');
  const leadCountLabel = document.getElementById('leadCountLabel');

  const emptyDetailState = document.getElementById('emptyDetailState');
  const activeDetailContent = document.getElementById('activeDetailContent');
  const leadHeaderCompany = document.getElementById('leadHeaderCompany');
  const leadHeaderContact = document.getElementById('leadHeaderContact');
  const leadHeaderEmail = document.getElementById('leadHeaderEmail');
  const leadHeaderId = document.getElementById('leadHeaderId');
  const leadStatusBadge = document.getElementById('leadStatusBadge');
  const leadUrgencyBadge = document.getElementById('leadUrgencyBadge');

  const leadRawText = document.getElementById('leadRawText');
  const leadSource = document.getElementById('leadSource');
  const leadCreatedAt = document.getElementById('leadCreatedAt');

  const aiModelBadge = document.getElementById('aiModelBadge');
  const aiConfidenceScore = document.getElementById('aiConfidenceScore');
  const aiIsCommercial = document.getElementById('aiIsCommercial');
  const aiRetryCount = document.getElementById('aiRetryCount');
  const evidenceListContainer = document.getElementById('evidenceListContainer');

  const confirmedFactsForm = document.getElementById('confirmedFactsForm');
  const factsVersionBadge = document.getElementById('factsVersionBadge');
  const factsAuthorMeta = document.getElementById('factsAuthorMeta');
  const factContactName = document.getElementById('factContactName');
  const factCompanyName = document.getElementById('factCompanyName');
  const factContactEmail = document.getElementById('factContactEmail');
  const factContactPhone = document.getElementById('factContactPhone');
  const factRequestType = document.getElementById('factRequestType');
  const factUrgency = document.getElementById('factUrgency');
  const factScopeSummary = document.getElementById('factScopeSummary');
  const btnSaveFacts = document.getElementById('btnSaveFacts');
  const factsSaveFeedback = document.getElementById('factsSaveFeedback');

  const draftStatusBadge = document.getElementById('draftStatusBadge');
  const draftVersionMeta = document.getElementById('draftVersionMeta');
  const staleWarningBanner = document.getElementById('staleWarningBanner');
  const draftTextarea = document.getElementById('draftTextarea');
  const btnSaveDraftEdit = document.getElementById('btnSaveDraftEdit');
  const btnGenerateDraft = document.getElementById('btnGenerateDraft');
  const btnGenerateDraftLabel = document.getElementById('btnGenerateDraftLabel');
  const btnCopyDraft = document.getElementById('btnCopyDraft');
  const appToast = document.getElementById('appToast');

  function showToast(message, duration = 3500) {
    appToast.textContent = message;
    appToast.style.display = 'flex';
    appToast.style.opacity = '1';
    setTimeout(() => {
      appToast.style.opacity = '0';
      setTimeout(() => {
        appToast.style.display = 'none';
      }, 300);
    }, duration);
  }

  async function apiRequest(url, options = {}) {
    const headers = {
      'Content-Type': 'application/json',
      ...options.headers
    };
    const res = await fetch(url, {
      ...options,
      headers
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
  }

  // Session & Auth
  async function checkSession() {
    const res = await apiRequest('/api/auth/me');
    if (res.ok && res.data?.user) {
      currentUser = res.data.user;
      renderUserSession();
      loginModal.style.display = 'none';
      loadLeads();
    } else {
      currentUser = null;
      loginModal.style.display = 'flex';
    }
  }

  function renderUserSession() {
    if (currentUser) {
      userName.textContent = currentUser.name;
      userRole.textContent = currentUser.role;
      userPill.style.display = 'flex';
      btnLogout.style.display = 'inline-flex';
    } else {
      userPill.style.display = 'none';
      btnLogout.style.display = 'none';
    }
  }

  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    loginError.style.display = 'none';
    const email = loginEmail.value.trim();
    const password = loginPassword.value;

    const res = await apiRequest('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password })
    });

    if (res.ok && res.data?.user) {
      currentUser = res.data.user;
      renderUserSession();
      loginModal.style.display = 'none';
      showToast(`Bienvenido, ${currentUser.name}`);
      loadLeads();
    } else {
      loginError.textContent = res.data?.error || 'Credenciales inválidas';
      loginError.style.display = 'block';
    }
  });

  btnLogout.addEventListener('click', async () => {
    await apiRequest('/api/auth/logout', { method: 'POST' });
    currentUser = null;
    activeLeadId = null;
    renderUserSession();
    loginModal.style.display = 'flex';
  });

  // Leads loading & list rendering
  async function loadLeads() {
    const search = searchLeadsInput.value.trim();
    const status = statusFilter.value;
    const query = new URLSearchParams();
    if (search) query.set('search', search);
    if (status) query.set('status', status);

    const res = await apiRequest(`/api/leads?${query.toString()}`);
    if (res.ok && res.data?.leads) {
      leadsCache = res.data.leads;
      renderLeadsList();
    }
  }

  function renderLeadsList() {
    leadsListContainer.innerHTML = '';
    leadCountLabel.textContent = `${leadsCache.length} solicitud${leadsCache.length === 1 ? '' : 'es'}`;

    if (leadsCache.length === 0) {
      leadsListContainer.innerHTML = `
        <div style="padding: 24px; text-align: center; color: var(--text-muted); font-size: 13px;">
          No se encontraron solicitudes.
        </div>
      `;
      return;
    }

    leadsCache.forEach(lead => {
      const card = document.createElement('div');
      card.className = `lead-card ${lead.id === activeLeadId ? 'active' : ''}`;
      card.setAttribute('role', 'option');
      card.setAttribute('aria-selected', lead.id === activeLeadId ? 'true' : 'false');
      card.setAttribute('data-id', lead.id);

      const company = lead.company_name || 'Sin empresa identificada';
      const contact = lead.sender_name || lead.sender_email || 'Sin contacto';
      const statusClass = lead.status === 'TRIAGED' ? 'badge-triaged' : (lead.status === 'ANALYZED' ? 'badge-generated' : 'badge-captured');

      let draftBadge = '';
      if (lead.draft_status === 'STALE') {
        draftBadge = '<span class="badge badge-stale">STALE</span>';
      } else if (lead.draft_status === 'GENERATED' || lead.draft_status === 'EDITED') {
        draftBadge = `<span class="badge badge-generated">Borrador v${lead.draft_facts_version || 1}</span>`;
      } else if (lead.draft_status === 'APPROVED_COPIED') {
        draftBadge = '<span class="badge badge-copied">Copiado</span>';
      }

      let factsBadge = lead.confirmed_facts_version 
        ? `<span class="badge" style="background:#e0f2fe; color:#0369a1;">Hechos v${lead.confirmed_facts_version}</span>`
        : '<span class="badge" style="background:#f1f5f9; color:#64748b;">Pendiente</span>';

      card.innerHTML = `
        <div class="lead-card-header">
          <div class="lead-card-title">${escapeHtml(company)}</div>
          <span class="badge ${statusClass}">${lead.status}</span>
        </div>
        <div class="lead-card-company">${escapeHtml(contact)}</div>
        <div class="lead-card-meta">
          ${factsBadge}
          ${draftBadge}
        </div>
      `;

      card.addEventListener('click', () => {
        selectLead(lead.id);
      });

      leadsListContainer.appendChild(card);
    });
  }

  // Selecting a lead and loading detail
  async function selectLead(leadId) {
    activeLeadId = leadId;
    renderLeadsList(); // Updates active class in list

    emptyDetailState.style.display = 'none';
    activeDetailContent.style.display = 'flex';

    const res = await apiRequest(`/api/leads/${leadId}`);
    if (res.ok && res.data?.lead) {
      activeLeadData = res.data;
      renderLeadDetail();
    } else {
      showToast('Error al cargar detalle del lead');
    }
  }

  function renderLeadDetail() {
    const { lead, extraction, evidence, current_confirmed_facts, current_draft } = activeLeadData;

    // Header info
    leadHeaderCompany.textContent = lead.company_name || 'Sin empresa confirmada';
    leadHeaderContact.textContent = lead.sender_name || 'Sin nombre';
    leadHeaderEmail.textContent = lead.sender_email || 'Sin correo';
    leadHeaderId.textContent = lead.id.slice(0, 8);
    leadStatusBadge.textContent = lead.status;
    leadStatusBadge.className = `badge ${lead.status === 'TRIAGED' ? 'badge-triaged' : 'badge-captured'}`;

    // Immutable raw text
    leadRawText.textContent = lead.raw_text;
    leadSource.textContent = lead.source || 'MANUAL';
    leadCreatedAt.textContent = new Date(lead.created_at).toLocaleString('es-CL');

    // AI Extraction and evidence
    if (extraction) {
      aiModelBadge.textContent = extraction.model_identifier;
      aiConfidenceScore.textContent = extraction.confidence_score;
      aiIsCommercial.textContent = extraction.is_commercial ? 'Sí' : 'No';
      aiRetryCount.textContent = extraction.retry_count || 0;
      leadUrgencyBadge.textContent = `URGENCIA: ${extraction.urgency || 'MEDIA'}`;
    } else {
      aiModelBadge.textContent = 'Sin extracción';
      aiConfidenceScore.textContent = '-';
      aiIsCommercial.textContent = '-';
      aiRetryCount.textContent = '0';
    }

    // Evidence citations
    evidenceListContainer.innerHTML = '';
    if (evidence && evidence.length > 0) {
      evidence.forEach(ev => {
        const item = document.createElement('div');
        item.className = 'evidence-item';
        item.innerHTML = `
          <div class="evidence-field">${escapeHtml(ev.field_name)} &bull; ${ev.is_verified ? '<span style="color:var(--success-text);">✓ Verificada</span>' : '<span style="color:var(--danger-text);">✗ No verificada</span>'}</div>
          <div class="evidence-quote">"${escapeHtml(ev.verbatim_quote)}"</div>
        `;
        evidenceListContainer.appendChild(item);
      });
    } else {
      evidenceListContainer.innerHTML = '<div style="font-size: 12px; color: var(--text-muted); padding: 8px;">No hay citas de evidencia registradas.</div>';
    }

    // Confirmed Facts Form
    if (current_confirmed_facts) {
      factsVersionBadge.textContent = `Versión Vigente: v${current_confirmed_facts.version}`;
      factsVersionBadge.style.backgroundColor = '#e0f2fe';
      factsVersionBadge.style.color = '#0369a1';
      factsAuthorMeta.textContent = `Confirmado por ${current_confirmed_facts.confirmed_by_user_name || 'Consultor'} el ${new Date(current_confirmed_facts.confirmed_at).toLocaleTimeString('es-CL')}`;

      factContactName.value = current_confirmed_facts.contact_name || '';
      factCompanyName.value = current_confirmed_facts.company_name || '';
      factContactEmail.value = current_confirmed_facts.contact_email || '';
      factContactPhone.value = current_confirmed_facts.contact_phone || '';
      factRequestType.value = current_confirmed_facts.request_type || 'QUOTE';
      factUrgency.value = current_confirmed_facts.urgency || 'MEDIUM';
      factScopeSummary.value = current_confirmed_facts.scope_summary || '';
      btnSaveFacts.textContent = `Guardar Hechos Confirmados (v${current_confirmed_facts.version + 1})`;
    } else {
      // Pre-populate with AI extraction proposals if available
      factsVersionBadge.textContent = 'Sin hechos confirmados';
      factsVersionBadge.style.backgroundColor = '#f1f5f9';
      factsVersionBadge.style.color = '#64748b';
      factsAuthorMeta.textContent = 'Propuesta inicial sugerida por IA (requiere confirmación)';

      factContactName.value = lead.sender_name || '';
      factCompanyName.value = lead.company_name || '';
      factContactEmail.value = lead.sender_email || '';
      factContactPhone.value = '';
      factRequestType.value = extraction?.request_type || 'QUOTE';
      factUrgency.value = extraction?.urgency || 'MEDIUM';
      factScopeSummary.value = extraction?.scope_summary || '';
      btnSaveFacts.textContent = 'Guardar Hechos Confirmados (v1)';
    }

    // Response Draft
    renderDraftSection(current_draft, current_confirmed_facts);
  }

  function renderDraftSection(draft, currentFacts) {
    if (!draft) {
      draftStatusBadge.textContent = 'SIN BORRADOR';
      draftStatusBadge.className = 'badge badge-status';
      draftVersionMeta.textContent = '';
      staleWarningBanner.style.display = 'none';
      draftTextarea.value = '';
      draftTextarea.disabled = true;
      btnSaveDraftEdit.disabled = true;
      btnCopyDraft.disabled = true;
      btnGenerateDraftLabel.textContent = 'Generar Borrador con IA';
      return;
    }

    draftTextarea.disabled = false;
    draftTextarea.value = draft.edited_text || draft.initial_draft_text;
    draftVersionMeta.textContent = `Basado en hechos v${draft.confirmed_facts_version} · Modelo: ${draft.model_identifier}`;

    if (draft.status === 'STALE') {
      draftStatusBadge.textContent = 'DESACTUALIZADO (STALE)';
      draftStatusBadge.className = 'badge badge-stale';
      staleWarningBanner.style.display = 'flex';
      btnCopyDraft.disabled = true;
      btnSaveDraftEdit.disabled = true;
      btnGenerateDraftLabel.textContent = `Regenerar Borrador con hechos v${currentFacts?.version || 'vigente'}`;
    } else {
      staleWarningBanner.style.display = 'none';
      btnCopyDraft.disabled = false;
      btnSaveDraftEdit.disabled = false;
      btnGenerateDraftLabel.textContent = 'Regenerar Borrador';

      if (draft.status === 'APPROVED_COPIED') {
        draftStatusBadge.textContent = 'COPIADO';
        draftStatusBadge.className = 'badge badge-copied';
      } else if (draft.status === 'EDITED') {
        draftStatusBadge.textContent = 'EDITADO MANUALMENTE';
        draftStatusBadge.className = 'badge badge-triaged';
      } else {
        draftStatusBadge.textContent = 'GENERADO VIGENTE';
        draftStatusBadge.className = 'badge badge-generated';
      }
    }
  }

  // Save Confirmed Facts
  confirmedFactsForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!activeLeadId) return;

    btnSaveFacts.disabled = true;
    factsSaveFeedback.textContent = 'Guardando confirmación...';

    const payload = {
      contact_name: factContactName.value.trim() || null,
      company_name: factCompanyName.value.trim() || null,
      contact_email: factContactEmail.value.trim() || null,
      contact_phone: factContactPhone.value.trim() || null,
      request_type: factRequestType.value,
      urgency: factUrgency.value,
      scope_summary: factScopeSummary.value.trim()
    };

    const res = await apiRequest(`/api/leads/${activeLeadId}/confirmed-facts`, {
      method: 'POST',
      body: JSON.stringify(payload)
    });

    btnSaveFacts.disabled = false;

    if (res.ok && res.data?.confirmed_facts) {
      factsSaveFeedback.textContent = `✓ Hechos confirmados v${res.data.confirmed_facts.version} guardados con éxito.`;
      showToast(`Hechos confirmados v${res.data.confirmed_facts.version} guardados.`);
      setTimeout(() => { factsSaveFeedback.textContent = ''; }, 3000);
      
      // Reload active lead details to reflect updated facts and STALE draft state
      selectLead(activeLeadId);
      loadLeads();
    } else {
      factsSaveFeedback.textContent = `Error: ${res.data?.error || 'No se pudo guardar'}`;
    }
  });

  // Generate Draft
  btnGenerateDraft.addEventListener('click', async () => {
    if (!activeLeadId) return;
    btnGenerateDraft.disabled = true;
    const originalLabel = btnGenerateDraftLabel.textContent;
    btnGenerateDraftLabel.textContent = 'Generando borrador con Gemini...';

    const res = await apiRequest(`/api/leads/${activeLeadId}/drafts/generate`, {
      method: 'POST'
    });

    btnGenerateDraft.disabled = false;
    btnGenerateDraftLabel.textContent = originalLabel;

    if (res.ok && res.data?.draft) {
      showToast('Borrador de respuesta generado con éxito');
      selectLead(activeLeadId);
      loadLeads();
    } else {
      showToast(`Error: ${res.data?.error || 'Fallo al generar borrador'}`);
    }
  });

  // Save Manual Draft Edit
  btnSaveDraftEdit.addEventListener('click', async () => {
    if (!activeLeadId || !activeLeadData?.current_draft) return;
    const draftId = activeLeadData.current_draft.id;
    const editedText = draftTextarea.value.trim();

    if (!editedText) {
      showToast('El borrador no puede estar vacío');
      return;
    }

    const res = await apiRequest(`/api/leads/${activeLeadId}/drafts/${draftId}`, {
      method: 'PATCH',
      body: JSON.stringify({ edited_text: editedText })
    });

    if (res.ok && res.data?.draft) {
      showToast('Ajustes del borrador guardados');
      selectLead(activeLeadId);
    } else {
      showToast(`Error al guardar edición: ${res.data?.error || 'Desconocido'}`);
    }
  });

  // Copy Draft to Clipboard
  btnCopyDraft.addEventListener('click', async () => {
    if (!activeLeadId || !activeLeadData?.current_draft) return;
    const draft = activeLeadData.current_draft;
    const textToCopy = draftTextarea.value.trim();

    btnCopyDraft.disabled = true;
    try {
      await executeDraftCopy({
        leadId: activeLeadId,
        draft,
        textToCopy,
        apiReq: apiRequest,
        onToast: showToast,
        onReload: () => selectLead(activeLeadId)
      });
    } finally {
      btnCopyDraft.disabled = false;
    }
  });

  // New Lead Modal Actions
  btnOpenNewLeadModal.addEventListener('click', () => {
    newLeadModal.style.display = 'flex';
    newLeadText.value = '';
    newLeadIdempKey.value = `lead-${Date.now()}`;
    newLeadError.style.display = 'none';
    newLeadText.focus();
  });

  function closeNewLeadModal() {
    newLeadModal.style.display = 'none';
  }

  btnCloseNewLeadModal.addEventListener('click', closeNewLeadModal);
  btnCancelNewLead.addEventListener('click', closeNewLeadModal);

  newLeadForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    newLeadError.style.display = 'none';
    btnSubmitNewLead.disabled = true;
    btnSubmitNewLead.textContent = 'Procesando con IA...';

    const raw_text = newLeadText.value.trim();
    const idempotency_key = newLeadIdempKey.value.trim() || `lead-${Date.now()}`;

    const res = await apiRequest('/api/leads', {
      method: 'POST',
      body: JSON.stringify({ raw_text, idempotency_key, source: 'MANUAL' })
    });

    btnSubmitNewLead.disabled = false;
    btnSubmitNewLead.textContent = 'Procesar e Ingestar';

    if (res.ok && res.data?.lead) {
      showToast('Solicitud comercial capturada y procesada');
      closeNewLeadModal();
      await loadLeads();
      selectLead(res.data.lead.id);
    } else {
      newLeadError.textContent = res.data?.error || 'Error al procesar la solicitud';
      newLeadError.style.display = 'block';
    }
  });

  // Filter & Search events
  searchLeadsInput.addEventListener('input', debounce(loadLeads, 300));
  statusFilter.addEventListener('change', loadLeads);

  function debounce(func, delay) {
    let timeout;
    return (...args) => {
      clearTimeout(timeout);
      timeout = setTimeout(() => func(...args), delay);
    };
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // Initialize
  checkSession();
})();
