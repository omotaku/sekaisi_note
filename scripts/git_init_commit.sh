#!/usr/bin/env bash
set -e
if [ ! -d .git ]; then
  git init
fi
git add .
git commit -m "Initial commit: jugyonote" || echo "No changes to commit or commit failed"
echo "Git initial commit completed (or nothing to commit)."
