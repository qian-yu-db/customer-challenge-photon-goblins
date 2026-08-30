# Unity AI Gateway Operations Guide

**Project**: Meridian Bank Customer Retention
**Gateway**: `vijay_catalog.customer_challenge.meridian_bank_gateway`
**Inference Table**: `vijay_catalog.customer_challenge.meridian_bank_gateway_payload`

---

## Architecture Overview

The AI Gateway sits between all callers (app, notebooks) and the foundation model.
It enforces rate limits, logs all traffic to the inference table, and provides
a governed access layer managed through Unity Catalog.

**Traffic Flow**:
Callers -> AI Gateway (rate limits, logging, guardrails) -> Claude Sonnet 4.5

**Key Components**:
- Gateway endpoint: `{host}/ai-gateway/mlflow/v1`
- Model route: `databricks-claude-sonnet-4-5` (100% traffic)
- Inference table: auto-captures every call (request, response, latency, status)

---

## Gateway Configuration

| Setting | Value |
| --- | --- |
| Name | `vijay_catalog.customer_challenge.meridian_bank_gateway` |
| Route | `databricks-claude-sonnet-4-5` (100% traffic) |
| Endpoint-wide rate limit | 50,000 tokens/min |
| Per-user default rate limit | 10,000 tokens/min |
| Inference table | Auto-capture enabled |
| Governance | Unity Catalog managed |

---

## How to Update Rate Limits

### Via Python SDK

```python
from databricks.sdk import WorkspaceClient
from databricks.sdk.service.catalog import (
    ModelService, ModelServiceConfig, RateLimit,
    RateLimitRateLimitKey, RateLimitRateLimitRenewalPeriod,
)
from google.protobuf.field_mask_pb2 import FieldMask

w = WorkspaceClient()
GATEWAY = "vijay_catalog.customer_challenge.meridian_bank_gateway"

w.ai_gateway.update_model_service(
    name=f"model-services/{GATEWAY}",
    model_service=ModelService(
        config=ModelServiceConfig(
            rate_limits=[
                # Endpoint-wide limit
                RateLimit(
                    tokens=50000,
                    key=RateLimitRateLimitKey.RATE_LIMIT_KEY_SERVICE,
                    renewal_period=RateLimitRateLimitRenewalPeriod.RATE_LIMIT_RENEWAL_PERIOD_MINUTE,
                ),
                # Per-user default
                RateLimit(
                    tokens=10000,
                    key=RateLimitRateLimitKey.RATE_LIMIT_KEY_USER_DEFAULT,
                    renewal_period=RateLimitRateLimitRenewalPeriod.RATE_LIMIT_RENEWAL_PERIOD_MINUTE,
                ),
            ]
        )
    ),
    update_mask=FieldMask(paths=["config.rate_limits"]),
)
```

### Rate Limit Key Types

| Key | Description |
| --- | --- |
| `RATE_LIMIT_KEY_SERVICE` | Endpoint-wide (all users combined) |
| `RATE_LIMIT_KEY_USER_DEFAULT` | Per-user default (no principal needed) |
| `RATE_LIMIT_KEY_USER` | Specific user (requires `principal` field) |
| `RATE_LIMIT_KEY_SERVICE_PRINCIPAL` | Specific SP |
| `RATE_LIMIT_KEY_USER_GROUP` | Group-level limit |

### RateLimit Fields

- `tokens` (int): Token-based limit per renewal period
- `requests` (int): Request-count limit per renewal period (alternative to tokens)
- `key`: One of the key types above
- `renewal_period`: `RATE_LIMIT_RENEWAL_PERIOD_MINUTE` or `RATE_LIMIT_RENEWAL_PERIOD_HOUR`
- `principal` (str): Required for USER and SERVICE_PRINCIPAL keys

---

## How to Call the Gateway

### From Python (OpenAI SDK)

```python
from openai import OpenAI

client = OpenAI(
    api_key="<databricks-token>",
    base_url="https://fevm-vijay.cloud.databricks.com/ai-gateway/mlflow/v1",
)

resp = client.chat.completions.create(
    model="vijay_catalog.customer_challenge.meridian_bank_gateway",
    messages=[{"role": "user", "content": "Hello"}],
    max_tokens=100,
)
print(resp.choices[0].message.content)
```

