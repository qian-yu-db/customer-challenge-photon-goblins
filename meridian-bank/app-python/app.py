"""Meridian Relationship Desk — Python Dash app with Lakebase + Agent tools."""
import os
import json
import uuid
import time
import threading
from datetime import datetime

import flask
import dash
from dash import html, dcc, Input, Output, State, callback, no_update
import plotly.express as px
import plotly.graph_objects as go
import psycopg2
import psycopg2.extras
from databricks.sdk import WorkspaceClient
from openai import OpenAI

# ─── Config ───────────────────────────────────────────────────────────────────
PORT = int(os.environ.get("DATABRICKS_APP_PORT", 8000))
DB_HOST = os.environ.get("PGHOST", "")
DB_NAME = os.environ.get("PGDATABASE", "databricks_postgres")
DB_USER = os.environ.get("PGUSER", "")
DB_PORT = os.environ.get("PGPORT", "5432")
LAKEBASE_ENDPOINT = os.environ.get("LAKEBASE_ENDPOINT", "projects/meridian-bank/branches/production/endpoints/primary")
GENIE_SPACE_ID = os.environ.get("GENIE_SPACE_ID", "")
DASHBOARD_ID = os.environ.get("DASHBOARD_ID", "")
DATABRICKS_HOST = os.environ.get("DATABRICKS_HOST", "")

# ─── DB Connection (OAuth token refresh) ──────────────────────────────────────
_token_cache = {"token": None, "expires": 0}
_token_lock = threading.Lock()


def get_db_token():
    """Get a fresh OAuth token for Lakebase Autoscaling (caches for 15 min)."""
    with _token_lock:
        if _token_cache["token"] and time.time() < _token_cache["expires"]:
            return _token_cache["token"]
        w = WorkspaceClient()
        cred = w.postgres.generate_database_credential(endpoint=LAKEBASE_ENDPOINT)
        _token_cache["token"] = cred.token
        _token_cache["expires"] = time.time() + 900  # 15 min
        return cred.token


def get_conn():
    """Get a fresh psycopg2 connection with OAuth token."""
    return psycopg2.connect(
        host=DB_HOST, database=DB_NAME, user=DB_USER,
        port=DB_PORT, password=get_db_token(), sslmode="require",
    )


def query(sql, params=None):
    """Execute a query and return rows as dicts."""
    conn = get_conn()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(sql, params)
            return [dict(r) for r in cur.fetchall()]
    finally:
        conn.close()


def execute(sql, params=None):
    """Execute a write and return affected rows."""
    conn = get_conn()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(sql, params)
            conn.commit()
            try:
                return [dict(r) for r in cur.fetchall()]
            except psycopg2.ProgrammingError:
                return []
    finally:
        conn.close()


# ─── Agent Tools ──────────────────────────────────────────────────────────────
def find_atrisk_customer(customer_id=None):
    if customer_id:
        rows = query("""
            SELECT cp.customer_id, cp.tier, cp.tenure_years, cp.home_metro,
                   cp.attrition_risk_score, cp.total_balance_usd,
                   cp.balance_at_risk_usd, cp.revenue_at_risk_usd,
                   oa.atrisk_product_id, oa.atrisk_balance_usd,
                   oa.days_to_maturity, oa.current_rate_apy,
                   oa.candidate_cross_sell_product_id
            FROM app.customer_position cp
            LEFT JOIN app.open_atrisk oa ON cp.customer_id = oa.customer_id
            WHERE cp.customer_id = %s
        """, (customer_id,))
    else:
        rows = query("""
            SELECT cp.customer_id, cp.tier, cp.tenure_years, cp.home_metro,
                   cp.attrition_risk_score, cp.total_balance_usd,
                   cp.balance_at_risk_usd, cp.revenue_at_risk_usd,
                   oa.atrisk_product_id, oa.atrisk_balance_usd,
                   oa.days_to_maturity, oa.current_rate_apy,
                   oa.candidate_cross_sell_product_id
            FROM app.open_atrisk oa
            JOIN app.customer_position cp ON cp.customer_id = oa.customer_id
            ORDER BY oa.attrition_risk_score DESC LIMIT 1
        """)
    if not rows:
        return {"found": False}
    r = rows[0]
    return {"found": True, **{k: float(v) if isinstance(v, (int, float)) and k != 'tenure_years' else v for k, v in r.items()}}


