# Databricks notebook source
"""
Meridian Bank — Retention & Cross-Sell Radar : synthetic data generation.

DAB setup-job task version — catalog/schema come from job widgets (base_parameters),
so the same generator lands data on any target. Uses the notebook's injected `spark`.

Writes 4 raw parquet datasets into the UC Volume raw_data/ landing zone:
  customers (~20K), accounts (~45K), transactions (~1.1M), balance_weekly (~1.17M)

Story shaping (see specifications/01-lakeflow.md):
  - A ~600-customer drifting cohort (Affluent-skewed, Harbor/Bayview/Highland branches)
    whose payroll stops ~5 weeks ago and whose balances drain 55-90% over 6 weeks,
    peaking in the at-risk trend ~3 weeks ago (never at the chart's right edge).
  - A ~1,500-customer cross-sell-ready cohort holding Checking (+maybe Savings) with
    strong balances but missing one high-value product they qualify for.
"""
from pyspark.sql import functions as F
from datetime import datetime, timedelta

dbutils.widgets.text("catalog", "", "Catalog")
dbutils.widgets.text("schema", "", "Schema")
CATALOG = dbutils.widgets.get("catalog")
SCHEMA = dbutils.widgets.get("schema")
assert CATALOG and SCHEMA, "catalog + schema are required"
VOL = f"/Volumes/{CATALOG}/{SCHEMA}/raw_data"

spark.sql(f"CREATE SCHEMA IF NOT EXISTS {CATALOG}.{SCHEMA}")
spark.sql(f"CREATE VOLUME IF NOT EXISTS {CATALOG}.{SCHEMA}.raw_data")

# ---- Time anchors (Monday-aligned weeks) ----
NOW = datetime.now()
this_monday = (NOW - timedelta(days=NOW.weekday())).replace(hour=0, minute=0, second=0, microsecond=0)
N_WEEKS = 26
WEEK0 = this_monday - timedelta(weeks=N_WEEKS - 1)          # oldest week (index 0)
RUNOFF_START_W = N_WEEKS - 1 - 6     # ~6 weeks ago  -> 19
PAYROLL_STOP_W = N_WEEKS - 1 - 5     # ~5 weeks ago  -> 20
RISK_PEAK_W    = N_WEEKS - 1 - 3     # ~3 weeks ago  -> 22
TXN_DAYS = 180
TXN_START = NOW - timedelta(days=TXN_DAYS)
PAYROLL_STOP_DATE = WEEK0 + timedelta(weeks=PAYROLL_STOP_W)

print(f"NOW={NOW.date()} WEEK0={WEEK0.date()} PAYROLL_STOP={PAYROLL_STOP_DATE.date()} "
      f"runoff_w={RUNOFF_START_W} payroll_stop_w={PAYROLL_STOP_W} peak_w={RISK_PEAK_W}")

N_CUSTOMERS = 20000

# Branch -> region map
BRANCHES = {
    "Downtown": "East", "Riverside": "East", "Harbor": "East", "Uptown": "East",
    "Lakeside": "Central", "Meadowbrook": "Central", "Fairview": "Central", "Oakhill": "Central",
    "Bayview": "West", "Highland": "West", "Summit": "West", "Parkway": "West",
}
COHORT_BRANCHES = ["Harbor", "Bayview", "Highland"]

PROD_REV = {
    "Checking": 40, "Savings": 60, "High-Yield Savings": 180, "Credit Card": 220,
    "Auto Loan": 350, "Mortgage": 500, "Small Business Line": 900, "Wealth Management": 1400,
}

# =====================================================================
# 1) CUSTOMERS
# =====================================================================
# Spark-native name pools (faker not available on serverless workers)
FIRST = ["James","Mary","John","Patricia","Robert","Jennifer","Michael","Linda","David","Elizabeth",
         "William","Barbara","Richard","Susan","Joseph","Jessica","Thomas","Sarah","Christopher","Karen",
         "Daniel","Nancy","Matthew","Lisa","Anthony","Betty","Mark","Sandra","Amir","Wei","Sofia","Priya",
         "Omar","Yuki","Diego","Fatima","Chen","Aisha","Ivan","Lucia"]
