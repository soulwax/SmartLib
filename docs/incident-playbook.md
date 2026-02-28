# Incident Playbook

This playbook defines the minimum response process for production incidents.

## Severity Levels

- `SEV-1`: Complete outage, data-loss risk, auth bypass/security breach, or critical user-impacting failure.
- `SEV-2`: Major feature broken for many users, significant latency/error spikes, degraded core flows.
- `SEV-3`: Partial degradation, non-critical feature issues, limited blast radius.

## Initial Response (First 10 Minutes)

1. Acknowledge incident in team channel and assign an incident commander.
2. Open a dedicated incident channel/thread with timestamp and owner.
3. Capture current scope:
   - failing endpoints and HTTP codes
   - impacted user segments
   - first known bad deploy/config change
4. Check:
   - `GET /api/health/live`
   - `GET /api/health/ready`
   - application logs, database status, and Redis status

## Stabilization

1. If issue started after deploy, trigger rollback to last known good release.
2. If rollback is not possible, apply hotfix with narrow blast radius.
3. Disable non-essential features/traffic paths if needed (for example AI-heavy routes).
4. Keep customer-facing status updates regular (every 15-30 minutes for SEV-1/2).

## Communication

1. Incident commander posts updates in fixed cadence.
2. Record all key actions with timestamps.
3. For external impact, update status page and support channel with:
   - what is affected
   - mitigation in progress
   - next update ETA

## Recovery Validation

1. Confirm error rate/latency returns to baseline.
2. Re-run the production smoke checklist.
3. Confirm auth, writes, and AI routes behave normally.
4. Continue elevated monitoring for at least 60 minutes.

## Postmortem (Within 48 Hours)

1. Document timeline (detection, response, mitigation, recovery).
2. Identify root cause and contributing factors.
3. Add concrete corrective actions with owners and deadlines.
4. Update runbooks, tests, and alerts to prevent recurrence.

## Ownership

- Incident Commander: coordinates response and communication.
- Ops Lead: executes deploy/rollback and infra checks.
- App Lead: drives application-level diagnosis and fixes.
- Comms Owner: manages customer/status updates.