def search_products(search_query):
    rows = query("""
        SELECT product_id, product_name, product_type, segment, rate_apy,
               min_balance_usd, description
        FROM app.products
        WHERE search_vector <@> to_bm25query(
            to_tsvector('english', %s), 'app.products_search_bm25'
        ) < 0
        ORDER BY search_vector <@> to_bm25query(
            to_tsvector('english', %s), 'app.products_search_bm25'
        )
        LIMIT 5
    """, (search_query, search_query))
    return {"results": rows, "count": len(rows)}


def rank_next_best_actions(customer_id):
    rows = query("""
        SELECT customer_id, recommended_action, recommended_offer_product_id,
               recommended_rate_apy, predicted_retained_usd,
               predicted_net_value_usd, action_ranking
        FROM app.nba_recommendations WHERE customer_id = %s
    """, (customer_id,))
    if not rows:
        return {"found": False}
    r = rows[0]
    return {"found": True, **r}


def execute_nba_action(customer_id, action_type, offered_product_id, rate_apy, drafted_note, user_email="system"):
    rec = rank_next_best_actions(customer_id)
    predicted = rec.get("predicted_retained_usd") if rec.get("found") else None
    audit = json.dumps([{"action": "created", "by": user_email, "at": datetime.utcnow().isoformat()}])
    # Auto-draft stakeholder memo
    memo = (f"## Retention Action Memo\n\n"
            f"**Customer**: {customer_id}\n"
            f"**Action**: {action_type}\n"
            f"**Product Offered**: {offered_product_id} @ {rate_apy}% APY\n"
            f"**Predicted Retained Balance**: ${predicted:,.0f}\n\n" if predicted else
            f"## Retention Action Memo\n\n"
            f"**Customer**: {customer_id}\n"
            f"**Action**: {action_type}\n"
            f"**Product Offered**: {offered_product_id} @ {rate_apy}% APY\n\n")
    memo += f"**Rationale**: {drafted_note}\n\n"
    memo += f"**Approved by**: {user_email} | **Date**: {datetime.utcnow().strftime('%Y-%m-%d %H:%M UTC')}\n"
    rows = execute("""
        INSERT INTO app.rm_actions
            (customer_id, action_type, offered_product_id, rate_apy, drafted_note,
             predicted_retained_usd, status, approved_by, audit_trail, decided_at, memo)
        VALUES (%s, %s, %s, %s, %s, %s, 'approved', %s, %s::jsonb, now(), %s)
        RETURNING id, created_at
    """, (customer_id, action_type, offered_product_id, rate_apy, drafted_note,
          predicted, user_email, audit, memo))
    r = rows[0] if rows else {}
    return {"action_id": str(r.get("id", "")), "created_at": str(r.get("created_at", "")),
            "recorded_by": user_email, "memo": memo}


def what_if_analysis(customer_id, offered_rate_apy, offered_product_id, term_months=12):
    """Run a what-if scenario: given a retention offer, predict outcome."""
    cust = find_atrisk_customer(customer_id)
    if not cust.get("found"):
        return {"error": f"Customer {customer_id} not found"}
    # Simple model: higher rate relative to current = higher retention probability
    current_rate = cust.get("current_rate_apy") or 0.03
    rate_delta = (offered_rate_apy - current_rate) / current_rate if current_rate > 0 else 0
    base_retention = 1.0 - cust.get("attrition_risk_score", 0.5)
    # Retention improves with rate uplift (capped at 0.95)
    predicted_retention = min(0.95, base_retention + rate_delta * 0.4)
    balance = cust.get("balance_at_risk_usd", 0)
    predicted_retained = balance * predicted_retention
    predicted_revenue_saved = predicted_retained * 0.025  # ~2.5% NIM
    cost_of_offer = balance * max(0, offered_rate_apy - current_rate)
    net_value = predicted_revenue_saved - cost_of_offer

    scenario = {
        "customer_id": customer_id,
        "current_rate_apy": current_rate,
        "offered_rate_apy": offered_rate_apy,
        "offered_product_id": offered_product_id,
        "term_months": term_months,
    }
    outcomes = {
        "predicted_retention_probability": round(predicted_retention, 4),
        "predicted_retained_usd": round(predicted_retained, 2),
        "predicted_revenue_saved_usd": round(predicted_revenue_saved, 2),
        "cost_of_offer_usd": round(cost_of_offer, 2),
        "net_value_usd": round(net_value, 2),
    }
    # Persist the scenario
    execute("""
        INSERT INTO app.what_if_scenarios (customer_id, scenario_inputs, predicted_outcomes)
        VALUES (%s, %s::jsonb, %s::jsonb)
    """, (customer_id, json.dumps(scenario, default=str), json.dumps(outcomes, default=str)))
    return {"scenario": scenario, "outcomes": outcomes}