LAST = ["Smith","Johnson","Williams","Brown","Jones","Garcia","Miller","Davis","Rodriguez","Martinez",
        "Hernandez","Lopez","Gonzalez","Wilson","Anderson","Thomas","Taylor","Moore","Jackson","Martin",
        "Lee","Perez","Thompson","White","Harris","Sanchez","Clark","Ramirez","Demirel","Jiang",
        "Gallagher","Otero","Okonkwo","Nguyen","Kowalski","Rossi","Andersson","Haddad","Petrov","Kim"]
first_arr = F.array(*[F.lit(x) for x in FIRST])
last_arr = F.array(*[F.lit(x) for x in LAST])

def pick(arr, n, salt):
    return arr[(F.abs(F.hash(F.col("id") + F.lit(salt))) % n)]

cust = spark.range(0, N_CUSTOMERS, numPartitions=16).withColumn("r", F.rand(seed=11))
cust = cust.withColumn("segment",
    F.when(F.col("r") < 0.65, F.lit("Mass Market"))
     .when(F.col("r") < 0.90, F.lit("Affluent"))
     .otherwise(F.lit("Small Business")))

branch_arr = F.array(*[F.lit(b) for b in BRANCHES.keys()])
cust = cust.withColumn("branch_idx", (F.rand(seed=22) * F.lit(len(BRANCHES))).cast("int"))
cust = cust.withColumn("home_branch", branch_arr.getItem(F.col("branch_idx")))
branch_region = F.create_map(*sum([[F.lit(b), F.lit(r)] for b, r in BRANCHES.items()], []))
cust = cust.withColumn("branch_region", branch_region.getItem(F.col("home_branch")))

cust = cust.withColumn("tenure_months", (F.rand(seed=33) * 239 + 1).cast("int"))
cust = cust.withColumn("registration_date",
    F.expr("date_sub(current_date(), cast(tenure_months*30 as int))"))

cust = cust.withColumn("rv_base",
    F.when(F.col("segment") == "Affluent", F.lit(1150.0))
     .when(F.col("segment") == "Small Business", F.lit(1400.0))
     .otherwise(F.lit(350.0)))
cust = cust.withColumn("relationship_value_usd",
    F.round(F.col("rv_base") * (F.lit(0.6) + F.rand(seed=44) * 0.9), 2))

# ---- Drifting cohort selection: ~600, Affluent-skewed, in cohort branches ----
cust = cust.withColumn("cohort_eligible",
    (F.col("home_branch").isin(COHORT_BRANCHES)) &
    ((F.col("segment") == "Affluent") | (F.rand(seed=55) < 0.15)))
cust = cust.withColumn("cohort_pick", F.when(F.col("cohort_eligible"), F.rand(seed=66)).otherwise(F.lit(2.0)))
elig_ct = cust.filter(F.col("cohort_pick") < 1.5).count()
frac = min(1.0, 600.0 / max(1, elig_ct))
thr = cust.filter(F.col("cohort_pick") < 1.5).approxQuantile("cohort_pick", [frac], 0.01)[0]
cust = cust.withColumn("is_cohort", F.col("cohort_pick") <= F.lit(thr))
print("cohort eligible pool:", elig_ct, "threshold frac:", frac)

# Cohort drift shape: staggered runoff-start over a WIDE window (weeks 14..18) ramping over ~4
# weeks to a runoff target (0.55..0.90) → at-risk count builds up over several weeks and peaks
# ~3 weeks ago (RISK_PEAK_W=22), not at the chart's right edge.
cust = cust.withColumn("runoff_start_w",
    F.when(F.col("is_cohort"), (F.lit(14) + (F.rand(seed=77) * 5).cast("int"))).otherwise(F.lit(999)))
cust = cust.withColumn("runoff_target",
    F.when(F.col("is_cohort"), F.lit(0.55) + F.rand(seed=88) * 0.35).otherwise(F.lit(0.0)))
# ~25% of the cohort RECOVER (direct deposit reinstated) after peaking → peak-then-decay shape.
cust = cust.withColumn("recovers", F.when(F.col("is_cohort"), F.rand(seed=89) < 0.25).otherwise(F.lit(False)))
cust = cust.withColumn("gets_payroll",
    F.when(F.col("is_cohort"), F.lit(True)).otherwise(F.rand(seed=99) < 0.85))