### Authentication from a Notebook

```python
from databricks.sdk import WorkspaceClient
w = WorkspaceClient()
auth = w.config.authenticate()
headers = auth({}) if callable(auth) else auth
token = headers.get("Authorization", "").replace("Bearer ", "")
```

### App Architecture Note

The `meridian-retention-desk` app uses `/serving-endpoints` with direct model
access (`databricks-claude-sonnet-4-5`) because the app's OAuth OBO token
currently lacks the `ai-gateway` scope. Once that scope becomes available for
app tokens, the app should switch to calling through the gateway for unified
rate limiting and logging.

---

## Inference Table Schema

| Column | Type | Description |
| --- | --- | --- |
| `event_time` | timestamp | When the call was made |
| `request_id` | string | Unique request identifier |
| `status_code` | int | HTTP status (200, 429, etc.) |
| `latency_ms` | long | End-to-end latency (0 for blocked) |
| `requester` | string | User or SP email |
| `destination_model` | string | Backend model that served the request |
| `request` | string | Full JSON request payload |
| `response` | string | Full JSON response payload |
| `api_type` | string | API type used |

### Example Queries

```sql
-- Recent calls
SELECT request_id, event_time, status_code, latency_ms, requester
FROM vijay_catalog.customer_challenge.meridian_bank_gateway_payload
ORDER BY event_time DESC LIMIT 20;

-- Rate-limited requests (evidence of enforcement)
SELECT request_id, event_time, requester
FROM vijay_catalog.customer_challenge.meridian_bank_gateway_payload
WHERE status_code = 429;

-- Usage summary
SELECT requester, COUNT(*) as calls, AVG(latency_ms) as avg_latency
FROM vijay_catalog.customer_challenge.meridian_bank_gateway_payload
GROUP BY requester;
```

---

## Access Requirements

For a service principal (or user) to call the gateway:

1. `USE CATALOG` on `vijay_catalog`
2. `USE SCHEMA` on `vijay_catalog.customer_challenge`
3. `EXECUTE` on the model service

The app SP (`b27cd838-59aa-4d7e-ad32-7588bee4df40`) already has these grants.

> **Known limitation (Aug 2026)**: The `ai-gateway` OAuth scope is not yet
> available for Databricks App OBO tokens. Until resolved, the app calls
> the model directly via `/serving-endpoints` rather than through the gateway.

---

## Troubleshooting

| Symptom | Cause | Resolution |
| --- | --- | --- |
| 404 "does not exist" | Caller lacks UC path permissions | Ensure USE CATALOG + USE SCHEMA granted |
| 403 "required scopes: ai-gateway" | OAuth token missing scope | Not yet available for app tokens; use direct model access |
| 429 `REQUEST_LIMIT_EXCEEDED` | Rate limit hit | Wait for renewal window or increase limits via SDK |
| Model refuses request | Safety guardrail | Expected behavior for harmful/injection content |
| Empty inference table | Async write delay | Wait 30-60s after calls; check gateway is active |

---

## Validation Notebook

Run `gateway_validation` (notebook ID: 877606162115650) end-to-end to verify:

1. Gateway responds to calls (Cell 2)
2. Inference table captures traffic (Cell 4 - shows 59+ rows)
3. Rate limits enforce - 429 evidence visible in inference table (Cell 5)
4. Guardrails block harmful requests at model layer (Cell 6)
5. Full payload export with request/response previews (Cell 7)

---

## Key Learnings

1. **Rate limits use a sliding window** — calls spread across >1 min may not
   trigger even when cumulative tokens exceed the cap.
2. **Inference table writes are async** — expect 10-30s delay before rows appear.
3. **The `w.ai_gateway` SDK attribute** requires specific SDK versions; not all
   compute environments expose it. Use a recent DBR with the latest SDK.
4. **Blocked requests (429) are still logged** with `latency_ms=0` and
   `status_code=429` — proof that enforcement is at the gateway layer.
5. **`RATE_LIMIT_KEY_USER_DEFAULT`** is the easiest key — no `principal` field
   required, applies to all users equally.
