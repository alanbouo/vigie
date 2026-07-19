#!/usr/bin/env bash
# Vendorise le skill claude-seo depuis son fork, pinné sur un commit précis.
# Usage : scripts/vendor-claude-seo.sh <repo-url> <commit-sha>
# Licence upstream : MIT — l'attribution (LICENSE) est conservée dans le skill.
set -euo pipefail

REPO_URL="${1:?usage: vendor-claude-seo.sh <repo-url> <commit-sha>}"
COMMIT="${2:?usage: vendor-claude-seo.sh <repo-url> <commit-sha>}"
DEST="$(dirname "$0")/../infra/diagnostic-workspace/.claude/skills/claude-seo"
TMP="$(mktemp -d)"

git clone --quiet "$REPO_URL" "$TMP/claude-seo"
git -C "$TMP/claude-seo" checkout --quiet "$COMMIT"

# On remplace le contenu du skill en conservant notre fichier de pin.
rsync -a --delete --exclude PINNED_COMMIT "$TMP/claude-seo/" "$DEST/"
cat > "$DEST/PINNED_COMMIT" <<EOF
UPSTREAM=$REPO_URL
COMMIT=$COMMIT
EOF

rm -rf "$TMP"
echo "claude-seo vendorisé depuis $REPO_URL @ $COMMIT vers $DEST"
echo "Pense à lancer les tests du Diagnostic avant de committer la mise à jour."