cust = cust.withColumn("customer_id", F.concat(F.lit("CUST-"), F.lpad(F.col("id").cast("string"), 6, "0")))
cust = cust.withColumn("first_name", pick(first_arr, len(FIRST), 7)) \
           .withColumn("last_name", pick(last_arr, len(LAST), 13)) \
           .withColumn("rm_first", pick(first_arr, len(FIRST), 101)) \
           .withColumn("rm_last", pick(last_arr, len(LAST), 103)) \
           .withColumn("rm_name", F.concat_ws(" ", F.col("rm_first"), F.col("rm_last"))) \
           .withColumn("email", F.concat(F.lower(F.col("first_name")), F.lit("."),
                                          F.lower(F.col("last_name")), F.col("id").cast("string"), F.lit("@example.com"))) \
           .withColumn("ssn_masked", F.concat(F.lit("***-**-"), F.lpad((F.col("id") % 10000).cast("string"), 4, "0")))

customers_out = cust.select(
    "customer_id", "first_name", "last_name", "email", "ssn_masked", "segment",
    "home_branch", "branch_region", "registration_date", "tenure_months",
    "relationship_value_usd", "rm_name",
    "is_cohort", "runoff_start_w", "runoff_target", "gets_payroll", "recovers")
customers_out.write.mode("overwrite").saveAsTable(f"{CATALOG}.{SCHEMA}._gen_customers")
print("customers rows:", spark.table(f"{CATALOG}.{SCHEMA}._gen_customers").count())
c = spark.table(f"{CATALOG}.{SCHEMA}._gen_customers")
print("cohort count:", c.filter("is_cohort").count())

# =====================================================================
# 2) ACCOUNTS  (1-4 per customer; product mix drives cross-sell eligibility)
# =====================================================================
acc = c.select("customer_id", "segment", "home_branch", "is_cohort", "gets_payroll") \
    .withColumn("has_savings", F.rand(seed=101) < 0.55) \
    .withColumn("has_hys", F.rand(seed=102) < 0.20) \
    .withColumn("has_cc", F.rand(seed=103) < 0.45) \
    .withColumn("has_auto", F.rand(seed=104) < 0.15) \
    .withColumn("has_mortgage", F.rand(seed=105) < 0.18) \
    .withColumn("has_sbl", F.when(F.col("segment") == "Small Business", F.rand(seed=106) < 0.45).otherwise(F.lit(False))) \
    .withColumn("has_wealth", F.when(F.col("segment") == "Affluent", F.rand(seed=107) < 0.30).otherwise(F.lit(False)))

acc = acc.withColumn("xsell_seed", F.rand(seed=108))
acc = acc.withColumn("xsell_ready",
    (~F.col("is_cohort")) & (F.col("xsell_seed") < 0.09))
acc = acc.withColumn("has_hys", F.when(F.col("xsell_ready") & (F.col("segment") != "Small Business"), F.lit(False)).otherwise(F.col("has_hys")))
acc = acc.withColumn("has_sbl", F.when(F.col("xsell_ready") & (F.col("segment") == "Small Business"), F.lit(False)).otherwise(F.col("has_sbl")))

def flag(colname, prod):
    return F.when(F.col(colname), F.array(F.lit(prod))).otherwise(F.array())
prod_list = F.concat(
    F.array(F.lit("Checking")),
    flag("has_savings", "Savings"),
    flag("has_hys", "High-Yield Savings"),
    flag("has_cc", "Credit Card"),
    flag("has_auto", "Auto Loan"),
    flag("has_mortgage", "Mortgage"),
    flag("has_sbl", "Small Business Line"),
    flag("has_wealth", "Wealth Management"),
)
acc = acc.withColumn("prod_list", prod_list)
acc_exp = acc.select("customer_id", "segment", "home_branch", "is_cohort", "xsell_ready",
                     F.posexplode("prod_list").alias("pos", "account_type"))

acc_exp = acc_exp.withColumn("account_id",
    F.concat(F.lit("ACCT-"), F.lpad(F.abs(F.hash(F.concat("customer_id", "account_type"))).cast("string"), 8, "0")))
acc_exp = acc_exp.withColumn("is_primary_deposit", F.col("account_type") == F.lit("Checking"))