def get_action_history(customer_id):
    """Retrieve committed actions for a customer from rm_actions."""
    rows = query("""
        SELECT id, customer_id, action_type, offered_product_id, rate_apy,
               drafted_note, predicted_retained_usd, status, approved_by,
               memo, created_at, decided_at
        FROM app.rm_actions WHERE customer_id = %s
        ORDER BY created_at DESC LIMIT 10
    """, (customer_id,))
    return {"actions": rows, "count": len(rows)}


def export_decision_chain(customer_id):
    """Export a complete, record-ID-linked decision chain for a customer."""
    # Step 1: Customer risk profile
    cust = find_atrisk_customer(customer_id)
    if not cust.get("found"):
        return {"error": f"Customer {customer_id} not found"}
    # Step 2: NBA recommendations
    nba = query("""
        SELECT customer_id, recommended_action, recommended_offer_product_id,
               recommended_rate_apy, predicted_retained_usd, action_ranking
        FROM app.nba_recommendations WHERE customer_id = %s
    """, (customer_id,))
    # Step 3: Executed actions
    actions = query("""
        SELECT id, action_type, offered_product_id, rate_apy, status,
               predicted_retained_usd, memo, created_at
        FROM app.rm_actions WHERE customer_id = %s ORDER BY created_at
    """, (customer_id,))
    # Step 4: What-if scenarios
    scenarios = query("""
        SELECT id, scenario_inputs, predicted_outcomes, created_at
        FROM app.what_if_scenarios WHERE customer_id = %s ORDER BY created_at
    """, (customer_id,))
    chain = {
        "customer_id": customer_id,
        "risk_profile": cust,
        "nba_recommendations": nba,
        "what_if_scenarios": scenarios,
        "executed_actions": actions,
        "chain_complete": len(actions) > 0,
    }
    return chain


# Tool definitions for OpenAI function calling
TOOLS = [
    {"type": "function", "function": {"name": "find_atrisk_customer", "description": "Find an at-risk customer. Pass customer_id or null for worst.", "parameters": {"type": "object", "properties": {"customer_id": {"type": ["string", "null"], "description": "Customer ID or null"}}, "required": ["customer_id"]}}},
    {"type": "function", "function": {"name": "search_products", "description": "Search products in the Lakebase BM25 index.", "parameters": {"type": "object", "properties": {"query": {"type": "string", "description": "Natural language search query"}}, "required": ["query"]}}},
    {"type": "function", "function": {"name": "rank_next_best_actions", "description": "Get ranked NBA recommendations for a customer.", "parameters": {"type": "object", "properties": {"customer_id": {"type": "string", "description": "Customer ID"}}, "required": ["customer_id"]}}},
    {"type": "function", "function": {"name": "what_if_analysis", "description": "Run a what-if retention scenario. Predicts retention probability and net value given an offer.", "parameters": {"type": "object", "properties": {"customer_id": {"type": "string"}, "offered_rate_apy": {"type": "number", "description": "Proposed APY rate"}, "offered_product_id": {"type": "string", "description": "Product ID to offer"}, "term_months": {"type": "integer", "description": "Term in months (default 12)"}}, "required": ["customer_id", "offered_rate_apy", "offered_product_id"]}}},
    {"type": "function", "function": {"name": "execute_nba_action", "description": "Record an approved retention action. Auto-drafts a stakeholder memo. Use ONLY after user confirms.", "parameters": {"type": "object", "properties": {"customer_id": {"type": "string"}, "action_type": {"type": "string"}, "offered_product_id": {"type": ["string", "null"]}, "rate_apy": {"type": ["number", "null"]}, "drafted_note": {"type": "string"}}, "required": ["customer_id", "action_type", "offered_product_id", "rate_apy", "drafted_note"]}}},
    {"type": "function", "function": {"name": "get_action_history", "description": "Retrieve past committed actions for a customer (proves write persistence).", "parameters": {"type": "object", "properties": {"customer_id": {"type": "string"}}, "required": ["customer_id"]}}},
    {"type": "function", "function": {"name": "export_decision_chain", "description": "Export the full record-ID-linked decision chain: risk profile → NBA → what-if scenarios → executed actions → memos.", "parameters": {"type": "object", "properties": {"customer_id": {"type": "string"}}, "required": ["customer_id"]}}},
]

