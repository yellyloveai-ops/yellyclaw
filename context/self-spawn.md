# Self-Spawn API Reference

A running YellyClaw agent session can create child sessions via the self-spawn API.

## Environment Variables

Every claude-code child process receives these environment variables:

| Variable | Value | Purpose |
|---|---|---|
| `YELLYCLAW_SESSION_ID` | numeric session id | This session's own id |
| `YELLYCLAW_PORT` | `2026` | Server port |
| `YELLYCLAW_TOKEN` | CSRF token | Required for POST requests back to server |
| `YELLYCLAW_PARENT_ID` | parent session id or `""` | Set when spawned by another session |

## Spawning a Child Session

```bash
curl -s -X POST \
  -H "Content-Type: application/json" \
  -H "X-YellyRock-Token: $YELLYCLAW_TOKEN" \
  -d '{"prompt":"Do subtask X"}' \
  "http://localhost:$YELLYCLAW_PORT/sessions/$YELLYCLAW_SESSION_ID/spawn"
# → {"sessionId":42,"parentId":7,"logsUrl":"/sessions/42/logs"}
```

## Constraints

- Maximum 5 child sessions per parent session
- Children inherit the parent's `agentSpec` unless overridden
- Each child has its own idle timeout (30 minutes)
- Child sessions appear with source `spawn` in the Server Manager UI

## Polling Child Session Logs

```bash
# Poll until session completes
while true; do
  result=$(curl -s -H "Accept: application/json" \
    "http://localhost:$YELLYCLAW_PORT/sessions/$CHILD_SESSION_ID/logs")
  exitCode=$(echo "$result" | grep -o '"exitCode":[^,}]*' | cut -d: -f2)
  if [ "$exitCode" != "null" ] && [ -n "$exitCode" ]; then
    echo "Child session completed with exit code: $exitCode"
    break
  fi
  sleep 2
done
```

## Checking Server Health

```bash
curl -s "http://localhost:$YELLYCLAW_PORT/health"
# → {"status":"ok","sessions":3}
```

## Available Routes for Agent Use

| Route | Method | Purpose |
|---|---|---|
| `/sessions/$YELLYCLAW_SESSION_ID/spawn` | POST | Create child session |
| `/sessions/:id/logs` | GET | View session output (JSON via Accept header) |
| `/sessions/:id/kill` | POST | Kill a session |
| `/schedules` | GET | List schedules |
| `/health` | GET | Server health check |
| `/token` | GET | Get current CSRF token |