acc_exp = acc_exp.withColumn("bal_seed", F.rand(seed=201))
acc_exp = acc_exp.withColumn("peak_balance_usd",
    F.round(
        F.when(F.col("account_type") == "Checking",
               F.when(F.col("xsell_ready"), F.lit(35000.0) + F.col("bal_seed") * 40000)
                .when(F.col("segment") == "Affluent", F.lit(20000.0) + F.col("bal_seed") * 30000)
                .when(F.col("segment") == "Small Business", F.lit(25000.0) + F.col("bal_seed") * 45000)
                .otherwise(F.lit(2500.0) + F.col("bal_seed") * 6000))
         .when(F.col("account_type").isin("Savings", "High-Yield Savings"),
               F.lit(8000.0) + F.col("bal_seed") * 30000)
         .when(F.col("account_type").isin("Credit Card"), -(F.lit(500.0) + F.col("bal_seed") * 4000))
         .when(F.col("account_type").isin("Auto Loan"), -(F.lit(8000.0) + F.col("bal_seed") * 20000))
         .when(F.col("account_type").isin("Mortgage"), -(F.lit(150000.0) + F.col("bal_seed") * 250000))
         .when(F.col("account_type").isin("Small Business Line"), F.lit(20000.0) + F.col("bal_seed") * 80000)
         .otherwise(F.lit(50000.0) + F.col("bal_seed") * 150000),
    2))
acc_exp = acc_exp.withColumn("open_date", F.expr("date_sub(current_date(), cast(rand()*2000+120 as int))"))
acc_exp = acc_exp.withColumn("status", F.lit("open"))

accounts_out = acc_exp.select("account_id", "customer_id", "account_type",
                              F.col("peak_balance_usd").alias("balance_usd"),
                              "open_date", "status", "is_primary_deposit", "peak_balance_usd", "xsell_ready")
accounts_out.write.mode("overwrite").saveAsTable(f"{CATALOG}.{SCHEMA}._gen_accounts")
print("accounts rows:", spark.table(f"{CATALOG}.{SCHEMA}._gen_accounts").count())

# =====================================================================
# 3) BALANCE_WEEKLY  (26 weekly snapshots per account; cohort primary drains)
# =====================================================================
a = spark.table(f"{CATALOG}.{SCHEMA}._gen_accounts") \
    .join(c.select("customer_id", "is_cohort", "runoff_start_w", "runoff_target", "recovers"), "customer_id")

weeks_df = spark.range(0, N_WEEKS).withColumnRenamed("id", "w")
bw = a.crossJoin(weeks_df)
bw = bw.withColumn("week_start", F.expr(f"date_add(to_date('{WEEK0.date()}'), cast(w*7 as int))"))
bw = bw.withColumn("noise", F.lit(1.0) + (F.rand(seed=301) - 0.5) * 0.06)

RAMP_WEEKS = 4.0
drain_ramp = (F.col("w") - F.col("runoff_start_w")) / F.lit(RAMP_WEEKS)
drain_ramp = F.least(F.lit(1.0), F.greatest(F.lit(0.0), drain_ramp))
rec_start = F.col("runoff_start_w") + F.lit(RAMP_WEEKS) + F.lit(1.0)
rec_ramp = F.least(F.lit(1.0), F.greatest(F.lit(0.0), (F.col("w") - rec_start) / F.lit(3.0)))
eff_ramp = F.when(F.col("recovers"), drain_ramp * (F.lit(1.0) - rec_ramp)).otherwise(drain_ramp)
progress = F.when(F.col("is_cohort") & F.col("is_primary_deposit"), F.col("runoff_target") * eff_ramp).otherwise(F.lit(0.0))
bw = bw.withColumn("progress", progress)
bw = bw.withColumn("balance_usd",
    F.round(F.col("peak_balance_usd") * (F.lit(1.0) - F.col("progress")) * F.col("noise"), 2))

balance_out = bw.select("account_id", "customer_id", "week_start", "balance_usd")
balance_out.write.mode("overwrite").parquet(f"{VOL}/balance_weekly")
print("balance_weekly rows:", spark.read.parquet(f"{VOL}/balance_weekly").count())

latest = bw.filter(F.col("w") == N_WEEKS - 1).select("account_id", F.col("balance_usd").alias("cur_bal"))
acc_final = spark.table(f"{CATALOG}.{SCHEMA}._gen_accounts").join(latest, "account_id", "left")
acc_final = acc_final.withColumn("balance_usd", F.coalesce(F.col("cur_bal"), F.col("balance_usd")))
acc_final.select("account_id", "customer_id", "account_type", "balance_usd",
                 "open_date", "status").write.mode("overwrite").parquet(f"{VOL}/accounts")
print("accounts parquet rows:", spark.read.parquet(f"{VOL}/accounts").count())