SYSTEM_PROMPT = """You are the Meridian Bank Relationship Desk AI assistant.
You help relationship managers identify at-risk customers and recommend next best actions.

Phase 1 - Discovery: Use find_atrisk_customer to identify at-risk positions.
Phase 2 - Analyze: Use what_if_analysis to model retention scenarios with different offers.
Phase 3 - Recommend: Use rank_next_best_actions + search_products (Lakebase BM25 index) to find the best retention play.
Phase 4 - Act: ONLY after the user explicitly approves, call execute_nba_action (auto-drafts a stakeholder memo).
Phase 5 - Verify: Use get_action_history to confirm the committed write is persisted.
Phase 6 - Export: Use export_decision_chain to produce a complete, record-ID-linked audit trail.

Always explain tradeoffs (predicted retained value, cost, net value) before recommending.
Never execute an action without explicit user approval.
After executing an action, always show the auto-drafted memo and offer to export the decision chain."""


def run_agent(messages):
    """Run the agent loop with tool calling via Databricks Foundation Model."""
    host = DATABRICKS_HOST.rstrip("/")
    if not host.startswith("https://"):
        host = f"https://{host}"
    w = WorkspaceClient()
    auth = w.config.authenticate()
    if callable(auth):
        headers = auth({})
    else:
        headers = auth
    token = headers.get("Authorization", "").replace("Bearer ", "")
    client = OpenAI(api_key=token, base_url=f"{host}/serving-endpoints")

    full_messages = [{"role": "system", "content": SYSTEM_PROMPT}] + messages
    max_turns = 8

    for _ in range(max_turns):
        resp = client.chat.completions.create(
            model="databricks-claude-sonnet-4-5",
            messages=full_messages,
            tools=TOOLS,
            tool_choice="auto",
        )
        msg = resp.choices[0].message
        full_messages.append(msg.model_dump())

        if not msg.tool_calls:
            return msg.content

        for tc in msg.tool_calls:
            fn = tc.function.name
            args = json.loads(tc.function.arguments)
            if fn == "find_atrisk_customer":
                result = find_atrisk_customer(args.get("customer_id"))
            elif fn == "search_products":
                result = search_products(args["query"])
            elif fn == "rank_next_best_actions":
                result = rank_next_best_actions(args["customer_id"])
            elif fn == "what_if_analysis":
                result = what_if_analysis(**args)
            elif fn == "execute_nba_action":
                result = execute_nba_action(**args)
            elif fn == "get_action_history":
                result = get_action_history(args["customer_id"])
            elif fn == "export_decision_chain":
                result = export_decision_chain(args["customer_id"])
            else:
                result = {"error": f"Unknown tool: {fn}"}

            full_messages.append({
                "role": "tool", "tool_call_id": tc.id,
                "content": json.dumps(result, default=str),
            })

    return full_messages[-1].get("content", "Agent loop exhausted.")


# ─── Dash App ─────────────────────────────────────────────────────────────────
app = dash.Dash(__name__, title="Meridian Relationship Desk")


def load_data():
    """Load at-risk customer data for visualization."""
    try:
        return query("""
            SELECT customer_id, tier, tenure_years, home_metro,
                   attrition_risk_score, total_balance_usd,
                   balance_at_risk_usd, revenue_at_risk_usd, risk_band
            FROM app.customer_position
            WHERE risk_band IN ('critical', 'elevated', 'watch')
            ORDER BY attrition_risk_score DESC
        """)
    except Exception as e:
        print(f"[load_data] error: {e}")
        return []


def load_metrics():
    """Load aggregate KPIs."""
    try:
        rows = query("""
            SELECT COALESCE(SUM(balance_at_risk_usd), 0) AS bal,
                   COALESCE(SUM(revenue_at_risk_usd), 0) AS rev,
                   COUNT(*) FILTER (WHERE risk_band = 'critical') AS crit,
                   COUNT(*) AS total
            FROM app.customer_position
            WHERE risk_band IN ('critical', 'elevated', 'watch')
        """)
        return rows[0] if rows else {"bal": 0, "rev": 0, "crit": 0, "total": 0}
    except Exception as e:
        print(f"[load_metrics] error: {e}")
        return {"bal": 0, "rev": 0, "crit": 0, "total": 0}


