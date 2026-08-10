#!/bin/zsh
cd "${0:A:h}"

if [[ -f .env ]]; then
  set -a
  source .env
  set +a
fi

npm start &
reviewpilot_pid=$!
trap 'kill $reviewpilot_pid 2>/dev/null' EXIT INT TERM

for attempt in {1..40}; do
  if curl -fsS "http://localhost:${PORT:-4173}/api/health" >/dev/null 2>&1; then
    break
  fi
  sleep 0.1
done

open "http://localhost:${PORT:-4173}"
wait $reviewpilot_pid