c.select("customer_id", "first_name", "last_name", "email", "ssn_masked", "segment",
         "home_branch", "branch_region", "registration_date", "tenure_months",
         "relationship_value_usd", "rm_name").write.mode("overwrite").parquet(f"{VOL}/customers")
print("customers parquet rows:", spark.read.parquet(f"{VOL}/customers").count())

# =====================================================================
# 4) TRANSACTIONS  (~1.1M: ~850K mixed + payroll)
# =====================================================================
N_MIXED = 850000
prim = spark.table(f"{CATALOG}.{SCHEMA}._gen_accounts") \
    .filter("is_primary_deposit") \
    .select("customer_id", "account_id")
prim = prim.withColumn("cidx", (F.abs(F.hash("customer_id")) % N_CUSTOMERS))
mixed = spark.range(0, N_MIXED, numPartitions=32).withColumn("cidx", (F.abs(F.hash("id")) % N_CUSTOMERS))
mixed = mixed.join(prim, "cidx")
mixed = mixed.withColumn("txn_date",
    F.expr(f"from_unixtime(unix_timestamp(to_timestamp('{TXN_START}')) + cast(rand()*{TXN_DAYS*86400} as int))").cast("timestamp"))
r = F.rand(seed=401)
mixed = mixed.withColumn("txn_type",
    F.when(r < 0.40, F.lit("purchase"))
     .when(r < 0.60, F.lit("withdrawal"))
     .when(r < 0.75, F.lit("bill_pay"))
     .when(r < 0.88, F.lit("transfer"))
     .otherwise(F.lit("fee")))
mixed = mixed.withColumn("amount_usd", F.round(-(F.lit(5.0) + F.rand(seed=402) * 400), 2))
ch = F.rand(seed=403)
mixed = mixed.withColumn("channel",
    F.when(ch < 0.45, F.lit("mobile")).when(ch < 0.7, F.lit("online"))
     .when(ch < 0.85, F.lit("atm")).otherwise(F.lit("branch")))
mixed = mixed.withColumn("transaction_id", F.concat(F.lit("TXN-M-"), F.col("id").cast("string")))
mixed_out = mixed.select("transaction_id", "account_id", "customer_id", "txn_date", "amount_usd", "txn_type", "channel")

pay_cust = c.filter("gets_payroll").select(
    "customer_id", "is_cohort", "recovers", "runoff_start_w", "relationship_value_usd")
pay_cust = pay_cust.join(prim, "customer_id")
pay_cust = pay_cust.withColumn("stop_date",
    F.expr(f"date_add(to_date('{WEEK0.date()}'), cast(runoff_start_w*7 as int))"))
pay_cust = pay_cust.withColumn("resume_date", F.expr("date_add(stop_date, 35)"))
paydays = spark.range(0, 13).withColumn("payday",
    F.expr(f"date_sub(to_date('{NOW.date()}'), cast(id*14 as int))"))
pay = pay_cust.crossJoin(paydays)
pay = pay.filter(
    (~F.col("is_cohort"))
    | (F.col("payday") < F.col("stop_date"))
    | (F.col("recovers") & (F.col("payday") >= F.col("resume_date"))))
pay = pay.withColumn("amount_usd", F.round(F.lit(1200.0) + F.rand(seed=501) * 3500, 2))
pay = pay.withColumn("txn_date", F.col("payday").cast("timestamp"))
pay = pay.withColumn("txn_type",
    F.when(F.rand(seed=502) < 0.5, F.lit("payroll")).otherwise(F.lit("direct_deposit")))
pay = pay.withColumn("channel", F.lit("ach"))
pay = pay.withColumn("transaction_id",
    F.concat(F.lit("TXN-P-"), F.col("customer_id"), F.lit("-"), F.col("payday").cast("string")))
pay_out = pay.select("transaction_id", "account_id", "customer_id", "txn_date", "amount_usd", "txn_type", "channel")

txns_out = mixed_out.unionByName(pay_out)
txns_out.write.mode("overwrite").parquet(f"{VOL}/transactions")
print("transactions rows:", spark.read.parquet(f"{VOL}/transactions").count())

spark.sql(f"DROP TABLE IF EXISTS {CATALOG}.{SCHEMA}._gen_customers")
spark.sql(f"DROP TABLE IF EXISTS {CATALOG}.{SCHEMA}._gen_accounts")
print("DONE")