COLOR_MAP = {"critical": "#E5484D", "elevated": "#FFB020", "watch": "#3C6997", "healthy": "#094074"}

app.layout = html.Div([
    html.Div([
        html.H1("Meridian Relationship Desk", style={"margin": 0, "color": "#094074"}),
        html.P("Customer Retention AI", style={"margin": 0, "color": "#666"}),
    ], style={"padding": "20px 30px", "background": "#F5F7FB", "borderBottom": "1px solid #ddd"}),

    # KPI Row
    html.Div(id="kpi-row", style={"display": "flex", "gap": "20px", "padding": "20px 30px"}),

    # Scatter Plot
    html.Div([
        dcc.Graph(id="scatter-chart", style={"height": "450px"}),
    ], style={"padding": "0 30px"}),

    # Chat Section
    html.Div([
        html.H3("AI Assistant", style={"color": "#094074"}),
        dcc.Loading(id="chat-loading", type="dot", color="#094074", children=[
            html.Div(id="chat-history", style={
                "height": "300px", "overflowY": "auto", "border": "1px solid #ddd",
                "borderRadius": "8px", "padding": "15px", "marginBottom": "10px",
                "background": "#fafafa",
            }),
        ]),
        html.Div([
            dcc.Input(id="chat-input", type="text", placeholder="Ask about at-risk customers...",
                      style={"flex": 1, "padding": "10px", "borderRadius": "6px", "border": "1px solid #ccc"}),
            html.Button("Send", id="send-btn", n_clicks=0,
                        style={"padding": "10px 20px", "background": "#094074", "color": "white",
                               "border": "none", "borderRadius": "6px", "cursor": "pointer"}),
        ], style={"display": "flex", "gap": "10px"}),
        # Suggested prompts
        html.Div([
            html.Button("Why is CUST-0000214 at risk?", id="chip-1", n_clicks=0,
                        style={"padding": "6px 12px", "border": "1px solid #094074", "borderRadius": "16px",
                               "background": "white", "color": "#094074", "cursor": "pointer", "fontSize": "12px"}),
            html.Button("Rank next best actions for CUST-0000214", id="chip-2", n_clicks=0,
                        style={"padding": "6px 12px", "border": "1px solid #094074", "borderRadius": "16px",
                               "background": "white", "color": "#094074", "cursor": "pointer", "fontSize": "12px"}),
            html.Button("What-if: offer 5% CD to CUST-0000214", id="chip-3", n_clicks=0,
                        style={"padding": "6px 12px", "border": "1px solid #094074", "borderRadius": "16px",
                               "background": "white", "color": "#094074", "cursor": "pointer", "fontSize": "12px"}),
            html.Button("Export decision chain for CUST-0000214", id="chip-4", n_clicks=0,
                        style={"padding": "6px 12px", "border": "1px solid #094074", "borderRadius": "16px",
                               "background": "white", "color": "#094074", "cursor": "pointer", "fontSize": "12px"}),
        ], style={"display": "flex", "gap": "8px", "marginTop": "10px", "flexWrap": "wrap"}),
    ], style={"padding": "20px 30px"}),

    # Hidden stores
    dcc.Store(id="chat-store", data=[]),
    dcc.Interval(id="init-interval", interval=1000, max_intervals=1),
], style={"fontFamily": "Inter, system-ui, sans-serif", "maxWidth": "1200px", "margin": "0 auto"})


