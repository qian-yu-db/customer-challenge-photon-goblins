### Business challenge

Meridian Bank is struggling with two problems: customer attrition and missed cross-sell. Attrition is customers quietly closing accounts or moving balances elsewhere, usually after signals a banker would have caught, such as a direct deposit stopping or balances draining over several weeks. Missed cross-sell is the opposite: a customer who already qualifies for a product they would want is never offered it, because the relationship manager works from an overnight extract and cannot see the whole picture. Attrition runs ~12%/yr, roughly 216K customers a year at an average relationship value of ~$500/yr, and missed next-best-action cross-sell leaves an estimated ~$15M/yr of product-holding revenue on the table. And the fix has to be AI-assisted without the AI spend running open-ended - in a heavily audited industry, an ungoverned next-best-action assistant adds cost and regulatory risk at once.



### What they want to solve

Give relationship managers a real-time customer 360 and a next-best-action recommendation they can act on during the call, without exposing broad personally identifiable information.


### Business outcomes to defend

#### ~$1.1M/yr
Per point of attrition avoided

#### ~$3-4M/yr
Cross-sell uplift

#### Audit-ready
Reduced PII exposure with auditable AI

#### Real-time
Overnight extracts to live RM decisions


### Current Databricks estate

- A lakehouse holding accounts, transactions, and customer profiles.
- Feeds risk models and regulatory reporting under strong Unity Catalog governance.
- But relationship managers work from static overnight extracts and cannot see a live customer picture.
- Broad personally identifiable information exposure is a constant compliance concern.


### Who you are building for · business personas

#### Yusuf Demirel
EVP Consumer & Small Business Banking
He cares about attrition and cross-sell: ~$1.1M/yr for every point of attrition avoided, and the ~$15M/yr of next-best-action revenue currently left on the table.

“Did the relationship manager do something different on this call than they would have yesterday?”

#### Wen Jiang
Director of Technology Finance
They care about total AI spend across the bank, not just this app. This use case is one line in a portfolio that must be forecast, charged back to the business units, and defended to a regulator who asks how the number was derived. The ~$300K/yr here matters mainly as a share of that whole.

“How does this fit the company-wide AI budget, and what does it displace?”

### Who you are building for · technical personas

#### Sinead Gallagher
Head of Data Platform Engineering
She cares about serving the customer 360 to a relationship manager screen in real time, without copying personally identifiable information into yet another system to do it.

“Can we serve this live without making a second copy of customer data?”

#### Marisol Otero
Platform Engineering Lead, Banking Technology
She was asked why the relationship manager app recommended a product offer that the client escalated a complaint about, so she cares about tracing that next-best-action back through the account and transaction data behind it. The investigation touches customer records, so it has to happen without exposing more than she is cleared to see, and it has to leave a trail an examiner would accept.

“Can I investigate this and hand an examiner the trail?”

