/**
 * Módulo de flujo de copia al portapapeles (Fuente única de verdad para navegador y pruebas)
 *
 * Semántica estricta:
 * 1. Verifica disponibilidad de API de portapapeles antes de cualquier petición de red.
 * 2. Pre-autoriza la copia en el backend (/copy-authorize) validando pertenencia lead/draft y vigencia (no STALE).
 *    Esta llamada NUNCA muta datos ni audita DRAFT_COPIED.
 * 3. Ejecuta la escritura real en el portapapeles (clipboard.writeText) únicamente tras autorización exitosa.
 * 4. Si la escritura real falla o es rechazada, informa el error y NUNCA audita DRAFT_COPIED.
 * 5. Si la escritura real tiene éxito, invoca la confirmación en el backend (/copy-confirm) para marcar
 *    el estado como APPROVED_COPIED y registrar el evento DRAFT_COPIED en audit_log.
 * 6. Si la confirmación en el backend falla tras haber copiado, informa con precisión al operador
 *    ("Texto copiado al portapapeles, pero falló la confirmación en el servidor") sin afirmar éxito integral.
 */

export async function executeDraftCopy({
  leadId,
  draft,
  textToCopy,
  clipboardApi,
  apiReq,
  onToast = () => {},
  onReload
}) {
  if (!draft || draft.status === 'STALE') {
    onToast('Bloqueado: no se puede copiar un borrador en estado STALE.');
    return { success: false, reason: 'DRAFT_STALE' };
  }

  if (!textToCopy) {
    return { success: false, reason: 'EMPTY_TEXT' };
  }

  // Pre-verificación de API de portapapeles antes de autorizar en red
  const clipboard = clipboardApi || (typeof navigator !== 'undefined' ? navigator.clipboard : null);
  if (!clipboard || typeof clipboard.writeText !== 'function') {
    onToast('Error: La API de portapapeles no está disponible en este entorno.');
    return { success: false, reason: 'CLIPBOARD_API_UNAVAILABLE' };
  }

  // 1. Pre-autorización en backend (comprueba pertenencia e inmutabilidad contra STALE; no muta ni audita)
  const authRes = await apiReq(`/api/leads/${leadId}/drafts/${draft.id}/copy-authorize`, {
    method: 'POST'
  });

  if (!authRes.ok) {
    if (authRes.status === 409 || authRes.data?.code === 'DRAFT_STALE') {
      onToast('Bloqueado: el borrador ha quedado desactualizado (STALE) y no puede ser copiado.');
    } else {
      onToast(`Error: ${authRes.data?.error || 'No se pudo autorizar la copia'}`);
    }
    if (onReload) await onReload();
    return { success: false, reason: authRes.data?.code || 'AUTHORIZATION_REJECTED' };
  }

  // 2. Escritura real en el portapapeles
  try {
    await clipboard.writeText(textToCopy);
  } catch (clipErr) {
    onToast(`Error al escribir en el portapapeles: ${clipErr.message || 'Permiso denegado'}`);
    // NUNCA confirma y NUNCA se audita DRAFT_COPIED
    return { success: false, reason: 'CLIPBOARD_WRITE_FAILED', error: clipErr };
  }

  // 3. Confirmación en backend tras escritura real exitosa
  const confirmRes = await apiReq(`/api/leads/${leadId}/drafts/${draft.id}/copy-confirm`, {
    method: 'POST'
  });

  if (!confirmRes.ok) {
    onToast(`Texto copiado al portapapeles, pero falló la confirmación en el servidor: ${confirmRes.data?.error || 'Error'}`);
    if (onReload) await onReload();
    return { success: false, reason: 'CONFIRM_FAILED' };
  }

  onToast('✓ Borrador verificado y copiado al portapapeles');
  if (onReload) await onReload();
  return { success: true, draft: confirmRes.data?.draft };
}