@callback(
    Output("kpi-row", "children"),
    Output("scatter-chart", "figure"),
    Input("init-interval", "n_intervals"),
)
def init_dashboard(_):
    metrics = load_metrics()
    data = load_data()

    kpis = [
        make_kpi("Balance at Risk", f"${metrics['bal']:,.0f}", "#E5484D"),
        make_kpi("Revenue at Risk", f"${metrics['rev']:,.0f}", "#E5484D"),
        make_kpi("Critical Customers", str(metrics["crit"]), "#E5484D"),
        make_kpi("At-Risk Total", str(metrics["total"]), "#FFB020"),
    ]

    if data:
        import pandas as pd
        df = pd.DataFrame(data)
        fig = px.scatter(
            df, x="total_balance_usd", y="attrition_risk_score",
            color="risk_band", color_discrete_map=COLOR_MAP,
            hover_data=["customer_id", "tier", "home_metro"],
            labels={"total_balance_usd": "Total Balance ($)", "attrition_risk_score": "Attrition Risk Score"},
            title="At-Risk Customer Map: Balance vs. Risk",
        )
        fig.update_layout(plot_bgcolor="white", paper_bgcolor="white")
    else:
        fig = go.Figure()
        fig.add_annotation(text="Loading data...", xref="paper", yref="paper", x=0.5, y=0.5, showarrow=False)

    return kpis, fig


def make_kpi(label, value, color):
    return html.Div([
        html.Div(value, style={"fontSize": "28px", "fontWeight": "700", "color": color}),
        html.Div(label, style={"fontSize": "13px", "color": "#666", "marginTop": "4px"}),
    ], style={"flex": 1, "padding": "20px", "background": "white", "borderRadius": "8px",
             "boxShadow": "0 1px 3px rgba(0,0,0,0.1)", "textAlign": "center"})


@callback(
    Output("chat-store", "data"),
    Output("chat-history", "children"),
    Output("chat-input", "value"),
    Input("send-btn", "n_clicks"),
    Input("chip-1", "n_clicks"),
    Input("chip-2", "n_clicks"),
    Input("chip-3", "n_clicks"),
    Input("chip-4", "n_clicks"),
    State("chat-input", "value"),
    State("chat-store", "data"),
    prevent_initial_call=True,
)
def handle_chat(send_clicks, chip1, chip2, chip3, chip4, input_val, history):
    triggered = dash.callback_context.triggered
    print(f"[chat] triggered={triggered}, input='{input_val}'")

    if not triggered or triggered[0]["value"] is None:
        return no_update, no_update, no_update

    trigger_id = triggered[0]["prop_id"].split(".")[0]
    if trigger_id == "chip-1":
        user_msg = "Why is CUST-0000214 at risk?"
    elif trigger_id == "chip-2":
        user_msg = "Rank next best actions for CUST-0000214"
    elif trigger_id == "chip-3":
        user_msg = "Run a what-if analysis for CUST-0000214: offer a 5.0% APY 18-month CD (PROD-DEP-2001)"
    elif trigger_id == "chip-4":
        user_msg = "Export the full decision chain for CUST-0000214"
    elif trigger_id == "send-btn":
        user_msg = input_val
    else:
        return no_update, no_update, no_update

    if not user_msg or not user_msg.strip():
        return no_update, no_update, no_update

    print(f"[chat] user_msg='{user_msg}', calling agent...")
    history = history or []
    history.append({"role": "user", "content": user_msg})

    try:
        response = run_agent(history)
        print(f"[chat] agent response (first 100): {str(response)[:100]}")
        history.append({"role": "assistant", "content": response or "(empty response)"})
    except Exception as e:
        print(f"[chat] agent ERROR: {e}")
        import traceback
        traceback.print_exc()
        history.append({"role": "assistant", "content": f"Error: {str(e)}"})

    chat_divs = []
    for msg in history:
        is_user = msg["role"] == "user"
        if is_user:
            bubble = html.Div(msg["content"] or "", style={
                "display": "inline-block", "padding": "8px 14px", "borderRadius": "12px",
                "background": "#094074", "color": "white", "maxWidth": "80%",
                "whiteSpace": "pre-wrap",
            })
        else:
            bubble = html.Div(
                dcc.Markdown(msg["content"] or "", style={"margin": 0}),
                style={
                    "display": "inline-block", "padding": "10px 16px", "borderRadius": "12px",
                    "background": "#e8ecf0", "color": "#333", "maxWidth": "85%",
                },
            )
        chat_divs.append(html.Div(
            bubble,
            style={"textAlign": "right" if is_user else "left", "marginBottom": "8px"},
        ))

    return history, chat_divs, ""


if __name__ == "__main__":
    print(f"[app] Starting Meridian Relationship Desk on port {PORT}")
    print(f"[app] PGHOST={DB_HOST}, PGDATABASE={DB_NAME}")
    app.run(host="0.0.0.0", port=PORT, debug=False)
