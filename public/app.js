import { executeDraftCopy } from './clipboard_workflow.js';

// Noos Sales Flow — Frontend Client Application (TP-04 Commercial Tracking & Inbox Filters)
(function () {
  let currentUser = null;
  let activeLeadId = null;
  let activeLeadData = null;
  let leadsCache = [];
  let currentFilter = '';
  let operatorsList = [];
  let isCreatingNewManualDraft = false;

  // DOM Elements - Auth & Header
  const loginModal = document.getElementById('loginModal');
  const loginForm = document.getElementById('loginForm');
  const loginEmail = document.getElementById('loginEmail');
  const loginPassword = document.getElementById('loginPassword');
  const loginError = document.getElementById('loginError');
  const userPill = document.getElementById('userPill');
  const userName = document.getElementById('userName');
  const userRole = document.getElementById('userRole');
  const btnLogout = document.getElementById('btnLogout');

  // Export Buttons
  const btnExportCsv = document.getElementById('btnExportCsv');
  const btnExportJson = document.getElementById('btnExportJson');

  // Ingestion Modal
  const btnOpenNewLeadModal = document.getElementById('btnOpenNewLeadModal');
  const newLeadModal = document.getElementById('newLeadModal');
  const btnCloseNewLeadModal = document.getElementById('btnCloseNewLeadModal');
  const btnCancelNewLead = document.getElementById('btnCancelNewLead');
  const newLeadForm = document.getElementById('newLeadForm');
  const newLeadText = document.getElementById('newLeadText');
  const newLeadIdempKey = document.getElementById('newLeadIdempKey');
  const newLeadError = document.getElementById('newLeadError');
  const btnSubmitNewLead = document.getElementById('btnSubmitNewLead');

  // Master Toolbar & Filter Tabs
  const leadsListContainer = document.getElementById('leadsListContainer');
  const searchLeadsInput = document.getElementById('searchLeadsInput');
  const statusFilter = document.getElementById('statusFilter');
  const leadCountLabel = document.getElementById('leadCountLabel');
  const tabFilterAll = document.getElementById('tabFilterAll');
  const tabFilterPending = document.getElementById('tabFilterPending');
  const tabFilterOverdue = document.getElementById('tabFilterOverdue');
  const tabFilterDuplicates = document.getElementById('tabFilterDuplicates');

  // Detail Panel Elements
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

  // AI & Evidence
  const aiModelBadge = document.getElementById('aiModelBadge');
  const aiConfidenceScore = document.getElementById('aiConfidenceScore');
  const aiIsCommercial = document.getElementById('aiIsCommercial');
  const aiRetryCount = document.getElementById('aiRetryCount');
  const evidenceListContainer = document.getElementById('evidenceListContainer');

  // Confirmed Facts
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

  // Supervised Draft
  const draftStatusBadge = document.getElementById('draftStatusBadge');
  const draftVersionMeta = document.getElementById('draftVersionMeta');
  const staleWarningBanner = document.getElementById('staleWarningBanner');
  const draftTextarea = document.getElementById('draftTextarea');
  const btnSaveDraftEdit = document.getElementById('btnSaveDraftEdit');
  const btnGenerateDraft = document.getElementById('btnGenerateDraft');
  const btnGenerateDraftLabel = document.getElementById('btnGenerateDraftLabel');
  const btnCopyDraft = document.getElementById('btnCopyDraft');
  const appToast = document.getElementById('appToast');

  // Commercial Action Section (TP-04)
  const actionStatusBadge = document.getElementById('actionStatusBadge');
  const btnArchiveLead = document.getElementById('btnArchiveLead');
  const activeActionContainer = document.getElementById('activeActionContainer');
  const actionTypeTitle = document.getElementById('actionTypeTitle');
  const actionAssignedName = document.getElementById('actionAssignedName');
  const actionDueDate = document.getElementById('actionDueDate');
  const actionEffectiveBadge = document.getElementById('actionEffectiveBadge');
  const actionDescriptionText = document.getElementById('actionDescriptionText');
  const btnOpenCompleteActionModal = document.getElementById('btnOpenCompleteActionModal');
  const btnCancelAction = document.getElementById('btnCancelAction');

  const assignActionFormContainer = document.getElementById('assignActionFormContainer');
  const assignActionForm = document.getElementById('assignActionForm');
  const actionAssigneeSelect = document.getElementById('actionAssigneeSelect');
  const actionTypeSelect = document.getElementById('actionTypeSelect');
  const actionDescriptionInput = document.getElementById('actionDescriptionInput');
  const actionDueDateInput = document.getElementById('actionDueDateInput');
  const btnSubmitNewAction = document.getElementById('btnSubmitNewAction');

  const completeActionModal = document.getElementById('completeActionModal');
  const completeActionForm = document.getElementById('completeActionForm');
  const actionResultSummaryInput = document.getElementById('actionResultSummaryInput');
  const chkScheduleNextAction = document.getElementById('chkScheduleNextAction');
  const nextActionFieldsBox = document.getElementById('nextActionFieldsBox');
  const nextActionTypeSelect = document.getElementById('nextActionTypeSelect');
  const nextActionDescInput = document.getElementById('nextActionDescInput');
  const nextActionDueDateInput = document.getElementById('nextActionDueDateInput');
  const btnCloseCompleteActionModal = document.getElementById('btnCloseCompleteActionModal');
  const btnCancelCompleteAction = document.getElementById('btnCancelCompleteAction');
  const actionsHistoryContainer = document.getElementById('actionsHistoryContainer');

  // Operational Summary Bar (MVP-10)
  const operationalSummaryBar = document.getElementById('operationalSummaryBar');
  const summaryTotalLeads = document.getElementById('summaryTotalLeads');
  const summaryInReview = document.getElementById('summaryInReview');
  const summaryInTracking = document.getElementById('summaryInTracking');
  const summaryOverdue = document.getElementById('summaryOverdue');
  const summaryResponded = document.getElementById('summaryResponded');
  const summaryAiErrors = document.getElementById('summaryAiErrors');
  const summaryAvgLatency = document.getElementById('summaryAvgLatency');
  const btnRefreshSummary = document.getElementById('btnRefreshSummary');

  // Admin Reset Modal (MVP-13)
  const btnResetDemoData = document.getElementById('btnResetDemoData');
  const resetDemoModal = document.getElementById('resetDemoModal');
  const btnCloseResetDemoModal = document.getElementById('btnCloseResetDemoModal');
  const btnCancelResetDemo = document.getElementById('btnCancelResetDemo');
  const btnConfirmResetDemo = document.getElementById('btnConfirmResetDemo');

  // Contingency & Manual Draft (MVP-11)
  const aiContingencyNotice = document.getElementById('aiContingencyNotice');
  const btnCreateManualDraft = document.getElementById('btnCreateManualDraft');

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
      await loadOperators();
      await loadLeads();
      await fetchOperationalSummary();
    } else {
      currentUser = null;
      renderUserSession();
      loginModal.style.display = 'flex';
    }
  }

  function renderUserSession() {
    if (currentUser) {
      userName.textContent = currentUser.name;
      userRole.textContent = currentUser.role;
      userPill.style.display = 'flex';
      btnLogout.style.display = 'inline-flex';
      if (btnResetDemoData) {
        btnResetDemoData.style.display = currentUser.role === 'ADMIN' ? 'inline-flex' : 'none';
      }
    } else {
      userPill.style.display = 'none';
      btnLogout.style.display = 'none';
      if (btnResetDemoData) btnResetDemoData.style.display = 'none';
      if (operationalSummaryBar) operationalSummaryBar.style.display = 'none';
    }
  }

  // Real Operational Summary (MVP-10)
  async function fetchOperationalSummary() {
    if (!currentUser) return;
    try {
      const res = await apiRequest('/api/operational-summary');
      if (!res.ok || !res.data) return;
      const data = res.data;
      if (summaryTotalLeads) summaryTotalLeads.textContent = data.totalLeads ?? 0;
      if (summaryInReview) summaryInReview.textContent = ((data.pendingTriage || 0) + (data.inReview || 0));
      if (summaryInTracking) summaryInTracking.textContent = data.confirmed ?? 0;
      if (summaryOverdue) {
        summaryOverdue.textContent = data.overdueActions ?? 0;
        summaryOverdue.className = (data.overdueActions > 0) ? 'chip-val chip-danger' : 'chip-val';
      }
      if (summaryResponded) summaryResponded.textContent = ((data.responded || 0) + (data.archived || 0));
      if (summaryAiErrors) {
        summaryAiErrors.textContent = data.observedAiErrors ?? 0;
        summaryAiErrors.className = (data.observedAiErrors > 0) ? 'chip-val chip-danger' : 'chip-val';
      }
      if (summaryAvgLatency) summaryAvgLatency.textContent = data.avgAiLatencyMs > 0 ? `${data.avgAiLatencyMs} ms` : '—';
      if (operationalSummaryBar) operationalSummaryBar.style.display = 'block';
    } catch (e) {
      console.warn('Error fetching operational summary:', e);
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
      await loadOperators();
      await loadLeads();
      await fetchOperationalSummary();
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

  // Operators Loader
  async function loadOperators() {
    const res = await apiRequest('/api/operators');
    if (res.ok && res.data?.operators) {
      operatorsList = res.data.operators;
      actionAssigneeSelect.innerHTML = '<option value="">Seleccione un responsable...</option>';
      operatorsList.forEach(op => {
        const opt = document.createElement('option');
        opt.value = op.id;
        opt.textContent = `${op.name} (${op.role})`;
        actionAssigneeSelect.appendChild(opt);
      });
      // Pre-select current user if operator
      if (currentUser && operatorsList.some(o => o.id === currentUser.id)) {
        actionAssigneeSelect.value = currentUser.id;
      }
    }
  }

  // Leads Loading & Filtering
  async function loadLeads() {
    const search = searchLeadsInput.value.trim();
    const status = statusFilter.value;
    const query = new URLSearchParams();
    if (search) query.set('search', search);
    if (status) query.set('status', status);
    if (currentFilter) query.set('filter', currentFilter);

    const res = await apiRequest(`/api/leads?${query.toString()}`);
    if (res.ok && res.data?.leads) {
      leadsCache = res.data.leads;
      renderLeadsList();
    }
  }

  function getStatusBadgeClass(status) {
    switch (status) {
      case 'PENDING_TRIAGE': return 'badge-pending_triage';
      case 'IN_REVIEW': return 'badge-in_review';
      case 'CONFIRMED': return 'badge-confirmed';
      case 'RESPONDED': return 'badge-responded';
      case 'ARCHIVED': return 'badge-archived';
      default: return 'badge-pending_triage';
    }
  }

  function renderLeadsList() {
    leadsListContainer.innerHTML = '';
    leadCountLabel.textContent = `${leadsCache.length} solicitud${leadsCache.length === 1 ? '' : 'es'}`;

    if (leadsCache.length === 0) {
      leadsListContainer.innerHTML = `
        <div style="padding: 24px; text-align: center; color: var(--text-muted); font-size: 13px;">
          No se encontraron solicitudes con los filtros aplicados.
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
      const statusClass = getStatusBadgeClass(lead.status);

      // Draft badge
      let draftBadge = '';
      if (lead.draft_status === 'STALE') {
        draftBadge = '<span class="badge badge-stale">STALE</span>';
      } else if (lead.draft_status === 'GENERATED' || lead.draft_status === 'EDITED') {
        draftBadge = `<span class="badge badge-generated">Borrador v${lead.draft_facts_version || 1}</span>`;
      } else if (lead.draft_status === 'APPROVED_COPIED') {
        draftBadge = '<span class="badge badge-copied">Copiado</span>';
      }

      // Facts badge
      let factsBadge = lead.confirmed_facts_version 
        ? `<span class="badge" style="background:#e0f2fe; color:#0369a1;">Hechos v${lead.confirmed_facts_version}</span>`
        : '<span class="badge" style="background:#f1f5f9; color:#64748b;">Sin hechos</span>';

      // Commercial Action badge in inbox
      let actionBadge = '';
      if (lead.effective_action_status === 'OVERDUE') {
        actionBadge = '<span class="badge badge-action-overdue">VENCIDA</span>';
      } else if (lead.effective_action_status === 'PENDING') {
        actionBadge = '<span class="badge badge-action-pending">Acción PEND</span>';
      } else if (lead.is_possible_duplicate) {
        actionBadge = '<span class="badge" style="background:#fef3c7; color:#b45309;">Duplicado</span>';
      }

      card.innerHTML = `
        <div class="lead-card-header">
          <div class="lead-card-title">${escapeHtml(company)}</div>
          <span class="badge ${statusClass}">${lead.status}</span>
        </div>
        <div class="lead-card-company">${escapeHtml(contact)}</div>
        <div class="lead-card-meta">
          ${factsBadge}
          ${draftBadge}
          ${actionBadge}
        </div>
      `;

      card.addEventListener('click', () => {
        selectLead(lead.id);
      });

      leadsListContainer.appendChild(card);
    });
  }

  // Filter Tabs Event Listeners
  const filterTabs = [
    { btn: tabFilterAll, filter: '' },
    { btn: tabFilterPending, filter: 'pending' },
    { btn: tabFilterOverdue, filter: 'overdue' },
    { btn: tabFilterDuplicates, filter: 'duplicates' }
  ];

  filterTabs.forEach(({ btn, filter }) => {
    btn.addEventListener('click', () => {
      filterTabs.forEach(t => t.btn.classList.remove('active'));
      btn.classList.add('active');
      currentFilter = filter;
      loadLeads();
    });
  });

  // Export handlers
  btnExportCsv.addEventListener('click', () => {
    window.location.href = '/api/leads/export/csv';
  });

  btnExportJson.addEventListener('click', () => {
    window.location.href = '/api/leads/export/json';
  });

  // Selecting a lead and loading detail
  async function selectLead(leadId) {
    activeLeadId = leadId;
    isCreatingNewManualDraft = false;
    renderLeadsList();

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

  function formatChileanDateTime(isoStr) {
    if (!isoStr) return '-';
    try {
      const d = new Date(isoStr);
      return new Intl.DateTimeFormat('es-CL', {
        timeZone: 'America/Santiago',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      }).format(d) + ' (CL)';
    } catch {
      return isoStr;
    }
  }

  function getDefaultDueDatetimeLocal() {
    // Tomorrow at 18:00
    const now = new Date();
    now.setDate(now.getDate() + 1);
    now.setHours(18, 0, 0, 0);
    const pad = (n) => String(n).padStart(2, '0');
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
  }

  function renderLeadDetail() {
    const { lead, extraction, evidence, current_confirmed_facts, current_draft, actions } = activeLeadData;

    // Header info
    leadHeaderCompany.textContent = lead.company_name || 'Sin empresa confirmada';
    leadHeaderContact.textContent = lead.sender_name || 'Sin nombre';
    leadHeaderEmail.textContent = lead.sender_email || 'Sin correo';
    leadHeaderId.textContent = lead.id.slice(0, 8);
    leadStatusBadge.textContent = lead.status;
    leadStatusBadge.className = `badge ${getStatusBadgeClass(lead.status)}`;

    // Immutable raw text
    leadRawText.textContent = lead.raw_text;
    leadSource.textContent = lead.source || 'MANUAL';
    leadCreatedAt.textContent = formatChileanDateTime(lead.created_at);

    // AI Extraction and evidence
    if (extraction) {
      aiModelBadge.textContent = extraction.model_identifier;
      aiConfidenceScore.textContent = extraction.confidence_score;
      aiIsCommercial.textContent = extraction.is_commercial ? 'Sí' : 'No';
      aiRetryCount.textContent = extraction.retry_count || 0;
      leadUrgencyBadge.textContent = `URGENCIA: ${extraction.urgency || 'MEDIA'}`;
      if (['FAILED', 'QUOTA_EXCEEDED', 'TIMEOUT', 'VALIDATION_ERROR'].includes(extraction.status)) {
        if (aiContingencyNotice) {
          aiContingencyNotice.style.display = 'block';
          aiContingencyNotice.innerHTML = `⚠️ <strong>Continuidad Manual (IA en Contingencia):</strong> Extracción registrada como <code>${escapeHtml(extraction.status)}</code> (${escapeHtml(extraction.error_message || 'Sin respuesta estructurada')}). Puede completar y confirmar los hechos comerciales manualmente abajo.`;
        }
      } else {
        if (aiContingencyNotice) aiContingencyNotice.style.display = 'none';
      }
    } else {
      aiModelBadge.textContent = 'Sin extracción';
      aiConfidenceScore.textContent = '-';
      aiIsCommercial.textContent = '-';
      aiRetryCount.textContent = '0';
      if (aiContingencyNotice) {
        aiContingencyNotice.style.display = 'block';
        aiContingencyNotice.innerHTML = `ℹ️ <strong>Continuidad Manual:</strong> Solicitud sin extracción automática. Complete y confirme los hechos abajo para avanzar.`;
      }
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
      factsAuthorMeta.textContent = `Confirmado por ${current_confirmed_facts.confirmed_by_user_name || 'Consultor'} el ${formatChileanDateTime(current_confirmed_facts.confirmed_at)}`;

      factContactName.value = current_confirmed_facts.contact_name || '';
      factCompanyName.value = current_confirmed_facts.company_name || '';
      factContactEmail.value = current_confirmed_facts.contact_email || '';
      factContactPhone.value = current_confirmed_facts.contact_phone || '';
      factRequestType.value = current_confirmed_facts.request_type || 'QUOTE';
      factUrgency.value = current_confirmed_facts.urgency || 'MEDIUM';
      factScopeSummary.value = current_confirmed_facts.scope_summary || '';
      btnSaveFacts.textContent = `Guardar Hechos Confirmados (v${current_confirmed_facts.version + 1})`;
    } else {
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

    // Supervised Response Draft
    renderDraftSection(current_draft, current_confirmed_facts);

    // Commercial Actions Section (TP-04)
    renderCommercialActionsSection(actions, lead);
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
      if (btnCreateManualDraft) {
        btnCreateManualDraft.disabled = !currentFacts;
        btnCreateManualDraft.style.display = 'inline-flex';
      }
      return;
    }

    if (btnCreateManualDraft) {
      btnCreateManualDraft.style.display = 'none';
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

  // Render Commercial Actions Section (TP-04)
  function renderCommercialActionsSection(actions = [], lead) {
    // Check if lead is archived
    if (lead.status === 'ARCHIVED') {
      btnArchiveLead.textContent = 'Solicitud Archivada';
      btnArchiveLead.disabled = true;
    } else {
      btnArchiveLead.textContent = 'Archivar Solicitud';
      btnArchiveLead.disabled = false;
    }

    // Find current active open action (PENDING or OVERDUE)
    const openAction = actions.find(a => a.status === 'PENDING' || a.status === 'OVERDUE');

    if (openAction) {
      activeActionContainer.style.display = 'block';
      assignActionFormContainer.style.display = 'none';

      const isOverdue = openAction.effective_status === 'OVERDUE' || openAction.status === 'OVERDUE';
      actionStatusBadge.textContent = isOverdue ? 'ACCIÓN VENCIDA' : 'ACCIÓN EN CURSO';
      actionStatusBadge.className = `badge ${isOverdue ? 'badge-action-overdue' : 'badge-action-pending'}`;

      actionEffectiveBadge.textContent = isOverdue ? 'OVERDUE (VENCIDA)' : 'PENDING';
      actionEffectiveBadge.className = `badge ${isOverdue ? 'badge-action-overdue' : 'badge-action-pending'}`;

      actionTypeTitle.textContent = openAction.action_type;
      actionAssignedName.textContent = openAction.assigned_user_name || openAction.assigned_user_id;
      actionDueDate.textContent = formatChileanDateTime(openAction.due_date);
      actionDescriptionText.textContent = openAction.description;

      activeActionContainer.setAttribute('data-action-id', openAction.id);
    } else {
      activeActionContainer.style.display = 'none';
      assignActionFormContainer.style.display = 'block';

      actionStatusBadge.textContent = 'SIN ACCIÓN ABIERTA';
      actionStatusBadge.className = 'badge badge-status';

      // Default due date input
      actionDueDateInput.value = getDefaultDueDatetimeLocal();
      actionDescriptionInput.value = '';
    }

    // Render History Timeline
    actionsHistoryContainer.innerHTML = '';
    const historyActions = actions.filter(a => a.status === 'COMPLETED' || a.status === 'CANCELLED');
    if (historyActions.length === 0) {
      actionsHistoryContainer.innerHTML = '<div style="font-size: 12px; color: var(--text-muted); padding: 6px;">No hay acciones previas completadas ni canceladas.</div>';
    } else {
      historyActions.forEach(hist => {
        const item = document.createElement('div');
        const isComp = hist.status === 'COMPLETED';
        const badgeClass = isComp ? 'badge-action-completed' : 'badge-action-cancelled';
        const statusLabel = isComp ? 'COMPLETADA' : 'CANCELADA';
        const dateFormatted = formatChileanDateTime(hist.completed_at || hist.created_at);

        item.style.padding = '10px 12px';
        item.style.background = '#ffffff';
        item.style.border = '1px solid var(--line-color)';
        item.style.borderRadius = 'var(--radius-sm)';
        item.style.fontSize = '12px';

        item.innerHTML = `
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
            <strong>${escapeHtml(hist.action_type)}</strong>
            <span class="badge ${badgeClass}">${statusLabel}</span>
          </div>
          <div style="color: var(--text-muted); font-size: 11px; margin-bottom: 4px;">
            ${escapeHtml(hist.description)} &bull; Venció: ${formatChileanDateTime(hist.due_date)}
          </div>
          ${hist.result_summary ? `<div style="background: #f1f5f9; padding: 6px 8px; border-radius: 4px; margin-top: 4px; font-size: 12px;"><strong>Resultado:</strong> ${escapeHtml(hist.result_summary)}</div>` : ''}
          <div style="font-size: 10px; color: var(--text-muted); margin-top: 4px; text-align: right;">
            Cerrado el ${dateFormatted} por ${escapeHtml(hist.completed_by_user_name || 'Operador')}
          </div>
        `;
        actionsHistoryContainer.appendChild(item);
      });
    }
  }

  // Create Commercial Action Form Submit
  assignActionForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!activeLeadId) return;

    btnSubmitNewAction.disabled = true;
    btnSubmitNewAction.textContent = 'Asignando...';

    const assigned_user_id = actionAssigneeSelect.value;
    const action_type = actionTypeSelect.value;
    const description = actionDescriptionInput.value.trim();
    const due_date = actionDueDateInput.value;

    const res = await apiRequest(`/api/leads/${activeLeadId}/actions`, {
      method: 'POST',
      body: JSON.stringify({
        assigned_user_id,
        action_type,
        description,
        due_date
      })
    });

    btnSubmitNewAction.disabled = false;
    btnSubmitNewAction.textContent = 'Asignar Próxima Acción';

    if (res.ok && res.data?.action) {
      showToast('Próxima acción comercial asignada exitosamente');
      await selectLead(activeLeadId);
      await loadLeads();
    } else {
      showToast(`Error: ${res.data?.error || 'No se pudo crear la acción'}`);
    }
  });

  // Complete Action Modal & Handling
  btnOpenCompleteActionModal.addEventListener('click', () => {
    completeActionModal.style.display = 'flex';
    actionResultSummaryInput.value = '';
    chkScheduleNextAction.checked = false;
    nextActionFieldsBox.style.display = 'none';
    nextActionDueDateInput.value = getDefaultDueDatetimeLocal();
    actionResultSummaryInput.focus();
  });

  function closeCompleteActionModal() {
    completeActionModal.style.display = 'none';
  }

  btnCloseCompleteActionModal.addEventListener('click', closeCompleteActionModal);
  btnCancelCompleteAction.addEventListener('click', closeCompleteActionModal);

  chkScheduleNextAction.addEventListener('change', () => {
    nextActionFieldsBox.style.display = chkScheduleNextAction.checked ? 'flex' : 'none';
  });

  completeActionForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const actionId = activeActionContainer.getAttribute('data-action-id');
    if (!activeLeadId || !actionId) return;

    btnSubmitCompleteAction.disabled = true;
    btnSubmitCompleteAction.textContent = 'Guardando...';

    const result_summary = actionResultSummaryInput.value.trim();
    const payload = { result_summary };

    if (chkScheduleNextAction.checked) {
      payload.next_action = {
        action_type: nextActionTypeSelect.value,
        description: nextActionDescInput.value.trim() || 'Seguimiento programado',
        due_date: nextActionDueDateInput.value,
        assigned_user_id: currentUser.id
      };
    }

    const res = await apiRequest(`/api/leads/${activeLeadId}/actions/${actionId}/complete`, {
      method: 'POST',
      body: JSON.stringify(payload)
    });

    btnSubmitCompleteAction.disabled = false;
    btnSubmitCompleteAction.textContent = 'Confirmar y Guardar';

    if (res.ok) {
      showToast('Acción comercial completada con éxito');
      closeCompleteActionModal();
      await selectLead(activeLeadId);
      await loadLeads();
    } else {
      showToast(`Error: ${res.data?.error || 'No se pudo completar la acción'}`);
    }
  });

  // Cancel Action
  btnCancelAction.addEventListener('click', async () => {
    const actionId = activeActionContainer.getAttribute('data-action-id');
    if (!activeLeadId || !actionId) return;

    const reason = prompt('Motivo de cancelación de la acción comercial:', 'Cancelada por cambio de prioridad comercial');
    if (reason === null) return;

    btnCancelAction.disabled = true;
    const res = await apiRequest(`/api/leads/${activeLeadId}/actions/${actionId}/cancel`, {
      method: 'POST',
      body: JSON.stringify({ cancellation_reason: reason })
    });
    btnCancelAction.disabled = false;

    if (res.ok) {
      showToast('Acción comercial cancelada');
      await selectLead(activeLeadId);
      await loadLeads();
    } else {
      showToast(`Error: ${res.data?.error || 'No se pudo cancelar la acción'}`);
    }
  });

  // Archive Lead
  btnArchiveLead.addEventListener('click', async () => {
    if (!activeLeadId) return;
    const confirmArchive = confirm('¿Está seguro de archivar esta solicitud? Pasará a estado ARCHIVED.');
    if (!confirmArchive) return;

    btnArchiveLead.disabled = true;
    const res = await apiRequest(`/api/leads/${activeLeadId}/archive`, {
      method: 'POST'
    });
    btnArchiveLead.disabled = false;

    if (res.ok) {
      showToast('Solicitud archivada correctamente');
      await selectLead(activeLeadId);
      await loadLeads();
    } else {
      showToast(`Error: ${res.data?.error || 'No se pudo archivar la solicitud'}`);
    }
  });

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
      
      await selectLead(activeLeadId);
      await loadLeads();
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
      await selectLead(activeLeadId);
      await loadLeads();
    } else {
      showToast(`Error: ${res.data?.error || 'Fallo al generar borrador'}`);
    }
  });

  // Save Manual Draft Edit (Supports updating existing draft and manual draft creation without AI)
  btnSaveDraftEdit.addEventListener('click', async () => {
    if (!activeLeadId) return;
    const editedText = draftTextarea.value.trim();

    if (!editedText) {
      showToast('El borrador no puede estar vacío');
      return;
    }

    if (isCreatingNewManualDraft || !activeLeadData?.current_draft) {
      // Manual creation without AI (MVP-11)
      const res = await apiRequest(`/api/leads/${activeLeadId}/drafts/manual`, {
        method: 'POST',
        body: JSON.stringify({ draft_text: editedText })
      });

      if (res.ok && res.data?.draft) {
        isCreatingNewManualDraft = false;
        showToast('Borrador manual creado con éxito');
        await selectLead(activeLeadId);
        await fetchOperationalSummary();
      } else {
        showToast(`Error al crear borrador: ${res.data?.error || 'Desconocido'}`);
      }
    } else {
      const draftId = activeLeadData.current_draft.id;
      const res = await apiRequest(`/api/leads/${activeLeadId}/drafts/${draftId}`, {
        method: 'PATCH',
        body: JSON.stringify({ edited_text: editedText })
      });

      if (res.ok && res.data?.draft) {
        showToast('Ajustes del borrador guardados');
        await selectLead(activeLeadId);
        await fetchOperationalSummary();
      } else {
        showToast(`Error al guardar edición: ${res.data?.error || 'Desconocido'}`);
      }
    }
  });

  // Manual Draft Creation trigger
  if (btnCreateManualDraft) {
    btnCreateManualDraft.addEventListener('click', () => {
      if (!activeLeadData?.current_confirmed_facts) {
        showToast('Debe confirmar los hechos del lead antes de redactar un borrador.');
        return;
      }
      isCreatingNewManualDraft = true;
      draftTextarea.disabled = false;
      draftTextarea.value = '';
      draftTextarea.placeholder = 'Redacte aquí la propuesta o respuesta comercial formal...';
      draftTextarea.focus();
      btnSaveDraftEdit.disabled = false;
      showToast('Modo manual activo: escriba la propuesta y guarde los ajustes.');
    });
  }

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
      await selectLead(res.data.lead.id);
      await fetchOperationalSummary();
    } else {
      newLeadError.textContent = res.data?.error || 'Error al procesar la solicitud';
      newLeadError.style.display = 'block';
    }
  });

  // Admin Controlled Demo Data Reset (MVP-13)
  if (btnResetDemoData) {
    btnResetDemoData.addEventListener('click', () => {
      if (resetDemoModal) resetDemoModal.style.display = 'flex';
    });
  }
  if (btnCloseResetDemoModal) {
    btnCloseResetDemoModal.addEventListener('click', () => {
      if (resetDemoModal) resetDemoModal.style.display = 'none';
    });
  }
  if (btnCancelResetDemo) {
    btnCancelResetDemo.addEventListener('click', () => {
      if (resetDemoModal) resetDemoModal.style.display = 'none';
    });
  }
  if (btnConfirmResetDemo) {
    btnConfirmResetDemo.addEventListener('click', async () => {
      btnConfirmResetDemo.disabled = true;
      btnConfirmResetDemo.textContent = 'Restableciendo...';
      try {
        const res = await apiRequest('/api/admin/reset-demo-data', {
          method: 'POST',
          body: JSON.stringify({ confirmation: 'RESET_SYNTHETIC_DEMO_DATA' })
        });
        if (res.ok) {
          showToast('Catálogo de prueba restablecido con éxito');
          if (resetDemoModal) resetDemoModal.style.display = 'none';
          activeLeadId = null;
          activeLeadData = null;
          emptyDetailState.style.display = 'block';
          activeDetailContent.style.display = 'none';
          await loadLeads();
          await fetchOperationalSummary();
        } else {
          showToast(`Error al restablecer: ${res.data?.error || 'Acción no permitida'}`);
        }
      } catch (err) {
        showToast('Error de conexión al restablecer datos');
      } finally {
        btnConfirmResetDemo.disabled = false;
        btnConfirmResetDemo.textContent = 'Sí, Restablecer Conjunto de Prueba';
      }
    });
  }

  // Refresh Operational Summary button
  if (btnRefreshSummary) {
    btnRefreshSummary.addEventListener('click', async () => {
      await fetchOperationalSummary();
      showToast('Resumen operativo actualizado');
    });
  }

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
