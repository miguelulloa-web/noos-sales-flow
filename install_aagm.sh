#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PACK_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
TARGET_INPUT="${1:-.}"
TARGET="$(cd "$TARGET_INPUT" 2>/dev/null && pwd || true)"
if [[ -z "$TARGET" || ! -d "$TARGET" ]]; then echo "ERROR: target directory does not exist." >&2; exit 2; fi
if [[ ! -d "$TARGET/.git" ]]; then echo "WARNING: no local .git detected. Initialize Git before normal AAGM use."; fi

upgrade=false
if [[ -e "$TARGET/.aagm" ]]; then
  current="$(tr -d '[:space:]' < "$TARGET/.aagm/VERSION" 2>/dev/null || true)"
  if [[ "$current" == "1.9" && "${AAGM_ALLOW_UPGRADE:-}" == "1" ]]; then upgrade=true
  else echo "ERROR: AAGM already installed. For v1.9 upgrade, set AAGM_ALLOW_UPGRADE=1 after checkpointing Git." >&2; exit 3; fi
fi

if $upgrade; then
  for item in AGENTS.md PROJECT_STATE.yaml BACKLOG.yaml; do
    [[ ! -e "$TARGET/$item" ]] || cp "$TARGET/$item" "$TARGET/$item.pre-aagm-v1.10"
  done
fi

mkdir -p "$TARGET/.aagm/state" "$TARGET/.aagm/governance" "$TARGET/.aagm/runtime" \
  "$TARGET/docs/product" "$TARGET/docs/technical" "$TARGET/docs/operations" \
  "$TARGET/docs/aagm/00-bootstrap" "$TARGET/docs/aagm/01-discovery" \
  "$TARGET/docs/aagm/02-solution-design" "$TARGET/docs/aagm/03-planning" \
  "$TARGET/docs/aagm/04-delivery/changes" "$TARGET/docs/aagm/04-delivery/task-packets" \
  "$TARGET/docs/aagm/04-delivery/impact-analysis" "$TARGET/docs/aagm/04-delivery/qa" \
  "$TARGET/docs/aagm/04-delivery/evidence" "$TARGET/docs/aagm/05-operations" "$TARGET/docs/aagm-feedback"

cp "$PACK_DIR/AGENTS.md" "$TARGET/AGENTS.md"
cp "$PACK_DIR/PROJECT_STATE.yaml" "$TARGET/PROJECT_STATE.yaml"
cp "$PACK_DIR/BACKLOG.yaml" "$TARGET/BACKLOG.yaml"
cp -R "$PACK_DIR/antigravity" "$TARGET/.aagm/"
cp -R "$PACK_DIR/agents" "$TARGET/.aagm/"
cp -R "$PACK_DIR/templates" "$TARGET/.aagm/"
cp -R "$PACK_DIR/schemas" "$TARGET/.aagm/"
for doc in COMMAND_REFERENCE.md CI_CD_RELEASE.md QUALITY_REGRESSION.md DASHBOARD_SPEC.md GOVERNANCE.md DOCUMENTATION_ARCHITECTURE.md STATE_AND_TRACEABILITY_MODEL.md; do
  cp "$PACK_DIR/docs/$doc" "$TARGET/docs/aagm/$doc"
done
cp "$PACK_DIR/templates/DOCUMENTATION_MAP.template.md" "$TARGET/docs/README.md"
cp "$PACK_DIR/docs/MIGRATION_V1.9_TO_V1.10.md" "$TARGET/docs/aagm/MIGRATION_V1.9_TO_V1.10.md"
cp "$PACK_DIR/docs/AAGM_MANUAL_USUARIO_v1.10.docx" "$TARGET/docs/AAGM_MANUAL_USUARIO_v1.10.docx"
cp "$PACK_DIR/runtime/dashboard/PROJECT_DASHBOARD.html" "$TARGET/docs/aagm/PROJECT_DASHBOARD.html"
cp "$PACK_DIR/docs/aagm-feedback/METHODOLOGY_FEEDBACK.md" "$TARGET/docs/aagm-feedback/METHODOLOGY_FEEDBACK.md"
printf '1.10\n' > "$TARGET/.aagm/VERSION"
python3 "$PACK_DIR/scripts/verify_installation.py" "$TARGET"
echo "AAGM v1.10 installed successfully at $TARGET"
echo "NEXT: open the project and run /aagm-bootstrap"
